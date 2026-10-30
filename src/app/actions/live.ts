"use server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tickCampaign } from "@/lib/engine/scheduler";

/**
 * Advances a running TEST campaign by one scheduler step. Called every few seconds by the
 * campaign page while it is open, so test runs work on hosts without a background worker.
 * Live campaigns are never sent from here: they need the worker or the cron endpoint.
 */
export async function advanceTestRun(campaignId: string): Promise<{ running: boolean }> {
  await requireUser();
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c || c.status !== "RUNNING") return { running: false };
  if (c.mode !== "TEST") return { running: true };
  const now = new Date();
  // Show the sender as active on the dashboard while a test is being driven from the page
  await db.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", lastBeat: now, startedAt: now, host: "idle" },
    update: { lastBeat: now },
  });
  await tickCampaign(c, await db.mailbox.findMany(), now);
  const after = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  return { running: after?.status === "RUNNING" };
}
