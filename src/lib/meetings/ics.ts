import { isValidTimezone, zonedToUtc } from "./time";

/**
 * Calendar invites (iCalendar, RFC 5545): building the invite we send for meetings booked
 * on our page, and reading invites that arrive in connected inboxes.
 */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? " " : "") + line.slice(i, i + 73));
  return parts.join("\r\n");
}

export interface InviteInput {
  uid: string;
  method: "REQUEST" | "CANCEL";
  start: Date;
  end: Date;
  title: string;
  description?: string;
  location?: string | null;
  organizer: { name?: string; email: string };
  attendees: { name?: string | null; email: string }[];
  sequence?: number;
}

export function buildInvite(i: InviteInput): string {
  const cn = (n?: string | null) => (n ? `;CN=${JSON.stringify(n.replace(/"/g, "'"))}` : "");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Yood Outreach//Meetings//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(i.start)}`,
    `DTEND:${stamp(i.end)}`,
    `SUMMARY:${esc(i.title)}`,
    ...(i.description ? [`DESCRIPTION:${esc(i.description)}`] : []),
    ...(i.location ? [`LOCATION:${esc(i.location)}`] : []),
    `ORGANIZER${cn(i.organizer.name)}:mailto:${i.organizer.email}`,
    ...i.attendees.map((a) => `ATTENDEE${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `SEQUENCE:${i.sequence ?? 0}`,
    `STATUS:${i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export interface ParsedInvite {
  method: string;
  uid: string | null;
  summary: string | null;
  start: Date | null;
  end: Date | null;
  organizer: string | null;
  attendees: string[];
  status: string | null;
  location: string | null;
}

function parseDate(params: string, value: string): Date | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)));
    const tz = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2];
    if (tz && isValidTimezone(tz)) return zonedToUtc(+y, +mo, +d, +h * 60 + +mi, tz);
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)));
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

export function parseInvite(ics: string): ParsedInvite | null {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: ParsedInvite = { method: "", uid: null, summary: null, start: null, end: null, organizer: null, attendees: [], status: null, location: null };
  let inEvent = false;
  let seenEvent = false;
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...rest] = head.split(";");
    const params = rest.join(";");
    const key = name.toUpperCase();
    if (key === "METHOD") out.method = value.trim().toUpperCase();
    if (key === "BEGIN" && value.trim().toUpperCase() === "VEVENT") {
      if (seenEvent) break; // only the first event
      inEvent = seenEvent = true;
      continue;
    }
    if (key === "END" && value.trim().toUpperCase() === "VEVENT") inEvent = false;
    if (!inEvent) continue;
    if (key === "UID") out.uid = value.trim();
    if (key === "SUMMARY") out.summary = unesc(value.trim());
    if (key === "LOCATION") out.location = unesc(value.trim());
    if (key === "STATUS") out.status = value.trim().toUpperCase();
    if (key === "DTSTART") out.start = parseDate(params, value);
    if (key === "DTEND") out.end = parseDate(params, value);
    const mail = value.match(/mailto:([^\s;]+)/i)?.[1]?.toLowerCase() ?? null;
    if (key === "ORGANIZER") out.organizer = mail;
    if (key === "ATTENDEE" && mail && !out.attendees.includes(mail)) out.attendees.push(mail);
  }
  return seenEvent ? out : null;
}
