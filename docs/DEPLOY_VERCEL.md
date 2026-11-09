# Deploying on Vercel (for testing)

1. **Database:** Vercel → your project → **Storage → Create Database → Neon (Free)** → connect it to the project.
   Vercel adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the project automatically.
2. **Settings:** Vercel → project → **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `APP_URL` | `https://<your-project>.vercel.app` |
   | `SESSION_SECRET` | 48 random characters (`openssl rand -hex 24`) |
   | `ENCRYPTION_KEY` | another 48 random characters |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | optional: your own admin login |
   | `SEED_DEMO` | optional: `false` to skip the demo login and demo campaign |

   Leave `SANDBOX_SMTP_URL` unset: test emails are then kept in the app's test inbox.
3. **Redeploy** (Deployments → ⋯ → Redeploy). Each build runs `npm run vercel-build`, which creates or updates
   the tables and, the first time, loads the demo login `demo@yood.ai` / `yood-demo-2026`.

## Sending on Vercel

- **Test campaigns** advance while their campaign page is open in a browser. Nothing else is needed.
- **Live campaigns** need something to call the sender every minute, because Vercel does not keep a background
  process running. Set `CRON_SECRET` in Vercel, then create a free job at cron-job.org (or any scheduler)
  that calls `https://<your-project>.vercel.app/api/cron/tick` every minute with the header
  `Authorization: Bearer <CRON_SECRET>`. Each call sends for about 50 seconds.
  Simplest: the repository's `.github/workflows/sender.yml` keeps one GitHub Actions job running that calls
  the sender about every minute. It needs no secret: the app accepts GitHub's signed token for that workflow
  in this repository (set `SENDER_REPO` if you fork it). Each call sends what is due, reads replies every
  few minutes, sends booking links and records meetings, and returns at once when nothing is due.
- `PILOT_MODE=true` turns the deployment into a real workspace: each deploy removes the demo login and
  sample data instead of loading them. Create your own admin first.
  On a regular server, run `npm run worker` instead.

Remove the demo login (Settings → Team) before sending real email.
