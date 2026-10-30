/**
 * Loads a demo so the team can try everything without real data:
 *   - sandbox mailboxes (never deliver) for the Yood sender addresses
 *   - a test-mode campaign with 24 fictional contacts and a 3-email sequence
 * Run: npm run demo   (then press "Start test run" on the campaign)
 */
import "../src/worker/load-env";
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

async function main() {
  for (const email of SENDERS) {
    const name = email.split("@")[0].replace(/^./, (c) => c.toUpperCase());
    const existing = await db.mailbox.findUnique({ where: { email } });
    if (!existing) await db.mailbox.create({ data: { email, displayName: `${name} from Yood`, provider: "SANDBOX" } });
  }
  const mailboxes = await db.mailbox.findMany({ where: { email: { in: SENDERS } } });

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
  console.log(`Open ${process.env.APP_URL ?? "http://localhost:3000"}/campaigns/${campaign.id} and press "Start test run".`);
}

main().finally(() => db.$disconnect());
