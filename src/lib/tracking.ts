import { db } from "./db";

/**
 * Open and click recording. Security scanners (Microsoft Safe Links, Mimecast, Proofpoint, Barracuda …)
 * fetch every link and image seconds after delivery; those hits are stored but flagged as likely bots
 * and left out of open/click rates.
 */
const SCANNER_UA = /(bot|crawler|spider|preview|scanner|safelinks|mimecast|proofpoint|barracuda|forcepoint|symantec|trendmicro|sophos|fireeye|zscaler|python-requests|curl|wget|go-http-client|headless|phantom|slurp|facebookexternalhit|linkedinbot|slackbot|whatsapp)/i;

export function isLikelyBot(userAgent: string | null, sentAt: Date, now: Date, kind: "open" | "click"): boolean {
  if (!userAgent) return true;
  if (SCANNER_UA.test(userAgent) && !/GoogleImageProxy|YahooMailProxy/i.test(userAgent)) return true;
  const seconds = (now.getTime() - sentAt.getTime()) / 1000;
  // Clicks within 15s and opens within 3s of sending are almost always automated
  return kind === "click" ? seconds < 15 : seconds < 3;
}

function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export async function recordOpen(token: string, headers: Headers) {
  const msg = await db.message.findUnique({ where: { token } });
  if (!msg) return;
  const now = new Date();
  const ua = headers.get("user-agent");
  const bot = isLikelyBot(ua, msg.sentAt, now, "open");
  await db.event.create({
    data: { type: "OPEN", campaignId: msg.campaignId, campaignContactId: msg.campaignContactId, messageId: msg.id, userAgent: ua?.slice(0, 300), ip: clientIp(headers), likelyBot: bot },
  });
  if (!bot) {
    await db.message.update({
      where: { id: msg.id },
      data: { openCount: { increment: 1 }, ...(msg.firstOpenedAt ? {} : { firstOpenedAt: now }) },
    });
  }
}

export async function recordClick(token: string, index: number, headers: Headers): Promise<string | null> {
  const msg = await db.message.findUnique({ where: { token } });
  if (!msg) return null;
  const links = Array.isArray(msg.links) ? (msg.links as string[]) : [];
  const url = links[index];
  if (!url) return null;
  const now = new Date();
  const ua = headers.get("user-agent");
  const bot = isLikelyBot(ua, msg.sentAt, now, "click");
  await db.event.create({
    data: { type: "CLICK", campaignId: msg.campaignId, campaignContactId: msg.campaignContactId, messageId: msg.id, url, userAgent: ua?.slice(0, 300), ip: clientIp(headers), likelyBot: bot },
  });
  if (!bot) {
    await db.message.update({
      where: { id: msg.id },
      data: {
        clickCount: { increment: 1 },
        ...(msg.firstClickedAt ? {} : { firstClickedAt: now }),
        // a real click proves the email was opened, even if images were blocked
        ...(msg.firstOpenedAt ? {} : { firstOpenedAt: now }),
      },
    });
  }
  return url;
}
