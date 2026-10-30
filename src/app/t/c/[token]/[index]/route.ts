import { recordClick } from "@/lib/tracking";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ token: string; index: string }> }) {
  const { token, index } = await ctx.params;
  let url: string | null = null;
  try {
    url = await recordClick(token, Number(index), req.headers);
  } catch {
    url = null;
  }
  // Only redirect to URLs that were in the email we sent (no open redirect)
  return Response.redirect(url ?? env.appUrl, 302);
}
