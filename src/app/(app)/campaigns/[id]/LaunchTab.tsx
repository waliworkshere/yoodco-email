import Link from "next/link";
import type { Campaign, CampaignStep } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { backToTest, goLive, sendTestToMe } from "@/app/actions/campaigns";
import { SubmitButton } from "@/components/buttons";
import { getSession } from "@/lib/auth";
import { Badge, fmtNum } from "@/components/ui";

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li style={{ gridTemplateColumns: "28px minmax(0,1fr)" }}>
      <span className={`badge plain ${ok ? "good" : warn ? "warn" : "bad"}`} style={{ width: 22, padding: 0, justifyContent: "center" }}>{ok ? "✓" : "!"}</span>
      <div className="stack" style={{ gap: 2 }}>{children}</div>
    </li>
  );
}

export async function LaunchTab({ campaign: c }: { campaign: Campaign & { steps: CampaignStep[] } }) {
  const me = await getSession();
  const [samples, boxes, testSent, liveSent, unassigned, replies] = await Promise.all([
    db.campaignContact.findMany({ where: { campaignId: c.id, mailboxId: { not: null } }, include: { contact: true }, take: 50, orderBy: { createdAt: "asc" } }),
    db.mailbox.findMany({ where: { campaignContacts: { some: { campaignId: c.id } } } }),
    db.message.count({ where: { campaignId: c.id, mode: "TEST" } }),
    db.message.count({ where: { campaignId: c.id, mode: "LIVE" } }),
    db.campaignContact.count({ where: { campaignId: c.id, mailboxId: null } }),
    db.event.count({ where: { campaignId: c.id, type: "REPLY" } }),
  ]);
  const sandbox = boxes.filter((b) => b.provider === "SANDBOX");
  const broken = boxes.filter((b) => b.provider !== "SANDBOX" && b.status !== "ACTIVE");
  const https = env.appUrl.startsWith("https://");
  const warmupOff = boxes.filter((b) => b.provider !== "SANDBOX" && !b.warmupEnabled);
  const realBoxes = boxes.filter((b) => b.provider !== "SANDBOX").length;

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head"><h2>1. Send yourself the sequence</h2><p>Real delivery from the real mailbox</p></div>
        <div className="card-body">
          <form action={sendTestToMe} className="form">
            <input type="hidden" name="id" value={c.id} />
            <p className="muted">
              Sends all {c.steps.length} emails at once, written exactly as one contact would receive them, from that contact&apos;s mailbox. Use it to check wording, links, signature and whether it lands in the inbox or spam. Not counted in results.
            </p>
            <div className="field">
              <label htmlFor="contactId">Write it as if for</label>
              <select id="contactId" name="contactId" className="select">
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>{[s.contact.firstName, s.contact.lastName].filter(Boolean).join(" ")} · {s.contact.email}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="to">Send to</label>
              <input id="to" name="to" type="email" className="input" defaultValue={me?.email} required />
            </div>
            <div className="form-foot" style={{ border: 0, padding: 0 }}>
              <SubmitButton className="btn" pending="Sending…" disabled={!samples.length}>Send test emails</SubmitButton>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>2. Run the whole campaign in test mode</h2></div>
        <div className="card-body stack">
          <p className="muted">
            Start the test run from the top of the page. The system goes through every contact and every follow-up exactly as it would live, but captures the emails{env.sandboxWebUrl ? " in Mailpit" : ""} instead of delivering them. Use the contact actions to simulate opens, clicks, replies and bounces and watch the sequence stop.
          </p>
          <dl className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
            <dt>Test emails produced</dt><dd className="num">{fmtNum(testSent)}</dd>
            <dt>Replies recorded (incl. simulated)</dt><dd className="num">{fmtNum(replies)}</dd>
          </dl>
          <div className="row">
            <Link className="btn btn-sm" href={`/campaigns/${c.id}?tab=emails`}>Open test inbox</Link>
            {env.sandboxWebUrl ? <a className="btn btn-sm" href={env.sandboxWebUrl} target="_blank" rel="noreferrer">Open Mailpit</a> : null}
          </div>
        </div>
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="card-head">
          <h2>3. Go live</h2>
          {c.mode === "LIVE" ? <Badge tone="info" plain>This campaign is live</Badge> : null}
        </div>
        <ul className="feed">
          <Check ok={unassigned === 0} warn>
            <strong>Every contact has a sending mailbox</strong>
            <span className="small muted">{unassigned ? `${fmtNum(unassigned)} contacts are waiting for a mailbox that is not connected.` : `${boxes.length} mailboxes share the list.`}</span>
          </Check>
          <Check ok={sandbox.length === 0}>
            <strong>No sandbox mailboxes</strong>
            <span className="small muted">{sandbox.length ? `Replace with real mailboxes: ${sandbox.map((b) => b.email).join(", ")}. Connecting a real mailbox with the same address replaces the sandbox one automatically.` : "All senders are real mailboxes."}</span>
          </Check>
          <Check ok={broken.length === 0}>
            <strong>Mailboxes are connected and healthy</strong>
            <span className="small muted">{broken.length ? `Check: ${broken.map((b) => b.email).join(", ")}` : "All active."}</span>
          </Check>
          <Check ok={https}>
            <strong>Tracking address is public</strong>
            <span className="small muted">{https ? env.appUrl : `APP_URL is ${env.appUrl}. Recipients cannot reach it, so opens, clicks and unsubscribe links would not work. Deploy the app on a public https address first.`}</span>
          </Check>
          <Check ok={realBoxes > 0 && warmupOff.length === 0} warn>
            <strong>Warm-up is on for new mailboxes</strong>
            <span className="small muted">{realBoxes === 0 ? "Applies once real mailboxes are connected." : warmupOff.length ? `Off for ${warmupOff.length} mailbox${warmupOff.length > 1 ? "es" : ""}. Fine for mailboxes that already send daily; turn it on for new ones.` : "On for every mailbox."}</span>
          </Check>
          <Check ok={c.unsubscribeFooter} warn>
            <strong>Opt-out line included</strong>
            <span className="small muted">{c.unsubscribeFooter ? "Included." : "Off. Recommended for compliance (GDPR, CAN-SPAM) and for Gmail and Outlook's sender rules."}</span>
          </Check>
          <Check ok={false} warn>
            <strong>Domain authentication (SPF, DKIM, DMARC)</strong>
            <span className="small muted">Check each sending domain on its <Link href="/mailboxes">mailbox page</Link>. Without these, slow sending will still land in spam.</span>
          </Check>
        </ul>
        <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
          {c.mode === "TEST" ? (
            <form action={goLive} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={c.id} />
              <div className="field" style={{ maxWidth: 240 }}>
                <label htmlFor="confirm">Type LIVE to confirm</label>
                <input id="confirm" name="confirm" className="input" autoComplete="off" placeholder="LIVE" />
              </div>
              <SubmitButton className="btn btn-go" pending="Switching…">Switch to live</SubmitButton>
              <span className="small muted" style={{ flexBasis: "100%" }}>Clears the test results and puts the campaign back at the start in live mode. Nothing is sent until you press Start sending.</span>
            </form>
          ) : liveSent === 0 ? (
            <form action={backToTest} className="row">
              <input type="hidden" name="id" value={c.id} />
              <span className="muted">Live, nothing sent yet.</span>
              <SubmitButton className="btn btn-sm" pending="…">Back to test mode</SubmitButton>
            </form>
          ) : (
            <p className="muted">Live since the first send. {fmtNum(liveSent)} emails sent.</p>
          )}
        </div>
      </section>
    </div>
  );
}
