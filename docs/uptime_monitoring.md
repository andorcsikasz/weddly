# Uptime monitoring

The app is a single Bun instance on Railway with SQLite, so there is no
redundant replica to fail over to (SQLite is single-writer; a second replica
would corrupt the volume, not add availability). Availability work therefore
concentrates on three layers:

## 1. In-process: graceful shutdown (shipped)

`backend/src/server.ts` installs SIGTERM/SIGINT handlers: the server stops
accepting new connections, drains in-flight requests (10s cap), checkpoints
SQLite via `db.close()`, then exits 0. Combined with `overlapSeconds: 20` in
`railway.json` (old + new container run side by side during a deploy), a
redeploy no longer drops requests.

## 2. Platform: Railway healthcheck + restart (already configured)

- `railway.json` -> `healthcheckPath: "/api/health"` (cheap DB liveness probe,
  `backend/src/routes/health.ts`). A deploy only goes live once it passes.
- `restartPolicyType: ON_FAILURE`, max 5 retries: a crashed process is
  restarted automatically.
- `GET /api/health/deep` reports per-component health (DB, Resend, disk,
  memory, uptime) for manual diagnosis. Deliberately NOT wired to Railway.

## 3. External: uptime monitor (operator setup)

A scheduled Claude routine pings `https://tryweddly.com/api/health` and digs
into Railway logs on failure (see the routine named `weddly-uptime`), but a
purpose-built external monitor has tighter resolution (1 min vs 30 min).
Recommended: **Better Stack** (free tier: 10 monitors, 3 min interval) or
**UptimeRobot** (free tier: 50 monitors, 5 min interval).

Setup (Better Stack):

1. Create an account at https://betterstack.com (uptime product).
2. New monitor -> type "HTTP", URL `https://tryweddly.com/api/health`,
   expected status 200. Check frequency: the lowest the plan allows.
3. Add a keyword check for `"ok"` in the body so a 200 from a broken edge
   proxy still alerts.
4. Alerting: email to hello@tryweddly.com at minimum; add SMS/phone
   escalation during wedding high season (March-September).
5. Optional second monitor on `https://tryweddly.com/` (SSR landing) to catch
   frontend-serving regressions the API probe misses.

Do NOT point the external monitor at `/api/health/deep`: it makes an outbound
Resend call per probe and would burn quota at 1-minute resolution.
