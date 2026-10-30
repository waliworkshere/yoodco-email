import { PrismaClient } from "@prisma/client";

/**
 * Connection URL. Hosted Postgres poolers (Neon, Supabase) run PgBouncer in transaction
 * mode, which needs `pgbouncer=true` for Prisma; add it automatically when it is missing.
 */
export function databaseUrl(raw = process.env.DATABASE_URL ?? ""): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const pooled = /-pooler\.|pooler\.supabase\.com|:6543$/.test(u.host) || u.port === "6543";
    if (pooled && !u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    return u.toString();
  } catch {
    return raw;
  }
}

// One client per process; survives hot reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ["error"], ...(process.env.DATABASE_URL ? { datasourceUrl: databaseUrl() } : {}) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
