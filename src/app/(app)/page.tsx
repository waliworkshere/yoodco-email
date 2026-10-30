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
      where: { status: { in: ["RUNNING", "PAUSED", "DRAFT"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
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
      <div className="page-head">
        <div className="title">
          <h1>Overview</h1>
          <p className="muted">Live sending over the last 7 days. Test runs are excluded.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" href="/campaigns/new"><IconPlus /> New campaign</Link>
        </div>
      </div>
      <Flash sp={sp} />

      {worker.state !== "online" ? (
        <Notice tone="warn" title={worker.state === "never" ? "The background sender has not started yet" : "The background sender is offline"}>
          Test campaigns run while their page is open. Live campaigns need the sender: <code>npm run worker</code> on a server, or a scheduler calling <code>/api/cron/tick</code> every minute (see docs/DEPLOY_VERCEL.md).
        </Notice>
      ) : null}

      {showSetup ? (
        <section className="card">
          <div className="card-head">
            <h2>Get set up</h2>
            <p>{steps.filter((s) => s.done).length} of {steps.length} done</p>
          </div>
          <ol className="feed" style={{ listStyle: "none" }}>
            {steps.map((s, i) => (
              <li key={s.label}>
                <span className="badge plain" style={{ width: 22, padding: 0, justifyContent: "center", ...(s.done ? { background: "var(--good-soft)", color: "var(--good)", border: 0 } : {}) }}>
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="stack" style={{ gap: 2 }}>
                  <strong style={{ textDecoration: s.done ? "line-through" : undefined, color: s.done ? "var(--muted)" : undefined }}>{s.label}</strong>
                  <span className="small muted">{s.hint}</span>
                </div>
                {!s.done ? <Link className="btn btn-sm" href={s.href}>Open</Link> : <span />}
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
            <h2>Mailboxes</h2>
            <Link className="small" href="/mailboxes">Manage</Link>
          </div>
          {mailboxes.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {mailboxes.slice(0, 8).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/mailboxes/${m.id}`} className="cell-main">{m.email}</Link>
                        <div className="cell-sub">{m.provider === "SANDBOX" ? "Sandbox" : `${usage.day.get(m.id) ?? 0} / ${effectiveDailyLimit(m, new Date())} today`}</div>
                      </td>
                      <td className="r"><MailboxStatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No mailboxes yet" actions={<Link className="btn btn-sm" href="/mailboxes/new">Connect a mailbox</Link>} />
          )}
          {mailboxes.length > 0 && realMailboxes === 0 ? (
            <div className="card-body small muted" style={{ borderTop: "1px solid var(--line)" }}>Only sandbox mailboxes are connected, so nothing can go live yet.</div>
          ) : null}
        </section>
      </div>

      <div className="grid-3-1">
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
                      <td><div className="row" style={{ gap: 6 }}><CampaignStatusBadge status={c.status} /><ModeBadge mode={c.mode} /></div></td>
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
        <section className="card">
          <div className="card-head">
            <h2>Latest responses</h2>
            <Badge plain>Live</Badge>
          </div>
          <ActivityFeed events={events} showCampaign emptyText="Replies and clicks from live campaigns appear here." />
        </section>
      </div>
    </>
  );
}
