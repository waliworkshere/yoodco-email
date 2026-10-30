import { db } from "@/lib/db";
import { workerStatus } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** Health and configuration check. Reports only whether settings are present, never their values. */
export async function GET() {
  const config = {
    sessionSecret: (process.env.SESSION_SECRET ?? "").length >= 32,
    encryptionKey: (process.env.ENCRYPTION_KEY ?? "").length >= 32,
    appUrl: Boolean(process.env.APP_URL),
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
