import { randomUUID } from "node:crypto";
import { runFor } from "@/lib/engine/runner";

/**
 * Serverless sender for hosts that cannot keep a worker running (e.g. Vercel).
 * Call it every minute with `Authorization: Bearer <CRON_SECRET>`, from Vercel Cron,
 * Supabase pg_cron, or any scheduler. Each call sends for ~50 seconds, then returns.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runFor(`cron:${randomUUID().slice(0, 8)}`, 50_000, 3_000);
  return Response.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
