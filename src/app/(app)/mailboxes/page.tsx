import Link from "next/link";
import { db } from "@/lib/db";
import { effectiveDailyLimit } from "@/lib/schedule";
import { mailboxUsage } from "@/lib/stats";
import { IconPlus } from "@/components/icons";
import { Empty, Flash, fmtNum, fmtRelative, MailboxStatusBadge, PROVIDER_LABEL, Progress } from "@/components/ui";

export const metadata = { title: "Mailboxes" };

export default async function MailboxesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [mailboxes, usage, waiting] = await Promise.all([
    db.mailbox.findMany({ orderBy: [{ provider: "asc" }, { email: "asc" }], include: { _count: { select: { campaignContacts: true } } } }),
    mailboxUsage(),
    db.campaignContact.groupBy({ by: ["senderEmail"], where: { mailboxId: null, senderEmail: { not: null }, status: { in: ["QUEUED", "ACTIVE"] } }, _count: { _all: true } }),
  ]);
  const now = new Date();
  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>Mailboxes</h1>
          <p className="muted">The accounts emails are sent from. Each one has its own daily and hourly limit.</p>
        </div>
        <Link className="btn btn-primary" href="/mailboxes/new"><IconPlus /> Connect mailbox</Link>
      </div>
      <Flash sp={sp} />

      {waiting.length ? (
        <section className="card">
          <div className="card-head"><h2>Senders from your sheets that are not connected</h2><p>Their contacts start sending as soon as you connect them</p></div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {waiting.map((w) => (
                  <tr key={w.senderEmail}>
                    <td className="cell-main">{w.senderEmail}</td>
                    <td className="r muted">{fmtNum(w._count._all)} contacts waiting</td>
                    <td className="r"><Link className="btn btn-sm" href={`/mailboxes/new?email=${encodeURIComponent(w.senderEmail ?? "")}`}>Connect</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        {mailboxes.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Mailbox</th><th>Connection</th><th>Status</th><th>Sent today</th><th className="r">This hour</th><th className="r">Contacts</th><th>Last sent</th></tr>
              </thead>
              <tbody>
                {mailboxes.map((m) => {
                  const limit = effectiveDailyLimit(m, now);
                  const day = usage.day.get(m.id) ?? 0;
                  return (
                    <tr key={m.id}>
                      <td><Link className="cell-main" href={`/mailboxes/${m.id}`}>{m.email}</Link><div className="cell-sub">{m.displayName}</div></td>
                      <td className="small">{PROVIDER_LABEL[m.provider]}</td>
                      <td>
                        <MailboxStatusBadge status={m.status} />
                        {m.statusReason && m.status !== "ACTIVE" ? <div className="cell-sub trunc" style={{ maxWidth: 220 }} title={m.statusReason}>{m.statusReason}</div> : null}
                      </td>
                      <td style={{ minWidth: 140 }}>
                        {m.provider === "SANDBOX" ? <span className="muted small">Never delivers</span> : (
                          <>
                            <Progress value={day} total={limit} />
                            <div className="cell-sub num">{day} / {limit}{m.warmupEnabled && limit < m.dailyLimit ? " · warming up" : ""}</div>
                          </>
                        )}
                      </td>
                      <td className="r">{m.provider === "SANDBOX" ? "–" : `${usage.hour.get(m.id) ?? 0} / ${m.hourlyLimit}`}</td>
                      <td className="r">{fmtNum(m._count.campaignContacts)}</td>
                      <td className="small nowrap">{fmtRelative(m.lastSentAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No mailboxes connected" actions={<Link className="btn btn-primary" href="/mailboxes/new">Connect a mailbox</Link>}>
            Connect the accounts you send from. To try the system without sending anything, add sandbox mailboxes.
          </Empty>
        )}
      </section>
    </>
  );
}
