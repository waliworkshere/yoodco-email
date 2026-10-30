/**
 * Background worker. Run exactly one (extra copies wait on standby).
 *
 *   every WORKER_TICK_SECONDS  → scheduler tick: sends at most one email per running campaign
 *   every 60 seconds           → inbox scan for mailboxes whose INBOX_SCAN_MINUTES have passed
 *   every tick                 → heartbeat, shown on the dashboard
 */
import "./load-env";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { tick } from "../lib/engine/scheduler";
import { claimLeadership as claim } from "../lib/engine/runner";
import { scanInboxes } from "../lib/engine/inbox";

const instance = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 6)}`;
const startedAt = new Date();
let stopping = false;
let lastInboxScan = 0;
const stats = { sent: 0, failed: 0, ticks: 0 };

const log = (msg: string, extra?: unknown) =>
  console.log(`${new Date().toISOString()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);

const claimLeadership = () => claim(instance, startedAt, stats);

async function loop() {
  log(`worker ${instance} started (tick ${env.workerTickSeconds}s, inbox every ${env.inboxScanMinutes}m)`);
  while (!stopping) {
    const began = Date.now();
    try {
      if (await claimLeadership()) {
        stats.ticks++;
        const reports = await tick();
        for (const r of reports) {
          if (r.action === "sent") stats.sent++;
          if (r.action === "failed") stats.failed++;
          if (r.action !== "waiting") log(`[${r.campaign}] ${r.action}`, r.reason ? { reason: r.reason } : undefined);
        }
        if (Date.now() - lastInboxScan > 60_000) {
          lastInboxScan = Date.now();
          const scanned = await scanInboxes();
          if (Object.keys(scanned).length) log("inbox scan", scanned);
        }
      }
    } catch (e) {
      log("tick error", { error: (e as Error).message });
    }
    const wait = Math.max(500, env.workerTickSeconds * 1000 - (Date.now() - began));
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, finishing current tick`);
  // Release leadership so a replacement can take over immediately
  await db.workerHeartbeat.updateMany({ where: { id: "worker", host: instance }, data: { lastBeat: new Date(0) } }).catch(() => {});
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void loop();
