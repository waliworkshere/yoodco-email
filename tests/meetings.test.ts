import { describe, expect, it } from "vitest";
import { classifyByRules, cleanReply } from "../src/lib/engine/intent";
import { availableSlots, isSlotAvailable, type Availability } from "../src/lib/meetings/slots";
import { buildInvite, parseInvite } from "../src/lib/meetings/ics";
import { zonedToUtc } from "../src/lib/meetings/time";
import { bookingToolFromEmail, parseBookingWebhook, prefillBookingUrl } from "../src/lib/meetings/webhook";

describe("reading replies", () => {
  const cases: [string, string][] = [
    ["Sounds interesting, happy to have a quick call next week.", "INTERESTED"],
    ["Yes, send me your calendar link", "INTERESTED"],
    ["Sure, what times work for you?", "INTERESTED"],
    ["Please remove me from your list.", "UNSUBSCRIBE"],
    ["Unsubscribe", "UNSUBSCRIBE"],
    ["Thanks, but we're not interested.", "NOT_INTERESTED"],
    ["We already work with an agency for this.", "NOT_INTERESTED"],
    ["Not right now, maybe next quarter.", "NOT_NOW"],
    ["I'm not the right person, you should reach out to Sarah in ops.", "WRONG_PERSON"],
    ["How is this different from HubSpot?", "QUESTION"],
    ["Received.", "OTHER"],
  ];
  for (const [text, intent] of cases) it(`${intent}: ${text}`, () => expect(classifyByRules(text)).toBe(intent));

  it("ignores the quoted original email", () => {
    const reply = "Not interested, thanks.\n\nOn Mon, Nov 9, 2026 at 10:02 Charles <charles@yood.ai> wrote:\n> Worth a 15-minute look? Interested?";
    expect(cleanReply(reply)).toBe("Not interested, thanks.");
    expect(classifyByRules(reply)).toBe("NOT_INTERESTED");
  });
});

describe("booking slots", () => {
  const a: Availability = { timezone: "America/Chicago", days: [1, 2, 3, 4, 5], startMinute: 600, endMinute: 1020, durationMin: 30, noticeHours: 12, horizonDays: 7 };
  const now = new Date("2026-11-04T12:00:00Z"); // Wednesday, 06:00 in Chicago

  it("offers weekday times in the host's time zone, after the notice period", () => {
    const slots = availableSlots(a, [], now);
    expect(slots.length).toBeGreaterThan(20);
    for (const s of slots) {
      const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(s);
      expect(local).not.toMatch(/Sat|Sun/);
      expect(s.getTime()).toBeGreaterThanOrEqual(now.getTime() + 12 * 3600_000);
    }
    // First slot: Thursday 10:00 Chicago = 16:00 UTC (CST, after the November clock change)
    expect(slots[0].toISOString()).toBe("2026-11-05T16:00:00.000Z");
  });

  it("never offers a time that overlaps a booked meeting", () => {
    const busy = [{ start: new Date("2026-11-05T16:00:00Z"), end: new Date("2026-11-05T16:30:00Z") }];
    const slots = availableSlots(a, busy, now);
    expect(slots.some((s) => s.toISOString() === "2026-11-05T16:00:00.000Z")).toBe(false);
    expect(isSlotAvailable(new Date("2026-11-05T16:30:00Z"), a, busy, now)).toBe(true);
  });

  it("handles daylight saving changes", () => {
    expect(zonedToUtc(2026, 7, 1, 600, "America/Chicago").toISOString()).toBe("2026-07-01T15:00:00.000Z");
    expect(zonedToUtc(2026, 12, 1, 600, "America/Chicago").toISOString()).toBe("2026-12-01T16:00:00.000Z");
  });
});

describe("calendar invites", () => {
  it("builds an invite that reads back the same", () => {
    const ics = buildInvite({
      uid: "abc@yood-outreach",
      method: "REQUEST",
      start: new Date("2026-11-10T16:00:00Z"),
      end: new Date("2026-11-10T16:30:00Z"),
      title: "Intro call: Acme, Inc. × Yood",
      location: "https://meet.google.com/abc-defg-hij",
      organizer: { name: "Charles from Yood", email: "charles@yood.ai" },
      attendees: [{ name: "Maya Laurent", email: "maya@acme.example" }, { email: "lionel@yood.co" }],
    });
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    const back = parseInvite(ics)!;
    expect(back.uid).toBe("abc@yood-outreach");
    expect(back.summary).toBe("Intro call: Acme, Inc. × Yood");
    expect(back.start?.toISOString()).toBe("2026-11-10T16:00:00.000Z");
    expect(back.organizer).toBe("charles@yood.ai");
    expect(back.attendees).toEqual(["maya@acme.example", "lionel@yood.co"]);
  });

  it("reads invites with a named time zone (Google, Outlook)", () => {
    const ics = [
      "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:g123@google.com",
      "DTSTART;TZID=America/Chicago:20261112T143000", "DTEND;TZID=America/Chicago:20261112T150000",
      "SUMMARY:Yood <> Acme", "ORGANIZER;CN=Maya:mailto:maya@acme.example",
      "ATTENDEE;CN=Charles;PARTSTAT=NEEDS-ACTION:mailto:charles@yood.ai", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const inv = parseInvite(ics)!;
    expect(inv.start?.toISOString()).toBe("2026-11-12T20:30:00.000Z");
    expect(inv.organizer).toBe("maya@acme.example");
  });
});

describe("booking webhooks", () => {
  it("reads Calendly", () => {
    const n = parseBookingWebhook({
      event: "invitee.created",
      payload: {
        email: "Maya@Acme.example", name: "Maya Laurent", uri: "https://api.calendly.com/x/invitees/1",
        tracking: { utm_content: "cc_123" },
        scheduled_event: { name: "Intro call", start_time: "2026-11-10T16:00:00.000000Z", end_time: "2026-11-10T16:30:00.000000Z", event_memberships: [{ user_email: "lionel@yood.co" }] },
      },
    })!;
    expect(n).toMatchObject({ kind: "booked", source: "CALENDLY", email: "maya@acme.example", ref: "cc_123", hostEmail: "lionel@yood.co" });
    expect(n.startsAt?.toISOString()).toBe("2026-11-10T16:00:00.000Z");
    expect(parseBookingWebhook({ event: "invitee.canceled", payload: { email: "a@b.co" } })?.kind).toBe("canceled");
  });

  it("reads Cal.com", () => {
    const n = parseBookingWebhook({
      triggerEvent: "BOOKING_CREATED",
      payload: { uid: "u1", title: "Intro", startTime: "2026-11-10T16:00:00Z", attendees: [{ email: "maya@acme.example", name: "Maya" }], organizer: { email: "lionel@yood.co" }, metadata: { yood: "cc_9" } },
    })!;
    expect(n).toMatchObject({ kind: "booked", source: "CAL_COM", externalId: "u1", ref: "cc_9" });
  });

  it("reads a plain JSON post from Zapier or Make", () => {
    const n = parseBookingWebhook({ email: "maya@acme.example", startTime: "2026-11-10T16:00:00Z" })!;
    expect(n.source).toBe("WEBHOOK");
    expect(parseBookingWebhook({ hello: "world" })).toBeNull();
  });

  it("fills in the contact on external booking links", () => {
    const u = new URL(prefillBookingUrl("https://calendly.com/lionel/intro", { name: "Maya Laurent", email: "maya@acme.example" }, "cc_1"));
    expect(u.searchParams.get("email")).toBe("maya@acme.example");
    expect(u.searchParams.get("utm_content")).toBe("cc_1");
    const c = new URL(prefillBookingUrl("https://cal.com/lionel/intro", { email: "maya@acme.example" }, "cc_1"));
    expect(c.searchParams.get("metadata[yood]")).toBe("cc_1");
  });

  it("recognises booking-tool notification emails", () => {
    expect(bookingToolFromEmail("notifications@calendly.com", "New Event: Maya Laurent - 10:00am Tue, Nov 10")).toBe("CALENDLY");
    expect(bookingToolFromEmail("maya@acme.example", "New Event")).toBeNull();
  });
});
