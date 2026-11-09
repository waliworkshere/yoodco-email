/**
 * Runs during each Vercel build (npm run vercel-build):
 *   1. applies database migrations (creates/updates tables)
 *   2. creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD, if set
 *   3. loads the demo login and demo campaign once, unless SEED_DEMO=false,
 *      or, with PILOT_MODE=true, removes demo data and the demo login (a real workspace)
 * Skips quietly when no database is configured, so previews without one still build.
 * Accepts prefixed names from hosting integrations (e.g. myapp_DATABASE_URL_UNPOOLED).
 */
import { execSync } from "node:child_process";

function findEnv(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  for (const n of names) {
    const key = Object.keys(process.env).find((k) => k.endsWith(`_${n}`) && process.env[k]);
    if (key) return process.env[key];
  }
  return "";
}
const clean = (raw) => {
  try { const u = new URL(raw); u.searchParams.delete("channel_binding"); return u.toString(); } catch { return raw; }
};

const pooled = findEnv("DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL");
const direct = findEnv("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING") || pooled;
if (!direct) {
  console.log("[db-setup] No database URL found: skipping database setup.");
  process.exit(0);
}
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

// Migrations need a direct (non-pooled) connection
run("npx prisma migrate deploy", { DATABASE_URL: clean(direct) });
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) run("npx tsx prisma/seed.ts", { DATABASE_URL: clean(pooled || direct) });
if (process.env.PILOT_MODE === "true") run("npx tsx scripts/pilot-mode.ts", { DATABASE_URL: clean(pooled || direct) });
else if (process.env.SEED_DEMO !== "false") run("npx tsx scripts/demo.ts --once", { DATABASE_URL: clean(pooled || direct) });
