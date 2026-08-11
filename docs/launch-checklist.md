# Launch checklist — what only you can do

The automated code checks pass, but production launch is not complete until
the external-service, real-world testing, content, and legal boxes below are
closed. Group ordering reflects what blocks ship.

---

## A. Domain + hosting infra (1–2 hours, blocks email + production URL)

- [ ] Buy domain (e.g. `weddly.hu`). Set DNS to Cloudflare or your registrar's resolver.
- [ ] Create Railway project; connect this repo; verify the Dockerfile build succeeds.
- [ ] **Mount a persistent volume at `/data`** in the Railway service settings. Without it every redeploy wipes the SQLite DB. This is the single most important infra step.
- [ ] In Railway service variables, set:
  - `JWT_SECRET` — `openssl rand -hex 48`
  - `FRONTEND_BASE_URL` — your real domain (`https://weddly.hu`)
  - `NODE_ENV=production`
  - `SERVE_FRONTEND=1`
  - `RESEND_API_KEY` — from Resend dashboard (after step B)
  - `EMAIL_FROM` — `Weddly <noreply@weddly.hu>` (must use a verified domain)
- [ ] Add a custom domain in Railway → wait for HTTPS cert (auto Let's Encrypt).
- [ ] Smoke test the deploy: hit `https://weddly.hu/api/health` → `{ "ok": true }`.

## B. Email deliverability (1 hour DNS + ~24h propagation)

- [ ] Sign up for Resend.
- [ ] Verify your sending domain in Resend dashboard.
- [ ] Add the **SPF, DKIM, and DMARC** DNS records Resend provides. Without these, invites and password-reset emails will land in spam.
  - DMARC starting policy: `v=DMARC1; p=none; rua=mailto:dmarc@weddly.hu` (move to `quarantine` after 1–2 weeks of clean reports).
- [ ] Send a test email to gmail / outlook / proton / fastmail / iCloud. Check the spam folder on each. Verify the bilingual (HU + EN) layout reads cleanly.
- [ ] Add `RESEND_API_KEY` to Railway (step A).

## C. Backups (30 min, blocks GDPR readiness)

Recommended target: **Cloudflare R2** — 10 GB / 10M reads / 1M writes free per month, no egress fees, S3-compatible (works with the same `aws s3 cp` calls). The script supports any S3-compatible bucket via `AWS_ENDPOINT_URL`.

### C.1 Generate the age keypair (5 min, do this on your laptop, not on the server)

```sh
age-keygen -o weddly-backup.key
# → "Public key: age1xxxxxxxxxxxxxxxxxxxx..."  (this is the AGE_RECIPIENT)
# The private half is the recovery secret. Without it, every encrypted snapshot is unrecoverable.
```

- [ ] Store the private key (`weddly-backup.key`) **outside this machine** — 1Password / Bitwarden / a sealed envelope in a drawer. Losing it = losing every backup.
- [ ] Set `AGE_RECIPIENT=age1xxxxx...` (the public key) in Railway service variables.

### C.2 Cloudflare R2 setup (10 min)

- [ ] Create a Cloudflare account (free) → R2 dashboard → **Create bucket**, e.g. `weddly-backups`. Pick a region close to Railway (`eu` if Railway runs in EU).
- [ ] Manage R2 API Tokens → **Create API Token** → permissions "Object Read & Write" scoped to that bucket only. Copy the Access Key ID + Secret Access Key + S3 endpoint URL.
- [ ] In R2 → bucket → Settings → **Object Lifecycle**: add a rule "delete after 90 days". Local retention sweep handles 14 days; R2 lifecycle handles long-term sweep.

### C.3 Railway env vars on the **backup** service (not the app)

- [ ] `DB_PATH=/data/weddly.db`
- [ ] `BACKUP_DIR=/tmp/weddly-backup`
- [ ] `AGE_RECIPIENT=age1xxxxx...` (from C.1)
- [ ] `S3_BUCKET=weddly-backups`
- [ ] `S3_PREFIX=prod/`
- [ ] `AWS_ACCESS_KEY_ID=...` (from C.2)
- [ ] `AWS_SECRET_ACCESS_KEY=...` (from C.2)
- [ ] `AWS_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com` (from C.2)
- [ ] `HEALTHCHECK_URL=https://hc-ping.com/<uuid>` (from `docs/uptime.md` step 2)

### C.4 Schedule the cron

Recommended: **Railway Cron service**.

- [ ] In your Railway project → **+ New** → Cron. Point it at the same repo/Dockerfile.
- [ ] Override the start command: `bash scripts/backup.sh`
- [ ] Schedule: `0 3 * * *` (03:00 UTC daily; tweak to off-peak for your couples).
- [ ] **Mount the same `/data` volume** that the app service uses, ideally read-only. The cron container needs to read the live DB.
- [ ] The base image (`oven/bun:1.3.10`) is Debian-based. Add `sqlite3`, `age`, and the AWS CLI to the cron service. Easiest path: add an ad-hoc `apt-get install` step in a wrapper shell, or use a small custom Dockerfile for the cron service. (TODO: ship a `Dockerfile.backup` if Railway's "Cron" feature doesn't accept inline install steps.)

Alternative: GitHub Actions scheduled workflow that SSHes into Railway and triggers the script. Slower to set up; only do this if Railway Cron isn't available on your plan.

### C.5 First-restore drill (mandatory — the only thing that proves backups work)

- [ ] Wait for the first nightly run, then check the R2 bucket → confirm a `weddly-<timestamp>.db.age` object appeared.
- [ ] On your laptop, with the private key from C.1:

  ```sh
  export AGE_IDENTITY=/path/to/weddly-backup.key
  export AWS_ACCESS_KEY_ID=...   # same R2 creds
  export AWS_SECRET_ACCESS_KEY=...
  export AWS_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
  bash scripts/restore.sh \
      s3://weddly-backups/prod/weddly-20260509T030000Z.db.age \
      /tmp/restored.db
  sqlite3 /tmp/restored.db 'SELECT count(*) FROM users;'
  ```

- [ ] Confirm row counts roughly match production. If they don't, the chain is broken — fix it before launch.

## D. Legal review (1–2 weeks calendar time, blocks public launch)

- [ ] Hand `legal/PRIVACY.md`, `legal/TERMS.md`, `legal/IMPRINT.md` to a Hungarian lawyer (privacy + e-commerce specialist). They review GDPR, ÁSZF, fogyasztóvédelem.
- [ ] Replace every `{{PLACEHOLDER}}` once the lawyer's edits are in.
- [ ] Add `/privacy`, `/terms`, `/imprint` routes in `frontend/src/App.tsx` rendering the final docs.
- [ ] Link them from the landing-page footer + auth-page footers + Settings.
- [ ] Decide on cookie banner — Plausible is cookieless (no banner needed legally) but HU users expect one. Skip for v1 if Plausible-only.

## E. Content / marketing (a couple of evenings)

- [ ] Have a native HU speaker review every string in `frontend/src/locales/hu.ts`. Auto-generated translations kill trust on weddings.
- [ ] Design an OG image (1200×630, JPG) — couple silhouette + "Weddly" wordmark works. Drop into `frontend/public/og.jpg`. Add `<meta property="og:image" content="/og.jpg" />` to `frontend/index.html`.
- [ ] Add `apple-touch-icon-180.png` (180×180 PNG) to `frontend/public/`. Add the corresponding `<link rel="apple-touch-icon">` in `index.html`.
- [ ] Update `frontend/public/sitemap.xml` to use the absolute domain (`https://weddly.hu/`).
- [ ] Edit landing copy with your real beta-pricing message. Confirm the FAQ answers.

## F. QA before traffic (1 day)

- [ ] **Print test:** print one A4 seating chart, one A6 place card, one A3 chart on a real printer. Confirm the page sizes match (paper-size mismatch = unusable).
- [ ] **Real-device QA:** open the app on an actual iPhone (Safari) and an actual Android phone (Chrome). Test signup, RSVP at `/rsvp/<code>`, seating drag-drop. RSVP especially gets opened on phones at venues with bad reception.
- [ ] **Spam-folder test:** send invite + password reset to gmail/outlook/proton; verify they hit Inbox, not Spam.
- [ ] **Real-data smoke test:** with a fresh production account, run signup → invite partner B (use a second email you control) → onboarding wizard → add 5 guests → CSV-import 20 more → submit RSVPs at `/rsvp/<code>` → drag guests onto a table → trigger a conflict → export the chart as A4 PDF → download Settings → JSON export.
- [ ] **Pause flow:** create a throwaway couple, hit Pause, then Cancel. Don't actually wait 30 days — the test suite already covers the purge job.

### F.1 Payment launch drill (required before accepting money)

- [ ] Create all Stripe products/prices in **test mode** using the scripts in
  `backend/scripts/stripe_setup*.ts`. The guest-page add-on has its own setup
  script; the film checkout uses inline price data and does not need a Price id.
- [ ] Configure the three distinct webhook endpoints and signing secrets:
  `/api/billing/webhook`, `/api/planner/billing/webhook`, and
  `/api/vendor/billing/webhook`.
- [ ] Run `STRIPE_PREFLIGHT_MODE=test bun run preflight:stripe`. Fix every
  failure; warnings require an explicit human decision.
- [ ] In Admin → Financial planner, launch one test product at a time. Complete
  checkout, confirm the webhook changed entitlement, open the customer portal,
  then pause new payments and confirm the portal still works.
- [ ] Repeat setup and preflight with live credentials:
  `STRIPE_PREFLIGHT_MODE=live bun run preflight:stripe`.
- [ ] Make the live preflight a deployment gate and run it on a daily monitor.
  Alert on a disabled/wrong Price, unavailable charges, or webhook drift; the
  admin launch check is intentionally not a substitute for ongoing monitoring.
- [ ] Launch live products in this order: guest-page add-on, film, couple,
  planner, vendor. Use a real low-value transaction for each, refund it, and
  confirm the refund/webhook is recorded before launching the next product.
- [ ] Enable the global paid-access paywall only after couple, planner and
  vendor subscriptions have passed their live checkout + recovery drill.

## G. Observability (30 min, optional but recommended)

- [ ] Sentry account → create project for "weddly-backend" + "weddly-frontend".
- [ ] Set `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (rebuild required) in Railway. **VITE_** vars are baked at build time; you need a redeploy after setting them.
- [ ] Plausible account → add domain → set `VITE_PLAUSIBLE_DOMAIN` and rebuild.
- [ ] External uptime monitor pinging `/api/health` every 5 min. Step-by-step runbook in [`docs/uptime.md`](docs/uptime.md) — UptimeRobot for endpoint pings + Healthchecks.io for the backup cron heartbeat, both free tier.

## H. Soft launch (recommended before going public)

- [ ] Recruit 5–10 actually-engaged couples via friends-of-friends. Free for life as a thank-you.
- [ ] Watch their behavior in audit logs + ask weekly for friction points. Wedding-specific edge cases (divorced parents seated apart, late RSVPs, surprise dietary restrictions) only surface from real use.
- [ ] Fix everything that's friction; only then do public launch / paid acquisition.

---

## What NOT to do at launch

- Don't enable v2 marketplace endpoints — they don't exist yet.
- Don't expose every Stripe flow at once. Configure and verify each product,
  then launch it independently from Admin → Financial planner. Start with the
  low-risk one-off add-on and film flows; keep vendor deferred billing for last.
- Don't add Google Analytics or any analytics SDK that touches PII. Plausible only.
- Don't run the backup script on top of the live DB without `.backup` (a plain `cp` against a WAL'd DB will produce a corrupt copy).
- Don't bypass `--no-verify` to push past failing hooks. If a hook fails, fix it.
