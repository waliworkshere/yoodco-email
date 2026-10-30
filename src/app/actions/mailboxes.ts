"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { upsertMailbox } from "@/lib/mailboxes";
import { deliver, verifyMailbox } from "@/lib/mail/transport";
import { googleServiceAccountToken } from "@/lib/mail/oauth";
import { messageIdFor } from "@/lib/engine/send";
import { renderEmail } from "@/lib/render";

const go = (path: string, params: Record<string, string>): never => redirect(`${path}?${new URLSearchParams(params)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string, def: number, min: number, max: number) => {
  const raw = f.get(k);
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function limits(f: FormData) {
  return {
    dailyLimit: int(f, "dailyLimit", 30, 1, 2000),
    hourlyLimit: int(f, "hourlyLimit", 8, 1, 500),
    warmupEnabled: f.get("warmupEnabled") === "on",
  };
}

const connectedMsg = (email: string, attached: number) =>
  `Connected ${email}.${attached ? ` ${attached} imported contacts were waiting for this sender and are now assigned.` : ""}`;

export async function connectSmtp(form: FormData) {
  await requireUser();
  const email = str(form, "email").toLowerCase();
  if (!EMAIL.test(email)) go("/mailboxes/new", { type: "smtp", error: "Enter the mailbox's email address." });
  const password = String(form.get("password") ?? "");
  if (!password) go("/mailboxes/new", { type: "smtp", error: "Enter the password or app password." });
  const smtpHost = str(form, "smtpHost");
  if (!smtpHost) go("/mailboxes/new", { type: "smtp", error: "Enter the SMTP server." });
  const smtpPort = int(form, "smtpPort", 587, 1, 65535);
  const imapPort = int(form, "imapPort", 993, 1, 65535);
  const l = limits(form);

  const { mailbox, attached } = await upsertMailbox(email, {
    displayName: str(form, "displayName") || email.split("@")[0],
    provider: "SMTP",
    smtpHost,
    smtpPort,
    smtpSecure: smtpPort === 465,
    imapHost: str(form, "imapHost") || null,
    imapPort,
    imapSecure: imapPort === 993,
    username: str(form, "username") || email,
    secretEnc: encrypt(password),
    ...l,
    warmupStartedAt: l.warmupEnabled ? new Date() : null,
  });

  const check = await verifyMailbox(mailbox);
  if (!check.ok) {
    await db.mailbox.update({ where: { id: mailbox.id }, data: { status: "ERROR", statusReason: `SMTP: ${check.smtp} · IMAP: ${check.imap}` } });
    go(`/mailboxes/${mailbox.id}`, { error: `Saved, but the connection test failed. SMTP: ${check.smtp}. IMAP: ${check.imap}` });
  }
  go(`/mailboxes/${mailbox.id}`, { notice: connectedMsg(mailbox.email, attached) });
}

export async function connectSandbox(form: FormData) {
  await requireUser();
  const emails = str(form, "emails")
    .split(/[\s,;]+/)
    .map((e) => e.toLowerCase())
    .filter(Boolean);
  const bad = emails.filter((e) => !EMAIL.test(e));
  if (!emails.length || bad.length) go("/mailboxes/new", { type: "sandbox", error: bad.length ? `Not valid: ${bad.join(", ")}` : "Enter at least one address." });
  let attached = 0;
  for (const email of emails) {
    const existing = await db.mailbox.findUnique({ where: { email } });
    if (existing && existing.provider !== "SANDBOX") continue; // never downgrade a real mailbox
    const r = await upsertMailbox(email, { displayName: email.split("@")[0].replace(/^./, (c) => c.toUpperCase()), provider: "SANDBOX", dailyLimit: 30, hourlyLimit: 8 });
    attached += r.attached;
  }
  go("/mailboxes", { notice: `Added ${emails.length} sandbox mailbox${emails.length > 1 ? "es" : ""}.${attached ? ` ${attached} imported contacts are now assigned.` : ""}` });
}

export async function connectGoogleWorkspace(form: FormData) {
  await requireUser();
  if (!env.google.dwdConfigured) go("/mailboxes/new", { error: "Set GOOGLE_SERVICE_ACCOUNT_JSON first (see docs/CONNECTING_MAILBOXES.md)." });
  const emails = str(form, "emails")
    .split(/[\s,;]+/)
    .map((e) => e.toLowerCase())
    .filter(Boolean);
  const bad = emails.filter((e) => !EMAIL.test(e));
  if (!emails.length || bad.length) go("/mailboxes/new", { type: "workspace", error: bad.length ? `Not valid: ${bad.join(", ")}` : "Enter at least one address." });
  const failures: string[] = [];
  let ok = 0;
  let attached = 0;
  for (const email of emails) {
    try {
      await googleServiceAccountToken(email); // proves delegation works for this user
      const r = await upsertMailbox(email, { displayName: email.split("@")[0].replace(/^./, (c) => c.toUpperCase()), provider: "GOOGLE_DWD", username: email, ...limits(form) });
      attached += r.attached;
      ok++;
    } catch (e) {
      failures.push(`${email}: ${(e as Error).message}`);
    }
  }
  if (failures.length) go("/mailboxes", { error: `Connected ${ok}. Failed: ${failures.join(" · ")}` });
  go("/mailboxes", { notice: `Connected ${ok} Google Workspace mailboxes.${attached ? ` ${attached} imported contacts are now assigned.` : ""}` });
}

export async function updateMailbox(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const current = await db.mailbox.findUniqueOrThrow({ where: { id } });
  const l = limits(form);
  await db.mailbox.update({
    where: { id },
    data: {
      displayName: str(form, "displayName") || current.displayName,
      signature: String(form.get("signature") ?? "").trim() || null,
      ...l,
      warmupStart: int(form, "warmupStart", current.warmupStart, 1, 500),
      warmupIncrement: int(form, "warmupIncrement", current.warmupIncrement, 1, 100),
      warmupStartedAt: l.warmupEnabled ? (current.warmupStartedAt ?? new Date()) : null,
      ...(current.provider === "SMTP"
        ? {
            smtpHost: str(form, "smtpHost") || current.smtpHost,
            smtpPort: int(form, "smtpPort", current.smtpPort ?? 587, 1, 65535),
            smtpSecure: int(form, "smtpPort", current.smtpPort ?? 587, 1, 65535) === 465,
            imapHost: str(form, "imapHost") || null,
            imapPort: int(form, "imapPort", current.imapPort ?? 993, 1, 65535),
            username: str(form, "username") || current.username,
            ...(String(form.get("password") ?? "") ? { secretEnc: encrypt(String(form.get("password"))) } : {}),
          }
        : {}),
    },
  });
  go(`/mailboxes/${id}`, { notice: "Mailbox saved." });
}

export async function setMailboxStatus(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const to = str(form, "to") === "PAUSED" ? "PAUSED" : "ACTIVE";
  await db.mailbox.update({ where: { id }, data: { status: to, statusReason: to === "PAUSED" ? "Paused by a teammate" : null } });
  go(`/mailboxes/${id}`, { notice: to === "PAUSED" ? "Mailbox paused. Its contacts wait until you resume." : "Mailbox resumed." });
}

export async function testMailbox(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  const r = await verifyMailbox(m);
  if (r.ok) {
    if (m.status === "ERROR") await db.mailbox.update({ where: { id }, data: { status: "ACTIVE", statusReason: null } });
    go(`/mailboxes/${id}`, { notice: `Connection works. Sending: ${r.smtp}. Inbox: ${r.imap}` });
  }
  await db.mailbox.update({ where: { id }, data: { status: "ERROR", statusReason: `SMTP: ${r.smtp} · IMAP: ${r.imap}`, lastError: r.smtp, lastErrorAt: new Date() } });
  go(`/mailboxes/${id}`, { error: `Connection failed. Sending: ${r.smtp}. Inbox: ${r.imap}` });
}

export async function sendMailboxTest(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const to = str(form, "to").toLowerCase() || user.email;
  if (!EMAIL.test(to)) go(`/mailboxes/${id}`, { error: "Enter a valid address." });
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  const token = randomToken();
  const r = renderEmail(
    "Test from Yoodco Email",
    `Hi,\n\nThis is a test from ${m.email}, sent by Yoodco Email.\n\nIf it landed in your inbox (not spam or promotions), this mailbox is ready.\n\nSent at ${new Date().toUTCString()}`,
    {},
    { appUrl: env.appUrl, token, trackOpens: false, trackClicks: false, signature: m.signature },
  );
  try {
    await deliver(m, { from: { name: m.displayName, address: m.email }, to, subject: r.subject, text: r.text, html: r.html, messageId: messageIdFor(token, m.email) }, "mailbox");
  } catch (e) {
    go(`/mailboxes/${id}`, { error: `Sending failed: ${(e as Error).message}` });
  }
  go(`/mailboxes/${id}`, { notice: m.provider === "SANDBOX" ? "Test captured in the sandbox inbox." : `Test email sent to ${to}. Check which folder it lands in.` });
}

export async function deleteMailbox(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  await db.mailbox.delete({ where: { id } });
  go("/mailboxes", { notice: "Mailbox removed. Its contacts are unassigned until you reconnect it or reassign them." });
}
