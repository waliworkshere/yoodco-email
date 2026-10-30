import type { Mailbox } from "@prisma/client";
import { simpleParser } from "mailparser";
import { db } from "../db";
import { env } from "../env";
import { imapAuth, openImap, serverSettings } from "../mail/transport";
import { applyAutoReply, applyBounce, applyReply } from "./outcomes";

/**
 * Reads each connected mailbox's inbox for replies and bounces.
 * Matching order: In-Reply-To / References headers → sender address → bounce report contents.
 */

export interface InboundSummary {
  from: string;
  subject: string;
  inReplyTo: string[];
  references: string[];
  autoSubmitted: boolean;
  isBounce: boolean;
}

const MSGID_RE = /<[^<>\s]+>/g;

export function parseIds(v: unknown): string[] {
  if (!v) return [];
  const s = Array.isArray(v) ? v.join(" ") : String(v);
  return s.match(MSGID_RE) ?? [];
}

export function looksLikeBounce(from: string, subject: string, contentType: string): boolean {
  return (
    /mailer-daemon|postmaster|mail delivery (sub)?system/i.test(from) ||
    /multipart\/report/i.test(contentType) ||
    /^(undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery failed|returned mail)/i.test(subject)
  );
}

export function looksAutomatic(headers: Map<string, unknown> | Record<string, unknown>, subject: string): boolean {
  const get = (k: string) => (headers instanceof Map ? headers.get(k) : (headers as Record<string, unknown>)[k]);
  const auto = String(get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (get("x-autoreply") || get("x-autorespond")) return true;
  const prec = String(get("precedence") ?? "").toLowerCase();
  if (prec === "auto_reply" || prec === "bulk") return true;
  return /^(automatic reply|auto(-|\s)?reply|out of (the )?office|abwesenheit|r[ée]ponse automatique|absence)/i.test(subject);
}

async function findOurMessage(mailboxId: string, ids: string[]) {
  if (!ids.length) return null;
  return db.message.findFirst({ where: { messageIdHeader: { in: ids }, status: "SENT" }, orderBy: { sentAt: "desc" } });
}

export async function scanMailbox(m: Mailbox): Promise<{ checked: number; replies: number; bounces: number }> {
  const result = { checked: 0, replies: 0, bounces: 0 };
  const s = serverSettings(m);
  if (m.provider === "SANDBOX" || !s.imapHost) return result;

  const client = openImap(m, await imapAuth(m));
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mbox = client.mailbox;
      const uidValidity = mbox && typeof mbox === "object" ? String(mbox.uidValidity) : "";
      let lastUid = m.inboxUidValidity === uidValidity ? (m.lastInboxUid ?? 0) : 0;

      // First scan: only look back 3 days. Afterwards: everything newer than the last UID seen.
      const since = new Date(Date.now() - 3 * 86_400_000);
      const uids = lastUid > 0 ? await client.search({ uid: `${lastUid + 1}:*` }, { uid: true }) : await client.search({ since }, { uid: true });
      const fresh = (uids || []).filter((u) => u > lastUid).slice(-500);

      for (const uid of fresh) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        lastUid = Math.max(lastUid, uid);
        if (!msg || !msg.source) continue;
        result.checked++;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
        const subject = parsed.subject ?? "";
        const contentType = String(parsed.headers.get("content-type") && (parsed.headers.get("content-type") as { value?: string }).value || "");
        const snippet = (parsed.text ?? "").split(/\n\s*On .+wrote:|\n-{2,}\s*Original Message/i)[0].trim().slice(0, 400);

        if (looksLikeBounce(from, subject, contentType)) {
          // Bounce reports quote the original message's headers: find our Message-ID inside
          const raw = msg.source.toString("utf8");
          const ids = raw.match(MSGID_RE) ?? [];
          const ours = await db.message.findFirst({ where: { messageIdHeader: { in: ids }, mailboxId: m.id } });
          let target = ours;
          if (!target) {
            const rcpt = raw.match(/Final-Recipient:\s*rfc822;\s*([^\s;]+)/i)?.[1]?.toLowerCase();
            if (rcpt) target = await db.message.findFirst({ where: { mailboxId: m.id, deliveredTo: rcpt }, orderBy: { sentAt: "desc" } });
          }
          if (target) {
            const diag = raw.match(/Diagnostic-Code:\s*([^\r\n]+)/i)?.[1] ?? subject;
            await applyBounce(target, diag);
            result.bounces++;
          }
          continue;
        }

        const ids = [...parseIds(parsed.inReplyTo), ...parseIds(parsed.references)];
        let ours = await findOurMessage(m.id, ids);
        if (!ours && from) {
          ours = await db.message.findFirst({
            where: { mailboxId: m.id, status: "SENT", OR: [{ deliveredTo: from }, { toEmail: from, mode: "LIVE" }] },
            orderBy: { sentAt: "desc" },
          });
        }
        if (!ours) continue;

        if (looksAutomatic(parsed.headers, subject)) {
          await applyAutoReply(ours, subject);
        } else {
          await applyReply(ours, { detail: snippet || subject, at: parsed.date ?? new Date() });
          result.replies++;
        }
      }

      await db.mailbox.update({
        where: { id: m.id },
        data: { lastInboxUid: lastUid || null, inboxUidValidity: uidValidity, lastInboxCheckAt: new Date() },
      });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return result;
}

/** Scan every mailbox that is due for a check and has sent something in the last 30 days. */
export async function scanInboxes(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.inboxScanMinutes * 60_000);
  const recent = new Date(now.getTime() - 30 * 86_400_000);
  const due = await db.mailbox.findMany({
    where: {
      provider: { not: "SANDBOX" },
      status: { in: ["ACTIVE", "PAUSED", "AUTO_PAUSED"] },
      OR: [{ lastInboxCheckAt: null }, { lastInboxCheckAt: { lt: cutoff } }],
      messages: { some: { sentAt: { gt: recent }, deliveredTo: { not: "" } } },
    },
  });
  const out: Record<string, unknown> = {};
  for (const m of due) {
    try {
      out[m.email] = await scanMailbox(m);
    } catch (e) {
      const err = (e as Error).message;
      out[m.email] = { error: err };
      await db.mailbox.update({ where: { id: m.id }, data: { lastInboxCheckAt: now, lastError: `Inbox check: ${err}`, lastErrorAt: now } });
    }
  }
  return out;
}
