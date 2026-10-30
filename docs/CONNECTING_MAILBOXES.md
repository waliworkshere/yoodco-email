# Connecting mailboxes

Four ways, pick per mailbox. All of them send through SMTP and read replies through IMAP.

| Option | Best for | Who does it |
|---|---|---|
| Google sign-in | Gmail / Google Workspace, each person connects their own | Each mailbox owner, once |
| Google Workspace (admin) | Connecting all @yood.ai mailboxes in one go | A Workspace admin, once |
| Microsoft sign-in | Microsoft 365 / Outlook | Each mailbox owner, once |
| SMTP / IMAP | Any other provider, or Google/Microsoft with an app password | Anyone with the password |

When a mailbox is connected, contacts from imported sheets whose `senderEmail` matches it are assigned to it automatically.

## Google sign-in (OAuth)

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project.
2. **APIs & Services → OAuth consent screen**: User type *Internal* (only your Workspace users can connect, no Google review needed). Add the scope `https://mail.google.com/`.
3. **Credentials → Create credentials → OAuth client ID** → *Web application*. Authorised redirect URI: `{APP_URL}/api/oauth/google/callback` (e.g. `https://mail.yood.ai/api/oauth/google/callback`).
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart.
5. Mailboxes → Connect → **Sign in with Google**, as the mailbox owner.

## Google Workspace, all mailboxes at once (domain-wide delegation)

1. In the same Cloud project: **IAM → Service accounts → Create**. Create a JSON key and download it.
2. In [Google Admin](https://admin.google.com/): **Security → Access and data control → API controls → Domain-wide delegation → Add new**. Client ID = the service account's numeric ID; scope `https://mail.google.com/`.
3. Put the whole JSON key on one line in `.env` as `GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`, restart.
4. Mailboxes → Connect → **All Google Workspace mailboxes at once**, paste the addresses. Each one is checked before it's added.

## Microsoft 365 (OAuth)

1. [Entra admin center](https://entra.microsoft.com/) → **App registrations → New registration**. Redirect URI (Web): `{APP_URL}/api/oauth/microsoft/callback`.
2. **Certificates & secrets → New client secret**.
3. **API permissions → Add → APIs my organization uses → Office 365 Exchange Online** → delegated `SMTP.Send` and `IMAP.AccessAsUser.All`. Grant admin consent.
4. Exchange admin: make sure **Authenticated SMTP** is enabled for the mailboxes (Microsoft 365 admin → user → Mail → Manage email apps).
5. `.env`: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (your tenant ID, or `common`). Restart.
6. Mailboxes → Connect → **Sign in with Microsoft**.

## SMTP / IMAP

| Provider | SMTP | IMAP | Password |
|---|---|---|---|
| Google | smtp.gmail.com : 465 | imap.gmail.com : 993 | [App password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| Microsoft 365 | smtp.office365.com : 587 | outlook.office365.com : 993 | App password, with Authenticated SMTP enabled |
| Zoho | smtp.zoho.com : 465 | imap.zoho.com : 993 | App-specific password |

Without IMAP the mailbox still sends, but replies and bounces arriving later are not detected.

## Recommended limits

| Mailbox | Daily limit | Hourly limit | Warm-up |
|---|---|---|---|
| New (under 2 weeks old) | 30 | 6 | On |
| Already used every day | 30–40 | 8 | Off |

With 7 mailboxes at 30/day the team can send about 210 emails a day. To send more, add mailboxes rather than raising limits.

## Before going live

On each mailbox page, **Domain health** must show SPF, DKIM and DMARC as found. Many teams also send cold outreach from a separate domain (e.g. `getyood.ai`) so the main domain's reputation is never at risk.
