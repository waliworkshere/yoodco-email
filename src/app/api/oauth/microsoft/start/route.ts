import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { microsoftAuthUrl } from "@/lib/mail/oauth";
import { signState } from "@/lib/oauth-state";

export async function GET(req: Request) {
  if (!(await getSession())) return Response.redirect(`${env.appUrl}/login`, 302);
  if (!env.microsoft.configured) return Response.redirect(`${env.appUrl}/mailboxes/new?error=${encodeURIComponent("Microsoft sign-in is not set up. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET (see docs/CONNECTING_MAILBOXES.md).")}`, 302);
  const hint = new URL(req.url).searchParams.get("email") ?? undefined;
  return Response.redirect(microsoftAuthUrl(await signState({ p: "microsoft" }), hint), 302);
}
