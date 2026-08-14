# Launch checklist — what only you can do

The automated code checks pass, but production launch is not complete until
the external-service, real-world testing, content, and legal boxes below are
closed. Group ordering reflects what blocks ship.

---

## A. Domain + hosting infra (1–2 hours, blocks email + production URL)

- [ ] Confirm control of the canonical `tryweddly.com` domain and its DNS. Keep
  retired/legacy domains redirecting permanently to this canonical host.
- [ ] Create Railway project; connect this repo; verify the Dockerfile build succeeds.
- [ ] **Mount a persistent volume at `/data`** in the Railway service settings. Without it every redeploy wipes the SQLite DB. This is the single most important infra step.
- [ ] In Railway service variables, set:
  - `JWT_SECRET` — `openssl rand -hex 48`
  - `FRONTEND_BASE_URL=https://tryweddly.com` (exact origin, no trailing slash)
  - `NODE_ENV=production`
  - `SERVE_FRONTEND=1`
  - `RESEND_API_KEY` — from Resend dashboard (after step B)
  - `EMAIL_FROM` — `Weddly <noreply@tryweddly.com>` (verified domain)
  - `SUPPORT_EMAIL` — a monitored mailbox on the verified sending domain
  - `ADMIN_EMAILS` — the explicit, reviewed administrator allowlist
  - `ADMIN_TOTP_SECRETS` — one unique 128-bit-or-stronger Base32 secret per admin
  - `DATA_ENCRYPTION_KEYS` — an independent, rotation-capable application-data keyring
  - every `OFFSITE_BACKUP_*` variable from section C.3
  Production boot deliberately fails if required security, email or admin
  configuration is absent or inconsistent. Off-site backup remains disabled
  when all of its variables are absent, and fails boot if configured only
  partially; complete section C.3 before launch.
- [ ] Add a custom domain in Railway → wait for HTTPS cert (auto Let's Encrypt).
- [ ] Smoke test the deploy: hit `https://tryweddly.com/api/health` → `{ "ok": true }`.

## B. Email deliverability (1 hour DNS + ~24h propagation)

- [ ] Sign up for Resend.
- [ ] Verify your sending domain in Resend dashboard.
- [ ] Add the **SPF, DKIM, and DMARC** DNS records Resend provides. Without these, invites and password-reset emails will land in spam.
  - DMARC starting policy: `v=DMARC1; p=none; rua=mailto:dmarc@tryweddly.com`
    (move to `quarantine` after 1–2 weeks of clean reports).
- [ ] Send a test email to gmail / outlook / proton / fastmail / iCloud. Check the spam folder on each. Verify the bilingual (HU + EN) layout reads cleanly.
- [ ] Add `RESEND_API_KEY` to Railway (step A).

## C. Backups (30 min, blocks GDPR readiness)

Use Railway native volume backups for fast recovery and a dedicated Cloudflare
R2 bucket for encrypted off-site copies. A Railway volume belongs to one
service, so do not try to mount the app volume into a separate cron service.

### C.1 Generate the off-site encryption key

```sh
openssl rand -hex 32
# Store as OFFSITE_BACKUP_ENCRYPTION_KEYS=v1:<64 hex characters>
```

- [ ] Store the key outside Railway, R2 and database backups. Losing it makes
  the off-site snapshots unusable.
- [ ] Add it to Railway only as a secret environment variable; never commit it.

### C.2 Cloudflare R2 setup (10 min)

- [ ] Create a Cloudflare account (free) → R2 dashboard → **Create bucket**, e.g. `weddly-backups`. Pick a region close to Railway (`eu` if Railway runs in EU).
- [ ] Manage R2 API Tokens → **Create API Token** → permissions "Object Read & Write" scoped to that bucket only. Copy the Access Key ID + Secret Access Key + S3 endpoint URL.
- [ ] In R2 → bucket → Settings → configure versioning/lifecycle protection and
  retain at least the documented RPO window (the app also keeps 90 newest by default).

### C.3 Railway app-service variables

- [ ] `OFFSITE_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- [ ] `OFFSITE_BACKUP_ACCESS_KEY_ID=...` (backup-bucket-only token)
- [ ] `OFFSITE_BACKUP_SECRET_ACCESS_KEY=...`
- [ ] `OFFSITE_BACKUP_BUCKET=weddly-backups`
- [ ] `OFFSITE_BACKUP_ENCRYPTION_KEYS=v1:<64 hex characters>`
- [ ] `OFFSITE_BACKUP_HEALTHCHECK_URL=https://hc-ping.com/<uuid>`
- [ ] `OFFSITE_BACKUP_INTERVAL_HOURS=24`
- [ ] `OFFSITE_BACKUP_RETENTION=90`

### C.4 Enable both backup layers

- [ ] Railway Volume → Backups: enable daily, weekly and monthly snapshots and
  record the retention shown by the dashboard.
- [ ] Confirm the application produces a
  `prod/weddly-<timestamp>.db.aes256gcm` object and a successful heartbeat.

### C.5 First-restore drill (mandatory — the only thing that proves backups work)

- [ ] Download the newest encrypted R2 object to an isolated machine.
- [ ] With the matching keyring from C.1:

  ```sh
  export OFFSITE_BACKUP_ENCRYPTION_KEYS='v1:<64 hex characters>'
  cd backend
  bun run scripts/decrypt-backup.ts \
      /path/to/weddly-20260813T030000Z.db.aes256gcm /tmp/restored.db
  sqlite3 /tmp/restored.db 'SELECT count(*) FROM users;'
  ```

- [ ] Confirm row counts roughly match production. If they don't, the chain is broken — fix it before launch.

## D. Legal review (1–2 weeks calendar time, blocks public launch)

- [ ] Hand the rendered `/privacy`, `/terms`, `/subscription-terms` and `/imprint`
  pages to Hungarian/EU counsel. EN/HU are the current canonical legal
  documents; do not target DE/ES/HR commercially until equivalent localized,
  counsel-approved documents are served there. The `legal/*.md` files point to
  the served documents and are not independent drafts.
- [ ] Record counsel-approved exact document versions and archive the rendered
  text accepted by each user and at each paid checkout.
- [ ] Implement and test exact-version, point-of-purchase terms acceptance for
  couple, planner and vendor recurring Checkout. Until then these products are
  code-gated as `PAID_CHECKOUT_TERMS_ACCEPTANCE` missing and cannot be launched.
- [x] Legal routes are linked from public and account surfaces.
- [x] Cookiebot is the sole CMP; optional analytics is category-gated and a
  permanent cookie-settings control permits withdrawal.
- [ ] Capture reject, accept-by-category and withdrawal network/storage evidence
  against the production deployment.

## E. Content / marketing (a couple of evenings)

- [ ] Have a native HU speaker review every string in `frontend/src/locales/hu.ts`. Auto-generated translations kill trust on weddings.
- [x] The 1200×1200 brand share image is `frontend/public/og.png`; static and
  server-rendered pages publish its absolute URL, dimensions and alt text.
- [x] `frontend/public/logo.png` is a 512×512 touch icon and is linked from
  `frontend/index.html`; PWA-specific sizes remain in the web manifest.
- [x] `/sitemap.xml` is generated by the backend from the canonical-host config,
  localized route table, published blog posts and eligible directory listings;
  there is intentionally no stale static sitemap to edit.
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
- [ ] Launch live products in this order: guest-page add-on and film first;
  couple, planner and vendor only after the recurring-checkout acceptance gate
  above is implemented. Use a real low-value transaction for each, refund it,
  and confirm the refund/webhook is recorded before launching the next product.
- [ ] Enable the global paid-access paywall only after couple, planner and
  vendor subscriptions have passed their live checkout + recovery drill.

## G. Observability (30 min, blocks public traffic)

- [ ] Sentry account → create project for "weddly-backend" + "weddly-frontend".
- [ ] Set `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (rebuild required) in Railway. **VITE_** vars are baked at build time; you need a redeploy after setting them.
- [ ] If analytics is enabled, add the canonical domain in Plausible and set
  `VITE_PLAUSIBLE_DOMAIN`; rebuild, verify consent gating, and keep it disclosed.
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
- Don't enable analytics that touches PII. Keep every non-essential provider
  behind Cookiebot consent and keep the privacy/cookie declarations current.
- Don't run the backup script on top of the live DB without `.backup` (a plain `cp` against a WAL'd DB will produce a corrupt copy).
- Don't bypass `--no-verify` to push past failing hooks. If a hook fails, fix it.
