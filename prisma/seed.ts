/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. Safe to run again. */
import "../src/worker/load-env";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists.`);
    return;
  }
  await db.user.create({ data: { email, name: process.env.ADMIN_NAME || "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password, 11) } });
  console.log(`Created admin ${email}. Sign in and change the password under Settings.`);
}

main().finally(() => db.$disconnect());
