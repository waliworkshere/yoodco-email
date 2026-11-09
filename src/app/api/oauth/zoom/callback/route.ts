import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { verifyState } from "@/lib/oauth-state";
import { connectZoom } from "@/lib/zoom";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const back = (q: string) => Response.redirect(`${env.appUrl}/settings?${q}#integrations`, 302);
  if (!(await getSession())) return Response.redirect(`${env.appUrl}/login`, 302);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  try {
    const st = await verifyState(url.searchParams.get("state") ?? "");
    if (st.p !== "zoom" || !code) throw new Error("Zoom did not return a sign-in code. Please try again.");
    await connectZoom(code);
  } catch (err) {
    return back(`error=${encodeURIComponent((err as Error).message)}`);
  }
  return back(`notice=${encodeURIComponent("Zoom is connected. Booked meetings now get their own Zoom link.")}`);
}
