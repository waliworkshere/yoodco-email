import type { Campaign, CampaignContact, Contact, Mailbox, Meeting, MeetingSource } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { randomToken } from "../crypto";
import { fillTemplate } from "../render";
import { deliver } from "../mail/transport";
import { messageIdFor, varsFor } from "../engine/send";
import { buildInvite } from "./ics";
import { createZoomMeeting, deleteZoomMeeting, zoomSettings } from "../zoom";
import type { Availability, Busy } from "./slots";

/**
 * Recording meetings, whichever way they were booked, and keeping the contact's sequence in step:
 * a booked meeting stops the follow-ups and cancels a booking-link reply that has not gone out yet.
 */

type Enrollment = CampaignContact & { contact: Contact; campaign: Campaign; mailbox: Mailbox | null };

export function availabilityFor(c: Campaign): Availability {
  return {
    timezone: c.timezone,
    days: c.meetingDays,
    startMinute: c.meetingStart,
    endMinute: c.meetingEnd,
    durationMin: c.meetingDurationMin,
    noticeHours: c.meetingNoticeHours,
    horizonDays: c.meetingHorizonDays,
  };
}

export function hostFor(c: Campaign, mailbox: Mailbox | null): string {
  return (c.meetingHostEmail || mailbox?.email || "").toLowerCase();
}

/** Meetings already booked with this host, so the booking page never offers the same time twice. */
export async function busyFor(hostEmail: string, exceptMeetingId?: string): Promise<Busy[]> {
  const rows = await db.meeting.findMany({
    where: { hostEmail, status: "BOOKED", startsAt: { gt: new Date(Date.now() - 86_400_000) }, ...(exceptMeetingId ? { id: { not: exceptMeetingId } } : {}) },
    select: { startsAt: true, endsAt: true },
  });
  return rows
    .filter((r) => r.startsAt)
    .map((r) => ({ start: r.startsAt!, end: r.endsAt ?? new Date(r.startsAt!.getTime() + 30 * 60_000) }));
}

/** The enrollment a booking belongs to: by our reference if the link carried it, otherwise by email address. */
export async function findEnrollment(ref: string | null, email: string): Promise<Enrollment | null> {
  const include = { contact: true, campaign: true, mailbox: true } as const;
  if (ref) {
    const byId = await db.campaignContact.findUnique({ where: { id: ref }, include });
    if (byId) return byId;
    const msg = await db.message.findUnique({ where: { token: ref }, select: { campaignContactId: true } });
    if (msg) return db.campaignContact.findUnique({ where: { id: msg.campaignContactId }, include });
  }
  const rows = await db.campaignContact.findMany({
    where: { contact: { email: email.toLowerCase() }, currentStep: { gt: 0 } },
    include,
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  // Prefer live campaigns, then the most recent conversation
  return rows.find((r) => r.campaign.mode === "LIVE") ?? rows[0] ?? null;
}

export interface MeetingInput {
  source: MeetingSource;
  email: string;
  name?: string | null;
  title?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  hostEmail?: string | null;
  location?: string | null;
  externalId?: string | null;
  notes?: string | null;
  ref?: string | null;
  enrollment?: Enrollment | null;
}

export async function recordMeeting(input: MeetingInput): Promise<{ meeting: Meeting; matched: boolean; created: boolean }> {
  const cc = input.enrollment ?? (await findEnrollment(input.ref ?? null, input.email));
  const existing = input.externalId ? await db.meeting.findUnique({ where: { externalId: input.externalId } }) : null;
  const data = {
    campaignId: cc?.campaignId ?? null,
    campaignContactId: cc?.id ?? null,
    mode: cc?.campaign.mode ?? ("LIVE" as const),
    source: input.source,
    status: "BOOKED" as const,
    email: input.email.toLowerCase(),
    name: input.name ?? ([cc?.contact.firstName, cc?.contact.lastName].filter(Boolean).join(" ") || null),
    company: cc?.contact.company ?? null,
    title: input.title ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? (input.startsAt ? new Date(input.startsAt.getTime() + (cc?.campaign.meetingDurationMin ?? 30) * 60_000) : null),
    hostEmail: input.hostEmail?.toLowerCase() ?? (cc ? hostFor(cc.campaign, cc.mailbox) : null),
    location: input.location ?? null,
    notes: input.notes ?? null,
  };
  const meeting = existing
    ? await db.meeting.update({ where: { id: existing.id }, data: { ...data, campaignId: existing.campaignId ?? data.campaignId, campaignContactId: existing.campaignContactId ?? data.campaignContactId } })
    : await db.meeting.create({ data: { ...data, externalId: input.externalId ?? null } });

  if (cc && (!existing || existing.status === "CANCELED")) {
    const keep = ["BOUNCED", "UNSUBSCRIBED"].includes(cc.status);
    await db.campaignContact.update({
      where: { id: cc.id },
      data: {
        ...(keep ? {} : { status: "MEETING", nextStepAt: null }),
        meetingBookedAt: new Date(),
        ...(cc.bookingReplySentAt ? {} : { bookingReplyDueAt: null }),
      },
    });
    const when = meeting.startsAt ? meetingWhen(meeting.startsAt, cc.campaign.timezone) : "time not given";
    await db.event.create({
      data: { type: "MEETING", campaignId: cc.campaignId, campaignContactId: cc.id, detail: `${sourceLabel(input.source)} · ${when}` },
    });
  }
  return { meeting, matched: Boolean(cc), created: !existing };
}

export async function cancelMeeting(meeting: Meeting, reason = "Canceled") {
  if (meeting.status === "CANCELED") return meeting;
  if (meeting.videoId) await deleteZoomMeeting(meeting.videoId).catch(() => undefined);
  const updated = await db.meeting.update({ where: { id: meeting.id }, data: { status: "CANCELED", notes: [meeting.notes, reason].filter(Boolean).join(" · ") } });
  if (meeting.campaignContactId) {
    const others = await db.meeting.count({ where: { campaignContactId: meeting.campaignContactId, status: { in: ["BOOKED", "HELD"] }, id: { not: meeting.id } } });
    const cc = await db.campaignContact.findUnique({ where: { id: meeting.campaignContactId } });
    if (cc && !others) {
      await db.campaignContact.update({
        where: { id: cc.id },
        data: { meetingBookedAt: null, ...(cc.status === "MEETING" ? { status: cc.repliedAt ? "REPLIED" : "STOPPED", stoppedReason: cc.repliedAt ? null : "Meeting canceled" } : {}) },
      });
    }
    if (cc) await db.event.create({ data: { type: "MEETING_CANCELED", campaignId: cc.campaignId, campaignContactId: cc.id, detail: reason } });
  }
  return updated;
}

/** "Thu 5 Nov, 11:00 AM CST" in the campaign's time zone. */
export function meetingWhen(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}

export const SOURCE_LABEL: Record<MeetingSource, string> = {
  BOOKING_PAGE: "Booking page",
  CALENDLY: "Calendly",
  CAL_COM: "Cal.com",
  CALENDAR_INVITE: "Calendar invite",
  WEBHOOK: "Webhook",
  MANUAL: "Added by hand",
};
export const sourceLabel = (s: MeetingSource) => SOURCE_LABEL[s] ?? s;

/**
 * Sends the calendar invite for a meeting booked on our page, from the contact's sending mailbox,
 * to the contact and the host. In test mode it is captured like every other test email.
 */
export async function sendInvite(meeting: Meeting, cc: Enrollment, method: "REQUEST" | "CANCEL" = "REQUEST") {
  const { campaign, contact, mailbox } = cc;
  if (!mailbox || !meeting.startsAt || !meeting.endsAt) return;
  const vars = varsFor(contact, mailbox, cc.variables);
  const title = fillTemplate(campaign.meetingTitle, vars).trim() || "Intro call";
  const host = hostFor(campaign, mailbox);
  const attendees = [{ name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null, email: contact.email }];
  if (host && host !== mailbox.email.toLowerCase()) attendees.push({ name: null, email: host });
  const location = meeting.location || (campaign.meetingLocation ? fillTemplate(campaign.meetingLocation, vars) : null);
  const description = [
    `Booked by ${contact.email}${contact.company ? ` (${contact.company})` : ""}.`,
    location ? `Join: ${location}` : "",
    `Need another time? ${env.appUrl}/b/${meeting.id}`,
  ]
    .filter(Boolean)
    .join("\n");
  const ics = buildInvite({
    uid: `${meeting.id}@yood-outreach`,
    method,
    start: meeting.startsAt,
    end: meeting.endsAt,
    title,
    description,
    location,
    organizer: { name: mailbox.displayName, email: mailbox.email },
    attendees,
    sequence: method === "CANCEL" ? 1 : 0,
  });

  const isTest = campaign.mode === "TEST";
  const route = isTest && !campaign.testRedirectTo ? "sandbox" : "mailbox";
  const to = isTest && campaign.testRedirectTo ? campaign.testRedirectTo : contact.email;
  const cc2 = !isTest && host && host !== mailbox.email.toLowerCase() ? host : undefined;
  const token = randomToken();
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: campaign.timezone, dateStyle: "full", timeStyle: "short" });
  const subject = `${method === "CANCEL" ? "Canceled" : "Invitation"}: ${title} · ${fmt.format(meeting.startsAt)} (${campaign.timezone.replace(/_/g, " ")})`;
  const text = `${method === "CANCEL" ? "This meeting was canceled." : "You're booked."}\n\n${title}\n${fmt.format(meeting.startsAt)} (${campaign.timezone.replace(/_/g, " ")})\n${location ? `\nJoin: ${location}\n` : ""}\nNeed another time? ${env.appUrl}/b/${meeting.id}\n`;
  const messageIdHeader = messageIdFor(token, mailbox.email);
  await deliver(
    mailbox,
    {
      from: { name: mailbox.displayName, address: mailbox.email },
      to,
      cc: cc2,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${text
        .split("\n")
        .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;"))
        .join("<br>")}</div>`,
      messageId: messageIdHeader,
      icalEvent: { method, content: ics },
    },
    route,
  );
  await db.message.create({
    data: {
      token,
      campaignId: campaign.id,
      campaignContactId: cc.id,
      mailboxId: mailbox.id,
      step: cc.currentStep,
      kind: "INVITE",
      mode: campaign.mode,
      status: "SENT",
      messageIdHeader,
      fromEmail: mailbox.email,
      toEmail: contact.email,
      deliveredTo: to,
      subject,
      bodyText: text,
      bodyHtml: "",
      links: [],
    },
  });
}

/**
 * Gives a meeting booked on our page its video link: a fresh Zoom meeting when the campaign uses Zoom
 * and Zoom is connected (live campaigns only), otherwise the campaign's fixed link.
 */
export async function attachVideo(meeting: Meeting, cc: Enrollment): Promise<Meeting> {
  const c = cc.campaign;
  if (c.meetingVideo !== "ZOOM" || !meeting.startsAt) return meeting;
  if (c.mode === "TEST") return db.meeting.update({ where: { id: meeting.id }, data: { location: "Zoom link (created for live bookings)" } });
  const z = await zoomSettings();
  if (!z.connected) return meeting;
  try {
    const title = fillTemplate(c.meetingTitle, varsFor(cc.contact, cc.mailbox, cc.variables)).trim() || "Intro call";
    const zm = await createZoomMeeting({
      topic: title,
      start: meeting.startsAt,
      durationMin: c.meetingDurationMin,
      timezone: c.timezone,
      agenda: `Booked by ${cc.contact.email}${cc.contact.company ? ` (${cc.contact.company})` : ""} via Yood Outreach.`,
    });
    return db.meeting.update({ where: { id: meeting.id }, data: { location: zm.joinUrl, videoId: zm.id } });
  } catch (err) {
    await db.meeting.update({ where: { id: meeting.id }, data: { notes: [meeting.notes, `Zoom: ${(err as Error).message}`].filter(Boolean).join(" · ") } });
    return meeting;
  }
}
