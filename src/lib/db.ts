import { PrismaClient } from "@prisma/client";

/** Finds the database URL even when a hosting integration prefixed the names (e.g. `myapp_DATABASE_URL`). */
export function findEnv(...names: string[]): string {
  for (const n of names) if (process.env[n]) return process.env[n] as string;
  for (const n of names) {
    const key = Object.keys(process.env).find((k) => k.endsWith(`_${n}`) && process.env[k]);
    if (key) return process.env[key] as string;
  }
  return "";
}

/**
 * Connection URL for the app. Pooled hosted Postgres (Neon, Supabase) runs PgBouncer in
 * transaction mode, which needs `pgbouncer=true`; `channel_binding` is not understood by
 * Prisma's driver, so it is removed.
 */
export function databaseUrl(raw = findEnv("DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL")): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete("channel_binding");
    const pooled = /-pooler\.|pooler\.supabase\.com/.test(u.host) || u.port === "6543";
    if (pooled && !u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    return u.toString();
  } catch {
    return raw;
  }
}

const url = databaseUrl();
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url;

// One client per process; survives hot reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["error"], ...(url ? { datasourceUrl: url } : {}) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
