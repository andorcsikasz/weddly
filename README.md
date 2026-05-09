# weddly

Self-serve wedding-organising platform for engaged couples. Plan → search → book → guests → aftermath, all in one place.

**Status:** v1 in development. See [BLUEPRINT.md](./BLUEPRINT.md) for the product spec and [CLAUDE.md](./CLAUDE.md) for engineering conventions.

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
| `bun run test` | E2E suite |
| `bun run lint:fix` | Biome format + lint, autofix |
| `bun run build` | Vite build to `frontend/dist` |
| `bun run start` | Production: backend serves API + built SPA |

## Layout

```
backend/    Bun + custom router + SQLite
frontend/   Vite + React + Tailwind
shared/     Single types contract (DTOs, enums)
.githooks/  pre-commit (Biome on staged) + pre-push (full gate)
```

## Conventions

- Money is integer Forint (HUF has no sub-unit). Never floats.
- Schema is additive-only — `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing()`. Never drop or rename.
- One API client (`frontend/src/lib/endpoints.ts`). Components never call `fetch` directly.
- One types contract (`shared/types.ts`). Both sides import from `@shared/*`.
- HU is the default locale; EN is secondary. Strings live in `frontend/src/locales/{hu,en}.ts`.
- Pre-commit gates Biome; pre-push runs the full E2E + typecheck on a `git archive` snapshot of HEAD. Never `git stash`. Never `--no-verify`.
