import type { Campaign, CampaignContact, CampaignStep, Contact, Mailbox, Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { randomToken } from "../crypto";
import { renderEmail, type Vars } from "../render";
import { classifySendError, deliver, type DeliveryRoute } from "../mail/transport";
import { stepDelayMs, emailDomain } from "../schedule";
import { checkMailboxHealth } from "./outcomes";

/** "Yood" from yood.ai, unless COMPANY_NAME is set. */
export function companyFromEmail(email: string | null | undefined): string {
  if (env.companyName) return env.companyName;
  const label = emailDomain(email ?? "").split(".")[0] ?? "";
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
}

export type EnrollmentWithAll = CampaignContact & {
  contact: Contact;
  mailbox: Mailbox | null;
  campaign: Campaign & { steps: CampaignStep[] };
};

export interface StepCopy {
  subject: string;
  body: string;
}

/** Copy for a step: the contact's own text from the sheet wins over the campaign template. */
export function copyForStep(cc: Pick<CampaignContact, "content">, steps: CampaignStep[], step: number): StepCopy | null {
  const own = Array.isArray(cc.content) ? (cc.content as unknown as StepCopy[])[step - 1] : undefined;
  const tpl = steps.find((s) => s.order === step);
  const subject = own?.subject?.trim() || tpl?.subject?.trim() || "";
  const body = own?.body?.trim() || tpl?.body?.trim() || "";
  if (!subject && !body) return null;
  return { subject, body };
}

export function varsFor(contact: Contact, mailbox: Mailbox | null, extra: unknown): Vars {
  const sender = mailbox?.displayName ?? "";
  return {
    ...(extra && typeof extra === "object" ? (extra as Vars) : {}),
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    companyName: contact.company,
    company: contact.company,
    email: contact.email,
    senderName: sender,
    senderFirstName: sender.split(" ")[0],
    senderEmail: mailbox?.email,
    senderCompany: companyFromEmail(mailbox?.email),
  };
}

export function messageIdFor(token: string, fromEmail: string) {
  return `<${token}@${emailDomain(fromEmail) || "yoodco.local"}>`;
}

/**
 * Builds the exact email for one enrollment and step. Used for sending, previews and test sends.
 */
export async function composeStep(cc: EnrollmentWithAll, step: number, token: string) {
  const { campaign, contact, mailbox } = cc;
  if (!mailbox) throw new Error("No sending mailbox assigned");
  const copy = copyForStep(cc, campaign.steps, step);
  if (!copy) return null;

  const rendered = renderEmail(copy.subject, copy.body, varsFor(contact, mailbox, cc.variables), {
    appUrl: env.appUrl,
    token,
    trackOpens: campaign.trackOpens,
    trackClicks: campaign.trackClicks,
    signature: mailbox.signature,
    unsubscribeLine: campaign.unsubscribeFooter ? campaign.unsubscribeText : null,
  });

  let subject = rendered.subject;
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  if (campaign.threadFollowUps && step > 1 && cc.threadRootMessageId) {
    const first = await db.message.findFirst({
      where: { campaignContactId: cc.id, step: 1, status: "SENT" },
      select: { subject: true },
    });
    if (first) subject = /^re:/i.test(first.subject) ? first.subject : `Re: ${first.subject}`;
    inReplyTo = cc.lastMessageId ?? cc.threadRootMessageId;
    references = [...new Set([cc.threadRootMessageId, inReplyTo])];
  }
  return { ...rendered, subject, inReplyTo, references };
}

export interface SendResult {
  ok: boolean;
  kind?: "auth" | "recipient" | "transient" | "skipped";
  error?: string;
  messageId?: string;
}

/**
 * Sends the next step for one enrollment and records everything.
 * The scheduler decides *when*; this decides *what* and records the outcome.
 */
export async function sendNextStep(ccId: string, now = new Date()): Promise<SendResult> {
  const cc = await db.campaignContact.findUnique({
    where: { id: ccId },
    include: { contact: true, mailbox: true, campaign: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  if (!cc || !cc.mailbox) return { ok: false, kind: "skipped", error: "No mailbox" };
  const { campaign, contact, mailbox } = cc;
  const lastStep = campaign.steps.length;
  const step = cc.currentStep + 1;

  // Global suppression (live only; test runs may use any address)
  if (campaign.mode === "LIVE" && (contact.unsubscribedAt || contact.bouncedAt)) {
    await db.campaignContact.update({
      where: { id: cc.id },
      data: { status: contact.unsubscribedAt ? "UNSUBSCRIBED" : "BOUNCED", nextStepAt: null },
    });
    return { ok: false, kind: "skipped", error: "Contact is on the suppression list" };
  }
  if (step > lastStep) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { status: "COMPLETED", nextStepAt: null } });
    return { ok: false, kind: "skipped" };
  }

  const token = randomToken();
  const composed = await composeStep(cc, step, token);
  if (!composed) {
    // Nothing written for this step: skip it
    await advance(cc.id, campaign, step, lastStep, now, null, null);
    return { ok: false, kind: "skipped", error: `Step ${step} has no subject or body` };
  }

  const isTest = campaign.mode === "TEST";
  const route: DeliveryRoute = isTest && !campaign.testRedirectTo ? "sandbox" : "mailbox";
  const deliveredTo = isTest && campaign.testRedirectTo ? campaign.testRedirectTo : contact.email;
  const subject = isTest && campaign.testRedirectTo ? `[Test → ${contact.email}] ${composed.subject}` : composed.subject;
  const messageIdHeader = messageIdFor(token, mailbox.email);

  const headers: Record<string, string> = { "X-Yoodco-Campaign": campaign.id };
  if (campaign.unsubscribeFooter) {
    headers["List-Unsubscribe"] = `<${composed.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (isTest) headers["X-Yoodco-Test"] = `original-recipient=${contact.email}`;

  const base: Omit<Prisma.MessageUncheckedCreateInput, "status"> = {
    token,
    campaignId: campaign.id,
    campaignContactId: cc.id,
    mailboxId: mailbox.id,
    step,
    mode: campaign.mode,
    messageIdHeader,
    fromEmail: mailbox.email,
    toEmail: contact.email,
    deliveredTo,
    subject,
    bodyText: composed.text,
    bodyHtml: composed.html,
    links: composed.links,
    sentAt: now,
  };

  try {
    await deliver(
      mailbox,
      {
        from: { name: mailbox.displayName, address: mailbox.email },
        to: deliveredTo,
        subject,
        text: composed.text,
        html: composed.html,
        messageId: messageIdHeader,
        inReplyTo: composed.inReplyTo,
        references: composed.references,
        headers,
      },
      route,
    );
  } catch (err) {
    const kind = classifySendError(err);
    const error = (err as Error).message?.slice(0, 500) ?? "Unknown error";
    const msg = await db.message.create({ data: { ...base, status: "FAILED", error } });
    await db.event.create({
      data: { type: kind === "recipient" ? "BOUNCE" : "FAILED", campaignId: campaign.id, campaignContactId: cc.id, messageId: msg.id, detail: error },
    });
    if (kind === "auth") {
      await db.mailbox.update({
        where: { id: mailbox.id },
        data: { status: "ERROR", statusReason: error, lastError: error, lastErrorAt: now },
      });
      // retry this contact once the mailbox is fixed
    } else if (kind === "recipient") {
      await db.message.update({ where: { id: msg.id }, data: { bouncedAt: now } });
      await db.campaignContact.update({ where: { id: cc.id }, data: { status: "BOUNCED", nextStepAt: null, lastError: error } });
      if (!isTest) {
        await db.contact.update({ where: { id: contact.id }, data: { bouncedAt: now } });
        await checkMailboxHealth(mailbox.id);
      }
    } else {
      const attempts = cc.attempts + 1;
      await db.campaignContact.update({
        where: { id: cc.id },
        data:
          attempts >= 3
            ? { status: "FAILED", attempts, lastError: error, nextStepAt: null }
            : { attempts, lastError: error, nextStepAt: new Date(now.getTime() + attempts * 15 * 60_000) },
      });
      await db.mailbox.update({ where: { id: mailbox.id }, data: { lastError: error, lastErrorAt: now } });
    }
    return { ok: false, kind, error };
  }

  const msg = await db.message.create({ data: { ...base, status: "SENT" } });
  await db.event.create({ data: { type: "SENT", campaignId: campaign.id, campaignContactId: cc.id, messageId: msg.id, createdAt: now } });
  await advance(cc.id, campaign, step, lastStep, now, messageIdHeader, cc.threadRootMessageId);
  await db.mailbox.update({ where: { id: mailbox.id }, data: { lastSentAt: now } });
  return { ok: true, messageId: msg.id };
}

async function advance(
  ccId: string,
  campaign: Campaign & { steps: CampaignStep[] },
  step: number,
  lastStep: number,
  now: Date,
  messageIdHeader: string | null,
  threadRoot: string | null,
) {
  const next = campaign.steps.find((s) => s.order === step + 1);
  const ff = campaign.mode === "TEST" && campaign.testFastForward;
  await db.campaignContact.update({
    where: { id: ccId },
    data: {
      currentStep: step,
      status: step >= lastStep ? "COMPLETED" : "ACTIVE",
      nextStepAt: next ? new Date(now.getTime() + stepDelayMs(next.delayDays, ff)) : null,
      attempts: 0,
      lastError: null,
      ...(messageIdHeader ? { lastMessageId: messageIdHeader, threadRootMessageId: threadRoot ?? messageIdHeader } : {}),
    },
  });
}
