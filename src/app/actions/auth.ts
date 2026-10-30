"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { env } from "@/lib/env";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  try {
    void env.sessionSecret;
    void env.encryptionKey;
  } catch {
    return { error: "The app is not fully set up: add a database (DATABASE_URL) or set SESSION_SECRET and ENCRYPTION_KEY, then redeploy." };
  }
  let user;
  try {
    user = email ? await db.user.findUnique({ where: { email } }) : null;
  } catch {
    return { error: "The database is not reachable. Check DATABASE_URL in the hosting settings." };
  }
  // Always run bcrypt so response time does not reveal whether the email exists
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok) return { error: "Email or password is incorrect." };
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession({ id: user.id, email: user.email, name: user.name, role: user.role });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
