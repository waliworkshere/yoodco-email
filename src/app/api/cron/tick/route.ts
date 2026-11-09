import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { runFor } from "@/lib/engine/runner";

/**
 * Serverless sender for hosts that cannot keep a worker running (e.g. Vercel).
 * Call it about every minute. Each call sends for up to ~40 seconds, reads replies every
 * few minutes, then returns (at once when nothing is due).
 *
 * Accepted callers:
 *   - `Authorization: Bearer <CRON_SECRET>` (Vercel Cron, cron-job.org, any scheduler)
 *   - the repository's GitHub Actions workflow (.github/workflows/sender.yml), proven with a
 *     GitHub-signed OIDC token: no shared secret needed. SENDER_REPO overrides the repository.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const jwks = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`));

async function fromGitHubActions(token: string) {
  try {
    const repo = process.env.SENDER_REPO || "waliworkshere/yoodco-email";
    const { payload } = await jwtVerify(token, jwks, { issuer: GITHUB_ISSUER, audience: "yood-outreach" });
    return payload.repository === repo && String(payload.job_workflow_ref ?? payload.workflow_ref ?? "").startsWith(`${repo}/.github/workflows/sender.yml@`);
  } catch {
    return false;
  }
}

async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  const ok = (secret && token === secret) || (token.split(".").length === 3 && (await fromGitHubActions(token)));
  if (!ok) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const result = await runFor(`cron:${randomUUID().slice(0, 8)}`, 40_000, 3_000);
  return Response.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
