# Contact sheet format

One row per contact, `.xlsx` or `.csv`. The first non-empty row is the header. Column names are matched loosely (case, spaces and underscores don't matter).

| Column | Required | Also accepted as |
|---|---|---|
| `recipientEmail` | Yes | email, recipient, to, work email |
| `firstName` | | first, given name |
| `lastName` | | last, surname |
| `companyName` | | company, organization, account |
| `senderEmail` | | sender, from, mailbox. Which connected mailbox sends to this contact. |
| `Email1_Subject`, `Email1_Body` | | `Email 1 Subject`, `Step1Body` … up to `Email10` |
| anything else | | Becomes a placeholder: a column `industry` is available as `{{industry}}` |

The copy in the sheet is used as-is for each contact (it can already be personalised). It may also contain placeholders:

`{{firstName}}` `{{lastName}}` `{{fullName}}` `{{companyName}}` `{{email}}` `{{senderName}}` `{{senderFirstName}}` `{{senderEmail}}`, plus any extra column. Add a fallback for empty values: `{{firstName|there}}`.

Bodies are plain text. Blank lines become paragraphs, URLs become links (tracked if click tracking is on).

## On import

- Invalid and duplicate emails are skipped and listed in the import summary.
- Addresses on the do-not-email list are imported but never emailed in live mode.
- Contacts whose `senderEmail` is not connected wait for that mailbox (or are spread across connected mailboxes, if you choose that option).
- The number of emails in the sequence comes from the highest `EmailN_` column.
