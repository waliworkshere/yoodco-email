# Testing before anyone gets an email

Every campaign is created in **test mode**. In test mode nothing reaches the people on the list; the system behaves exactly as it will live, but every email is captured.

## Where test emails go

| Setting | Where emails go |
|---|---|
| Default | Mailpit (<http://localhost:8025> with Docker) and the campaign's **Emails** tab |
| `SANDBOX_SMTP_URL` empty | Only the campaign's **Emails** tab |
| Campaign setting *Send test emails to a real inbox* | Really sent from the mailbox to that one address, subject prefixed `[Test → original@contact]`, to check inbox vs spam placement |

## Walkthrough

1. **Add sandbox mailboxes**: Mailboxes → Connect → Sandbox. The form is pre-filled with the senders from your sheets.
2. **Import the sheet**: Campaigns → New campaign.
3. **Start test run**. With fast-forward on (default) an email goes out every few seconds, and "3 days later" means 3 minutes later, so a full 3-email sequence finishes in minutes.
4. **Watch it**: Overview shows progress and engagement; Contacts shows each person's step and next email time; Emails is the test inbox.
5. **Act like a recipient**:
   - Open an email in Mailpit → counts as an open (images load from the app).
   - Click a link in it → counts as a click, then forwards to the real page.
   - Contacts → Actions → *Simulate a reply* → the contact stops getting emails. With "stop for the whole company" on, colleagues at the same domain stop too.
   - *Simulate a bounce* → contact marked bounced.
   - Click the opt-out link in an email → unsubscribe page.
6. **Rehearse real timing** (optional): Settings → turn off fast-forward. The test then respects the sending window, hourly limit and day delays.
7. **Send yourself the sequence**: Test & launch → *Send test emails*. All steps arrive from the real mailbox, written for a contact you pick.
8. **Reset** (More → Reset test run) to start over, or **Switch to live** (Test & launch, type `LIVE`). Switching clears test results and waits for you to press *Start sending*.

## Automated tests

```bash
npm test
```

Covers the sending window and time zones, warm-up, jitter, template filling, HTML rendering and link tracking, sheet import (CSV and Excel, the Yood column layout, invalid and duplicate rows), bounce and out-of-office detection, and send-error classification.
