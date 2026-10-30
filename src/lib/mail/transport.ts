import nodemailer from "nodemailer";
import type { Mailbox } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";
import { googleRefresh, googleServiceAccountToken, microsoftRefresh } from "./oauth";

/** Default server settings for each provider. SMTP mailboxes carry their own. */
const PRESETS = {
  GOOGLE: { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true },
  GOOGLE_DWD: { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true },
  MICROSOFT: { smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false, imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true },
} as const;

export function serverSettings(m: Mailbox) {
  if (m.provider in PRESETS) return PRESETS[m.provider as keyof typeof PRESETS];
  return {
    smtpHost: m.smtpHost ?? "",
    smtpPort: m.smtpPort ?? 587,
    smtpSecure: m.smtpSecure,
    imapHost: m.imapHost ?? "",
    imapPort: m.imapPort ?? 993,
    imapSecure: m.imapSecure,
  };
}

export class MailboxAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxAuthError";
  }
}

/** Returns a valid OAuth access token, refreshing and caching it (encrypted) when needed. */
export async function getAccessToken(m: Mailbox): Promise<string> {
  if (m.accessTokenEnc && m.accessTokenExpiresAt && m.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(m.accessTokenEnc);
  }
  let tokens;
  try {
    if (m.provider === "GOOGLE_DWD") {
      tokens = await googleServiceAccountToken(m.email);
    } else {
      if (!m.secretEnc) throw new MailboxAuthError("Mailbox is not connected. Reconnect it from the Mailboxes page.");
      const refresh = decrypt(m.secretEnc);
      tokens = m.provider === "GOOGLE" ? await googleRefresh(refresh) : await microsoftRefresh(refresh);
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "invalid_grant" || code === "unauthorized_client" || e instanceof MailboxAuthError) {
      throw new MailboxAuthError(`Access was revoked or expired (${(e as Error).message}). Reconnect this mailbox.`);
    }
    throw e;
  }
  await db.mailbox.update({
    where: { id: m.id },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      // Microsoft rotates refresh tokens
      ...(tokens.refreshToken && m.provider !== "GOOGLE_DWD" ? { secretEnc: encrypt(tokens.refreshToken) } : {}),
    },
  });
  return tokens.accessToken;
}

const isOAuth = (m: Mailbox) => m.provider === "GOOGLE" || m.provider === "GOOGLE_DWD" || m.provider === "MICROSOFT";

async function smtpTransport(m: Mailbox) {
  const s = serverSettings(m);
  const user = m.username || m.email;
  const auth = isOAuth(m)
    ? { type: "OAuth2" as const, user, accessToken: await getAccessToken(m) }
    : { user, pass: m.secretEnc ? decrypt(m.secretEnc) : "" };
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    requireTLS: !s.smtpSecure,
    auth,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

/** Where test-mode mail goes when it must not reach anyone: Mailpit if configured, otherwise nowhere (kept in the app only). */
export function sandboxTransport() {
  if (env.sandboxSmtpUrl) return nodemailer.createTransport(env.sandboxSmtpUrl);
  return nodemailer.createTransport({ jsonTransport: true });
}

export interface OutgoingEmail {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}

export type DeliveryRoute = "mailbox" | "sandbox";

export async function deliver(m: Mailbox, email: OutgoingEmail, route: DeliveryRoute) {
  const transport = route === "sandbox" || m.provider === "SANDBOX" ? sandboxTransport() : await smtpTransport(m);
  try {
    return await transport.sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      headers: email.headers,
    });
  } finally {
    transport.close();
  }
}

export type SendErrorKind = "auth" | "recipient" | "transient";

/** Decide what a failed send means: fix the mailbox, drop the recipient, or try again later. */
export function classifySendError(err: unknown): SendErrorKind {
  if (err instanceof MailboxAuthError) return "auth";
  const e = err as { code?: string; responseCode?: number; command?: string; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534) return "auth";
  if (e.command === "RCPT TO" && e.responseCode && e.responseCode >= 500) return "recipient";
  if (e.responseCode && [550, 551, 553].includes(e.responseCode) && /recipient|mailbox|user|address/i.test(e.message ?? ""))
    return "recipient";
  return "transient";
}

export function openImap(m: Mailbox, auth: { user: string; pass?: string; accessToken?: string }) {
  const s = serverSettings(m);
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapSecure,
    auth,
    logger: false,
    emitLogs: false,
    socketTimeout: 60_000,
  });
}

export async function imapAuth(m: Mailbox) {
  const user = m.username || m.email;
  return isOAuth(m) ? { user, accessToken: await getAccessToken(m) } : { user, pass: m.secretEnc ? decrypt(m.secretEnc) : "" };
}

/** Checks SMTP login and (if available) IMAP login. Returns a human-readable result per check. */
export async function verifyMailbox(m: Mailbox): Promise<{ smtp: string; imap: string; ok: boolean }> {
  if (m.provider === "SANDBOX") {
    return { smtp: "Sandbox mailbox: emails are captured, never delivered.", imap: "Not used.", ok: true };
  }
  let smtp = "OK";
  let imap = "OK";
  let ok = true;
  try {
    const t = await smtpTransport(m);
    await t.verify();
    t.close();
  } catch (e) {
    ok = false;
    smtp = (e as Error).message;
  }
  const s = serverSettings(m);
  if (!s.imapHost) {
    imap = "No IMAP server set, so replies and bounces cannot be detected.";
  } else {
    const client = openImap(m, await imapAuth(m).catch(() => ({ user: m.email, pass: "" })));
    try {
      await client.connect();
      await client.logout();
    } catch (e) {
      ok = false;
      imap = (e as Error).message;
    }
  }
  return { smtp, imap, ok };
}
