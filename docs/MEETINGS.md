# Replies and meetings

The goal of a campaign is a meeting in the calendar. This is how a reply becomes one, without anyone chasing.

```
Email 1 / 2 / 3 ──► reply arrives in the sending mailbox (IMAP, checked every few minutes)
                     │
                     ├─ sequence stops for that person (and their colleagues at the same company)
                     ├─ the reply is read: Interested · Has a question · Not right now ·
                     │                     Not interested · Asked to be removed · Wrong person · Other
                     │
                     └─ Interested ──► 4–12 minutes later, the booking link goes out
                                        in the same thread, from the same mailbox
                                              │
                                              ▼
                                   they pick a time ──► calendar invite to them and the host
                                                        meeting recorded, shown under Meetings
```

## Reading replies

Built-in rules sort every reply (English phrasing such as "happy to chat", "send me times", "not interested",
"remove me", "not the right person"). Quoted history and signatures are ignored.
Set `ANTHROPIC_API_KEY` to have replies read by an AI model instead (the rules stay as the fallback).
Teammates can correct any reply type on the campaign's **Replies** tab; switching a reply to *Interested*
sends the booking link within a minute.

"Please remove me" replies are treated like the unsubscribe link: the address goes on the do-not-email list.

## Booking: three options per campaign (Settings → Meetings)

| Option | What the contact sees | How the meeting is recorded |
|---|---|---|
| **Built-in booking page** (default) | A page with free times in their own time zone. Booking sends a calendar invite (Accept / Decline in Gmail and Outlook) to them and to the host. | Automatically. |
| **My own booking link** | Your Calendly, Cal.com, Google appointment schedule or HubSpot page, with their name and email filled in. | Webhook (below), or the tool's "New event" email reaching a connected mailbox. |
| **Off** | Nothing is sent; replies are only sorted. | Teammates add meetings by hand. |

The built-in page offers the campaign's meeting days and hours, at least *Earliest booking* hours ahead,
and never offers a time that overlaps another meeting already booked with the same host. It does not see the
host's other calendar events: keep the bookable hours to times the host keeps free, or use your own booking link.

You can also place `{{bookingLink}}` in Email 2 or 3 ("grab a time here").

## Recording meetings from other tools

Settings → **Calendar tools** shows the webhook address (`/api/meetings/<key>`). The key is
`MEETING_WEBHOOK_KEY`, or derived from the database password when that is not set.

- **Calendly** (Standard plan or higher): Integrations → Webhooks → *Invitee created* and *Invitee canceled*.
- **Cal.com**: Settings → Developer → Webhooks → *Booking created* and *Booking cancelled*.
- **Anything else** (Zapier, Make, HubSpot workflows): POST JSON `{ "email": "...", "name": "...", "startTime": "ISO date" }`.
  Add `"status": "canceled"` and the same `"id"` to cancel.

Bookings are matched to the contact by the reference carried in the booking link, otherwise by email address.
Calendar invitations a prospect sends to a connected mailbox are recognised and recorded too.

## The Meetings page

Every meeting from every campaign: coming up, past, canceled. Mark each one **Held** or **No-show** after
the call; the show rate and the CSV export (one row per meeting) are what you report or invoice on.
Test-run bookings are kept separately and never counted.

## Trying it in test mode

Start a test run, then on the **Contacts** tab use *Actions → Simulate → An interested reply*. A few seconds
later the booking-link email appears on the **Emails** tab. Open the link (the address is in the email) to book
a time; the meeting appears on the **Replies** tab and under **Meetings → Test bookings**.
