import Link from "next/link";
import type { Campaign, CampaignStep } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveDailyLimit, forecastDays, isInWindow, nextWindowOpen } from "@/lib/schedule";
import { dailySends, fmtPct, peopleFunnel, perMailbox, perStep, statusCounts } from "@/lib/stats";
import { reassignUnassigned } from "@/app/actions/campaigns";
import { SubmitButton } from "@/components/buttons";
import { DailyChart, enrollmentLabel, fmtDate, fmtNum, FunnelBars, Kpi, MailboxStatusBadge, Notice, stepColor } from "@/components/ui";

interface ImportReport {
  fileName: string;
  imported: number;
  stepCount: number;
  invalidCount: number;
  invalid: { rowNumber: number; reason: string }[];
  duplicates: number;
  suppressed: number;
  unassigned: number;
  senders: { email: string; contacts: number; connected: boolean }[];
}

async function scheduleStatus(c: Campaign & { steps: CampaignStep[] }) {
  const now = new Date();
  const ff = c.mode === "TEST" && c.testFastForward;
  if (c.status === "DRAFT") return { tone: "info" as const, text: c.mode === "TEST" ? "Not started. Start the test run to see the sequence play out." : "Ready. Press Start sending when you want the first emails to go." };
  if (c.status === "PAUSED") return { tone: "warn" as const, text: "Paused. Nothing is being sent." };
  if (c.status === "COMPLETED") return { tone: "good" as const, text: `Finished ${fmtDate(c.completedAt)}. Every contact has completed the sequence or dropped out.` };
  if (ff) return { tone: "test" as const, text: "Fast-forward test: an email every few seconds; follow-ups arrive minutes later instead of days." };
  if (!isInWindow(now, c)) {
    const next = nextWindowOpen(now, c);
    return { tone: "info" as const, text: next ? `Outside the sending window. Sending resumes ${fmtDate(next)}.` : "The sending window has no days selected." };
  }
  const lastHour = await db.message.count({ where: { campaignId: c.id, status: "SENT", sentAt: { gt: new Date(now.getTime() - 3600_000) } } });
  if (lastHour >= c.hourlyLimit) return { tone: "info" as const, text: `Hourly limit reached (${lastHour}/${c.hourlyLimit}). The next email goes out when the oldest one is an hour old.` };
  if (c.nextSendAt && c.nextSendAt > now) return { tone: "good" as const, text: `Sending. ${lastHour} of ${c.hourlyLimit} this hour. Next email around ${fmtDate(c.nextSendAt)}.` };
  return { tone: "good" as const, text: `Sending. ${lastHour} of ${c.hourlyLimit} this hour.` };
}

export async function OverviewTab({ campaign }: { campaign: Campaign & { steps: CampaignStep[] } }) {
  const id = campaign.id;
  const report = campaign.importReport as ImportReport | null;
  const [people, steps, boxes, series, statuses, status, remaining] = await Promise.all([
    peopleFunnel(id),
    perStep(id, campaign.steps.length),
    perMailbox(id),
    dailySends({ campaignId: id }, 14),
    statusCounts(id),
    scheduleStatus(campaign),
    db.campaignContact.findMany({ where: { campaignId: id, status: { in: ["QUEUED", "ACTIVE"] } }, select: { currentStep: true } }),
  ]);
  const sendsLeft = remaining.reduce((n, r) => n + (campaign.steps.length - r.currentStep), 0);
  const capacity = boxes.rows.reduce((n, r) => n + effectiveDailyLimit(r.mailbox, new Date()), 0);
  const days = sendsLeft ? forecastDays(sendsLeft, campaign.hourlyLimit, campaign.windowEnd - campaign.windowStart, capacity || 1) : 0;

  return (
    <>
      <Notice tone={status.tone} title={status.text}>
        {sendsLeft > 0 && !(campaign.mode === "TEST" && campaign.testFastForward)
          ? `${fmtNum(sendsLeft)} emails left to send · about ${days} sending day${days === 1 ? "" : "s"} at the current limits.`
          : null}
      </Notice>

      {boxes.unassigned > 0 ? (
        <Notice tone="warn" title={`${fmtNum(boxes.unassigned)} contacts are waiting for a mailbox`}>
          <span>
            Their sender from the sheet is not connected yet. <Link href="/mailboxes/new">Connect those mailboxes</Link> and they are picked up automatically, or spread them over the connected ones:
          </span>
          <form action={reassignUnassigned} style={{ marginTop: 6 }}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="btn btn-sm" pending="Assigning…">Assign to connected mailboxes</SubmitButton>
          </form>
        </Notice>
      ) : null}

      <div className="kpis" data-tour="kpis">
        <Kpi label="Contacts" value={fmtNum(people.enrolled)} sub={`${fmtNum(people.contacted)} reached`} />
        <Kpi label="Opened" value={fmtPct(people.opened, people.contacted)} sub={`${fmtNum(people.opened)} people`} />
        <Kpi label="Clicked" value={fmtPct(people.clicked, people.contacted)} sub={`${fmtNum(people.clicked)} people`} />
        <Kpi label="Replied" value={fmtPct(people.replied, people.contacted)} sub={`${fmtNum(people.replied)} people`} />
        <Kpi label="Bounced" value={fmtPct(people.bounced, people.contacted)} sub={`${fmtNum(people.bounced)} addresses`} />
        <Kpi label="Unsubscribed" value={fmtNum(people.unsubscribed)} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Who engaged</h2>
            <p>Share of contacts reached</p>
          </div>
          <div className="card-body">
            <FunnelBars
              base={people.contacted}
              rows={[
                { label: "Reached", value: people.contacted },
                { label: "Opened", value: people.opened },
                { label: "Clicked", value: people.clicked },
                { label: "Replied", value: people.replied },
              ]}
            />
            <p className="small muted" style={{ marginTop: 14 }}>
              Opens are estimates: some mail apps load images automatically, and scanner hits are excluded. Clicks and replies are reliable.
            </p>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Where contacts are</h2>
          </div>
          <div className="card-body">
            <div className="stack" style={{ gap: 8 }}>
              {Object.entries(statuses).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <div key={s} className="spread">
                  <Link href={`/campaigns/${id}?tab=contacts&status=${s}`}>{enrollmentLabel(s)}</Link>
                  <span className="num">{fmtNum(n)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>By email in the sequence</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Waits</th><th className="r">Sent</th><th className="r">Opened</th><th className="r">Clicked</th><th className="r">Replied</th><th className="r">Bounced</th></tr>
            </thead>
            <tbody>
              {steps.map((s) => {
                const def = campaign.steps.find((x) => x.order === s.step);
                return (
                  <tr key={s.step}>
                    <td><span className="row" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: stepColor(s.step), display: "inline-block" }} />Email {s.step}</span></td>
                    <td className="muted">{s.step === 1 ? "Starts the sequence" : `${def?.delayDays ?? 0} days after Email ${s.step - 1}`}</td>
                    <td className="r">{fmtNum(s.sent)}</td>
                    <td className="r">{fmtPct(s.opened, s.delivered)}</td>
                    <td className="r">{fmtPct(s.clicked, s.delivered)}</td>
                    <td className="r">{fmtPct(s.replied, s.delivered)}</td>
                    <td className="r">{fmtPct(s.bounced, s.sent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-3-1">
        <section className="card">
          <div className="card-head"><h2>Sent per day</h2><p>Last 14 days</p></div>
          <div className="card-body"><DailyChart series={series} steps={campaign.steps.length} /></div>
        </section>
        {report ? (
          <section className="card">
            <div className="card-head"><h2>Import</h2><p className="trunc" style={{ maxWidth: 180 }}>{report.fileName}</p></div>
            <div className="card-body">
              <dl className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
                <dt>Contacts imported</dt><dd className="num">{fmtNum(report.imported)}</dd>
                <dt>Emails per contact</dt><dd className="num">{report.stepCount}</dd>
                <dt>Invalid rows skipped</dt><dd className="num">{report.invalidCount}</dd>
                <dt>Duplicates skipped</dt><dd className="num">{report.duplicates}</dd>
                <dt>On do-not-email list</dt><dd className="num">{report.suppressed}</dd>
              </dl>
              {report.invalid.length ? (
                <details style={{ marginTop: 12 }}>
                  <summary className="small">Show skipped rows</summary>
                  <ul className="small muted" style={{ paddingLeft: 18 }}>
                    {report.invalid.slice(0, 50).map((r) => <li key={r.rowNumber}>Row {r.rowNumber}: {r.reason}</li>)}
                  </ul>
                </details>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>By sending mailbox</h2>
          <Link className="small" href="/mailboxes">Mailboxes</Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Mailbox</th><th>Status</th><th className="r">Contacts</th><th className="r">Sent</th><th className="r">Opened</th><th className="r">Clicked</th><th className="r">Replied</th><th className="r">Bounced</th></tr>
            </thead>
            <tbody>
              {boxes.rows.map((r) => (
                <tr key={r.mailbox.id}>
                  <td><Link className="cell-main" href={`/mailboxes/${r.mailbox.id}`}>{r.mailbox.email}</Link><div className="cell-sub">{r.mailbox.displayName}</div></td>
                  <td><MailboxStatusBadge status={r.mailbox.status} /></td>
                  <td className="r">{fmtNum(r.contacts)}</td>
                  <td className="r">{fmtNum(r.sent)}</td>
                  <td className="r">{fmtPct(r.opened, r.delivered)}</td>
                  <td className="r">{fmtPct(r.clicked, r.delivered)}</td>
                  <td className="r">{fmtPct(r.replied, r.delivered)}</td>
                  <td className="r">{fmtPct(r.bounced, r.sent)}</td>
                </tr>
              ))}
              {report?.senders
                .filter((s) => !boxes.rows.some((r) => r.mailbox.email === s.email))
                .map((s) => (
                  <tr key={s.email}>
                    <td><span className="cell-main">{s.email}</span><div className="cell-sub">From the sheet</div></td>
                    <td><span className="badge warn">Not connected</span></td>
                    <td className="r">{fmtNum(s.contacts)}</td>
                    <td className="r" colSpan={5}><Link href={`/mailboxes/new`}>Connect</Link></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
