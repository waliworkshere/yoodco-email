import { headers } from "next/headers";
import { db } from "../db";
import { isLikelyBot } from "../tracking";

/**
 * Resolves a booking link. The link carries either the token of the email it was in
 * (/b/<message token>) or, in a calendar invite, the meeting id (to pick another time).
 */
export async function resolveBooking(token: string) {
  const include = { contact: true, campaign: true, mailbox: true } as const;
  const msg = await db.message.findUnique({ where: { token } });
  let ccId = msg?.campaignContactId;
  let meetingId: string | null = null;
  if (!ccId) {
    const m = await db.meeting.findUnique({ where: { id: token } });
    if (m?.campaignContactId) {
      ccId = m.campaignContactId;
      meetingId = m.id;
    }
  }
  if (!ccId) return null;
  const cc = await db.campaignContact.findUnique({ where: { id: ccId }, include });
  if (!cc) return null;
  const current = meetingId
    ? await db.meeting.findUnique({ where: { id: meetingId } })
    : await db.meeting.findFirst({ where: { campaignContactId: cc.id, status: "BOOKED" }, orderBy: { createdAt: "desc" } });
  return { cc, message: msg, current: current?.status === "BOOKED" ? current : null };
}

/** Records that the booking link was opened, as a click on the email it came from (scanners flagged). */
export async function recordBookingVisit(message: { id: string; campaignId: string; campaignContactId: string; sentAt: Date; firstClickedAt: Date | null; firstOpenedAt: Date | null }) {
  const h = await headers();
  const ua = h.get("user-agent");
  const now = new Date();
  const bot = isLikelyBot(ua, message.sentAt, now, "click");
  const recent = await db.event.findFirst({
    where: { messageId: message.id, type: "CLICK", url: "Booking page", createdAt: { gt: new Date(now.getTime() - 60_000) } },
  });
  if (recent) return;
  await db.event.create({
    data: {
      type: "CLICK",
      campaignId: message.campaignId,
      campaignContactId: message.campaignContactId,
      messageId: message.id,
      url: "Booking page",
      userAgent: ua?.slice(0, 300),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      likelyBot: bot,
    },
  });
  if (!bot) {
    await db.message.update({
      where: { id: message.id },
      data: { clickCount: { increment: 1 }, firstClickedAt: message.firstClickedAt ?? now, firstOpenedAt: message.firstOpenedAt ?? now },
    });
  }
}
