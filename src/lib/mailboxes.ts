import type { Mailbox, Prisma } from "@prisma/client";
import { db } from "./db";

/**
 * Create or update a mailbox by email, then attach any imported contacts that
 * were waiting for this sender (rows whose senderEmail matched before it was connected).
 */
export async function upsertMailbox(email: string, data: Omit<Prisma.MailboxCreateInput, "email">): Promise<{ mailbox: Mailbox; attached: number }> {
  const normalized = email.trim().toLowerCase();
  const mailbox = await db.mailbox.upsert({
    where: { email: normalized },
    create: { ...data, email: normalized },
    update: { ...data, status: "ACTIVE", statusReason: null, lastError: null, accessTokenEnc: null, accessTokenExpiresAt: null },
  });
  const { count } = await db.campaignContact.updateMany({
    where: { senderEmail: normalized, mailboxId: null },
    data: { mailboxId: mailbox.id },
  });
  return { mailbox, attached: count };
}
