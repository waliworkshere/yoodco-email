import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sourceLabel } from "@/lib/meetings/record";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every live meeting, for reporting or invoicing per meeting. ?mode=TEST for test-run bookings. */
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("Sign in first", { status: 401 });
  const mode = new URL(req.url).searchParams.get("mode") === "TEST" ? "TEST" : "LIVE";
  const rows = await db.meeting.findMany({ where: { mode }, include: { campaign: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const header = ["bookedAt", "startsAt", "status", "name", "email", "company", "campaign", "source", "host", "title", "location", "notes"];
  const lines = [header.join(",")];
  for (const m of rows) {
    lines.push([m.createdAt, m.startsAt, m.status, m.name, m.email, m.company, m.campaign?.name, sourceLabel(m.source), m.hostEmail, m.title, m.location, m.notes].map(esc).join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="meetings-${mode.toLowerCase()}.csv"` },
  });
}
