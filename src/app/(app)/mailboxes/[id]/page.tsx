import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { checkDomain } from "@/lib/dns-check";
import { effectiveDailyLimit, emailDomain } from "@/lib/schedule";
import { fmtPct, mailboxUsage, messageFunnel } from "@/lib/stats";
import { deleteMailbox, sendMailboxTest, setMailboxStatus, testMailbox, updateMailbox } from "@/app/actions/mailboxes";
import { ConfirmButton, SubmitButton } from "@/components/buttons";
import { getSession } from "@/lib/auth";
import { Badge, Flash, fmtDate, fmtNum, fmtRelative, Kpi, MailboxStatusBadge, Notice, PROVIDER_LABEL } from "@/components/ui";

export const metadata = { title: "Mailbox" };

export default async function MailboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.mailbox.findUnique({ where: { id } });
  if (!m) notFound();
  const me = await getSession();
  const isSandbox = m.provider === "SANDBOX";
  const [usage, funnel, contacts, dns] = await Promise.all([
    mailboxUsage(),
    messageFunnel({ mailboxId: id, mode: "LIVE", sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }),
    db.campaignContact.count({ where: { mailboxId: id, status: { in: ["QUEUED", "ACTIVE"] } } }),
    isSandbox ? Promise.resolve(null) : checkDomain(emailDomain(m.email), m.provider).catch(() => null),
  ]);
  const limit = effectiveDailyLimit(m, new Date());

  return (
    <>
      <div className="page-head">
        <div className="title">
          <span className="crumbs"><Link href="/mailboxes">Mailboxes</Link> / {m.email}</span>
          <div className="title-row"><h1>{m.email}</h1><MailboxStatusBadge status={m.status} /><Badge plain>{PROVIDER_LABEL[m.provider]}</Badge></div>
        </div>
        <div className="actions">
          <form action={testMailbox}><input type="hidden" name="id" value={id} /><SubmitButton className="btn" pending="Testing…">Test connection</SubmitButton></form>
          {m.status === "ACTIVE" ? (
            <form action={setMailboxStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="PAUSED" /><SubmitButton className="btn" pending="…">Pause</SubmitButton></form>
          ) : (
            <form action={setMailboxStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="ACTIVE" /><SubmitButton className="btn btn-primary" pending="…">Resume</SubmitButton></form>
          )}
        </div>
      </div>
      <Flash sp={sp} />
      {m.status !== "ACTIVE" && m.statusReason ? <Notice tone={m.status === "PAUSED" ? "warn" : "bad"} title="Why it is not sending">{m.statusReason}</Notice> : null}
      {m.status === "ERROR" && (m.provider === "GOOGLE" || m.provider === "MICROSOFT") ? (
        <Notice tone="info" title="Reconnect">
          <a href={`/api/oauth/${m.provider === "GOOGLE" ? "google" : "microsoft"}/start?email=${encodeURIComponent(m.email)}`}>Sign in again</a> to restore access. Contacts and history are kept.
        </Notice>
      ) : null}

      <div className="kpis">
        <Kpi label="Sent today" value={isSandbox ? "–" : `${usage.day.get(id) ?? 0} / ${limit}`} sub={m.warmupEnabled && limit < m.dailyLimit ? `warming up to ${m.dailyLimit}` : "rolling 24 hours"} />
        <Kpi label="This hour" value={isSandbox ? "–" : `${usage.hour.get(id) ?? 0} / ${m.hourlyLimit}`} />
        <Kpi label="Contacts waiting" value={fmtNum(contacts)} />
        <Kpi label="Bounce rate" value={fmtPct(funnel.bounced, funnel.sent)} sub="live, last 30 days" />
        <Kpi label="Reply rate" value={fmtPct(funnel.replied, funnel.delivered)} sub="live, last 30 days" />
      </div>

      <div className="grid-3-1">
        <form action={updateMailbox} className="card">
          <input type="hidden" name="id" value={id} />
          <div className="card-head"><h2>Settings</h2></div>
          <div className="card-body form">
            <div className="fields">
              <div className="field"><label htmlFor="displayName">Sender name</label><input id="displayName" name="displayName" className="input" defaultValue={m.displayName} /><span className="hint">Shown as the &quot;From&quot; name.</span></div>
              <div className="field"><label htmlFor="dailyLimit">Daily limit</label><input id="dailyLimit" name="dailyLimit" type="number" min={1} className="input" defaultValue={m.dailyLimit} /></div>
              <div className="field"><label htmlFor="hourlyLimit">Hourly limit</label><input id="hourlyLimit" name="hourlyLimit" type="number" min={1} className="input" defaultValue={m.hourlyLimit} /></div>
              <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" name="warmupEnabled" defaultChecked={m.warmupEnabled} /><span><span className="label">Warm up</span><br /><span className="hint">{m.warmupStartedAt ? `Started ${fmtDate(m.warmupStartedAt, false)}` : "Ramp up daily volume gradually"}</span></span></label>
              <div className="field"><label htmlFor="warmupStart">Warm-up: first day</label><input id="warmupStart" name="warmupStart" type="number" min={1} className="input" defaultValue={m.warmupStart} /></div>
              <div className="field"><label htmlFor="warmupIncrement">Warm-up: add per day</label><input id="warmupIncrement" name="warmupIncrement" type="number" min={1} className="input" defaultValue={m.warmupIncrement} /></div>
              <div className="field span-2"><label htmlFor="signature">Signature</label><textarea id="signature" name="signature" className="textarea" style={{ minHeight: 80 }} defaultValue={m.signature ?? ""} placeholder="Leave empty if the sheet's copy already ends with a sign-off" /><span className="hint">Added under every email from this mailbox.</span></div>
              {m.provider === "SMTP" ? (
                <>
                  <div className="field"><label htmlFor="smtpHost">SMTP server</label><input id="smtpHost" name="smtpHost" className="input" defaultValue={m.smtpHost ?? ""} /></div>
                  <div className="field"><label htmlFor="smtpPort">SMTP port</label><input id="smtpPort" name="smtpPort" type="number" className="input" defaultValue={m.smtpPort ?? 587} /></div>
                  <div className="field"><label htmlFor="imapHost">IMAP server</label><input id="imapHost" name="imapHost" className="input" defaultValue={m.imapHost ?? ""} /></div>
                  <div className="field"><label htmlFor="imapPort">IMAP port</label><input id="imapPort" name="imapPort" type="number" className="input" defaultValue={m.imapPort ?? 993} /></div>
                  <div className="field"><label htmlFor="username">Login</label><input id="username" name="username" className="input" defaultValue={m.username ?? ""} /></div>
                  <div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" className="input" autoComplete="new-password" placeholder="Leave empty to keep" /></div>
                </>
              ) : null}
            </div>
            <div className="form-foot"><SubmitButton pending="Saving…">Save</SubmitButton></div>
          </div>
        </form>

        <div className="stack">
          <form action={sendMailboxTest} className="card">
            <input type="hidden" name="id" value={id} />
            <div className="card-head"><h2>Send a test email</h2></div>
            <div className="card-body form">
              <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="email" className="input" defaultValue={me?.email} /></div>
              <SubmitButton className="btn" pending="Sending…">Send test</SubmitButton>
              <span className="hint">Check whether it lands in the inbox, promotions or spam.</span>
            </div>
          </form>
          <section className="card">
            <div className="card-head"><h2>Activity</h2></div>
            <div className="card-body">
              <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                <dt>Connected</dt><dd>{fmtDate(m.createdAt, false)}</dd>
                <dt>Last sent</dt><dd>{fmtRelative(m.lastSentAt)}</dd>
                <dt>Inbox checked</dt><dd>{isSandbox ? "Not needed" : fmtRelative(m.lastInboxCheckAt)}</dd>
                {m.lastError ? <><dt>Last error</dt><dd className="small" style={{ color: "var(--bad)" }}>{m.lastError} <span className="muted">({fmtRelative(m.lastErrorAt)})</span></dd></> : null}
              </dl>
            </div>
          </section>
        </div>
      </div>

      {dns ? (
        <section className="card">
          <div className="card-head"><h2>Domain health · {dns.domain}</h2><p>Spam filters check these records before they look at anything else</p></div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {([["SPF", dns.spf, "Says which servers may send for the domain"], ["DKIM", dns.dkim, "Signs each email so it can't be forged"], ["DMARC", dns.dmarc, "Tells receivers what to do when SPF/DKIM fail"], ["MX", dns.mx, "Where replies are delivered"]] as const).map(([k, v, what]) => (
                  <tr key={k}>
                    <td style={{ width: 90 }}><strong>{k}</strong></td>
                    <td style={{ width: 130 }}>{v.ok ? <Badge tone="good">Found</Badge> : <Badge tone="bad">Missing</Badge>}</td>
                    <td><div className="small">{what}</div><div className="cell-sub mono" style={{ overflowWrap: "anywhere" }}>{v.detail}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head"><h2>Remove mailbox</h2><p>Contacts assigned to it wait until you reconnect it or reassign them. Sent history is kept.</p></div>
        <div className="card-body">
          <form action={deleteMailbox}><input type="hidden" name="id" value={id} /><ConfirmButton className="btn btn-danger" confirm="Click again to remove">Remove {m.email}</ConfirmButton></form>
        </div>
      </section>
    </>
  );
}
