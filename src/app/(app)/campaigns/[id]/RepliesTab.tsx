import Link from "next/link";
import type { Campaign, CampaignStep, Prisma, ReplyIntent } from "@prisma/client";
import { db } from "@/lib/db";
import { INTENT_LABEL, INTENTS } from "@/lib/engine/intent";
import { replyBreakdown } from "@/lib/stats";
import { addMeeting, holdBookingLink, sendBookingLinkNow, setReplyIntent } from "@/app/actions/meetings";
import { SubmitButton } from "@/components/buttons";
import { Empty, fmtDate, fmtNum, IntentBadge, Kpi, MeetingStatusBadge } from "@/components/ui";

/**
 * Everyone who answered: what they said, what it means, whether the booking link went out,
 * and whether they booked. Teammates can correct the reading and act from here.
 */
export async function RepliesTab({ campaign, sp }: { campaign: Campaign & { steps: CampaignStep[] }; sp: Record<string, string> }) {
  const id = campaign.id;
  const intent = INTENTS.includes(sp.intent as ReplyIntent) ? (sp.intent as ReplyIntent) : undefined;
  const where: Prisma.CampaignContactWhereInput = {
    campaignId: id,
    OR: [{ repliedAt: { not: null } }, { meetingBookedAt: { not: null } }],
    ...(intent ? { replyIntent: intent } : {}),
  };
  const [rows, breakdown, people] = await Promise.all([
    db.campaignContact.findMany({
      where,
      include: { contact: true, mailbox: { select: { email: true } }, meetings: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ repliedAt: { sort: "desc", nulls: "last" } }, { meetingBookedAt: "desc" }],
      take: 200,
    }),
    replyBreakdown(id),
    db.campaignContact.count({ where: { campaignId: id, currentStep: { gt: 0 } } }),
  ]);
  const replied = Object.values(breakdown.intents).reduce((a, b) => a + b, 0);
  const backUrl = `/campaigns/${id}?tab=replies${intent ? `&intent=${intent}` : ""}`;
  const now = new Date();

  return (
    <>
      <div className="kpis">
        <Kpi label="Replies" value={fmtNum(replied)} sub={people ? `${((replied / people) * 100).toFixed(1)}% of people reached` : undefined} />
        <Kpi label="Interested" value={fmtNum(breakdown.intents.INTERESTED ?? 0)} sub="wanted to talk" />
        <Kpi label="Booking link sent" value={fmtNum(breakdown.linkSent)} sub={campaign.autoBookingReply ? "automatically" : "by a teammate"} />
        <Kpi label="Meetings booked" value={fmtNum(breakdown.booked)} sub={replied ? `${((breakdown.booked / replied) * 100).toFixed(0)}% of replies` : undefined} highlight />
      </div>

      <section className="card">
        <div className="filters">
          <Link className="chip" href={`/campaigns/${id}?tab=replies`} aria-current={!intent ? "true" : undefined}>All<span className="n">{fmtNum(replied)}</span></Link>
          {INTENTS.filter((i) => (breakdown.intents[i] ?? 0) > 0).map((i) => (
            <Link key={i} className="chip" href={`/campaigns/${id}?tab=replies&intent=${i}`} aria-current={intent === i ? "true" : undefined}>
              {INTENT_LABEL[i]}<span className="n">{fmtNum(breakdown.intents[i] ?? 0)}</span>
            </Link>
          ))}
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Contact</th><th>Their reply</th><th>Type</th><th>Booking link</th><th>Meeting</th><th className="r">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meeting = r.meetings[0];
                  const linkState = r.bookingReplySentAt
                    ? <span className="small">Sent {fmtDate(r.bookingReplySentAt)}</span>
                    : r.bookingReplyDueAt
                      ? <span className="small" style={{ color: "var(--blue)" }}>Going out {r.bookingReplyDueAt <= now ? "now" : fmtDate(r.bookingReplyDueAt)}</span>
                      : <span className="small muted">Not sent</span>;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-main">{[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email}</div>
                        <div className="cell-sub">{r.contact.email}{r.contact.company ? ` · ${r.contact.company}` : ""}</div>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        {r.replyText ? <div className="reply-text">{r.replyText.length > 400 ? `${r.replyText.slice(0, 400)}…` : r.replyText}</div> : <span className="muted small">–</span>}
                        {r.repliedAt ? <div className="cell-sub">{fmtDate(r.repliedAt)} · to {r.mailbox?.email ?? "–"}</div> : null}
                      </td>
                      <td className="nowrap">
                        <IntentBadge intent={r.replyIntent} />
                        {r.replyIntentBy ? <div className="cell-sub">{r.replyIntentBy === "ai" ? "Read by AI" : r.replyIntentBy === "person" ? "Set by a teammate" : "Read automatically"}</div> : null}
                      </td>
                      <td className="nowrap">{linkState}</td>
                      <td className="nowrap">
                        {meeting ? (
                          <>
                            <MeetingStatusBadge status={meeting.status} />
                            <div className="cell-sub">{meeting.startsAt ? fmtDate(meeting.startsAt) : "Time not given"}</div>
                          </>
                        ) : <span className="muted small">None yet</span>}
                      </td>
                      <td className="r">
                        <details className="menu">
                          <summary className="btn btn-sm">Actions</summary>
                          <div className="menu-pop" style={{ minWidth: 260 }}>
                            <span className="menu-label">This reply is…</span>
                            <form action={setReplyIntent} className="inline-form" style={{ padding: "4px 10px 8px" }}>
                              <input type="hidden" name="ccId" value={r.id} />
                              <input type="hidden" name="back" value={backUrl} />
                              <select name="intent" className="input" defaultValue={r.replyIntent ?? "OTHER"} aria-label="Reply type">
                                {INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
                              </select>
                              <SubmitButton className="btn btn-sm" pending="…">Save</SubmitButton>
                            </form>
                            {campaign.bookingMode !== "OFF" && !meeting ? (
                              <form action={sendBookingLinkNow}>
                                <input type="hidden" name="ccId" value={r.id} />
                                <input type="hidden" name="back" value={backUrl} />
                                <button className="menu-item" type="submit">{r.bookingReplySentAt ? "Send the booking link again" : "Send the booking link now"}</button>
                              </form>
                            ) : null}
                            {r.bookingReplyDueAt && !r.bookingReplySentAt ? (
                              <form action={holdBookingLink}>
                                <input type="hidden" name="ccId" value={r.id} />
                                <input type="hidden" name="back" value={backUrl} />
                                <button className="menu-item" type="submit">Don&apos;t send the link</button>
                              </form>
                            ) : null}
                            <span className="menu-label">Record a meeting ({campaign.timezone.replace(/_/g, " ")})</span>
                            <form action={addMeeting} className="inline-form" style={{ padding: "4px 10px 10px" }}>
                              <input type="hidden" name="ccId" value={r.id} />
                              <input type="hidden" name="back" value={backUrl} />
                              <input name="when" type="datetime-local" className="input" required aria-label="Meeting date and time" />
                              <SubmitButton className="btn btn-sm" pending="…">Add</SubmitButton>
                            </form>
                            <Link className="menu-item" href={`/campaigns/${id}?tab=emails&contact=${r.id}`}>View emails</Link>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={intent ? "No replies of this type" : "No replies yet"}>
            {campaign.mode === "TEST" ? "In a test run, use Actions → Simulate in the Contacts tab to play a reply." : "Replies appear here within a few minutes of arriving in the mailbox."}
          </Empty>
        )}
      </section>
    </>
  );
}
