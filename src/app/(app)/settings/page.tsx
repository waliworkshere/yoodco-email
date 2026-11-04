import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { workerStatus } from "@/lib/stats";
import { addSuppression, addUser, changePassword, removeSuppression, removeUser } from "@/app/actions/settings";
import { ConfirmButton, SubmitButton } from "@/components/buttons";
import { Badge, Flash, fmtDate, fmtNum, fmtRelative } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const [users, suppressed, suppressedCount, worker] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.contact.findMany({ where: { OR: [{ unsubscribedAt: { not: null } }, { bouncedAt: { not: null } }] }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.contact.count({ where: { OR: [{ unsubscribedAt: { not: null } }, { bouncedAt: { not: null } }] } }),
    workerStatus(),
  ]);
  const isAdmin = me.role === "ADMIN";

  const webhook = env.meetingWebhookKey ? `${env.appUrl}/api/meetings/${env.meetingWebhookKey}` : "";
  return (
    <>
      <div className="page-head"><div className="title"><h1>Settings</h1></div></div>
      <Flash sp={sp} />

      <section className="card">
        <div className="card-head"><h2>System</h2></div>
        <div className="card-body">
          <dl className="kv">
            <dt>Public address</dt><dd className="mono">{env.appUrl} {env.appUrl.startsWith("https://") ? <Badge tone="good">Public</Badge> : <Badge tone="warn">Local only</Badge>}</dd>
            <dt>Background sender</dt><dd>{worker.state === "online" ? <Badge tone="good">Running</Badge> : <Badge tone="bad">{worker.state === "never" ? "Never started" : "Offline"}</Badge>} {worker.hb ? <span className="muted small">last heartbeat {fmtRelative(worker.hb.lastBeat)} · {worker.hb.host}</span> : null}</dd>
            <dt>Test mail catcher</dt><dd>{env.sandboxSmtpUrl ? <span className="mono">{env.sandboxSmtpUrl}</span> : <span className="muted">Not configured: test emails are kept in the app only</span>}</dd>
            <dt>Google sign-in</dt><dd>{env.google.oauthConfigured ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>} {env.google.dwdConfigured ? <Badge tone="good">Workspace admin set up</Badge> : null}</dd>
            <dt>Microsoft sign-in</dt><dd>{env.microsoft.configured ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>}</dd>
            <dt>Reading replies</dt><dd>{process.env.ANTHROPIC_API_KEY ? <Badge tone="good">AI</Badge> : <Badge>Built-in rules</Badge>} <span className="muted small">{process.env.ANTHROPIC_API_KEY ? "Replies are read by an AI model, with the rules as a fallback." : "Add ANTHROPIC_API_KEY to have replies read by AI."}</span></dd>
            <dt>Live sending schedule</dt><dd>{process.env.CRON_SECRET ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">CRON_SECRET not set</Badge>} <span className="muted small">A scheduler calls {env.appUrl}/api/cron/tick every minute (see docs/DEPLOY_VERCEL.md).</span></dd>
          </dl>
        </div>
      </section>

      <section className="card" id="calendar-tools">
        <div className="card-head"><h2>Calendar tools</h2><p>Only needed if a campaign uses your own booking link. The built-in booking page records meetings by itself.</p></div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="field">
            <span className="label">Booking webhook address</span>
            {webhook ? <code className="mono copyable">{webhook}</code> : <span className="muted">Set MEETING_WEBHOOK_KEY (any long random text) to get an address.</span>}
            <span className="hint">Keep it private: anyone with this address can record a meeting.</span>
          </div>
          <ul className="small stack" style={{ gap: 8, paddingLeft: 18, margin: 0 }}>
            <li><b>Calendly</b> (Standard plan or higher): Integrations → Webhooks → New webhook, paste the address, choose <i>Invitee created</i> and <i>Invitee canceled</i>.</li>
            <li><b>Cal.com</b>: Settings → Developer → Webhooks → New, paste the address, choose <i>Booking created</i> and <i>Booking cancelled</i>.</li>
            <li><b>Google appointment schedule, HubSpot or anything else</b>: in Zapier or Make, send a POST with <code>email</code>, <code>name</code> and <code>startTime</code> to the address.</li>
            <li>Without a webhook, invitations and &quot;New event&quot; emails that reach a connected mailbox are recognised too.</li>
          </ul>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Team</h2></div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><div className="cell-main">{u.name}</div><div className="cell-sub">{u.email}</div></td>
                    <td><Badge plain tone={u.role === "ADMIN" ? "info" : "neutral"}>{u.role === "ADMIN" ? "Admin" : "Member"}</Badge></td>
                    <td className="small muted">{u.lastLoginAt ? `Signed in ${fmtRelative(u.lastLoginAt)}` : "Never signed in"}</td>
                    <td className="r">
                      {isAdmin && u.id !== me.id ? (
                        <form action={removeUser}><input type="hidden" name="id" value={u.id} /><ConfirmButton className="btn btn-sm btn-danger" confirm="Confirm">Remove</ConfirmButton></form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isAdmin ? (
            <form action={addUser} className="card-body form" style={{ borderTop: "1px solid var(--line)" }}>
              <h3>Add a teammate</h3>
              <div className="fields">
                <div className="field"><label htmlFor="u-name">Name</label><input id="u-name" name="name" className="input" required /></div>
                <div className="field"><label htmlFor="u-email">Email</label><input id="u-email" name="email" type="email" className="input" required /></div>
                <div className="field"><label htmlFor="u-password">Temporary password</label><input id="u-password" name="password" type="password" minLength={10} className="input" required autoComplete="new-password" /></div>
                <div className="field"><label htmlFor="u-role">Role</label><select id="u-role" name="role" className="select"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select></div>
              </div>
              <div><SubmitButton className="btn" pending="Adding…">Add teammate</SubmitButton></div>
            </form>
          ) : null}
        </section>

        <form action={changePassword} className="card">
          <div className="card-head"><h2>Your password</h2></div>
          <div className="card-body form">
            <div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" className="input" required autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" minLength={10} className="input" required autoComplete="new-password" /></div>
            <div><SubmitButton className="btn" pending="Saving…">Change password</SubmitButton></div>
          </div>
        </form>
      </div>

      <section className="card">
        <div className="card-head"><h2>Do-not-email list</h2><p>{fmtNum(suppressedCount)} addresses. Unsubscribes and hard bounces are added automatically and skipped in every live campaign.</p></div>
        <form action={addSuppression} className="card-body row" style={{ alignItems: "flex-end", borderBottom: "1px solid var(--line)" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="emails">Add addresses</label>
            <input id="emails" name="emails" className="input" placeholder="name@company.com, other@company.com" />
          </div>
          <SubmitButton className="btn" pending="Adding…">Add</SubmitButton>
        </form>
        {suppressed.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Address</th><th>Reason</th><th>Since</th><th /></tr></thead>
              <tbody>
                {suppressed.map((c) => (
                  <tr key={c.id}>
                    <td>{c.email}</td>
                    <td>{c.unsubscribedAt ? <Badge tone="warn">Unsubscribed</Badge> : <Badge tone="bad">Bounced</Badge>}</td>
                    <td className="small">{fmtDate(c.unsubscribedAt ?? c.bouncedAt)}</td>
                    <td className="r"><form action={removeSuppression}><input type="hidden" name="id" value={c.id} /><ConfirmButton className="btn btn-sm" confirm="Confirm">Remove</ConfirmButton></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty small">Nobody yet.</div>}
      </section>
    </>
  );
}
