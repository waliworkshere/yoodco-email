/**
 * Central access to configuration. Values are read lazily so the worker,
 * the web app and the tests can each load their own environment.
 */
import { createHash } from "node:crypto";

/**
 * When SESSION_SECRET / ENCRYPTION_KEY are not set (quick test deploys), derive stable keys
 * from the database password, which is already secret. Set real values for production;
 * note that changing ENCRYPTION_KEY later means reconnecting mailboxes.
 */
function derived(purpose: string): string {
  const raw = Object.entries(process.env).find(([k, v]) => v && (k === "DATABASE_URL" || k.endsWith("_DATABASE_URL")))?.[1] ?? "";
  let pass = "";
  try {
    const u = new URL(raw);
    pass = decodeURIComponent(u.password);
    if (pass) pass = `${decodeURIComponent(u.username)}:${pass}`;
  } catch {
    /* not a URL */
  }
  if (!pass) return "";
  return createHash("sha256").update(`yood-outreach:${purpose}:${pass}`).digest("hex");
}

function read(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return v;
}

export const env = {
  get appUrl() {
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
    return (process.env.APP_URL || vercel || "http://localhost:3000").replace(/\/+$/, "");
  },
  get sessionSecret() {
    const s = process.env.SESSION_SECRET || derived("session") || read("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
    return s;
  },
  get encryptionKey() {
    const s = process.env.ENCRYPTION_KEY || derived("encryption") || read("ENCRYPTION_KEY");
    if (s.length < 32) throw new Error("ENCRYPTION_KEY must be at least 32 characters.");
    return s;
  },
  /** Time zone used to display dates in the dashboard. */
  get displayTimezone() {
    return process.env.APP_TIMEZONE || "Asia/Dubai";
  },
  get sandboxSmtpUrl() {
    return process.env.SANDBOX_SMTP_URL || "";
  },
  get sandboxWebUrl() {
    return process.env.SANDBOX_WEB_URL || "";
  },
  google: {
    get clientId() {
      return process.env.GOOGLE_CLIENT_ID || "";
    },
    get clientSecret() {
      return process.env.GOOGLE_CLIENT_SECRET || "";
    },
    get serviceAccountJson() {
      return process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    },
    get oauthConfigured() {
      return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    },
    get dwdConfigured() {
      return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    },
  },
  microsoft: {
    get clientId() {
      return process.env.MICROSOFT_CLIENT_ID || "";
    },
    get clientSecret() {
      return process.env.MICROSOFT_CLIENT_SECRET || "";
    },
    get tenant() {
      return process.env.MICROSOFT_TENANT_ID || "common";
    },
    get configured() {
      return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    },
  },
  get workerTickSeconds() {
    return Math.max(2, Number(process.env.WORKER_TICK_SECONDS || 10));
  },
  get inboxScanMinutes() {
    return Math.max(1, Number(process.env.INBOX_SCAN_MINUTES || 3));
  },
  get autoPauseBounceRate() {
    return Number(process.env.AUTO_PAUSE_BOUNCE_RATE || 0.05);
  },
};
