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
          </dl>
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
