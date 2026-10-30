import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { googleAuthUrl } from "@/lib/mail/oauth";
import { signState } from "@/lib/oauth-state";

export async function GET(req: Request) {
  if (!(await getSession())) return Response.redirect(`${env.appUrl}/login`, 302);
  if (!env.google.oauthConfigured) return Response.redirect(`${env.appUrl}/mailboxes/new?error=${encodeURIComponent("Google sign-in is not set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see docs/CONNECTING_MAILBOXES.md).")}`, 302);
  const hint = new URL(req.url).searchParams.get("email") ?? undefined;
  return Response.redirect(googleAuthUrl(await signState({ p: "google" }), hint), 302);
}
