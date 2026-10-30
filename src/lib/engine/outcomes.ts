import type { Message } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { emailDomain, PUBLIC_EMAIL_DOMAINS } from "../schedule";

/**
 * What happens when a person replies, an email bounces, or someone unsubscribes.
 * Shared by the inbox scanner, the tracking routes and the test-mode "simulate" buttons.
 */

const OPEN_STATUSES = ["QUEUED", "ACTIVE"] as const;

export async function applyReply(message: Message, opts: { detail?: string; at?: Date } = {}) {
  const at = opts.at ?? new Date();
  const cc = await db.campaignContact.findUnique({
    where: { id: message.campaignContactId },
    include: { campaign: true, contact: true },
  });
  if (!cc) return;
  if (message.repliedAt) return; // already processed

  await db.message.update({ where: { id: message.id }, data: { repliedAt: at } });
  await db.event.create({
    data: {
      type: "REPLY",
      campaignId: cc.campaignId,
      campaignContactId: cc.id,
      messageId: message.id,
      detail: opts.detail?.slice(0, 500),
      createdAt: at,
    },
  });

  if (cc.campaign.stopOnReply) {
    await db.campaignContact.update({
      where: { id: cc.id },
      data: { status: "REPLIED", repliedAt: at, nextStepAt: null },
    });
  } else if (!cc.repliedAt) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { repliedAt: at } });
  }

  // Stop the sequence for colleagues at the same company
  const domain = emailDomain(cc.contact.email);
  if (cc.campaign.stopOnDomainReply && domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
    const colleagues = await db.campaignContact.findMany({
      where: {
        campaignId: cc.campaignId,
        id: { not: cc.id },
        status: { in: [...OPEN_STATUSES] },
        contact: { email: { endsWith: `@${domain}` } },
      },
      select: { id: true },
    });
    if (colleagues.length) {
      const reason = `${cc.contact.email} (same company) replied`;
      await db.campaignContact.updateMany({
        where: { id: { in: colleagues.map((c) => c.id) } },
        data: { status: "STOPPED", stoppedReason: reason, nextStepAt: null },
      });
      await db.event.createMany({
        data: colleagues.map((c) => ({ type: "STOPPED" as const, campaignId: cc.campaignId, campaignContactId: c.id, detail: reason })),
      });
    }
  }
}

export async function applyAutoReply(message: Message, detail?: string) {
  await db.event.create({
    data: {
      type: "AUTO_REPLY",
      campaignId: message.campaignId,
      campaignContactId: message.campaignContactId,
      messageId: message.id,
      detail: detail?.slice(0, 500),
    },
  });
}

export async function applyBounce(message: Message, detail?: string) {
  if (message.bouncedAt) return;
  const now = new Date();
  await db.message.update({ where: { id: message.id }, data: { bouncedAt: now } });
  const cc = await db.campaignContact.update({
    where: { id: message.campaignContactId },
    data: { status: "BOUNCED", nextStepAt: null, stoppedReason: null },
  });
  // Live bounces suppress the address everywhere; test bounces stay inside the test
  if (message.mode === "LIVE") await db.contact.update({ where: { id: cc.contactId }, data: { bouncedAt: now } });
  await db.event.create({
    data: {
      type: "BOUNCE",
      campaignId: message.campaignId,
      campaignContactId: cc.id,
      messageId: message.id,
      detail: detail?.slice(0, 500),
    },
  });
  if (message.mailboxId && message.mode === "LIVE") await checkMailboxHealth(message.mailboxId);
}

export async function applyUnsubscribe(message: Message) {
  const cc = await db.campaignContact.findUnique({ where: { id: message.campaignContactId } });
  if (!cc) return;
  const contact = await db.contact.findUnique({ where: { id: cc.contactId } });
  if (!contact) return;
  if (!contact.unsubscribedAt && message.mode === "LIVE") {
    await db.contact.update({ where: { id: contact.id }, data: { unsubscribedAt: new Date() } });
  }
  // In live mode stop every running sequence for this person; in test mode only this one
  const affected = await db.campaignContact.findMany({
    where: message.mode === "LIVE" ? { contactId: contact.id, status: { in: [...OPEN_STATUSES] } } : { id: cc.id },
    select: { id: true, campaignId: true },
  });
  await db.campaignContact.updateMany({
    where: { id: { in: affected.map((a) => a.id) } },
    data: { status: "UNSUBSCRIBED", nextStepAt: null },
  });
  const already = await db.event.findFirst({ where: { messageId: message.id, type: "UNSUBSCRIBE" } });
  if (!already) {
    await db.event.create({
      data: { type: "UNSUBSCRIBE", campaignId: message.campaignId, campaignContactId: cc.id, messageId: message.id },
    });
  }
}

/** Pause a mailbox automatically when too many of its recent live emails bounce. */
export async function checkMailboxHealth(mailboxId: string) {
  const recent = await db.message.findMany({
    where: { mailboxId, mode: "LIVE", status: { in: ["SENT", "FAILED"] } },
    orderBy: { sentAt: "desc" },
    take: 50,
    select: { bouncedAt: true },
  });
  if (recent.length < 20) return;
  const rate = recent.filter((m) => m.bouncedAt).length / recent.length;
  if (rate > env.autoPauseBounceRate) {
    await db.mailbox.updateMany({
      where: { id: mailboxId, status: "ACTIVE" },
      data: {
        status: "AUTO_PAUSED",
        statusReason: `Bounce rate ${(rate * 100).toFixed(1)}% over the last ${recent.length} emails. Clean the list, then resume.`,
      },
    });
  }
}
