/**
 * Runs during each Vercel build (npm run vercel-build):
 *   1. applies database migrations (creates/updates tables)
 *   2. creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD, if set
 *   3. loads the demo login and demo campaign once, unless SEED_DEMO=false
 * Skips quietly when no database is configured, so previews without one still build.
 */
import { execSync } from "node:child_process";

const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!direct) {
  console.log("[db-setup] No DATABASE_URL: skipping database setup.");
  process.exit(0);
}
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

// Migrations need a direct (non-pooled) connection
run("npx prisma migrate deploy", { DATABASE_URL: direct });
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) run("npx tsx prisma/seed.ts");
if (process.env.SEED_DEMO !== "false") run("npx tsx scripts/demo.ts --once");
