import { db } from "../db";
import { env } from "../env";
import { tick, type TickReport } from "./scheduler";
import { scanInboxes } from "./inbox";
import { isInWindow } from "../schedule";

/**
 * Shared by the long-running worker (`npm run worker`) and the serverless
 * cron endpoint (/api/cron/tick). Only one runner sends at a time: the one
 * holding a fresh heartbeat. A runner that finishes marks itself "idle" so the
 * next one can take over at once while the dashboard still shows it as online.
 */
export async function claimLeadership(instance: string, startedAt: Date, info: unknown = null): Promise<boolean> {
  const now = new Date();
  const hb = await db.workerHeartbeat.findUnique({ where: { id: "worker" } });
  const staleAfter = env.workerTickSeconds * 3000 + 15_000;
  if (hb && hb.host !== instance && hb.host !== "idle" && now.getTime() - hb.lastBeat.getTime() < staleAfter) return false;
  await db.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", lastBeat: now, startedAt, host: instance, info: info ?? undefined },
    update: { lastBeat: now, host: instance, info: info ?? undefined, ...(hb?.host !== instance ? { startedAt } : {}) },
  });
  return true;
}

export async function releaseLeadership(instance: string) {
  await db.workerHeartbeat.updateMany({ where: { id: "worker", host: instance }, data: { host: "idle" } });
}

export interface CycleResult {
  ticks: number;
  sent: number;
  failed: number;
  reports: TickReport[];
  inbox?: Record<string, unknown>;
  skipped?: string;
}

/** Reads replies at most every few minutes, however often the sender is called. */
async function scanInboxesIfDue(everyMs = 3 * 60_000) {
  const now = new Date();
  const last = await db.workerHeartbeat.findUnique({ where: { id: "inbox" } });
  if (last && now.getTime() - last.lastBeat.getTime() < everyMs) return { skipped: "Read recently" };
  await db.workerHeartbeat.upsert({ where: { id: "inbox" }, create: { id: "inbox", lastBeat: now, startedAt: now, host: "inbox" }, update: { lastBeat: now } });
  return scanInboxes();
}

/** Is there anything to send in the next `withinMs`: a campaign inside its sending window, or a booking link due? */
async function workAhead(withinMs: number) {
  const now = new Date();
  const running = await db.campaign.findMany({ where: { status: "RUNNING" } });
  if (running.some((c) => (c.mode === "TEST" && c.testFastForward) || isInWindow(now, c))) return true;
  const due = await db.campaignContact.count({ where: { bookingReplySentAt: null, bookingReplyDueAt: { lte: new Date(now.getTime() + withinMs) } } });
  return due > 0;
}

/** Runs scheduler ticks for up to `budgetMs`, then returns. Reads inboxes when due. */
export async function runFor(instance: string, budgetMs: number, tickMs: number): Promise<CycleResult> {
  const startedAt = new Date();
  const out: CycleResult = { ticks: 0, sent: 0, failed: 0, reports: [] };
  if (!(await claimLeadership(instance, startedAt))) return { ...out, skipped: "Another sender is running" };
  try {
    out.inbox = await scanInboxesIfDue();
    while (Date.now() - startedAt.getTime() < budgetMs) {
      const began = Date.now();
      if (!(await claimLeadership(instance, startedAt, { sent: out.sent, failed: out.failed, ticks: out.ticks }))) break;
      const reports = await tick();
      out.ticks++;
      for (const r of reports) {
        if (r.action === "sent") out.sent++;
        if (r.action === "failed") out.failed++;
        if (r.action !== "waiting") out.reports.push(r);
      }
      if (!(await workAhead(budgetMs))) break;
      const wait = Math.max(300, tickMs - (Date.now() - began));
      if (Date.now() - startedAt.getTime() + wait >= budgetMs) break;
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    await releaseLeadership(instance);
  }
  return out;
}
