"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { disconnectZoom } from "@/lib/zoom";

const go = (params: Record<string, string>): never => redirect(`/settings?${new URLSearchParams(params)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addUser(form: FormData) {
  await requireAdmin();
  const email = str(form, "email").toLowerCase();
  const name = str(form, "name");
  const password = String(form.get("password") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) go({ error: "Enter a name and a valid email." });
  if (password.length < 10) go({ error: "Passwords need at least 10 characters." });
  if (await db.user.findUnique({ where: { email } })) go({ error: `${email} already has an account.` });
  await db.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 11), role: form.get("role") === "ADMIN" ? "ADMIN" : "MEMBER" },
  });
  go({ notice: `Added ${name}. Share the password with them securely.` });
}

export async function removeUser(form: FormData) {
  const me = await requireAdmin();
  const id = str(form, "id");
  if (id === me.id) go({ error: "You cannot remove yourself." });
  await db.user.delete({ where: { id } });
  go({ notice: "Teammate removed." });
}

export async function changePassword(form: FormData) {
  const me = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await bcrypt.compare(current, user.passwordHash))) go({ error: "Current password is incorrect." });
  if (next.length < 10) go({ error: "New password needs at least 10 characters." });
  await db.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(next, 11) } });
  go({ notice: "Password changed." });
}

export async function addSuppression(form: FormData) {
  await requireUser();
  const emails = str(form, "emails")
    .split(/[\s,;]+/)
    .map((e) => e.toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!emails.length) go({ error: "Enter one or more email addresses." });
  const now = new Date();
  for (const email of emails) {
    await db.contact.upsert({ where: { email }, create: { email, unsubscribedAt: now }, update: { unsubscribedAt: now } });
  }
  await db.campaignContact.updateMany({
    where: { contact: { email: { in: emails } }, status: { in: ["QUEUED", "ACTIVE"] } },
    data: { status: "UNSUBSCRIBED", nextStepAt: null },
  });
  go({ notice: `${emails.length} address${emails.length > 1 ? "es" : ""} will never be emailed.` });
}

export async function removeSuppression(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  await db.contact.update({ where: { id }, data: { unsubscribedAt: null, bouncedAt: null } });
  go({ notice: "Removed from the do-not-email list." });
}

/** Saves the Zoom app's credentials (created once in the Zoom App Marketplace). */
export async function saveZoomApp(form: FormData) {
  await requireAdmin();
  const clientId = String(form.get("clientId") ?? "").trim();
  const clientSecret = String(form.get("clientSecret") ?? "").trim();
  if (!clientId || !clientSecret) redirect(`/settings?error=${encodeURIComponent("Paste both the Client ID and the Client secret.")}#integrations`);
  const data = { clientId, clientSecretEnc: encrypt(clientSecret) };
  await db.integration.upsert({ where: { provider: "ZOOM" }, create: { provider: "ZOOM", ...data }, update: data });
  redirect(`/settings?notice=${encodeURIComponent("Zoom app saved. Now press Connect Zoom.")}#integrations`);
}

export async function removeZoom() {
  await requireAdmin();
  await disconnectZoom();
  redirect(`/settings?notice=${encodeURIComponent("Zoom disconnected. Meetings use the fixed link again.")}#integrations`);
}
