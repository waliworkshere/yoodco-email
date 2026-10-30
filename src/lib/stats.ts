import type { Prisma } from "@prisma/client";
import { db } from "./db";

/**
 * Reporting queries. Rates are per email delivered (sent and not bounced),
 * opens and clicks exclude likely bots (link scanners, image prefetchers).
 */

export interface Funnel {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

export const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
export const fmtPct = (n: number, d: number) => (d > 0 ? `${pct(n, d).toFixed(1)}%` : "–");

export async function messageFunnel(where: Prisma.MessageWhereInput): Promise<Funnel> {
  const base = { ...where, status: "SENT" as const };
  const [sent, bounced, opened, clicked, replied, unsubscribed] = await Promise.all([
    db.message.count({ where: base }),
    db.message.count({ where: { ...base, bouncedAt: { not: null } } }),
    db.message.count({ where: { ...base, firstOpenedAt: { not: null } } }),
    db.message.count({ where: { ...base, firstClickedAt: { not: null } } }),
    db.message.count({ where: { ...base, repliedAt: { not: null } } }),
    db.event.count({ where: { type: "UNSUBSCRIBE", message: base } }),
  ]);
  return { sent, delivered: sent - bounced, opened, clicked, replied, bounced, unsubscribed };
}

/** Contact-level outcome: how many people (not emails) opened, clicked, replied. */
export async function peopleFunnel(campaignId: string) {
  const [enrolled, contacted, opened, clicked, replied, bounced, unsubscribed] = await Promise.all([
    db.campaignContact.count({ where: { campaignId } }),
    db.campaignContact.count({ where: { campaignId, currentStep: { gt: 0 } } }),
    db.campaignContact.count({ where: { campaignId, messages: { some: { firstOpenedAt: { not: null } } } } }),
    db.campaignContact.count({ where: { campaignId, messages: { some: { firstClickedAt: { not: null } } } } }),
    db.campaignContact.count({ where: { campaignId, repliedAt: { not: null } } }),
    db.campaignContact.count({ where: { campaignId, status: "BOUNCED" } }),
    db.campaignContact.count({ where: { campaignId, status: "UNSUBSCRIBED" } }),
  ]);
  return { enrolled, contacted, opened, clicked, replied, bounced, unsubscribed };
}

export async function statusCounts(campaignId: string) {
  const rows = await db.campaignContact.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
}

export async function perStep(campaignId: string, steps: number) {
  const out = [];
  for (let s = 1; s <= steps; s++) out.push({ step: s, ...(await messageFunnel({ campaignId, step: s })) });
  return out;
}

export async function perMailbox(campaignId: string) {
  const boxes = await db.campaignContact.groupBy({ by: ["mailboxId"], where: { campaignId }, _count: { _all: true } });
  const ids = boxes.map((b) => b.mailboxId).filter((x): x is string => Boolean(x));
  const mailboxes = await db.mailbox.findMany({ where: { id: { in: ids } } });
  const rows = [];
  for (const m of mailboxes) {
    rows.push({
      mailbox: m,
      contacts: boxes.find((b) => b.mailboxId === m.id)?._count._all ?? 0,
      ...(await messageFunnel({ campaignId, mailboxId: m.id })),
    });
  }
  const unassigned = boxes.find((b) => !b.mailboxId)?._count._all ?? 0;
  return { rows: rows.sort((a, b) => a.mailbox.email.localeCompare(b.mailbox.email)), unassigned };
}

/** Emails sent per day by step, for the last `days` days (in UTC days). */
export async function dailySends(where: Prisma.MessageWhereInput, days = 14) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const msgs = await db.message.findMany({
    where: { ...where, status: "SENT", sentAt: { gte: since } },
    select: { sentAt: true, step: true },
  });
  const series: { date: string; byStep: Record<number, number>; total: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    series.push({ date: d.toISOString().slice(0, 10), byStep: {}, total: 0 });
  }
  for (const m of msgs) {
    const key = m.sentAt.toISOString().slice(0, 10);
    const row = series.find((s) => s.date === key);
    if (!row) continue;
    row.byStep[m.step] = (row.byStep[m.step] ?? 0) + 1;
    row.total++;
  }
  return series;
}

export async function workerStatus() {
  const hb = await db.workerHeartbeat.findUnique({ where: { id: "worker" } });
  if (!hb) return { state: "never" as const, hb: null };
  const age = Date.now() - hb.lastBeat.getTime();
  return { state: age < 90_000 ? ("online" as const) : ("offline" as const), hb, ageSeconds: Math.round(age / 1000) };
}

/** Emails a mailbox sent in the last 24h / 1h (live only). */
export async function mailboxUsage() {
  const now = Date.now();
  const [day, hour] = await Promise.all([
    db.message.groupBy({ by: ["mailboxId"], where: { mode: "LIVE", status: "SENT", sentAt: { gt: new Date(now - 86_400_000) } }, _count: { _all: true } }),
    db.message.groupBy({ by: ["mailboxId"], where: { mode: "LIVE", status: "SENT", sentAt: { gt: new Date(now - 3_600_000) } }, _count: { _all: true } }),
  ]);
  return {
    day: new Map(day.map((r) => [r.mailboxId ?? "", r._count._all])),
    hour: new Map(hour.map((r) => [r.mailboxId ?? "", r._count._all])),
  };
}
