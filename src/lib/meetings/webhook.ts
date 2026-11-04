import type { MeetingSource } from "@prisma/client";

/**
 * Reads booking notifications from Calendly, Cal.com, or anything else that can POST JSON
 * (Zapier, Make, n8n, HubSpot workflows …) into one shape.
 */
export interface BookingNotice {
  kind: "booked" | "canceled";
  source: MeetingSource;
  externalId: string | null;
  email: string;
  name: string | null;
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  hostEmail: string | null;
  location: string | null;
  /** Our reference passed through the booking link (utm_content / metadata), when present. */
  ref: string | null;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const d = (v: unknown): Date | null => {
  const t = s(v) ?? (typeof v === "number" ? new Date(v).toISOString() : null);
  if (!t) return null;
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function parseBookingWebhook(body: unknown): BookingNotice | null {
  const b = o(body);

  // Calendly (webhook v2): { event: "invitee.created", payload: { email, name, scheduled_event, tracking } }
  if (typeof b.event === "string" && b.event.startsWith("invitee.")) {
    const p = o(b.payload);
    const ev = o(p.scheduled_event);
    const email = s(p.email);
    if (!email) return null;
    const host = (Array.isArray(ev.event_memberships) ? ev.event_memberships : []).map((m) => s(o(m).user_email)).find(Boolean) ?? null;
    return {
      kind: b.event === "invitee.canceled" ? "canceled" : "booked",
      source: "CALENDLY",
      externalId: s(p.uri) ?? s(ev.uri),
      email: email.toLowerCase(),
      name: s(p.name),
      title: s(ev.name),
      startsAt: d(ev.start_time),
      endsAt: d(ev.end_time),
      hostEmail: host,
      location: s(o(ev.location).join_url) ?? s(o(ev.location).location),
      ref: s(o(p.tracking).utm_content),
    };
  }

  // Cal.com: { triggerEvent: "BOOKING_CREATED", payload: { uid, title, startTime, attendees, organizer, metadata } }
  if (typeof b.triggerEvent === "string") {
    const p = o(b.payload);
    const attendee = o(Array.isArray(p.attendees) ? p.attendees[0] : null);
    const email = s(attendee.email);
    if (!email) return null;
    const meta = o(p.metadata);
    const responses = o(p.responses);
    return {
      kind: /CANCEL/i.test(b.triggerEvent) ? "canceled" : "booked",
      source: "CAL_COM",
      externalId: s(p.uid) ?? (p.bookingId != null ? String(p.bookingId) : null),
      email: email.toLowerCase(),
      name: s(attendee.name),
      title: s(p.title),
      startsAt: d(p.startTime),
      endsAt: d(p.endTime),
      hostEmail: s(o(p.organizer).email),
      location: s(meta.videoCallUrl) ?? s(p.location),
      ref: s(meta.yood) ?? s(o(responses.yood).value) ?? s(responses.yood),
    };
  }

  // Anything else: { email, name?, startTime?, endTime?, title?, id?, status?, ref? }
  const email = s(b.email) ?? s(b.attendee_email) ?? s(b.invitee_email);
  if (!email) return null;
  const status = (s(b.status) ?? s(b.event) ?? "").toLowerCase();
  return {
    kind: /cancel/.test(status) ? "canceled" : "booked",
    source: "WEBHOOK",
    externalId: s(b.id) ?? s(b.uid) ?? s(b.bookingId),
    email: email.toLowerCase(),
    name: s(b.name),
    title: s(b.title),
    startsAt: d(b.startTime ?? b.start_time ?? b.start ?? b.startsAt),
    endsAt: d(b.endTime ?? b.end_time ?? b.end ?? b.endsAt),
    hostEmail: s(b.hostEmail ?? b.host_email ?? b.organizer),
    location: s(b.location),
    ref: s(b.ref) ?? s(b.utm_content),
  };
}

/** Booking-tool notification emails ("New Event: …" from Calendly, "New booking" from Cal.com). */
export function bookingToolFromEmail(from: string, subject: string): MeetingSource | null {
  if (/calendly\.com/i.test(from) && /(new event|scheduled|booked)/i.test(subject)) return "CALENDLY";
  if (/cal\.com/i.test(from) && /(new (event|booking)|confirmed|scheduled|booked)/i.test(subject)) return "CAL_COM";
  if (/(hubspot|acuityscheduling|savvycal|zcal|youcanbook\.me|calendar-notification@google\.com)/i.test(from) && /(booked|new (meeting|appointment|event)|scheduled|appointment)/i.test(subject))
    return "CALENDAR_INVITE";
  return null;
}

/** Adds the contact's name and email, plus our reference, to an external booking link. */
export function prefillBookingUrl(url: string, contact: { name?: string | null; email: string }, ref: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase();
  if (contact.name) u.searchParams.set("name", contact.name);
  u.searchParams.set("email", contact.email);
  if (host.endsWith("calendly.com")) {
    u.searchParams.set("utm_source", "yood-outreach");
    u.searchParams.set("utm_content", ref);
  } else if (host.endsWith("cal.com") || host.includes("cal.")) {
    u.searchParams.set("metadata[yood]", ref);
  } else {
    u.searchParams.set("utm_source", "yood-outreach");
    u.searchParams.set("utm_content", ref);
  }
  return u.toString();
}
