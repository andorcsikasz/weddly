# Production database migration safety

Weddly uses one persistent SQLite database on Railway. A failed startup cannot
be hidden by a second replica because the volume is attached to one deployment
at a time. Database changes therefore use fail-closed release gates.

## Rules

1. Changes are additive. Never drop or rename a table or column.
2. New tables belong in `backend/src/schema.sql`.
3. A new column must appear both in the canonical `CREATE TABLE` and in an
   `addColumnIfMissing()` call in `backend/src/db.ts`.
4. Any index, backfill, or query using a new column must run in `db.ts` after
   that column's `addColumnIfMissing()` call. Do not put such an index in
   `schema.sql`: on an existing database, `CREATE TABLE IF NOT EXISTS` does not
   add the column before later schema statements run.
5. Migrations must be idempotent. Production may boot the same release more
   than once after a restart.

## Mandatory check

```bash
bun run check:migrations --base <production-or-base-commit>
```

The check creates a database from the base revision's schema, boots the current
`db.ts` over it twice, and verifies:

- both boots succeed;
- no existing table or column disappeared;
- every current canonical table, column, and index exists after migration;
- a sentinel row survives;
- SQLite integrity and foreign keys remain valid.

This is enforced in four places:

- GitHub Actions on every push and pull request;
- Railway `Wait for CI` on the production GitHub trigger;
- the pre-push hook, against the remote's current schema;
- `scripts/deploy.sh`, against both the target's parent and the currently
  running production revision.

Use `scripts/deploy.sh --check-only` to exercise every production gate without
uploading anything. Do not deploy with a raw `railway up`; it bypasses the local
production-revision comparison.

