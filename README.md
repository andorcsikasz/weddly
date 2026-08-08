# weddly

Self-serve wedding-organising platform for engaged couples. Plan → search → book → guests → aftermath, all in one place.

**Status:** v1 in development. See [docs/blueprint.md](./docs/blueprint.md) for the product spec and [CLAUDE.md](./CLAUDE.md) for engineering conventions.

## Quick start

```bash
bun install
cp .env.example .env
bun run setup:hooks   # one-time per clone
bun run dev           # backend on :8787, frontend on :5173
```

## Stack

- **Backend:** Bun 1.3.x, custom router, `bun:sqlite`, Argon2id, HMAC-signed sessions
- **Frontend:** Vite, React 19, React Router 6, Tailwind 3, lucide-react
- **Tests:** `bun:test` (single E2E suite)
- **Lint/format:** Biome
- **Deploy:** Railway, single-image Dockerfile, `/data` volume

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Backend + frontend in watch mode |
| `bun run typecheck` | Both `tsc --noEmit` runs |
| `bun run check:migrations` | Boot current DB migrations twice over the previous schema |
| `bun run test` | E2E suite |
| `bun run lint:fix` | Biome format + lint, autofix |
| `bun run build` | Vite build to `frontend/dist` |
| `bun run start` | Production: backend serves API + built SPA |

## Layout

```
backend/
  src/
    auth/       session + password helpers
    routes/     one file per feature; each exports registerXRoutes(router)
    lib/        infra — http, logger, mailer, observability, audit, csv, rate_limit
    domain/     wedding-specific — couples, guests, invite_codes, pdf, purge, suppliers_data, users
    config.ts, db.ts, schema.sql, server.ts
  tests/        single E2E suite
frontend/
  src/
    pages/      route components
    components/ shared UI primitives + ErrorBoundary
    lib/        auth, i18n, single API client (endpoints.ts)
    locales/    hu.ts (default) + en.ts + keys.ts (type)
shared/         types contract — types.ts (main) + per-domain modules (suppliers.ts)
scripts/        backup.sh, restore.sh
docs/           blueprint.md, launch-checklist.md, uptime.md
legal/          policy templates
.githooks/      pre-commit (Biome on staged) + pre-push (full gate)
```

## Conventions

- Money is integer Forint (HUF has no sub-unit). Never floats.
- Schema is additive-only — `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing()`. Never drop or rename. Follow [the production migration rules](./docs/database-migrations.md).
- One API client (`frontend/src/lib/endpoints.ts`). Components never call `fetch` directly.
- Types live in `shared/`. Default to `shared/types.ts`; split into a per-domain file (e.g. `shared/suppliers.ts`) only when the cluster is large enough to be its own concern. Both sides import via `@shared/*`.
- HU is the default locale; EN is secondary. Strings live in `frontend/src/locales/{hu,en}.ts`.
- Pre-commit gates Biome; pre-push runs the full E2E + typecheck on a `git archive` snapshot of HEAD. Never `git stash`. Never `--no-verify`.
