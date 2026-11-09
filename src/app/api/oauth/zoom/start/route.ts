import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { signState } from "@/lib/oauth-state";
import { zoomAuthUrl, zoomSettings } from "@/lib/zoom";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSession())) return Response.redirect(`${env.appUrl}/login`, 302);
  const s = await zoomSettings();
  if (!s.appReady) return Response.redirect(`${env.appUrl}/settings?error=${encodeURIComponent("Add the Zoom app's Client ID and Client secret first.")}#integrations`, 302);
  return Response.redirect(zoomAuthUrl(s.clientId, await signState({ p: "zoom" })), 302);
}
