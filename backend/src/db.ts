// SQLite + idempotent migrations. New tables go in schema.sql; new columns
// go through addColumnIfMissing(). Never DROP or RENAME — old servers still
// need to read the DB during a rolling deploy.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG } from "./config";

try {
  mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
  mkdirSync(CONFIG.uploadsDir, { recursive: true });
} catch (e) {
  console.error(
    `[db] FATAL: could not create data dirs (db=${CONFIG.dbPath} uploads=${CONFIG.uploadsDir}). ` +
      `On Railway, mount a volume at '/data' in the service settings.`,
    e,
  );
  process.exit(1);
}

export const db = new Database(CONFIG.dbPath, { create: true });
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const schemaPath = new URL("./schema.sql", import.meta.url);
const schema = await Bun.file(schemaPath).text();
db.exec(schema);

/** Idempotent ALTER TABLE: adds the column iff it's missing. The whole
 *  migration story for v1 — no migration files, no version table. */
export function addColumnIfMissing(table: string, column: string, ddl: string) {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// ── Future column additions land here. ──
addColumnIfMissing("couples", "bride_name", "bride_name TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("couples", "groom_name", "groom_name TEXT NOT NULL DEFAULT ''");

// Flexible "wedding goal" — couples often start before they have a fixed
// date / final guest count / locked budget. We keep the original columns
// (wedding_date, target_guest_count, budget_ceiling_huf) for back-compat and
// "exact" answers; the *_kind columns plus structured period / range fields
// hold the fuzzier shapes.
//
//   wedding_date_kind:      'exact' | 'month' | 'season' | 'year' | 'tbd'
//   wedding_target_year:    integer (e.g. 2027). Filled for month/season/year/exact.
//   wedding_target_month:   1..12. Filled when kind = 'month' or 'exact'.
//   wedding_target_season:  'spring' | 'summer' | 'fall' | 'winter'.
//                           Filled when kind = 'season'.
//   guest_count_kind:       'exact' | 'range' | 'tbd'
//   target_guest_count_min/max: range bounds when kind = 'range'.
//   budget_kind:            'exact' | 'range' | 'tbd'
//   budget_ceiling_min_huf/max_huf: range bounds when kind = 'range'.
addColumnIfMissing(
  "couples",
  "wedding_date_kind",
  "wedding_date_kind TEXT NOT NULL DEFAULT 'exact'",
);
addColumnIfMissing("couples", "wedding_target_year", "wedding_target_year INTEGER");
addColumnIfMissing("couples", "wedding_target_month", "wedding_target_month INTEGER");
addColumnIfMissing("couples", "wedding_target_season", "wedding_target_season TEXT");
addColumnIfMissing("couples", "guest_count_kind", "guest_count_kind TEXT NOT NULL DEFAULT 'exact'");
addColumnIfMissing("couples", "target_guest_count_min", "target_guest_count_min INTEGER");
addColumnIfMissing("couples", "target_guest_count_max", "target_guest_count_max INTEGER");
addColumnIfMissing("couples", "budget_kind", "budget_kind TEXT NOT NULL DEFAULT 'exact'");
addColumnIfMissing("couples", "budget_ceiling_min_huf", "budget_ceiling_min_huf INTEGER");
addColumnIfMissing("couples", "budget_ceiling_max_huf", "budget_ceiling_max_huf INTEGER");

// Real-world table dimensions in millimetres so the floor-plan map and PDF
// can render at exact size when the user knows their venue's table sizes.
addColumnIfMissing("seating_tables", "width_mm", "width_mm INTEGER NOT NULL DEFAULT 1500");
addColumnIfMissing("seating_tables", "length_mm", "length_mm INTEGER NOT NULL DEFAULT 1500");
// Rotation around the table centre, in degrees (0 = axis-aligned). Stored as
// 0..359; the editor cycles in 45° steps but any integer is accepted so the
// PDF layer can render at exact angle.
addColumnIfMissing("seating_tables", "rotation_deg", "rotation_deg INTEGER NOT NULL DEFAULT 0");
// JSON array of seat indices the couple X'd out in the editor preview.
// Stored as TEXT (JSON) so SQLite stays simple; mapper / writer parse + validate.
addColumnIfMissing(
  "seating_tables",
  "disabled_seats_json",
  "disabled_seats_json TEXT NOT NULL DEFAULT '[]'",
);
// JSON array of seat indices that need a baby high-chair. Same shape /
// invariants as disabled_seats_json; server enforces disjointness with it.
addColumnIfMissing(
  "seating_tables",
  "baby_seats_json",
  "baby_seats_json TEXT NOT NULL DEFAULT '[]'",
);

// Airport-style RSVP credentials. `couples.slug` is the public couple
// identifier ("ANDORSARI"); `guests.household_id` links each guest to its
// party. Backfill happens on first boot via init_households.ts.
addColumnIfMissing("couples", "slug", "slug TEXT");
addColumnIfMissing("guests", "household_id", "household_id INTEGER REFERENCES households(id)");

// Guest kind — drives the "needs a high chair" / "kid meal" affordances.
// 'adult' (default) | 'child' | 'baby'. Orthogonal to meal_choice.
addColumnIfMissing("guests", "kind", "kind TEXT NOT NULL DEFAULT 'adult'");

// "Invited?" check on the guest row. Nullable timestamp — null = not yet
// invited, non-null = ms since epoch when the couple marked them invited.
// Drives the per-guest checkbox + the x/n indicator on the household header.
addColumnIfMissing("guests", "invited_at", "invited_at INTEGER");

// "Invitation physically delivered?" — strictly stronger than invited_at.
// The 3-state chip on /app/guests cycles not-invited → invited → delivered.
// Nullable timestamp; non-null implies invited_at is also non-null.
addColumnIfMissing("guests", "invitation_delivered_at", "invitation_delivered_at INTEGER");

// Planning items: tasks carry an optional free-text `assignee` (e.g. "Anna",
// "Apa", "Tanú1"). Ideas carry `suggested_by_user_id` — stamped at create time
// from the current session — so the UI can render "— Anna javasolta". Both
// columns are nullable so old rows + non-applicable kinds stay clean.
addColumnIfMissing("planning_items", "assignee", "assignee TEXT");
addColumnIfMissing(
  "planning_items",
  "suggested_by_user_id",
  "suggested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
);

// Global slug uniqueness — couples.slug paired with the 4-digit household
// code is the public RSVP credential, so two weddings must never share a
// slug. Application code (uniqueCoupleSlug + PATCH /api/couples/slug)
// already enforces this on write, but a unique index is the belt
// alongside the suspenders.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_couples_slug_unique ON couples(slug)");

// Optional street address on community-submitted suppliers, surfaced on the
// directory card. Curated entries set it inline in suppliers_data.ts.
addColumnIfMissing("community_suppliers", "address", "address TEXT");

// Round-2 additions ───────────────────────────────────────────────────────
//
// Archive history + previous-date trail. `couples.previous_wedding_date`
// remembers the prior YYYY-MM-DD when the couple edits the wedding date so
// the date-changed notification has a "from" value. `couples.archived_at`
// stamps the moment a workspace was put in the read-only `archived` status
// — orthogonal to `status` so the column ladder stays additive.
addColumnIfMissing("couples", "previous_wedding_date", "previous_wedding_date TEXT");
addColumnIfMissing("couples", "archived_at", "archived_at INTEGER");
// `ceremony_kind`: 'civil' | 'religious' | 'both' | NULL — drives copy on
// the dashboard and (later) the budget/timeline suggestions. NULL means the
// couple hasn't decided yet.
addColumnIfMissing("couples", "ceremony_kind", "ceremony_kind TEXT");

// Optimistic-concurrency timestamps. `budget_lines.updated_at` was always
// in the create-table DDL, but `seating_tables.updated_at` we add defensively
// in case an old DB predates the column. Both routes now honour `If-Match`.
addColumnIfMissing("seating_tables", "updated_at", "updated_at INTEGER NOT NULL DEFAULT 0");

// Kids-table flag. Drives the on-screen badge today; future "auto-place
// children together" logic will read it. Boolean stored as 0/1.
addColumnIfMissing("seating_tables", "is_kids_table", "is_kids_table INTEGER NOT NULL DEFAULT 0");

// Free-text address / Google Maps URL on the public vendor waitlist form.
// Helps the team triage by region before we open onboarding.
addColumnIfMissing("vendor_waitlist", "location", "location TEXT");

// `couple_supplier_id` back-reference on auto-synced budget lines. When a
// DIY supplier entry on /app/suppliers has a price, the backend creates a
// matching `budget_lines` row stamped with this id. The frontend renders
// those rows as read-only (price is owned by the supplier card) and the
// supplier's update / delete flow keeps them in sync.
addColumnIfMissing("budget_lines", "couple_supplier_id", "couple_supplier_id TEXT");

// Per-couple supplier votes — see schema.sql. The legacy `(user_id, supplier_id)`
// keying let both partners stack two votes on a self-submitted supplier, which
// brigaded the directory's default sort. Backfill `couple_id` from the voter's
// user record so existing votes get correctly scoped before the new partial
// unique index activates.
addColumnIfMissing("supplier_votes", "couple_id", "couple_id INTEGER");
db.exec(`
  UPDATE supplier_votes
     SET couple_id = (SELECT couple_id FROM users WHERE users.id = supplier_votes.user_id)
   WHERE couple_id IS NULL
`);
// Dedupe before the new unique index. Under the old (user_id, supplier_id)
// keying both partners on one couple could each vote on the same supplier;
// once couple_id is backfilled those rows collide on (couple_id, supplier_id)
// and a naive CREATE UNIQUE INDEX would fail with "UNIQUE constraint failed".
// Keep the latest cast vote (highest id) — it best reflects current intent.
db.exec(`
  DELETE FROM supplier_votes
   WHERE couple_id IS NOT NULL
     AND id NOT IN (
       SELECT MAX(id) FROM supplier_votes
        WHERE couple_id IS NOT NULL
        GROUP BY couple_id, supplier_id
     )
`);
// Partial unique index on the just-backfilled column. Lives in db.ts (not
// schema.sql) because schema.sql executes BEFORE addColumnIfMissing, and on
// existing prod DBs where supplier_votes pre-dates the column,
// `CREATE TABLE IF NOT EXISTS` is a no-op so the column wouldn't yet exist
// when the index DDL fires — the resulting `no such column: couple_id` error
// crashed the container on boot and failed Railway's healthcheck.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_votes_couple_supplier_unique " +
    "ON supplier_votes(couple_id, supplier_id) WHERE couple_id IS NOT NULL",
);

// Honeymoon trip details — surfaced on /app/honeymoon as the "Days / Where"
// header. Stored as plain TEXT so we can defer date validation to the route
// handler; nights are computed client-side from the YYYY-MM-DD pair.
addColumnIfMissing("couples", "honeymoon_destination", "honeymoon_destination TEXT");
addColumnIfMissing("couples", "honeymoon_start_date", "honeymoon_start_date TEXT");
addColumnIfMissing("couples", "honeymoon_end_date", "honeymoon_end_date TEXT");

// Cost-planning scenario count — shared between partners across all devices.
// Distinct from `target_guest_count` (the onboarding goal): this is the
// "what if we go to 130?" slider on /app/budget. NULL = the couple hasn't
// touched the slider; the frontend then falls back to target_guest_count.
addColumnIfMissing("couples", "planning_count", "planning_count INTEGER");

export function now(): number {
  return Date.now();
}
