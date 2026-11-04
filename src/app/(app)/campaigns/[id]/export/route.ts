import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new Response("Sign in first", { status: 401 });
  const { id } = await ctx.params;
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) return new Response("Not found", { status: 404 });
  const rows = await db.campaignContact.findMany({
    where: { campaignId: id },
    include: { contact: true, mailbox: true, messages: { where: { status: "SENT", kind: "SEQUENCE" } }, meetings: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const header = ["email", "firstName", "lastName", "company", "sender", "status", "emailsSent", "firstOpenedAt", "firstClickedAt", "repliedAt", "replyType", "reply", "bookingLinkSentAt", "meetingStatus", "meetingAt", "bounced", "unsubscribed", "stoppedReason"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const opened = r.messages.map((m) => m.firstOpenedAt).filter(Boolean).sort()[0] ?? null;
    const clicked = r.messages.map((m) => m.firstClickedAt).filter(Boolean).sort()[0] ?? null;
    lines.push(
      [r.contact.email, r.contact.firstName, r.contact.lastName, r.contact.company, r.mailbox?.email ?? r.senderEmail, r.status, r.messages.length, opened, clicked, r.repliedAt, r.replyIntent, r.replyText, r.bookingReplySentAt, r.meetings[0]?.status, r.meetings[0]?.startsAt, r.status === "BOUNCED", r.status === "UNSUBSCRIBED", r.stoppedReason]
        .map(esc)
        .join(","),
    );
  }
  const name = c.name.replace(/[^\w.-]+/g, "_").slice(0, 60);
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}_results.csv"` },
  });
}
