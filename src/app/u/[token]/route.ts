import { db } from "@/lib/db";
import { applyUnsubscribe } from "@/lib/engine/outcomes";
import { escapeHtml } from "@/lib/render";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe link. GET shows a confirmation button (so link scanners can't unsubscribe people);
 * POST unsubscribes — from that button or from the mail app's one-click "Unsubscribe" (RFC 8058).
 */
function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f6f8;color:#1b1f2a;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:420px;background:#fff;border:1px solid #e2e5ec;border-radius:12px;padding:32px}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#545b6b}
button{font:inherit;font-weight:600;background:#1b1f2a;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}button:focus-visible{outline:3px solid #9aa8ff}
@media (prefers-color-scheme:dark){body{background:#12141a;color:#e8eaf0}main{background:#1a1d25;border-color:#2a2e3a}p{color:#a2a8b8}button{background:#e8eaf0;color:#12141a}}</style></head>
<body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const msg = await db.message.findUnique({ where: { token }, include: { campaignContact: { include: { contact: true } } } });
  if (!msg) return page("Link not found", "<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>", 404);
  const email = escapeHtml(msg.toEmail);
  if (msg.campaignContact.contact.unsubscribedAt || msg.campaignContact.status === "UNSUBSCRIBED") {
    return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>${email} will not receive further emails from ${escapeHtml(msg.fromEmail)}.</p>`);
  }
  return page(
    "Unsubscribe",
    `<h1>Stop these emails?</h1><p>${email} will no longer receive emails from ${escapeHtml(msg.fromEmail)}.</p><form method="post"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const msg = await db.message.findUnique({ where: { token } });
  if (!msg) return page("Link not found", "<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>", 404);
  await applyUnsubscribe(msg);
  return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>${escapeHtml(msg.toEmail)} will not receive further emails from ${escapeHtml(msg.fromEmail)}.</p>`);
}
