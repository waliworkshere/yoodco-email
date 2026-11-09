/**
 * Turns the workspace into a real one (PILOT_MODE=true, run on each deploy; safe to repeat):
 * removes the demo login, the demo and sample campaigns (and their meetings), and sandbox mailboxes
 * no longer used, so real results are never mixed with sample data and the public demo password
 * no longer opens the workspace.
 */
import "../src/worker/load-env";
import { db } from "../src/lib/db";

async function main() {
  const demo = await db.campaign.findMany({ where: { OR: [{ name: { startsWith: "Demo ·" } }, { name: { startsWith: "Example ·" } }] }, select: { id: true, name: true } });
  if (demo.length) {
    const ids = demo.map((c) => c.id);
    await db.meeting.deleteMany({ where: { campaignId: { in: ids } } });
    await db.campaign.deleteMany({ where: { id: { in: ids } } });
    console.log(`[pilot] Removed ${demo.length} demo/sample campaigns.`);
  }
  const sandboxes = await db.mailbox.findMany({ where: { provider: "SANDBOX" }, select: { id: true, _count: { select: { messages: true } } } });
  const unused = sandboxes.filter((m) => m._count.messages === 0).map((m) => m.id);
  if (unused.length) {
    await db.campaignContact.updateMany({ where: { mailboxId: { in: unused } }, data: { mailboxId: null } });
    await db.mailbox.deleteMany({ where: { id: { in: unused } } });
    console.log(`[pilot] Removed ${unused.length} sandbox mailboxes.`);
  }
  const orphans = await db.contact.deleteMany({ where: { enrollments: { none: {} }, email: { endsWith: ".example" } } });
  if (orphans.count) console.log(`[pilot] Removed ${orphans.count} sample contacts.`);
  const removed = await db.user.deleteMany({ where: { email: "demo@yood.ai" } });
  if (removed.count) console.log("[pilot] Removed the demo login.");
}

main().finally(() => db.$disconnect());
