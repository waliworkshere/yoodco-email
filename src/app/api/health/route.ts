import { db } from "@/lib/db";
import { workerStatus } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const w = await workerStatus();
    return Response.json({ ok: true, database: "ok", worker: w.state });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
