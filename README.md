# Yoodco Email

Outbound email sequences sent from your team's own mailboxes, paced so they don't land in spam, that turn interested replies into meetings in the calendar.

Upload the same contact sheet you use today (contact, sender mailbox, and the copy for Email 1, 2 and 3). The system queues every email, sends at most a set number per hour with random gaps, pauses outside working hours, sends follow-ups on schedule, and stops the sequence the moment someone replies.

**Everything starts in test mode.** A campaign captures every email in a test inbox until you switch it to live, so the team can check the whole flow first.

---

## What it does

| | |
|---|---|
| **Your own mailboxes** | Google Workspace / Gmail, Microsoft 365, or any SMTP/IMAP account. Each contact is sent from the mailbox named in the sheet. |
| **Pacing** | Per campaign: emails per hour (default 20), random gap between emails (90–270 s), sending window (Mon–Fri 09:00–17:00 in your time zone). Per mailbox: daily and hourly limits, optional warm-up. |
| **Sequences** | Email 1 → wait N days → Email 2 → wait → Email 3. Follow-ups can go in the same thread. |
| **Stops automatically** | On reply (out-of-office ignored), bounce, or unsubscribe. Optionally stops everyone at the same company when one person replies. |
| **Replies → meetings** | Every reply is sorted (interested, question, not now, not interested, remove me, wrong person). Interested people get a booking link in the same thread a few minutes later; when they pick a time, a calendar invite goes to them and the host and the meeting is recorded. Works with the built-in booking page or your own Calendly / Cal.com / Google link. See [docs/MEETINGS.md](docs/MEETINGS.md). |
| **Meetings** | One page with every booked call: coming up, held, no-show, canceled, show rate, CSV export for reporting or per-meeting billing. |
| **Tracking** | Opens (invisible image), clicks (redirect links), replies and bounces (reads each mailbox's inbox). Link scanners and image prefetchers are flagged and excluded. |
| **Safety** | Mailbox auto-pauses if its bounce rate passes 5%. Global do-not-email list. One-click unsubscribe header. Credentials encrypted at rest. |
| **Test mode** | Emails captured (Mailpit or the in-app test inbox), fast-forward turns days into minutes, simulate opens/clicks/replies/bounces, or send the whole sequence to yourself through the real mailbox. |
| **Reporting** | Per campaign, per email step, per mailbox; contact list with status; activity timeline; CSV export. |

## Try it in 5 minutes (Docker)

```bash
git clone https://github.com/waliworkshere/yoodco-email.git
cd yoodco-email
cp .env.example .env
# edit .env: set SESSION_SECRET, ENCRYPTION_KEY (openssl rand -base64 48), ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
docker compose exec web npx tsx scripts/demo.ts   # optional: demo login + demo campaign with fictional contacts
```

- App: <http://localhost:3000> (sign in with ADMIN_EMAIL / ADMIN_PASSWORD, or after the demo script with `demo@yood.ai` / `yood-demo-2026`; remove that account before going live)
- Test inbox (Mailpit): <http://localhost:8025>

Then: open the demo campaign → **Start test run**. Within a few minutes all 24 fictional contacts receive all three emails in Mailpit. Open one in Mailpit and click its link to see an open and a click appear on the dashboard; use **Actions → Simulate a reply** on a contact to watch the sequence stop. See [docs/TESTING.md](docs/TESTING.md) for the full walkthrough.

## Run without Docker

Requires Node 20.9+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and the secrets
npx prisma migrate deploy
npm run db:seed               # creates the admin account
npm run build && npm start    # web app on :3000
npm run worker                # in a second terminal: the sender
```

For development: `npm run dev` and `npm run worker:dev`. Tests: `npm test`.

## Going live

1. **Deploy on a public https address** (e.g. `https://mail.yood.ai`) and set `APP_URL` to it. Tracking pixels, click links and unsubscribe links point there, so recipients must be able to reach it. Any host that runs Docker works (a small VPS, Railway, Render, Fly.io); run one `web` and exactly one `worker`.
2. **Authenticate the sending domain**: SPF, DKIM and DMARC. Each mailbox page checks these and tells you what is missing.
3. **Connect the real mailboxes** ([docs/CONNECTING_MAILBOXES.md](docs/CONNECTING_MAILBOXES.md)). Connecting a mailbox with the same address as a sandbox one replaces it, and its contacts carry over.
4. On the campaign, open **Test & launch**, send yourself the sequence, review the checklist, type `LIVE`, then **Start sending**.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): components, data model, how the scheduler decides what to send
- [Connecting mailboxes](docs/CONNECTING_MAILBOXES.md): Google, Google Workspace (admin), Microsoft 365, SMTP
- [Testing](docs/TESTING.md): test mode, Mailpit, simulations, the pre-launch checklist
- [Contact sheet format](docs/SHEET_FORMAT.md)
- [Replies and meetings](docs/MEETINGS.md): reply sorting, booking page, Calendly / Cal.com webhooks

## Project layout

```
prisma/schema.prisma      data model
src/app/                  Next.js dashboard, server actions, tracking + unsubscribe routes
src/lib/engine/           scheduler (pacing), send, inbox scanner, reply/bounce/unsubscribe handling
src/lib/mail/             SMTP/IMAP transport, OAuth for Google and Microsoft
src/lib/schedule.ts       sending window, limits, warm-up (pure, unit-tested)
src/lib/render.ts         template filling, HTML version, link tracking
src/lib/import.ts         .xlsx / .csv contact sheet reader
src/worker/index.ts       background sender process
tests/                    unit tests (vitest)
```
