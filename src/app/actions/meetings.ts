"use server";
import { redirect } from "next/navigation";
import type { MeetingStatus, ReplyIntent } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INTENTS } from "@/lib/engine/intent";
import { cancelMeeting, recordMeeting } from "@/lib/meetings/record";
import { zonedToUtc } from "@/lib/meetings/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData, params: Record<string, string>) => {
  const target = str(f, "back") || "/meetings";
  const [base, query] = target.split("?");
  const q = new URLSearchParams(query);
  q.delete("notice");
  q.delete("error");
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  redirect(`${base}?${q}`);
};

/** A teammate corrects what a reply means. Interested → the booking link goes out at the next tick. */
export async function setReplyIntent(form: FormData) {
  await requireUser();
  const cc = await db.campaignContact.findUniqueOrThrow({ where: { id: str(form, "ccId") }, include: { campaign: true, contact: true } });
  const intent = str(form, "intent") as ReplyIntent;
  if (!INTENTS.includes(intent)) back(form, { error: "Unknown reply type." });
  const wantsLink = intent === "INTERESTED" && cc.campaign.autoBookingReply && cc.campaign.bookingMode !== "OFF" && !cc.bookingReplySentAt && !cc.meetingBookedAt;
  await db.campaignContact.update({
    where: { id: cc.id },
    data: {
      replyIntent: intent,
      replyIntentBy: "person",
      bookingReplyDueAt: cc.bookingReplySentAt ? cc.bookingReplyDueAt : wantsLink ? new Date() : null,
      ...(intent === "UNSUBSCRIBE" ? { status: "UNSUBSCRIBED", nextStepAt: null } : {}),
    },
  });
  if (intent === "UNSUBSCRIBE" && cc.campaign.mode === "LIVE" && !cc.contact.unsubscribedAt) {
    await db.contact.update({ where: { id: cc.contactId }, data: { unsubscribedAt: new Date() } });
  }
  back(form, { notice: wantsLink ? "Marked as interested. The booking link goes out within a minute." : "Reply type updated." });
}

export async function sendBookingLinkNow(form: FormData) {
  await requireUser();
  const cc = await db.campaignContact.findUniqueOrThrow({ where: { id: str(form, "ccId") }, include: { campaign: true } });
  if (cc.campaign.bookingMode === "OFF") back(form, { error: "Booking is turned off for this campaign. Turn it on in the campaign's settings." });
  await db.campaignContact.update({ where: { id: cc.id }, data: { bookingReplyDueAt: new Date(), bookingReplySentAt: null } });
  back(form, { notice: cc.bookingReplySentAt ? "The booking link will be sent again within a minute." : "The booking link goes out within a minute." });
}

export async function holdBookingLink(form: FormData) {
  await requireUser();
  await db.campaignContact.update({ where: { id: str(form, "ccId") }, data: { bookingReplyDueAt: null } });
  back(form, { notice: "The booking link will not be sent. Answer them yourself from the mailbox." });
}

/** Record a meeting arranged some other way (phone, a reply with times, a colleague's calendar). */
export async function addMeeting(form: FormData) {
  await requireUser();
  const cc = await db.campaignContact.findUniqueOrThrow({ where: { id: str(form, "ccId") }, include: { campaign: true, contact: true, mailbox: true } });
  const local = str(form, "when"); // yyyy-mm-ddThh:mm in the campaign's time zone
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const startsAt = m ? zonedToUtc(+m[1], +m[2], +m[3], +m[4] * 60 + +m[5], cc.campaign.timezone) : null;
  await recordMeeting({ source: "MANUAL", email: cc.contact.email, startsAt, notes: str(form, "notes") || null, enrollment: cc });
  back(form, { notice: `Meeting recorded for ${cc.contact.email}.` });
}

export async function setMeetingStatus(form: FormData) {
  await requireUser();
  const meeting = await db.meeting.findUniqueOrThrow({ where: { id: str(form, "meetingId") } });
  const status = str(form, "status") as MeetingStatus;
  if (!["BOOKED", "HELD", "NO_SHOW", "CANCELED"].includes(status)) back(form, { error: "Unknown status." });
  if (status === "CANCELED") await cancelMeeting(meeting, "Canceled by a teammate");
  else await db.meeting.update({ where: { id: meeting.id }, data: { status } });
  const label: Record<string, string> = { BOOKED: "booked", HELD: "held", NO_SHOW: "a no-show", CANCELED: "canceled" };
  back(form, { notice: `Meeting marked as ${label[status]}.` });
}
