import { recordOpen } from "@/lib/tracking";

export const dynamic = "force-dynamic";

// 1×1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const token = file.replace(/\.gif$/i, "");
  try {
    await recordOpen(token, req.headers);
  } catch {
    /* never break the image */
  }
  return new Response(PIXEL, {
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL.length),
      "cache-control": "no-store, no-cache, must-revalidate, private",
      pragma: "no-cache",
    },
  });
}
