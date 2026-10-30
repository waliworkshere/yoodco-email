import type { Campaign, CampaignMode, Mailbox } from "@prisma/client";
import { db } from "../db";
import { effectiveDailyLimit, isInWindow, jitterMs } from "../schedule";
import { sendNextStep } from "./send";

/**
 * The pacing loop. Called by the worker every few seconds.
 *
 * Per tick and per running campaign it sends at most ONE email, and only if:
 *   1. the campaign's sending window is open (local time zone, weekdays, hours)
 *   2. the campaign's own random gap since its last send has passed
 *   3. the campaign has sent fewer than `hourlyLimit` in the last 60 minutes
 *   4. there is a due enrollment whose mailbox is active, rested, and under its hourly and daily limits
 *
 * Follow-ups (step 2, 3 …) go before first emails so threads stay on schedule.
 * Test campaigns in fast-forward ignore the window and caps and send every few seconds.
 */

export interface TickReport {
  campaign: string;
  action: "sent" | "failed" | "waiting" | "completed";
  reason?: string;
}

const HOUR = 3600_000;

async function mailboxUsage(mode: CampaignMode, now: Date) {
  const [day, hour] = await Promise.all([
    db.message.groupBy({
      by: ["mailboxId"],
      where: { mode, status: "SENT", sentAt: { gt: new Date(now.getTime() - 24 * HOUR) } },
      _count: { _all: true },
    }),
    db.message.groupBy({
      by: ["mailboxId"],
      where: { mode, status: "SENT", sentAt: { gt: new Date(now.getTime() - HOUR) } },
      _count: { _all: true },
    }),
  ]);
  const toMap = (rows: typeof day) => new Map(rows.map((r) => [r.mailboxId ?? "", r._count._all]));
  return { day: toMap(day), hour: toMap(hour) };
}

export function mailboxAvailable(
  m: Mailbox,
  usage: { day: Map<string, number>; hour: Map<string, number> },
  now: Date,
  opts: { ignoreLimits: boolean; ignoreStatus: boolean },
): boolean {
  if (!opts.ignoreStatus && m.status !== "ACTIVE") return false;
  if (opts.ignoreLimits) return true;
  if (m.nextSendAt && m.nextSendAt > now) return false;
  if ((usage.hour.get(m.id) ?? 0) >= m.hourlyLimit) return false;
  if ((usage.day.get(m.id) ?? 0) >= effectiveDailyLimit(m, now)) return false;
  return true;
}

export async function tickCampaign(c: Campaign, mailboxes: Mailbox[], now = new Date()): Promise<TickReport> {
  const fastForward = c.mode === "TEST" && c.testFastForward;

  if (!fastForward && !isInWindow(now, c)) return { campaign: c.name, action: "waiting", reason: "Outside sending window" };
  if (c.nextSendAt && c.nextSendAt > now) return { campaign: c.name, action: "waiting", reason: "Spacing between emails" };

  if (!fastForward) {
    const lastHour = await db.message.count({
      where: { campaignId: c.id, status: "SENT", sentAt: { gt: new Date(now.getTime() - HOUR) } },
    });
    if (lastHour >= c.hourlyLimit) return { campaign: c.name, action: "waiting", reason: `Hourly limit reached (${c.hourlyLimit})` };
  }

  const usage = await mailboxUsage(c.mode, now);
  // In test mode the real mailbox is not used (unless redirecting), so its status does not matter
  const ignoreStatus = c.mode === "TEST" && !c.testRedirectTo;
  const available = mailboxes
    .filter((m) => mailboxAvailable(m, usage, now, { ignoreLimits: fastForward, ignoreStatus }))
    .map((m) => m.id);

  const due = available.length
    ? await db.campaignContact.findFirst({
        where: {
          campaignId: c.id,
          status: { in: ["QUEUED", "ACTIVE"] },
          nextStepAt: { lte: now },
          mailboxId: { in: available },
        },
        orderBy: [{ currentStep: "desc" }, { nextStepAt: "asc" }],
        select: { id: true, mailboxId: true },
      })
    : null;

  if (!due) {
    const remaining = await db.campaignContact.count({ where: { campaignId: c.id, status: { in: ["QUEUED", "ACTIVE"] } } });
    if (remaining === 0) {
      await db.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED", completedAt: now, nextSendAt: null } });
      return { campaign: c.name, action: "completed" };
    }
    return {
      campaign: c.name,
      action: "waiting",
      reason: available.length ? "No email is due yet" : "All mailboxes are resting, at their limit, or paused",
    };
  }

  const result = await sendNextStep(due.id, now);

  const gap = fastForward ? jitterMs(3, 8) : jitterMs(c.minGapSeconds, c.maxGapSeconds);
  await db.campaign.update({ where: { id: c.id }, data: { nextSendAt: new Date(now.getTime() + gap) } });
  if (due.mailboxId && !fastForward) {
    // A mailbox also rests 2–6 minutes between its own emails, even across campaigns
    await db.mailbox.update({ where: { id: due.mailboxId }, data: { nextSendAt: new Date(now.getTime() + jitterMs(120, 360)) } });
  }

  return result.ok
    ? { campaign: c.name, action: "sent" }
    : { campaign: c.name, action: result.kind === "skipped" ? "waiting" : "failed", reason: result.error };
}

export async function tick(now = new Date()): Promise<TickReport[]> {
  const campaigns = await db.campaign.findMany({ where: { status: "RUNNING" }, orderBy: { startedAt: "asc" } });
  if (!campaigns.length) return [];
  const mailboxes = await db.mailbox.findMany();
  const reports: TickReport[] = [];
  for (const c of campaigns) {
    try {
      reports.push(await tickCampaign(c, mailboxes, now));
    } catch (e) {
      reports.push({ campaign: c.name, action: "failed", reason: (e as Error).message });
    }
  }
  return reports;
}
