# CLAUDE.md — Engineering conventions for Weddly

This file tells Claude Code how to work in this repo. The product spec is in [docs/blueprint.md](./docs/blueprint.md).

## Commands

```bash
bun install           # install workspace deps
bun run dev           # backend + frontend in watch mode
bun run dev:backend   # just the API
bun run dev:frontend  # just Vite
bun run typecheck     # both tsc passes
bun run test          # E2E suite
bun run lint:fix      # Biome format + autofix
bun run build         # Vite build to frontend/dist
bun run setup:hooks   # one-time per clone — installs git hooks
```

## Architecture

```
React (frontend/src)
  → endpoints.ts (single typed API client)
  → fetch JSON
  → Bun + custom router (backend/src)
  → routes/ (thin) → domain/ (thick) using lib/ (infra)
  → bun:sqlite (data/weddly.db locally, /data/weddly.db in prod)
```

- **One file per feature in `backend/src/routes/`.** Each exports `registerXRoutes(router)`. Adding a feature = new file + one register call in `server.ts`.
- **Wedding-domain logic in `backend/src/domain/`.** Mappers (`toCouple`, `toGuest`), per-aggregate helpers (`getCoupleForUser`, `purgeOneCouple`, `renderSeatingChartPdf`), invite codes, supplier directory data.
- **Generic infra in `backend/src/lib/`.** App-agnostic plumbing: `http` (router/Ctx/HttpError), `logger`, `observability` (Sentry), `mailer`, `audit`, `csv`, `rate_limit`. Domain code imports from `lib/`; `lib/` never imports from `domain/`.
- **Types contract in `shared/`.** `shared/types.ts` is the default; split into a per-domain module (e.g. `shared/suppliers.ts`) only when the cluster is large enough to stand alone. Both sides import via `@shared/*`. Backend mappers convert `*Row` → DTO. No runtime validation library — TypeScript is the contract.
- **One API client.** `frontend/src/lib/endpoints.ts` wraps every HTTP call (`coupleApi.create()`, `guestApi.list()`). Components never `fetch` directly.

## Domain model

See [docs/blueprint.md](./docs/blueprint.md#domain-primitives-v1) for the full table list. Highlights:

- **`couples`** is the workspace. Every protected query is scoped by `couple_id` derived from the session.
- **Money is integer Forint.** No floats. `formatHuf(cents)` for display.
- **Audit log is append-only.** Never UPDATE or DELETE rows in `audit_log`.
- **Schema is additive only.** New columns via `addColumnIfMissing(table, column, ddl)` in `db.ts`.

## Auth

- Argon2id via `Bun.password.hash` / `verify`.
- Sessions are opaque random ids + HMAC-SHA256 sigs stored in the `sessions` table — **no JWT**. Format: `Authorization: Bearer {id}.{sig}`.
- `users.status = "active" | "suspended"` is checked on every token verify so suspensions take immediate effect.
- Production refuses to boot without a strong `JWT_SECRET`.

## Adding a feature

1. **DB change?** Edit `backend/src/schema.sql` for new tables; add `addColumnIfMissing()` calls in `db.ts` for new columns. Never drop or rename.
2. **API endpoint?** Add a procedure in the matching `backend/src/routes/<feature>.ts`. Use `requireAuth(ctx)` for couple-scoped endpoints. Validate input by hand (no Zod). Return `json(toX(row))`.
3. **Shared type?** Add to `shared/types.ts` first. Both sides will pick it up.
4. **Frontend route?** Add a page in `frontend/src/pages/<feature>/` and a route in `App.tsx`. Wrap protected pages in `<RequireAuth>`. Call the API through `lib/endpoints.ts`.
5. **i18n?** Add keys to `frontend/src/locales/hu.ts` AND `frontend/src/locales/en.ts`. `warnDrift()` flags missing pairs in the console.
6. **Test?** Major-change rule: every new endpoint / schema change / money flow / state machine / auth change ships with E2E coverage in the same commit.

## Code quality

- TypeScript `strict: true` + `noUncheckedIndexedAccess`.
- Biome handles format + lint. Pre-commit runs it on staged files; pre-push runs the full gate against a `git archive` snapshot of HEAD.
- **Never `git stash` or `--no-verify`.** Stash races with concurrent editors; `--no-verify` ships broken code.
- No raw hex colors in components — every value comes from `tailwind.config.js` tokens.
- No `window.confirm` / `alert()` — use the portal-mounted `<ConfirmDialog>` and `useToast()`.

## Testing

- **Every test file MUST start with `import "./setup"` (or `"../setup"`, `"../../setup"` depending on depth).** `backend/tests/setup.ts` boots the server and pins the test environment; skipping it means the test fetches against either nothing or, worse, the dev server.
- **`bun test` autoloads `backend/.env` BEFORE `setup.ts` runs.** This is the trap that masked tests-against-the-dev-DB for three days in May 2026. The fix: `setup.ts` uses unconditional `process.env.X = "..."` assignments rather than `??` fallbacks — every dev value that could leak (PORT, DB_PATH, UPLOADS_DIR, RESEND_API_KEY, SENTRY_DSN, AMADEUS_*, SERVE_FRONTEND, EMAIL_FROM, JWT_SECRET, ADMIN_EMAILS, GOOGLE_CLIENT_ID, GOOGLE_TEST_BYPASS, FRONTEND_BASE_URL) gets pinned. If you add a new env var to `config.ts`, pin its test value in `setup.ts` too.
- **Worktree-parallel testing escape hatches: `BUN_TEST_PORT` and `BUN_TEST_DB_PATH`** — set those on the `bun test` invocation to run two checkouts side by side. Plain `PORT`/`DB_PATH` env vars deliberately DON'T win (that's the regression guard from the May 2026 leak).
- **Test DB lives at `./data/test-weddly.db`** and gets `rmSync`'d on every bun-test start. The dev DB at `./data/weddly.db` must never be touched by the suite.
- **Backend test suite:** mostly under `backend/tests/api/<feature>.e2e.test.ts` (per-domain files). The legacy monolithic `backend/tests/e2e.test.ts` is gradually being split into the same per-domain shape — when adding new tests, put them in the per-domain file, not the monolith.
- **Frontend tests run under happy-dom.** Two known limitations: `https://accounts.google.com/gsi/client` script loads are blocked (no impact on test outcome, just noisy logs) and `blob:` URL fetches throw `NotSupportedError`. For HU-locale tests, call `_preloadHuForTests()` in `beforeAll` — the HU translations tree is dynamically imported in production, so synchronous queries against HU labels need the preload.
- **Major-change rule:** every new endpoint / schema change / money flow / state machine / auth change ships with E2E coverage in the same commit.

## Milestone workflow (auto-commit rule)

When a self-contained feature, bug fix, or logical change is complete, follow this sequence before moving on — do not wait for the user to ask:

1. **Run E2E tests** for the affected flow (`bun run test`, or exercise the feature end-to-end if no test covers it).
2. **Fix any issues** the E2E surfaces, then re-run until it passes.
3. **Auto-commit** the milestone with a descriptive message. Push only when the user asks.

A "milestone" is a logical unit of work (Claude's judgment call), not every edited file or every TodoWrite item. Group related changes into one commit. Skip the auto-commit if the change is purely exploratory/WIP and the user has signalled they're still iterating.

## i18n

- **EN is the default for non-HU clients.** Frontend detection: `localStorage["weddly.locale"]` → host match against `VITE_EN_CANONICAL_HOST` → `navigator.language` starts with "hu" → HU; else EN. SSR detection: backend reads the request `Accept-Language` header, branches HU vs EN per first preference, and serves the matching pre-rendered HTML body (`index.html` vs `index.en.html`) — Googlebot (which sends `en-US`) indexes the EN landing.
- All literals go through `t("path.key")`. No inline strings.
- **Currency follows the user's locale at couple creation** — HU users get HUF, EN users get EUR (overridable in onboarding and via PATCH `/api/couples/current`). Format display amounts with `Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", { style: "currency", currency: couple.currency, maximumFractionDigits: 0 })`.
- Drift detection (`warnDrift()`) on init `console.warn`s missing keys.

## Print export

PDF formats supported in v1: **A4** (seating chart), **A6** (place cards), **A3** (large seating chart). The seating data model must encode positions in millimetres so PDFs render at exact size.

## Deployment

- Single Bun service on Railway. Multi-stage Dockerfile (Bun builder → slim runtime). `WORKDIR /app/backend`. `CMD bun src/server.ts`.
- `/data` persistent volume holds SQLite + uploads. Without it, redeploy = data loss (unless R2 is on for uploads + backups — see below).
- **Object storage (Cloudflare R2):** uploads + DB backups can live in R2 instead of the `/data` volume. `backend/src/lib/storage.ts` is a Disk|R2 abstraction keyed by the existing relative upload path (`couples/3/photos/5/5.jpg`), so every public `/uploads/<key>` URL and DB-stored value is identical across backends. R2 is selected only when ALL of `R2_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` are set; otherwise the local-disk fallback runs with zero behaviour change (same "configured?" gate as Stripe — see `R2_ENABLED`). R2 objects are streamed through the app at `/uploads/*` so auth/cache semantics match disk. `domain/backup.ts` (`startBackupWorker`) snapshots SQLite via `VACUUM INTO` and uploads to `backups/` every `R2_BACKUP_INTERVAL_HOURS` (default 24, 0 disables), keeping `R2_BACKUP_RETENTION` (default 14) newest; optional `R2_BACKUP_BUCKET` overrides the bucket. Operator setup (enable R2, create bucket, Railway env): [docs/r2_setup.md](./docs/r2_setup.md). When adding a new R2 env var, pin its test value in `backend/tests/setup.ts` too.
- `VITE_*` env vars are baked at build time. Changing them requires a rebuild.
- Required prod env: `JWT_SECRET`, `FRONTEND_BASE_URL`. Required for email: `RESEND_API_KEY`, `EMAIL_FROM`.
- Billing (Stripe subscriptions, live): set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_EUR`, `STRIPE_PRICE_HUF`. When `STRIPE_SECRET_KEY` is unset billing is disabled (checkout/portal 503, app runs in trial mode), so it never blocks boot. Run `bun backend/scripts/stripe_setup.ts` once (test mode first) to create the Product + Prices and print the price ids. Webhook endpoint: `POST {FRONTEND_BASE_URL}/api/billing/webhook` for `checkout.session.completed` + `customer.subscription.created/updated/deleted`. Plan price lives in `shared/billing.ts` (`MONTHLY_PRICE`) — keep it in sync with the Stripe Prices.

## Billing / subscriptions

- State machine on `couples` (`shared/billing.ts`): `trialing` (14-day in-app trial, set at onboarding) → `founding` → `active`/`past_due`/`canceled` (driven by the Stripe webhook). Entitlement (edit access) is COMPUTED from status + timestamps in `toCoupleBilling`, never stored — a lapsed couple goes read-only at read-time.
- **Founding (free) goes to the first `FOUNDING_CAP`=200 couples to get BOTH partners in — counted by partner-join, not couple-creation order.** A fresh couple has only partner A, so `initBillingAtOnboarding` (at couple creation in `routes/couples.ts`) always starts the 14-day trial. When partner B joins, `activatePartnerFreeWindow` grants the founding plan (`subscription_status='founding'`, `is_founding_member=1`, `founding_until = partnerFreeWindowEnd(wedding)` — free until the wedding day) **only while founding slots remain**. Eligibility is `foundingSlotsUsed() < FOUNDING_CAP`, where `foundingSlotsUsed` counts granted badges (`is_founding_member=1`, demo + admin-comp `badge=0` excluded) — a slot is spent permanently, so an expired window never frees one. Once the cohort is full, partner-join is a no-op and the couple stays on its trial → paid path. `founding_spots_left` (billing status + admin planner) = `CAP − foundingSlotsUsed()`; `refreshPartnerFreeWindow` re-pins the cohort's window when the wedding date moves. A one-time boot grandfather (`db.ts`) comps every pre-launch couple. Covered by `backend/tests/api/billing.e2e.test.ts`.
- **Never reuse `couples.status` for billing** — that column drives the pause-to-DELETE countdown. A lapsed couple keeps `status='active'` and just loses edit entitlement (data preserved).
- Read-only enforcement is central: `entitlementBlock()` in the `server.ts` request pipeline returns 402 for mutating requests to the workspace edit surfaces (`EDIT_PREFIXES` in `domain/billing.ts`) once a couple lapses. Reads, exports, and recovery flows stay open. Demo couples are always entitled.
- Payment UI is 100% Stripe-hosted (Checkout + Billing Portal) — no card fields in-app, no `@stripe/*` frontend deps.
- **Planner subscriptions** are a parallel system for `user_type='planner'` (a separate aggregate, mirrors vendor billing on the shared `computeEntitlement`). Tiers `starter`/`pro`/`premium` are ALL paid, priced per tier per currency in `shared/planner_billing.ts` (`PLANNER_TIER_PRICE`: EUR 19/29/49, HUF 6900/11900/19900). State lives in `planner_subscriptions` (keyed by user_id); the tier itself stays on `users.planner_plan` (single source of truth, kept in lockstep with `planner_max_clients` by `updatePlannerPlan` — the webhook calls it). First `PLANNER_FOUNDING_CAP`=25 planners get 24 months free (`is_founding_member=1`), granted at `grantPlannerAccount`; everyone after gets a 3-day trial; lapse → hard read-only via `plannerEntitlementBlock` (402, in the `server.ts` chain). Separate webhook endpoint `POST {FRONTEND_BASE_URL}/api/planner/billing/webhook` with its OWN secret `STRIPE_PLANNER_WEBHOOK_SECRET`. Go-live: run `bun backend/scripts/stripe_setup_planner.ts` (test first) to mint 6 prices, set `STRIPE_PRICE_PLANNER_{STARTER,PRO,PREMIUM}_{EUR,HUF}` + the planner webhook secret in Railway. Covered by `backend/tests/api/planner_subscription.e2e.test.ts`. (Note: `backend/tests/api/planner_billing.e2e.test.ts` is the DIFFERENT couple-side "planner-managed + guest-page add-on" suite.)

## What NOT to do

- Don't add a UI library (Radix, MUI, shadcn). The design system is hand-rolled.
- Don't add Redux / Zustand. Provider stack + `localStorage` is enough.
- Don't add react-query. The single API client + React state is enough.
- Don't add Zod / io-ts. TS is the contract; hand-write boundary guards.
- `users.locale` is captured at signup (post-international-expansion) — surfaced on `/api/auth/me` and used by the frontend to override navigator.language detection on fresh devices. The local locale switcher still wins on the device where the user flipped it. Outbound email is still bilingual (HU hero + compact EN block); the per-locale email rewrite is a separate follow-up.
- Don't introduce a frontend SSG framework. SPA + SSR meta injection on public routes is enough (see simpleraz seo_ssr.ts pattern when phase 2 lands).
