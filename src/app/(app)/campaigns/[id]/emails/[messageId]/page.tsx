import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { simulate } from "@/app/actions/campaigns";
import { SubmitButton } from "@/components/buttons";
import { Badge, Flash, fmtDate } from "@/components/ui";
import { ActivityFeed } from "../../ActivityFeed";

export const metadata = { title: "Email" };

export default async function EmailPreview({ params, searchParams }: { params: Promise<{ id: string; messageId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id, messageId } = await params;
  const sp = await searchParams;
  const m = await db.message.findFirst({ where: { id: messageId, campaignId: id }, include: { campaign: true } });
  if (!m) notFound();
  const events = await db.event.findMany({
    where: { messageId: m.id },
    orderBy: { createdAt: "desc" },
    include: { campaignContact: { include: { contact: true } } },
  });

  // Viewing an email here must never count as an open or a click: strip the pixel and un-track links
  const links = (m.links as string[]) ?? [];
  const trackPrefix = `${env.appUrl}/t/c/${m.token}/`;
  const safeHtml = m.bodyHtml
    .replace(/<img[^>]+\/t\/o\/[^>]+>/g, "")
    .replace(new RegExp(trackPrefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "(\\d+)", "g"), (_x, i) => links[Number(i)] ?? "#")
    .replace('<body style="margin:0;padding:0">', '<body style="margin:0;padding:20px 22px">')
    .replace("<html>", '<html><head><base target="_blank"></head>');
  const back = `/campaigns/${id}/emails/${m.id}`;

  return (
    <>
      <div className="page-head">
        <div className="title">
          <span className="crumbs"><Link href="/campaigns">Campaigns</Link> / <Link href={`/campaigns/${id}?tab=emails`}>{m.campaign.name}</Link> / {m.kind === "BOOKING_REPLY" ? "Booking link reply" : m.kind === "INVITE" ? "Calendar invite" : `Email ${m.step}`}</span>
          <div className="title-row"><h1 className="trunc" style={{ maxWidth: 680 }}>{m.subject || "(no subject)"}</h1>{m.mode === "TEST" ? <Badge tone="test" plain>Test</Badge> : null}</div>
        </div>
      </div>
      <Flash sp={sp} />
      <div className="grid-3-1">
        <div className="email-preview">
          <dl className="meta">
            <dt>From</dt><dd>{m.fromEmail}</dd>
            <dt>To</dt><dd>{m.toEmail}{m.deliveredTo !== m.toEmail ? ` (delivered to ${m.deliveredTo})` : ""}</dd>
            <dt>Subject</dt><dd>{m.subject}</dd>
            <dt>Sent</dt><dd>{fmtDate(m.sentAt)}</dd>
          </dl>
          <iframe title="Email content" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={safeHtml} />
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Outcome</h2></div>
            <div className="card-body">
              <dl className="kv" style={{ gridTemplateColumns: "100px 1fr" }}>
                <dt>Status</dt><dd>{m.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : m.bouncedAt ? <Badge tone="bad">Bounced</Badge> : <Badge tone="good">Delivered</Badge>}</dd>
                {m.error ? <><dt>Error</dt><dd className="small">{m.error}</dd></> : null}
                <dt>Opened</dt><dd>{m.firstOpenedAt ? `${fmtDate(m.firstOpenedAt)} · ${m.openCount}×` : "Not yet"}</dd>
                <dt>Clicked</dt><dd>{m.firstClickedAt ? `${fmtDate(m.firstClickedAt)} · ${m.clickCount}×` : "Not yet"}</dd>
                <dt>Replied</dt><dd>{m.repliedAt ? fmtDate(m.repliedAt) : "Not yet"}</dd>
                <dt>Links</dt><dd className="small">{links.length ? links.map((l) => <div key={l} className="trunc" style={{ maxWidth: 220 }}>{l}</div>) : "None"}</dd>
              </dl>
            </div>
            {m.mode === "TEST" && m.status === "SENT" ? (
              <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
                <p className="small muted" style={{ marginBottom: 10 }}>Pretend the contact did something, to see how the dashboard and the sequence react.</p>
                <div className="row" style={{ gap: 6 }}>
                  {(["open", "click", "reply", "bounce"] as const).map((w) => (
                    <form action={simulate} key={w}>
                      <input type="hidden" name="ccId" value={m.campaignContactId} />
                      <input type="hidden" name="what" value={w} />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton className="btn btn-sm" pending="…">{w[0].toUpperCase() + w.slice(1)}</SubmitButton>
                    </form>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="card">
            <div className="card-head"><h2>History</h2></div>
            <ActivityFeed events={events} />
          </section>
        </div>
      </div>
      <details className="card">
        <summary className="card-body" style={{ cursor: "pointer" }}>Plain-text version</summary>
        <pre className="card-body mono" style={{ whiteSpace: "pre-wrap", margin: 0, borderTop: "1px solid var(--line)" }}>{m.bodyText}</pre>
      </details>
    </>
  );
}
