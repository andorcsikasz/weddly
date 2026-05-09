# Uptime monitoring runbook

External pings of `/api/health` so a 3am 503 pages someone instead of waiting
for a user complaint. Two free services cover the two failure modes you care
about:

- **UptimeRobot** — pulls `/api/health` every 5 min. Catches "the service is
  down or returning bad responses".
- **Healthchecks.io** — the backup cron pings *it*. Catches "the cron didn't
  even fire" — the most dangerous backup failure mode.

Both have free tiers that are sufficient. Total setup is ~15 minutes.

> The shallow `/api/health` endpoint is intentionally cheap and DB-only so
> Railway's container healthcheck doesn't flap on transient upstream issues.
> The deeper `/api/health/deep` endpoint (DB + Resend + disk write) is what
> external monitors should hit if you want richer signal — see the second
> UptimeRobot monitor below.

---

## 1. UptimeRobot — primary uptime alerts

Free tier: 50 monitors, 5-min interval, email + webhook alerts, public status
pages. <https://uptimerobot.com>

### Monitor 1 — shallow health (required)

- Type: **HTTP(s)**
- URL: `https://<your-prod-domain>/api/health`
- Friendly name: `weddly-prod-health`
- Interval: **5 minutes**
- Keyword (Advanced → Keyword Monitoring):
  - Mode: `exists`
  - Keyword: `"ok":true`
  - This matches the JSON response shape — see `backend/src/routes/health.ts`.
- Alert contacts: at least one email; ideally also a Slack/Discord webhook.
- Timeout: 30 seconds (matches Railway's `healthcheckTimeout`).

### Monitor 2 — deep health (recommended)

Same as monitor 1, but:

- URL: `https://<your-prod-domain>/api/health/deep`
- Friendly name: `weddly-prod-health-deep`
- Interval: **15 minutes** (slower so transient Resend blips don't page you)
- Keyword: `"ok":true` (same shape, status field also `ok` when all components healthy)

### Alert contacts

Configure under My Settings → Alert Contacts before adding monitors:

- Primary: your email.
- Secondary (recommended): a Slack/Discord/PagerDuty webhook so a 3am page
  reaches you on your phone.

### Public status page (optional)

Status Pages → Add New. Pick the two monitors. Free tier supports custom
slug. Couples get a transparency page; you get free PR if you stay up.

---

## 2. Healthchecks.io — backup cron heartbeat

Free tier: 20 cron-style "push" checks. <https://healthchecks.io>

The backup cron pings Healthchecks.io on success / failure. If it doesn't ping
within the grace window, Healthchecks pages you. This catches "the cron was
never scheduled" and "the cron container won't even start" — UptimeRobot
can't see those.

### Setup

1. Create an account, then **Add Check**:
   - Name: `weddly-nightly-backup`
   - Schedule: `Cron`, expression `0 3 * * *` (03:00 UTC daily — adjust to taste)
   - Grace time: **1 hour** (allows for slow R2 uploads)
2. Copy the unique **Ping URL** (looks like `https://hc-ping.com/<uuid>`).
3. In Railway, set the env var on the **backup** service (not the app service):
   - `HEALTHCHECK_URL` = the ping URL.
4. The backup script (`scripts/backup.sh`) wraps itself with this — see the
   start/success/fail conventions documented at <https://healthchecks.io/docs/>.

### Verifying it works

After the first scheduled run, the Healthchecks dashboard should show a
green checkmark and "last ping: <minutes> ago". Trigger a manual fail by
running `scripts/backup.sh` locally with an invalid `S3_BUCKET` to confirm
the failure ping is sent.

---

## 3. Better Stack (Better Uptime) — fallback

Free tier: 10 monitors, 3-min interval. <https://betterstack.com/better-uptime>

Use this only if UptimeRobot proves unreliable for you. The setup mirrors
UptimeRobot — HTTP(s) monitor on `/api/health`, keyword `"ok":true`. Better
Stack has nicer incident management and Slack integration on the free tier.
We don't run it by default because UptimeRobot's 50-monitor cap leaves
plenty of headroom for free.

---

## 4. Required-actions checklist

Once-per-environment setup. Tick as you go.

- [ ] UptimeRobot account created.
- [ ] Email alert contact configured.
- [ ] (Optional) Slack/Discord webhook alert contact configured.
- [ ] Monitor `weddly-prod-health` added (URL + keyword).
- [ ] Monitor `weddly-prod-health-deep` added (URL + keyword).
- [ ] (Optional) Public status page published.
- [ ] Healthchecks.io account created.
- [ ] Check `weddly-nightly-backup` added with grace 1h.
- [ ] `HEALTHCHECK_URL` set on the Railway backup service.
- [ ] **Drill:** stop the production service for ~6 minutes and confirm
      UptimeRobot pages you. Restart, confirm recovery.
- [ ] **Drill:** trigger a backup failure (bad S3 creds) and confirm
      Healthchecks pages you.

The drills are the only step that matters — an unverified pager is no pager.
