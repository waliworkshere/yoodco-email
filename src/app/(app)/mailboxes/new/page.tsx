import Link from "next/link";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { connectGoogleWorkspace, connectSandbox, connectSmtp } from "@/app/actions/mailboxes";
import { SubmitButton } from "@/components/buttons";
import { Flash, Notice } from "@/components/ui";

export const metadata = { title: "Connect a mailbox" };

const SMTP_PRESETS = [
  { name: "Google Workspace / Gmail (app password)", smtp: "smtp.gmail.com", smtpPort: 465, imap: "imap.gmail.com" },
  { name: "Microsoft 365 / Outlook", smtp: "smtp.office365.com", smtpPort: 587, imap: "outlook.office365.com" },
  { name: "Zoho Mail", smtp: "smtp.zoho.com", smtpPort: 465, imap: "imap.zoho.com" },
];

function Limits() {
  return (
    <div className="fields fields-3">
      <div className="field">
        <label htmlFor="dailyLimit">Daily limit</label>
        <input id="dailyLimit" name="dailyLimit" type="number" min={1} defaultValue={30} className="input" />
        <span className="hint">30–40 is safe for cold email.</span>
      </div>
      <div className="field">
        <label htmlFor="hourlyLimit">Hourly limit</label>
        <input id="hourlyLimit" name="hourlyLimit" type="number" min={1} defaultValue={8} className="input" />
      </div>
      <label className="check" style={{ alignSelf: "center" }}>
        <input type="checkbox" name="warmupEnabled" />
        <span><span className="label">Warm up</span><br /><span className="hint">Start at 5/day, +3 each day.</span></span>
      </label>
    </div>
  );
}

export default async function NewMailbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const type = sp.type ?? "";
  const prefill = sp.email ?? "";
  const waitingSenders = await db.campaignContact.findMany({
    where: { mailboxId: null, senderEmail: { not: null } },
    distinct: ["senderEmail"],
    select: { senderEmail: true },
  });
  const senderList = waitingSenders.map((w) => w.senderEmail).filter(Boolean).join("\n");

  return (
    <>
      <div className="page-head">
        <div className="title">
          <span className="crumbs"><Link href="/mailboxes">Mailboxes</Link> / Connect</span>
          <h1>Connect a mailbox</h1>
        </div>
      </div>
      <Flash sp={sp} />

      <div className="provider-grid">
        <div className="provider">
          <span className="logo">G</span>
          <h3>Google Workspace or Gmail</h3>
          <p>The mailbox owner signs in with Google. Best when each person connects their own account.</p>
          {env.google.oauthConfigured ? (
            <a className="btn btn-primary" href={`/api/oauth/google/start${prefill ? `?email=${encodeURIComponent(prefill)}` : ""}`}>Sign in with Google</a>
          ) : (
            <span className="small muted">Needs <code>GOOGLE_CLIENT_ID</code>. See <code>docs/CONNECTING_MAILBOXES.md</code>.</span>
          )}
        </div>
        <div className="provider">
          <span className="logo">W</span>
          <h3>All Google Workspace mailboxes at once</h3>
          <p>An admin connects every @yourdomain mailbox with a service account. No one else has to sign in.</p>
          {env.google.dwdConfigured ? (
            <Link className="btn" href="/mailboxes/new?type=workspace">Add mailboxes</Link>
          ) : (
            <span className="small muted">Needs <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>.</span>
          )}
        </div>
        <div className="provider">
          <span className="logo">M</span>
          <h3>Microsoft 365 or Outlook</h3>
          <p>The mailbox owner signs in with Microsoft.</p>
          {env.microsoft.configured ? (
            <a className="btn btn-primary" href={`/api/oauth/microsoft/start${prefill ? `?email=${encodeURIComponent(prefill)}` : ""}`}>Sign in with Microsoft</a>
          ) : (
            <span className="small muted">Needs <code>MICROSOFT_CLIENT_ID</code>. See <code>docs/CONNECTING_MAILBOXES.md</code>.</span>
          )}
        </div>
        <div className="provider">
          <span className="logo">@</span>
          <h3>Any provider (SMTP / IMAP)</h3>
          <p>Server address and password or app password. Works with Google, Microsoft, Zoho and most hosts.</p>
          <Link className="btn" href={`/mailboxes/new?type=smtp${prefill ? `&email=${encodeURIComponent(prefill)}` : ""}`}>Enter details</Link>
        </div>
        <div className="provider" style={{ borderColor: "color-mix(in srgb, var(--test) 35%, transparent)" }}>
          <span className="logo" style={{ color: "var(--test)" }}>S</span>
          <h3>Sandbox (try it out)</h3>
          <p>Pretend mailboxes that never deliver. Use the addresses from your sheet to rehearse the whole flow.</p>
          <Link className="btn" href="/mailboxes/new?type=sandbox">Add sandbox mailboxes</Link>
        </div>
      </div>

      {type === "smtp" ? (
        <form action={connectSmtp} className="card">
          <div className="card-head"><h2>SMTP and IMAP details</h2><p>IMAP is used to detect replies and bounces</p></div>
          <div className="card-body form">
            <Notice tone="info" title="For Google accounts use an app password">
              Turn on 2-step verification, then create one at myaccount.google.com/apppasswords. Your normal password will not work. Microsoft 365 needs &quot;Authenticated SMTP&quot; enabled for the mailbox.
            </Notice>
            <div className="fields">
              <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" className="input" required defaultValue={prefill} /></div>
              <div className="field"><label htmlFor="displayName">Sender name</label><input id="displayName" name="displayName" className="input" placeholder="Charles from Yood" /></div>
              <div className="field"><label htmlFor="username">Login (if different from email)</label><input id="username" name="username" className="input" autoComplete="off" /></div>
              <div className="field"><label htmlFor="password">Password or app password</label><input id="password" name="password" type="password" className="input" required autoComplete="new-password" /></div>
              <div className="field"><label htmlFor="smtpHost">SMTP server</label><input id="smtpHost" name="smtpHost" className="input" list="smtp-hosts" required placeholder="smtp.gmail.com" /></div>
              <div className="field"><label htmlFor="smtpPort">SMTP port</label><input id="smtpPort" name="smtpPort" type="number" className="input" defaultValue={465} /><span className="hint">465 (SSL) or 587 (STARTTLS)</span></div>
              <div className="field"><label htmlFor="imapHost">IMAP server</label><input id="imapHost" name="imapHost" className="input" list="imap-hosts" placeholder="imap.gmail.com" /></div>
              <div className="field"><label htmlFor="imapPort">IMAP port</label><input id="imapPort" name="imapPort" type="number" className="input" defaultValue={993} /></div>
            </div>
            <datalist id="smtp-hosts">{SMTP_PRESETS.map((p) => <option key={p.smtp} value={p.smtp}>{p.name}</option>)}</datalist>
            <datalist id="imap-hosts">{SMTP_PRESETS.map((p) => <option key={p.imap} value={p.imap}>{p.name}</option>)}</datalist>
            <Limits />
            <div className="form-foot">
              <Link className="btn" href="/mailboxes/new">Cancel</Link>
              <SubmitButton pending="Connecting and testing…">Connect and test</SubmitButton>
            </div>
          </div>
        </form>
      ) : null}

      {type === "sandbox" ? (
        <form action={connectSandbox} className="card">
          <div className="card-head"><h2>Sandbox mailboxes</h2><p>Nothing sent from these ever leaves the system</p></div>
          <div className="card-body form">
            <div className="field">
              <label htmlFor="emails">Addresses</label>
              <textarea id="emails" name="emails" className="textarea" defaultValue={senderList || prefill} placeholder={"charles@yood.ai\nkaty@yood.ai"} />
              <span className="hint">One per line. {senderList ? "Pre-filled with the senders from your imported sheets, so their contacts are assigned straight away." : "Use the sender addresses from your sheet so contacts match automatically."} Connect the real mailbox with the same address later and it replaces the sandbox one.</span>
            </div>
            <div className="form-foot">
              <Link className="btn" href="/mailboxes/new">Cancel</Link>
              <SubmitButton pending="Adding…">Add sandbox mailboxes</SubmitButton>
            </div>
          </div>
        </form>
      ) : null}

      {type === "workspace" && env.google.dwdConfigured ? (
        <form action={connectGoogleWorkspace} className="card">
          <div className="card-head"><h2>Google Workspace mailboxes</h2><p>Connected through your service account</p></div>
          <div className="card-body form">
            <div className="field">
              <label htmlFor="ws-emails">Addresses</label>
              <textarea id="ws-emails" name="emails" className="textarea" defaultValue={senderList} placeholder={"charles@yood.ai\nkaty@yood.ai"} />
              <span className="hint">One per line. Each address is checked before it is added.</span>
            </div>
            <Limits />
            <div className="form-foot">
              <Link className="btn" href="/mailboxes/new">Cancel</Link>
              <SubmitButton pending="Connecting…">Connect mailboxes</SubmitButton>
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}
