import Link from "next/link";
import type { Campaign, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Badge, Empty, fmtDate, fmtNum } from "@/components/ui";

const PAGE = 50;

export async function EmailsTab({ campaign, sp }: { campaign: Campaign; sp: Record<string, string> }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.MessageWhereInput = { campaignId: campaign.id, ...(sp.contact ? { campaignContactId: sp.contact } : {}) };
  const [rows, total] = await Promise.all([
    db.message.findMany({ where, orderBy: { sentAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.message.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const base = `/campaigns/${campaign.id}?tab=emails${sp.contact ? `&contact=${sp.contact}` : ""}`;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{campaign.mode === "TEST" ? "Test inbox" : "Sent emails"}</h2>
        <p>{campaign.mode === "TEST" ? "Every email the test run produced, exactly as it would be delivered." : "Every email sent, with its outcome."}{sp.contact ? <> · <Link href={`/campaigns/${campaign.id}?tab=emails`}>Show all</Link></> : null}</p>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Sent</th><th>To</th><th>From</th><th>Email</th><th>Subject</th><th>Outcome</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap small">{fmtDate(m.sentAt)}</td>
                  <td className="small">{m.toEmail}{m.deliveredTo !== m.toEmail ? <div className="cell-sub">delivered to {m.deliveredTo}</div> : null}</td>
                  <td className="small">{m.fromEmail}</td>
                  <td className="nowrap">{m.kind === "BOOKING_REPLY" ? "Booking link" : m.kind === "INVITE" ? "Calendar invite" : `Email ${m.step}`}</td>
                  <td><Link href={`/campaigns/${campaign.id}/emails/${m.id}`} className="trunc" style={{ display: "inline-block" }}>{m.subject || "(no subject)"}</Link></td>
                  <td className="nowrap">
                    <span className="row" style={{ gap: 4 }}>
                      {m.status === "FAILED" ? <Badge tone="bad">Failed</Badge> : null}
                      {m.bouncedAt ? <Badge tone="bad">Bounced</Badge> : null}
                      {m.repliedAt ? <Badge tone="good">Replied</Badge> : null}
                      {m.firstClickedAt ? <Badge tone="info" plain>Clicked</Badge> : m.firstOpenedAt ? <Badge plain>Opened</Badge> : null}
                      {m.status === "SENT" && !m.bouncedAt && !m.repliedAt && !m.firstOpenedAt ? <span className="muted small">Delivered</span> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No emails yet">
          {campaign.status === "DRAFT" ? "Start the campaign and emails appear here as they are sent." : "Emails appear here as they are sent."}
        </Empty>
      )}
      {pages > 1 ? (
        <div className="pagination">
          <span>Page {page} of {pages} · {fmtNum(total)} emails</span>
          <span className="row">
            {page > 1 ? <Link className="btn btn-sm" href={`${base}&page=${page - 1}`}>Previous</Link> : null}
            {page < pages ? <Link className="btn btn-sm" href={`${base}&page=${page + 1}`}>Next</Link> : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}
