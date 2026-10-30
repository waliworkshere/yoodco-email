import Link from "next/link";
import { db } from "@/lib/db";
import { effectiveDailyLimit } from "@/lib/schedule";
import { dailySends, fmtPct, mailboxUsage, messageFunnel, workerStatus } from "@/lib/stats";
import { IconPlus } from "@/components/icons";
import {
  Badge, CampaignStatusBadge, DailyChart, Empty, Flash, fmtNum, fmtRelative, Kpi, MailboxStatusBadge, ModeBadge, Notice, Progress,
} from "@/components/ui";
import { ActivityFeed } from "./campaigns/[id]/ActivityFeed";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [mailboxes, campaigns, funnel, series, usage, worker, events, testRuns, liveCount] = await Promise.all([
    db.mailbox.findMany({ orderBy: { email: "asc" } }),
    db.campaign.findMany({
      where: {},
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 6,
      include: { _count: { select: { contacts: true } } },
    }),
    messageFunnel({ mode: "LIVE", sentAt: { gte: since } }),
    dailySends({ mode: "LIVE" }, 14),
    mailboxUsage(),
    workerStatus(),
    db.event.findMany({
      where: { type: { in: ["REPLY", "CLICK", "BOUNCE", "UNSUBSCRIBE"] }, likelyBot: false, campaign: { mode: "LIVE" } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { campaignContact: { include: { contact: true } }, campaign: { select: { name: true, id: true } } },
    }),
    db.message.count({ where: { mode: "TEST" } }),
    db.message.count({ where: { mode: "LIVE" } }),
  ]);
  const liveRunning = await db.campaign.count({ where: { status: "RUNNING", mode: "LIVE" } });

  const progress = await Promise.all(
    campaigns.map((c) => db.campaignContact.count({ where: { campaignId: c.id, status: { notIn: ["QUEUED", "ACTIVE"] } } })),
  );

  const realMailboxes = mailboxes.filter((m) => m.provider !== "SANDBOX").length;
  const steps = [
    { done: mailboxes.length > 0, label: "Connect your sending mailboxes", hint: "Google, Microsoft 365 or any SMTP account. Add sandbox mailboxes to try things first.", href: "/mailboxes/new" },
    { done: campaigns.length > 0 || liveCount > 0, label: "Import a contact sheet", hint: "Upload the same .xlsx you use today: contacts, sender and the copy for each email.", href: "/campaigns/new" },
    { done: testRuns > 0, label: "Run it in test mode", hint: "Everything is captured in a test inbox. Nobody receives anything.", href: "/campaigns" },
    { done: liveCount > 0, label: "Go live", hint: "Switch the campaign to live once the test looks right.", href: "/campaigns" },
  ];
  const showSetup = steps.some((s) => !s.done);

  return (
    <>
      <section className="hero hero-split">
        <div>
          <span className="eyebrow">Outreach overview</span>
          <h1 style={{ marginTop: 10 }}>
            {funnel.sent > 0 ? (
              <><b>{fmtNum(funnel.sent)} emails</b> sent this week, <b>{fmtNum(funnel.replied)} replies</b> so far.</>
            ) : (
              <>Paced outreach from <b>your own mailboxes</b>, without landing in spam.</>
            )}
          </h1>
          <p>Live sending over the last 7 days. Test runs are kept separate.</p>
          <div className="actions">
            <Link className="btn btn-primary btn-lg" href="/campaigns/new"><IconPlus /> New campaign</Link>
            <Link className="btn btn-lg" href="/campaigns">View campaigns</Link>
          </div>
        </div>
        <div className="hero-panel" aria-label="How a sequence runs">
          <span className="eyebrow">How every sequence runs</span>
          <ol className="seq">
            <li><b>Email 1</b><span>From the contact&apos;s own sender</span></li>
            <li className="wait">3 days</li>
            <li><b>Email 2</b><span>Only if there was no reply</span></li>
            <li className="wait">4 days</li>
            <li><b>Email 3</b><span>Then the sequence ends</span></li>
          </ol>
          <div className="pills">
            <span>20 / hour</span><span>Weekdays 09:00–17:00</span><span>Stops on reply</span>
          </div>
        </div>
      </section>
      <Flash sp={sp} />

      {worker.state !== "online" && liveRunning > 0 ? (
        <Notice tone="warn" title="A live campaign is waiting for the sender">
          Test campaigns run while their page is open. Live campaigns need the sender: <code>npm run worker</code> on a server, or a scheduler calling <code>/api/cron/tick</code> every minute (see docs/DEPLOY_VERCEL.md).
        </Notice>
      ) : null}

      {showSetup ? (
        <section className="card setup">
          <span className="eyebrow">Getting started · {steps.filter((s) => s.done).length} of {steps.length} done</span>
          <ol className="setup-steps">
            {steps.map((s, i) => (
              <li key={s.label} className={s.done ? "done" : ""}>
                <span className="setup-num">{s.done ? "✓" : i + 1}</span>
                <div>
                  <strong>{s.label}</strong>
                  {!s.done ? <span className="small muted"> {s.hint}</span> : null}
                </div>
                {!s.done ? <Link className="btn btn-sm btn-primary" href={s.href}>Open</Link> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="kpis">
        <Kpi label="Emails sent" value={fmtNum(funnel.sent)} sub="last 7 days" />
        <Kpi label="Opened" value={fmtPct(funnel.opened, funnel.delivered)} sub={`${fmtNum(funnel.opened)} emails`} />
        <Kpi label="Clicked" value={fmtPct(funnel.clicked, funnel.delivered)} sub={`${fmtNum(funnel.clicked)} emails`} />
        <Kpi label="Replied" value={fmtPct(funnel.replied, funnel.delivered)} sub={`${fmtNum(funnel.replied)} replies`} />
        <Kpi label="Bounced" value={fmtPct(funnel.bounced, funnel.sent)} sub={`${fmtNum(funnel.bounced)} emails`} />
      </div>

      <div className="grid-3-1">
        <div className="stack" style={{ gap: 22 }}>
          <section className="card">
            <div className="card-head">
              <h2>Emails sent per day</h2>
              <p>Last 14 days, live campaigns</p>
            </div>
            <div className="card-body">
              <DailyChart series={series} steps={3} />
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Campaigns</h2>
              <Link className="small" href="/campaigns">All campaigns</Link>
            </div>
            {campaigns.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Campaign</th><th>Status</th><th>Progress</th><th className="r">Contacts</th></tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c, i) => (
                      <tr key={c.id}>
                        <td>
                          <Link className="cell-main" href={`/campaigns/${c.id}`}>{c.name}</Link>
                          <div className="cell-sub">Updated {fmtRelative(c.updatedAt)}</div>
                        </td>
                        <td><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><CampaignStatusBadge status={c.status} /><ModeBadge mode={c.mode} /></div></td>
                        <td style={{ minWidth: 140 }}><Progress value={progress[i]} total={c._count.contacts} /></td>
                        <td className="r">{fmtNum(c._count.contacts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No campaigns yet" actions={<Link className="btn btn-sm" href="/campaigns/new">Import a sheet</Link>}>
                Upload your contact sheet to create the first one.
              </Empty>
            )}
          </section>
        </div>
        <div className="stack" style={{ gap: 22 }}>
          <section className="card">
            <div className="card-head">
              <h2>Mailboxes</h2>
              <Link className="small" href="/mailboxes">Manage</Link>
            </div>
            {mailboxes.length ? (
              <ul className="mini-list">
                {mailboxes.slice(0, 7).map((m) => (
                  <li key={m.id}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/mailboxes/${m.id}`} className="cell-main trunc" style={{ display: "block" }}>{m.email}</Link>
                      <span className="cell-sub">{m.provider === "SANDBOX" ? "Sandbox" : `${usage.day.get(m.id) ?? 0} / ${effectiveDailyLimit(m, new Date())} today`}</span>
                    </div>
                    <MailboxStatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No mailboxes yet" actions={<Link className="btn btn-sm" href="/mailboxes/new">Connect a mailbox</Link>} />
            )}
            {mailboxes.length > 0 && realMailboxes === 0 ? (
              <div className="card-body small muted" style={{ borderTop: "1px solid var(--line)", paddingBlock: 12 }}>Only sandbox mailboxes are connected, so nothing can go live yet.</div>
            ) : null}
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Latest responses</h2>
              <Badge plain>Live</Badge>
            </div>
            <ActivityFeed events={events.slice(0, 6)} showCampaign emptyText="Replies and clicks from live campaigns appear here." />
          </section>
        </div>
      </div>
    </>
  );
}
