# Launch checklist — what only you can do

The codebase is launch-ready (see `git log` for what just landed). The boxes
below are the things a human needs to handle: external services, real-world
testing, content, and legal sign-off. Group ordering reflects what blocks ship.

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

- [ ] Decide where snapshots go: Cloudflare R2 (recommended — cheap, S3-compat) or AWS S3.
- [ ] Generate an `age` keypair: `age-keygen -o weddly-backup.key`. Store the private key in 1Password / similar; put the public key in Railway as `AGE_RECIPIENT`.
- [ ] Configure `S3_BUCKET`, `S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL` (R2) in Railway.
- [ ] Schedule `scripts/backup.sh` daily. Options:
  - **Railway Cron service** (separate service in same project, mount the same `/data` volume read-only).
  - **GitHub Actions** scheduled workflow that SSHes into Railway shell.
- [ ] Run a test restore: download a snapshot, decrypt with `age`, open with `sqlite3` and check `PRAGMA integrity_check;` returns `ok`.

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

## G. Observability (30 min, optional but recommended)

- [ ] Sentry account → create project for "weddly-backend" + "weddly-frontend".
- [ ] Set `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (rebuild required) in Railway. **VITE_** vars are baked at build time; you need a redeploy after setting them.
- [ ] Plausible account → add domain → set `VITE_PLAUSIBLE_DOMAIN` and rebuild.
- [ ] External uptime monitor pinging `/api/health` every 5 min — free options: BetterStack, Healthchecks.io, UptimeRobot.

## H. Soft launch (recommended before going public)

- [ ] Recruit 5–10 actually-engaged couples via friends-of-friends. Free for life as a thank-you.
- [ ] Watch their behavior in audit logs + ask weekly for friction points. Wedding-specific edge cases (divorced parents seated apart, late RSVPs, surprise dietary restrictions) only surface from real use.
- [ ] Fix everything that's friction; only then do public launch / paid acquisition.

---

## What NOT to do at launch

- Don't enable v2 marketplace endpoints — they don't exist yet.
- Don't ship Stripe — deferred to v2.
- Don't add Google Analytics or any analytics SDK that touches PII. Plausible only.
- Don't run the backup script on top of the live DB without `.backup` (a plain `cp` against a WAL'd DB will produce a corrupt copy).
- Don't bypass `--no-verify` to push past failing hooks. If a hook fails, fix it.
