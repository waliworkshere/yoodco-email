import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseBookingWebhook } from "@/lib/meetings/webhook";
import { cancelMeeting, recordMeeting } from "@/lib/meetings/record";

/**
 * Booking webhook for Calendly, Cal.com, Zapier, Make, HubSpot … The secret key is part of the URL:
 *   POST /api/meetings/<MEETING_WEBHOOK_KEY>
 * Settings shows the exact address to paste into each tool.
 */
export const dynamic = "force-dynamic";

function allowed(key: string) {
  const expected = env.meetingWebhookKey;
  if (!expected || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!allowed(key)) return Response.json({ ok: false, error: "Unknown webhook address" }, { status: 404 });
  return Response.json({ ok: true, message: "Booking webhook is ready. Send bookings here with POST." });
}

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!allowed(key)) return Response.json({ ok: false, error: "Unknown webhook address" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Send JSON" }, { status: 400 });
  }
  const notice = parseBookingWebhook(body);
  if (!notice) return Response.json({ ok: true, ignored: "No attendee email in this notification" });

  if (notice.kind === "canceled") {
    const existing = notice.externalId ? await db.meeting.findUnique({ where: { externalId: notice.externalId } }) : null;
    if (existing) await cancelMeeting(existing, `Canceled in ${notice.source === "CALENDLY" ? "Calendly" : notice.source === "CAL_COM" ? "Cal.com" : "the booking tool"}`);
    return Response.json({ ok: true, canceled: Boolean(existing) });
  }
  const { meeting, matched, created } = await recordMeeting({
    source: notice.source,
    email: notice.email,
    name: notice.name,
    title: notice.title,
    startsAt: notice.startsAt,
    endsAt: notice.endsAt,
    hostEmail: notice.hostEmail,
    location: notice.location,
    externalId: notice.externalId,
    ref: notice.ref,
  });
  return Response.json({ ok: true, meeting: meeting.id, matched, created });
}
