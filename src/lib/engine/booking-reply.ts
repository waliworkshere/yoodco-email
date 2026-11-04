import { db } from "../db";
import { env } from "../env";
import { randomToken } from "../crypto";
import { renderEmail } from "../render";
import { classifySendError, deliver } from "../mail/transport";
import { messageIdFor, varsFor } from "./send";

/**
 * Answers interested replies with the booking link, in the same thread, from the same mailbox,
 * a few minutes after the reply arrives (seconds in a fast-forward test) so it reads like a person.
 * Sent whatever the sending window, because a warm lead should not wait until tomorrow.
 */

export async function pendingBookingReplies(where: { campaignId?: string } = {}) {
  return db.campaignContact.count({ where: { ...where, bookingReplyDueAt: { not: null }, bookingReplySentAt: null } });
}

export async function sendDueBookingReplies(now = new Date(), where: { campaignId?: string } = {}) {
  const due = await db.campaignContact.findMany({
    where: { ...where, bookingReplyDueAt: { lte: now }, bookingReplySentAt: null },
    include: { contact: true, mailbox: true, campaign: true },
    orderBy: { bookingReplyDueAt: "asc" },
    take: 10,
  });
  let sent = 0;
  for (const cc of due) {
    const { campaign, contact, mailbox } = cc;
    const skip = async (reason: string) => {
      await db.campaignContact.update({ where: { id: cc.id }, data: { bookingReplyDueAt: null } });
      await db.event.create({ data: { type: "STOPPED", campaignId: cc.campaignId, campaignContactId: cc.id, detail: `Booking link not sent: ${reason}` } });
    };
    if (!mailbox) {
      await skip("no sending mailbox");
      continue;
    }
    if (campaign.bookingMode === "OFF") {
      await skip("booking is turned off for this campaign");
      continue;
    }
    if (["UNSUBSCRIBED", "BOUNCED", "MEETING"].includes(cc.status) || cc.meetingBookedAt) {
      await db.campaignContact.update({ where: { id: cc.id }, data: { bookingReplyDueAt: null } });
      continue;
    }
    const isTest = campaign.mode === "TEST";
    if (!isTest && mailbox.status !== "ACTIVE") {
      // Try again when the mailbox is back
      await db.campaignContact.update({ where: { id: cc.id }, data: { bookingReplyDueAt: new Date(now.getTime() + 15 * 60_000) } });
      continue;
    }

    const last = await db.message.findFirst({ where: { campaignContactId: cc.id, kind: "SEQUENCE", status: "SENT" }, orderBy: { sentAt: "desc" } });
    const baseSubject = (last?.subject ?? "Quick question").replace(/^\[Test → [^\]]+\]\s*/, "").replace(/^(re:\s*)+/i, "");
    const token = randomToken();
    const rendered = renderEmail(`Re: ${baseSubject}`, campaign.bookingReplyText, varsFor(contact, mailbox, cc.variables), {
      appUrl: env.appUrl,
      token,
      trackOpens: false,
      trackClicks: false, // the booking link records its own visits
      signature: null,
      unsubscribeLine: null,
    });
    const route = isTest && !campaign.testRedirectTo ? "sandbox" : "mailbox";
    const deliveredTo = isTest && campaign.testRedirectTo ? campaign.testRedirectTo : contact.email;
    const subject = isTest && campaign.testRedirectTo ? `[Test → ${contact.email}] ${rendered.subject}` : rendered.subject;
    const messageIdHeader = messageIdFor(token, mailbox.email);
    const inReplyTo = cc.replyMessageId ?? cc.lastMessageId ?? undefined;
    const references = [...new Set([cc.threadRootMessageId, cc.lastMessageId, cc.replyMessageId].filter((x): x is string => Boolean(x)))];

    try {
      await deliver(
        mailbox,
        {
          from: { name: mailbox.displayName, address: mailbox.email },
          to: deliveredTo,
          subject,
          text: rendered.text,
          html: rendered.html,
          messageId: messageIdHeader,
          inReplyTo,
          references: references.length ? references : undefined,
          headers: { "X-Yoodco-Campaign": campaign.id, ...(isTest ? { "X-Yoodco-Test": `original-recipient=${contact.email}` } : {}) },
        },
        route,
      );
    } catch (err) {
      const error = (err as Error).message?.slice(0, 300) ?? "Unknown error";
      const kind = classifySendError(err);
      await db.campaignContact.update({
        where: { id: cc.id },
        data: { lastError: `Booking link: ${error}`, bookingReplyDueAt: kind === "recipient" ? null : new Date(now.getTime() + 15 * 60_000) },
      });
      if (kind === "auth") await db.mailbox.update({ where: { id: mailbox.id }, data: { status: "ERROR", statusReason: error, lastError: error, lastErrorAt: now } });
      continue;
    }

    const msg = await db.message.create({
      data: {
        token,
        campaignId: campaign.id,
        campaignContactId: cc.id,
        mailboxId: mailbox.id,
        step: cc.currentStep,
        kind: "BOOKING_REPLY",
        mode: campaign.mode,
        status: "SENT",
        messageIdHeader,
        fromEmail: mailbox.email,
        toEmail: contact.email,
        deliveredTo,
        subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        links: rendered.links,
        sentAt: now,
      },
    });
    await db.campaignContact.update({ where: { id: cc.id }, data: { bookingReplySentAt: now, bookingReplyDueAt: null, lastMessageId: messageIdHeader } });
    await db.event.create({ data: { type: "BOOKING_LINK_SENT", campaignId: campaign.id, campaignContactId: cc.id, messageId: msg.id, createdAt: now } });
    await db.mailbox.update({ where: { id: mailbox.id }, data: { lastSentAt: now } });
    sent++;
  }
  return sent;
}
