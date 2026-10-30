import { db } from "@/lib/db";
import { workerStatus } from "@/lib/stats";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Health and configuration check. Reports only whether settings are present, never their values. */
export async function GET() {
  const has = (fn: () => string) => { try { return fn().length >= 32; } catch { return false; } };
  const config = {
    sessionSecret: has(() => env.sessionSecret),
    encryptionKey: has(() => env.encryptionKey),
    secretsFromSettings: Boolean(process.env.SESSION_SECRET && process.env.ENCRYPTION_KEY),
    appUrl: env.appUrl,
  };
  try {
    await db.$queryRaw`SELECT 1`;
    const [w, users] = await Promise.all([workerStatus(), db.user.count()]);
    const ok = config.sessionSecret && config.encryptionKey && users > 0;
    return Response.json({ ok, database: "ok", users, worker: w.state, config }, { status: ok ? 200 : 503 });
  } catch (e) {
    return Response.json({ ok: false, database: (e as Error).message.split("\n").filter(Boolean).slice(-1)[0], config }, { status: 503 });
  }
}
