import Link from "next/link";
import type { Event, CampaignContact, Contact } from "@prisma/client";
import { Badge, fmtDate } from "@/components/ui";

type FeedEvent = Event & {
  campaignContact: (CampaignContact & { contact: Contact }) | null;
  campaign?: { name: string; id: string };
};

const VERB: Record<string, string> = {
  SENT: "was sent",
  FAILED: "send failed for",
  OPEN: "opened",
  CLICK: "clicked",
  REPLY: "replied",
  AUTO_REPLY: "auto-replied",
  BOUNCE: "bounced",
  UNSUBSCRIBE: "unsubscribed",
  STOPPED: "sequence stopped for",
};

function describe(e: FeedEvent) {
  const c = e.campaignContact?.contact;
  const name = c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : "";
  const who = c ? (name ? `${name}${c.company ? ` (${c.company})` : ""}` : c.email) : "Someone";
  if (e.type === "SENT") return <><b>{who}</b> <span className="muted">was emailed</span></>;
  if (e.type === "FAILED" || e.type === "STOPPED") return <><span className="muted">{e.type === "FAILED" ? "Send failed for" : "Stopped"}</span> <b>{who}</b></>;
  return <><b>{who}</b> <span className="muted">{VERB[e.type] ?? e.type.toLowerCase()}</span></>;
}

export function ActivityFeed({ events, showCampaign, emptyText }: { events: FeedEvent[]; showCampaign?: boolean; emptyText?: string }) {
  if (!events.length) return <div className="empty small">{emptyText ?? "No activity yet."}</div>;
  return (
    <ul className="feed">
      {events.map((e) => (
        <li key={e.id}>
          <span className={`dot ${e.type}`} />
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span>
              {describe(e)} {e.likelyBot ? <Badge plain>likely bot</Badge> : null}
            </span>
            {e.url ? <span className="small muted trunc">{e.url}</span> : null}
            {e.detail ? <span className="small muted" style={{ overflowWrap: "anywhere" }}>{e.detail}</span> : null}
            {showCampaign && e.campaign ? (
              <Link className="small" href={`/campaigns/${e.campaign.id}`}>{e.campaign.name}</Link>
            ) : null}
          </div>
          <time dateTime={e.createdAt.toISOString()}>{fmtDate(e.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}
