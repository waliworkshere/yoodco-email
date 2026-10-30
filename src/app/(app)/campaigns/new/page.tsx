import Link from "next/link";
import { db } from "@/lib/db";
import { createCampaign } from "@/app/actions/campaigns";
import { SubmitButton } from "@/components/buttons";
import { Flash, Notice } from "@/components/ui";

export const metadata = { title: "New campaign" };

export default async function NewCampaign({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const mailboxCount = await db.mailbox.count();
  return (
    <>
      <div className="page-head">
        <div className="title">
          <span className="crumbs"><Link href="/campaigns">Campaigns</Link> / New</span>
          <h1>New campaign</h1>
        </div>
      </div>
      <Flash sp={sp} />
      {mailboxCount === 0 ? (
        <Notice tone="info" title="No mailboxes connected yet">
          You can import now. Contacts are matched to their sender when you <Link href="/mailboxes/new">connect the mailboxes</Link>, or add sandbox mailboxes to try the system first.
        </Notice>
      ) : null}
      <form action={createCampaign} className="card">
        <div className="card-head"><h2>Contacts and copy</h2></div>
        <div className="card-body form">
          <div className="field">
            <label htmlFor="name">Campaign name</label>
            <input id="name" name="name" className="input" placeholder="Yood · Sequence 1 · SaaS CEOs" required />
          </div>
          <div className="file-drop">
            <label htmlFor="file" className="label">Contact sheet</label>
            <input id="file" name="file" type="file" accept=".xlsx,.csv" required />
            <p className="hint">
              .xlsx or .csv with one row per contact. Recognised columns: <code>recipientEmail</code>, <code>firstName</code>, <code>lastName</code>, <code>companyName</code>, <code>senderEmail</code>, and <code>Email1_Subject</code> / <code>Email1_Body</code> up to <code>Email10</code>. Other columns become placeholders, e.g. a column <code>industry</code> can be used as <code>{"{{industry}}"}</code>.
            </p>
          </div>
          <div className="fields fields-3">
            <div className="field">
              <label htmlFor="delay2">Email 2 after</label>
              <select id="delay2" name="delay2" className="select" defaultValue="3">
                {[1, 2, 3, 4, 5, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="delay3">Email 3 after</label>
              <select id="delay3" name="delay3" className="select" defaultValue="4">
                {[1, 2, 3, 4, 5, 7, 10].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hourlyLimit">Emails per hour (whole campaign)</label>
              <input id="hourlyLimit" name="hourlyLimit" type="number" min={1} max={500} defaultValue={20} className="input" />
            </div>
            <div className="field">
              <label htmlFor="timezone">Sending time zone</label>
              <input id="timezone" name="timezone" className="input" defaultValue="Asia/Dubai" />
              <span className="hint">Weekdays 09:00–17:00 in this zone. Adjustable later.</span>
            </div>
            <div className="field span-2">
              <span className="label">Contacts whose sender is not connected</span>
              <label className="check"><input type="radio" name="assignMissing" value="wait" defaultChecked /><span>Keep them for that sender. They are assigned automatically when the mailbox is connected.</span></label>
              <label className="check"><input type="radio" name="assignMissing" value="roundrobin" /><span>Spread them across the mailboxes that are connected now.</span></label>
            </div>
          </div>
          <Notice tone="test" title="Every new campaign starts in test mode">
            Emails are captured in a test inbox and never reach the people on the list. You switch to live when you are happy.
          </Notice>
          <div className="form-foot">
            <Link className="btn" href="/campaigns">Cancel</Link>
            <SubmitButton pending="Importing…">Import and create</SubmitButton>
          </div>
        </div>
      </form>
    </>
  );
}
