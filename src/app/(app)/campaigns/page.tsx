import Link from "next/link";
import { db } from "@/lib/db";
import { fmtPct } from "@/lib/stats";
import { IconPlus } from "@/components/icons";
import { CampaignStatusBadge, Empty, Flash, fmtDate, fmtNum, ModeBadge, Progress } from "@/components/ui";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const campaigns = await db.campaign.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { _count: { select: { contacts: true, steps: true } } },
  });
  const rows = await Promise.all(
    campaigns.map(async (c) => {
      const [done, sent, delivered, opened, clicked, replied] = await Promise.all([
        db.campaignContact.count({ where: { campaignId: c.id, status: { notIn: ["QUEUED", "ACTIVE"] } } }),
        db.message.count({ where: { campaignId: c.id, status: "SENT" } }),
        db.message.count({ where: { campaignId: c.id, status: "SENT", bouncedAt: null } }),
        db.campaignContact.count({ where: { campaignId: c.id, messages: { some: { firstOpenedAt: { not: null } } } } }),
        db.campaignContact.count({ where: { campaignId: c.id, messages: { some: { firstClickedAt: { not: null } } } } }),
        db.campaignContact.count({ where: { campaignId: c.id, repliedAt: { not: null } } }),
      ]);
      const contacted = await db.campaignContact.count({ where: { campaignId: c.id, currentStep: { gt: 0 } } });
      return { c, done, sent, delivered, opened, clicked, replied, contacted };
    }),
  );

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>Campaigns</h1>
          <p className="muted">Each campaign is one imported sheet and its email sequence.</p>
        </div>
        <Link className="btn btn-primary" href="/campaigns/new"><IconPlus /> New campaign</Link>
      </div>
      <Flash sp={sp} />
      <section className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th><th>Status</th><th>Progress</th>
                  <th className="r">Contacts</th><th className="r">Emails sent</th><th className="r">Opened</th><th className="r">Clicked</th><th className="r">Replied</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, done, sent, opened, clicked, replied, contacted }) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="cell-main" href={`/campaigns/${c.id}`}>{c.name}</Link>
                      <div className="cell-sub">{c._count.steps}-step sequence · created {fmtDate(c.createdAt, false)}</div>
                    </td>
                    <td><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><CampaignStatusBadge status={c.status} /><ModeBadge mode={c.mode} /></div></td>
                    <td style={{ minWidth: 130 }}>
                      <Progress value={done} total={c._count.contacts} />
                      <div className="cell-sub num">{fmtNum(done)} of {fmtNum(c._count.contacts)} finished</div>
                    </td>
                    <td className="r">{fmtNum(c._count.contacts)}</td>
                    <td className="r">{fmtNum(sent)}</td>
                    <td className="r">{fmtPct(opened, contacted)}</td>
                    <td className="r">{fmtPct(clicked, contacted)}</td>
                    <td className="r">{fmtPct(replied, contacted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No campaigns yet" actions={<Link className="btn btn-primary" href="/campaigns/new">Import a contact sheet</Link>}>
            A campaign starts from your contact sheet. It runs in test mode first, so you can check everything before anyone gets an email.
          </Empty>
        )}
      </section>
      {rows.length ? <p className="small muted">Open, click and reply rates are per contact reached.</p> : null}
    </>
  );
}
