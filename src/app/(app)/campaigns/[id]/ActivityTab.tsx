import Link from "next/link";
import type { Campaign, EventType } from "@prisma/client";
import { db } from "@/lib/db";
import { ActivityFeed } from "./ActivityFeed";

const FILTERS: [string, string, EventType[]][] = [
  ["all", "Everything", []],
  ["responses", "Replies", ["REPLY", "AUTO_REPLY"]],
  ["clicks", "Clicks", ["CLICK"]],
  ["opens", "Opens", ["OPEN"]],
  ["problems", "Problems", ["BOUNCE", "FAILED", "UNSUBSCRIBE", "STOPPED"]],
  ["sent", "Sent", ["SENT"]],
];

export async function ActivityTab({ campaign, sp }: { campaign: Campaign; sp: Record<string, string> }) {
  const f = FILTERS.find(([k]) => k === sp.filter) ?? FILTERS[0];
  const events = await db.event.findMany({
    where: { campaignId: campaign.id, ...(f[2].length ? { type: { in: f[2] } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { campaignContact: { include: { contact: true } } },
  });
  return (
    <section className="card">
      <div className="filters">
        {FILTERS.map(([k, label]) => (
          <Link key={k} className="chip" href={`/campaigns/${campaign.id}?tab=activity${k === "all" ? "" : `&filter=${k}`}`} aria-current={f[0] === k ? "true" : undefined}>{label}</Link>
        ))}
        <span className="small muted" style={{ marginLeft: "auto" }}>Latest 150 events</span>
      </div>
      <ActivityFeed events={events} emptyText="Nothing has happened yet." />
    </section>
  );
}
