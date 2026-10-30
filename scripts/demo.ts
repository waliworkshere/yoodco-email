/**
 * Loads a demo so the team can try everything without real data:
 *   - sandbox mailboxes (never deliver) for the Yood sender addresses
 *   - a test-mode campaign with 24 fictional contacts and a 3-email sequence
 * Run: npm run demo   (then press "Start test run" on the campaign)
 */
import "../src/worker/load-env";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";

const SENDERS = ["charles@yood.ai", "katy@yood.ai", "bill@yood.ai", "sam@yood.ai", "samantha@yood.ai", "ashley@yood.ai", "julia@yood.ai"];
const COMPANIES = ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Litware", "Adatum", "Proseware", "Wingtip"];
const PEOPLE = [
  ["Ava", "Stone"], ["Liam", "Park"], ["Mia", "Chen"], ["Noah", "Reyes"], ["Zoe", "Ito"], ["Omar", "Haddad"], ["Lena", "Vogel"], ["Ravi", "Menon"],
  ["Sara", "Lind"], ["Tom", "Becker"], ["Ines", "Costa"], ["Yuki", "Mori"], ["Jon", "Weller"], ["Nora", "Ali"], ["Paul", "Klein"], ["Eva", "Novak"],
  ["Max", "Ruiz"], ["Hana", "Kim"], ["Leo", "Marin"], ["Ada", "Okafor"], ["Ben", "Shaw"], ["Kai", "Berg"], ["Rosa", "Diaz"], ["Ian", "Price"],
];

const STEPS = [
  {
    subject: "Most SaaS companies hit a plateau. I've hit it 4 times.",
    body: "Hi {{firstName}},\n\nIf {{companyName}} is doing $5–10M ARR with 50–100 people, growth often flattens and ARR per employee stalls around $120–160K.\n\nWe built an operating system to break through that ceiling. Here is how it works: https://yood.ai\n\nWorth a 15-minute look? Just reply \"Yes\".\n\nBest,\n{{senderFirstName}}",
  },
  {
    subject: "How 100 weeks unlocks +100K ARR/person",
    body: "Hi {{firstName}},\n\nQuick follow-up. Yood combines a 100-week roadmap, a performance platform and an embedded team that executes with you.\n\nWant to review the model? Reply \"Let's talk\".\n\nBest,\n{{senderFirstName}}",
  },
  {
    subject: "SaaS teams that broke through the plateau",
    body: "Hi {{firstName}},\n\nLast note from me. If it's worth a conversation, pick a time here:\nhttps://calendar.app.google/demo\n\nYou'll leave with a growth map you can use with or without us.\n\nBest,\n{{senderFirstName}}",
  },
];

// Deterministic pseudo-random numbers, so every deploy creates the same example
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const EXAMPLE_NAME = "Example · SaaS founders (sample data)";
const EX_FIRST = ["Maya", "Felix", "Lara", "Hugo", "Iris", "Dev", "Nina", "Oscar", "Tara", "Eli", "Vera", "Sami", "Anya", "Remy", "Lina", "Theo", "Jade", "Owen", "Mila", "Arjun"];
const EX_LAST = ["Laurent", "Sato", "Moreau", "Jansen", "Rossi", "Kowalski", "Hart", "Silva", "Brandt", "Nakamura", "Ferreira", "Dubois", "Lund", "Okoye", "Varga"];
const EX_COMPANIES = ["Woodgrove", "Lucerne", "Coho", "Margie", "Alpine Ski", "Blue Yonder", "Trey Research", "Humongous", "Wide World", "Relecloud", "Fourth Coffee", "Graphic Design"];
const REPLIES = ["Sounds interesting. Thursday works for me.", "Send me two or three slots next week.", "Not right now, check back in Q1.", "Yes, happy to talk.", "Can you share a case study first?"];

const fill = (t: string, v: Record<string, string>) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => v[k] ?? "");

/** A finished live-mode campaign with two weeks of results, clearly named as sample data. */
async function seedExampleHistory(mailboxes: { id: string; email: string; displayName: string }[]) {
  if (await db.campaign.findFirst({ where: { name: EXAMPLE_NAME } })) return;
  const now = Date.now();
  const DAY = 86_400_000;
  const campaign = await db.campaign.create({
    data: {
      name: EXAMPLE_NAME,
      mode: "LIVE",
      status: "COMPLETED",
      startedAt: new Date(now - 14 * DAY),
      completedAt: new Date(now - 2 * 3600_000),
      steps: { create: STEPS.map((s, i) => ({ order: i + 1, delayDays: [0, 3, 4][i], subject: s.subject, body: s.body })) },
      importReport: { fileName: "SaaS_founders_example.xlsx", imported: 168, stepCount: 3, invalid: [], invalidCount: 2, duplicates: 1, suppressed: 0, unassigned: 0, senders: [], columns: [] },
    },
  });

  const messages: Prisma.MessageCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  let n = 0;
  for (let i = 0; i < 168; i++) {
    const first = EX_FIRST[i % EX_FIRST.length];
    const last = EX_LAST[Math.floor(i / EX_FIRST.length) % EX_LAST.length];
    const company = EX_COMPANIES[(i * 5) % EX_COMPANIES.length];
    const email = `${first}.${last}@${company.toLowerCase().replace(/[^a-z]/g, "")}.example`.toLowerCase();
    const contact = await db.contact.upsert({ where: { email }, create: { email, firstName: first, lastName: last, company }, update: {} });
    const mb = mailboxes[i % mailboxes.length];
    const cc = await db.campaignContact.create({ data: { campaignId: campaign.id, contactId: contact.id, mailboxId: mb.id, senderEmail: mb.email, status: "COMPLETED" } });

    // ~24 new people per weekday, starting 14 days ago; follow-ups 3 and 4 days later
    let t = now - (14 - Math.floor(i / 24)) * DAY + (2 + rand() * 6) * 3600_000;
    let status: "COMPLETED" | "REPLIED" | "BOUNCED" | "UNSUBSCRIBED" = "COMPLETED";
    let step = 0;
    let repliedAt: Date | null = null;
    for (let st = 1; st <= 3; st++) {
      if (t > now - 3600_000) break;
      step = st;
      const id = `ex${campaign.id.slice(-6)}m${n++}`;
      const vars = { firstName: first, companyName: company, senderFirstName: mb.displayName.split(" ")[0] };
      const body = fill(STEPS[st - 1].body, vars);
      const m = {
        id, token: `ex-${id}`, campaignId: campaign.id, campaignContactId: cc.id, mailboxId: mb.id, step: st, mode: "LIVE" as const, status: "SENT" as const,
        messageIdHeader: `<${id}@yood.ai>`, fromEmail: mb.email, toEmail: email, deliveredTo: email, subject: STEPS[st - 1].subject,
        bodyText: body, bodyHtml: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
        links: st === 3 ? ["https://calendar.app.google/demo"] : st === 1 ? ["https://yood.ai"] : [],
        sentAt: new Date(t), firstOpenedAt: null as Date | null, openCount: 0, firstClickedAt: null as Date | null, clickCount: 0, repliedAt: null as Date | null, bouncedAt: null as Date | null,
      };
      events.push({ type: "SENT", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, createdAt: new Date(t) });
      if (st === 1 && rand() < 0.025) {
        m.bouncedAt = new Date(t + 60_000); status = "BOUNCED";
        events.push({ type: "BOUNCE", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, detail: "550 5.1.1 mailbox does not exist", createdAt: m.bouncedAt });
        messages.push(m); break;
      }
      if (rand() < 0.52) {
        m.firstOpenedAt = new Date(t + rand() * 8 * 3600_000); m.openCount = 1 + Math.floor(rand() * 3);
        events.push({ type: "OPEN", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, userAgent: "Mozilla/5.0", createdAt: m.firstOpenedAt });
        if (m.links.length && rand() < 0.22) {
          m.firstClickedAt = new Date(m.firstOpenedAt.getTime() + rand() * 600_000); m.clickCount = 1;
          events.push({ type: "CLICK", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, url: m.links[0], userAgent: "Mozilla/5.0", createdAt: m.firstClickedAt });
        }
      }
      if (rand() < 0.022) {
        const at = new Date(t + (1 + rand() * 20) * 3600_000);
        if (at.getTime() < now) {
          m.repliedAt = at; repliedAt = at; status = "REPLIED";
          events.push({ type: "REPLY", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, detail: REPLIES[Math.floor(rand() * REPLIES.length)], createdAt: at });
          messages.push(m); break;
        }
      }
      if (rand() < 0.006) {
        status = "UNSUBSCRIBED";
        events.push({ type: "UNSUBSCRIBE", campaignId: campaign.id, campaignContactId: cc.id, messageId: id, createdAt: new Date(t + 7200_000) });
        messages.push(m); break;
      }
      messages.push(m);
      if (st < 3) t += [0, 3, 4][st] * DAY;
    }
    await db.campaignContact.update({ where: { id: cc.id }, data: { status, currentStep: step, repliedAt } });
  }
  await db.message.createMany({ data: messages });
  await db.event.createMany({ data: events });
  console.log(`Example history ready: ${messages.length} sample emails.`);
}

async function main() {
  // Demo login to showcase the app: demo@yood.ai / yood-demo-2026 (remove it in production under Settings → Team)
  const demoEmail = "demo@yood.ai";
  if (!(await db.user.findUnique({ where: { email: demoEmail } }))) {
    await db.user.create({ data: { email: demoEmail, name: "Demo Admin", role: "ADMIN", passwordHash: await bcrypt.hash("yood-demo-2026", 11) } });
  }

  for (const email of SENDERS) {
    const name = email.split("@")[0].replace(/^./, (c) => c.toUpperCase());
    const existing = await db.mailbox.findUnique({ where: { email } });
    if (!existing) await db.mailbox.create({ data: { email, displayName: `${name} from Yood`, provider: "SANDBOX" } });
  }
  const mailboxes = await db.mailbox.findMany({ where: { email: { in: SENDERS } }, orderBy: { email: "asc" } });

  if (process.env.SEED_EXAMPLE_HISTORY !== "false") await seedExampleHistory(mailboxes);

  // --once: used by the deploy setup, only creates the test campaign the first time
  if (process.argv.includes("--once") && (await db.campaign.count({ where: { name: { startsWith: "Demo ·" } } })) > 0) {
    console.log("Demo already loaded.");
    return;
  }

  const campaign = await db.campaign.create({
    data: {
      name: "Demo · Sequence 1 (fictional contacts)",
      mode: "TEST",
      testFastForward: true,
      steps: { create: STEPS.map((s, i) => ({ order: i + 1, delayDays: [0, 3, 4][i], subject: s.subject, body: s.body })) },
      importReport: { fileName: "demo (generated)", imported: PEOPLE.length, stepCount: 3, invalid: [], invalidCount: 0, duplicates: 0, suppressed: 0, unassigned: 0, senders: [], columns: [] },
    },
  });

  for (let i = 0; i < PEOPLE.length; i++) {
    const [first, last] = PEOPLE[i];
    const company = COMPANIES[i % COMPANIES.length];
    const email = `${first}.${last}@${company.toLowerCase()}.example`.toLowerCase();
    const contact = await db.contact.upsert({ where: { email }, create: { email, firstName: first, lastName: last, company }, update: {} });
    await db.campaignContact.create({ data: { campaignId: campaign.id, contactId: contact.id, mailboxId: mailboxes[i % mailboxes.length].id } });
  }
  console.log(`Demo ready: ${PEOPLE.length} fictional contacts across ${mailboxes.length} sandbox mailboxes.`);
  console.log("Demo login: demo@yood.ai / yood-demo-2026");
  console.log(`Open ${process.env.APP_URL ?? "http://localhost:3000"}/campaigns/${campaign.id} and press "Start test run".`);
}

main().finally(() => db.$disconnect());
