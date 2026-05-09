# CLAUDE.md — Engineering conventions for Weddly

This file tells Claude Code how to work in this repo. The product spec is in [BLUEPRINT.md](./BLUEPRINT.md).

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
  → routes/ (thin) → lib/ (thick)
  → bun:sqlite (data/weddly.db locally, /data/weddly.db in prod)
```

- **One file per feature in `backend/src/routes/`.** Each exports `registerXRoutes(router)`. Adding a feature = new file + one register call in `server.ts`.
- **Cross-cutting in `backend/src/lib/`.** Mappers (`toCouple`, `toGuest`), helpers (`computeBudget`, `addAuditLog`), notifications.
- **One types contract.** `shared/types.ts` is imported by both sides via `@shared/*`. Backend mappers convert `*Row` → DTO. No runtime validation library — TypeScript is the contract.
- **One API client.** `frontend/src/lib/endpoints.ts` wraps every HTTP call (`coupleApi.create()`, `guestApi.list()`). Components never `fetch` directly.

## Domain model

See [BLUEPRINT.md](./BLUEPRINT.md#domain-primitives-v1) for the full table list. Highlights:

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

## i18n

- HU is default; EN is secondary. Detection: `localStorage["weddly.locale"]` → `navigator.language` → `"hu"`.
- All literals go through `t("path.key")`. No inline strings.
- Currency is always HUF via `Intl.NumberFormat("hu-HU", { style: "currency", currency: "HUF", maximumFractionDigits: 0 })`.
- Drift detection (`warnDrift()`) on init `console.warn`s missing keys.

## Print export

PDF formats supported in v1: **A4** (seating chart), **A6** (place cards), **A3** (large seating chart). The seating data model must encode positions in millimetres so PDFs render at exact size.

## Deployment

- Single Bun service on Railway. Multi-stage Dockerfile (Bun builder → slim runtime). `WORKDIR /app/backend`. `CMD bun src/server.ts`.
- `/data` persistent volume holds SQLite + uploads. Without it, redeploy = data loss.
- `VITE_*` env vars are baked at build time. Changing them requires a rebuild.
- Required prod env: `JWT_SECRET`, `FRONTEND_BASE_URL`. Required for email: `RESEND_API_KEY`, `EMAIL_FROM`. Stripe deferred to v2.

## What NOT to do

- Don't add a UI library (Radix, MUI, shadcn). The design system is hand-rolled.
- Don't add Redux / Zustand. Provider stack + `localStorage` is enough.
- Don't add react-query. The single API client + React state is enough.
- Don't add Zod / io-ts. TS is the contract; hand-write boundary guards.
- Don't store per-user locale in the DB. Bilingual emails (HU hero + compact EN block) are the safer fallback.
- Don't introduce a frontend SSG framework. SPA + SSR meta injection on public routes is enough (see simpleraz seo_ssr.ts pattern when phase 2 lands).
