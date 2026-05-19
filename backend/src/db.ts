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

// Gantt-range support on planning tasks. `start_date` pairs with the existing
// `due_date` (= "task ends here") to form a date range; `supplier_id` is a
// free reference to `couple_picks.supplier_id` (curated slug / "c{N}" /
// DIY hex). We deliberately do NOT enforce a FK — picks have no PK on
// supplier_id alone, and a task may outlive a supplier un-pick.
addColumnIfMissing("planning_items", "start_date", "start_date TEXT");
addColumnIfMissing("planning_items", "supplier_id", "supplier_id TEXT");
// SOS / important flag on tasks. 0 = no flag, 1 = "!" (important), 2 = "!!"
// (SOS). NOT NULL with default 0 so existing rows pre-fill without needing
// a migration sweep, and validation can treat it as a plain number.
addColumnIfMissing("planning_items", "priority", "priority INTEGER NOT NULL DEFAULT 0");
// Sub-topic the task / idea belongs to. Currently "wedding" or "honeymoon" —
// drives which planning surface surfaces it. NULL is treated as "wedding" by
// existing readers so back-fill isn't required. Wand items stamped at create
// time; manual entries default to NULL (wedding-scoped on the planning page).
addColumnIfMissing("planning_items", "topic", "topic TEXT");
// The honeymoon page filters tasks by (couple_id, kind='task', topic='honeymoon');
// the composite index lets that query short-circuit instead of scanning the
// per-couple slice and filtering in memory.
db.exec("CREATE INDEX IF NOT EXISTS idx_planning_topic ON planning_items(couple_id, kind, topic)");

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

// CRM-style triage detail on the admin vendor-waitlist queue. The `status`
// column already carries the outcome bucket; these four columns add the
// "what did we actually do?" context — when the entry left the inbox
// (`outcome_at`), the admin's private notes, and the exact subject/body of
// the last template email we sent the supplier. All nullable so existing
// rows stay valid.
addColumnIfMissing("vendor_waitlist", "outcome_at", "outcome_at INTEGER");
addColumnIfMissing("vendor_waitlist", "notes", "notes TEXT");
addColumnIfMissing("vendor_waitlist", "sent_subject", "sent_subject TEXT");
addColumnIfMissing("vendor_waitlist", "sent_body", "sent_body TEXT");

// Optional website on the public vendor waitlist form. Vendors paste their
// portfolio / Instagram / business homepage so the admin can vet without
// having to google the name.
addColumnIfMissing("vendor_waitlist", "website", "website TEXT");

// Structured portfolio submission on the public vendor waitlist form.
// `portfolio_links` holds a JSON-encoded array (max 6) of validated URLs the
// vendor pastes — Pixieset galleries, Vimeo reels, Instagram posts, Drive
// folders, etc. Stored as TEXT (JSON) rather than a separate table because
// the field is write-once on submit and read whole — no per-link queries.
// `instagram_handle` is the bare handle (no leading '@' — server strips it).
addColumnIfMissing("vendor_waitlist", "portfolio_links", "portfolio_links TEXT");
addColumnIfMissing("vendor_waitlist", "instagram_handle", "instagram_handle TEXT");

// `couple_supplier_id` back-reference on auto-synced budget lines. When a
// DIY supplier entry on /app/suppliers has a price, the backend creates a
// matching `budget_lines` row stamped with this id. The frontend renders
// those rows as read-only (price is owned by the supplier card) and the
// supplier's update / delete flow keeps them in sync.
addColumnIfMissing("budget_lines", "couple_supplier_id", "couple_supplier_id TEXT");

// Custom rows can opt into the headcount-driven rescale that built-in
// per-guest categories already get, and can pick a Lucide icon slug so the
// row renders distinguishably in the list. Both default to fixed/no-icon so
// historic rows behave exactly as before.
addColumnIfMissing("budget_lines", "per_guest", "per_guest INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("budget_lines", "icon", "icon TEXT");

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

// JSON-encoded `BudgetCategory[]` — the set of categories the couple has
// pinned on the cost-planning panel. Frozen categories are read-only in the
// slider + the budget table, and the headcount slider doesn't rescale their
// planned amount (per-guest scaling is skipped). Empty array = nothing frozen.
addColumnIfMissing(
  "couples",
  "frozen_categories_json",
  "frozen_categories_json TEXT NOT NULL DEFAULT '[]'",
);

// Display currency for the couple's money fields. Storage stays as integer
// units in whatever currency the couple picked — switching does NOT
// retro-convert past entries, it only flips the symbol/format on display.
// Default 'HUF' so legacy couples behave exactly as before.
addColumnIfMissing("couples", "currency", "currency TEXT NOT NULL DEFAULT 'HUF'");

// "Have we actually paid this yet?" flag on DIY supplier entries. Default 0
// (planned-only) — the mirrored budget line writes the price to
// `planned_huf` but leaves `actual_huf` at 0 until the couple flips the
// toggle. Loop C₂ fix: previously every DIY price double-wrote to both
// columns and made the dashboard read as if every aunt-cooking-line was
// already paid. Existing rows keep their data — see couple_suppliers.ts.
addColumnIfMissing("couple_suppliers", "paid", "paid INTEGER NOT NULL DEFAULT 0");

// Admin-only freeform notes on community-submitted suppliers. Turns the
// admin moderation page into a real CRM — moderators can jot triage notes
// ("emailed the venue, awaiting reply", "looks like dupe of Crystal Hall")
// against each row without leaking those notes to the submitter. NULL is
// the default ("no notes yet"); empty string clears.
addColumnIfMissing("community_suppliers", "admin_notes", "admin_notes TEXT");

// Distinguishes a vendor who self-submits ('self') from a couple/user who
// recommends a supplier they like ('user'). Drives the icon + pill on the
// public directory cards so the trust signal matches the source. Defaults
// to 'user' for existing rows since the legacy modal didn't ask.
addColumnIfMissing(
  "community_suppliers",
  "submitter_type",
  "submitter_type TEXT NOT NULL DEFAULT 'user'",
);

// Partner role marker on the two host guest rows that mirror
// `couples.bride_name` / `couples.groom_name`. Server-derived: clients
// never write it. NULL on every regular guest. Used by /app/seating to pin
// the couple's own slots at the top of the unassigned panel, and by
// /app/guests to render a Crown next to the hosts. Schema additive: no
// DEFAULT, NULL is the resting state.
addColumnIfMissing("guests", "partner_role", "partner_role TEXT");

// Last-active marker — stamped from `verifySessionToken` on every successful
// bearer-token verify (debounced to once per 5 minutes per user to avoid a
// hot-loop write on every API call). Powers the admin directory's "Last
// active" column. NULL means "never logged in since the column was added".
addColumnIfMissing("users", "last_seen_at", "last_seen_at INTEGER");

// Google account linkage. `users.google_sub` is the Google-issued `sub` claim
// — a stable, opaque user id that never changes even if the user renames the
// account or rotates emails. Null for password-only accounts. Partial unique
// index (NULL excluded) so a second Google sign-in for the same account is
// caught at the DB layer too, not just by the application check. Index lives
// in db.ts (not schema.sql) because the column is added by addColumnIfMissing
// — see [[project_schema_additive_ordering]] for the May 2026 incident.
addColumnIfMissing("users", "google_sub", "google_sub TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique " +
    "ON users(google_sub) WHERE google_sub IS NOT NULL",
);

// "Did this user ever set a real password?" — 1 = yes (default for back-compat,
// every legacy user signed up with password), 0 = Google-only signup, no local
// password ever set. Gates `/api/auth/forgot` and `/api/auth/reset` so an
// attacker who knows a Google-only user's email can't quietly install a
// password and take over the account through the password-recovery side door
// (the legitimate user would never expect a password path to exist on their
// Google-only account, so a stealthy reset is more dangerous here than on
// regular accounts). Flipped to 1 the moment a password is actually set,
// either through the reset flow or any future "set initial password" surface.
addColumnIfMissing("users", "password_set", "password_set INTEGER NOT NULL DEFAULT 1");

// Opt-in toggle for the "needs accommodation?" question on the RSVP flow.
// Default 0 (off) so couples who don't offer accommodation don't pester
// guests with an irrelevant checkbox. When the couple flips it on from the
// Profile page, both the in-app GuestDrawer and the public household RSVP
// form render the question; otherwise the field is hidden on both surfaces
// (existing per-guest `accommodation_needed` rows are preserved, just not
// edited). Stored 0/1 to match the project's other boolean columns.
addColumnIfMissing(
  "couples",
  "rsvp_offers_accommodation",
  "rsvp_offers_accommodation INTEGER NOT NULL DEFAULT 0",
);

// Opt-out toggle for the meal-choice row on the public RSVP form. Most
// weddings serve a plated menu so the icon row of meat/fish/veg/vegan/child/
// none is useful, and existing couples shouldn't lose it on upgrade — hence
// the DEFAULT 1. When a couple flips it off from the Profile page (e.g. a
// buffet wedding), the meal-icon row is hidden on the public form. The
// per-member `meal_choice` value isn't touched server-side; if the toggle
// flips back on later, prior selections re-appear.
addColumnIfMissing(
  "couples",
  "rsvp_collects_meal",
  "rsvp_collects_meal INTEGER NOT NULL DEFAULT 1",
);

// Household-level group tag — one source of truth for the whole party (his
// family, her friends, work, etc.) so the household card can render the
// chip in its header and every member inherits the same group. Backfills
// each household with the most common group_tag among its current members
// (ties broken by first encountered). Households with no members stay on
// 'other' (the column default).
addColumnIfMissing("households", "group_tag", "group_tag TEXT NOT NULL DEFAULT 'other'");
db.exec(`
  UPDATE households
     SET group_tag = COALESCE((
       SELECT g.group_tag
         FROM guests g
        WHERE g.household_id = households.id
        GROUP BY g.group_tag
        ORDER BY COUNT(*) DESC, MIN(g.id) ASC
        LIMIT 1
     ), 'other')
   WHERE group_tag = 'other'
     AND EXISTS (SELECT 1 FROM guests WHERE household_id = households.id)
`);

// Per-household opt-in for the "needs accommodation?" RSVP question and the
// meal-choice icon row. These started life on `couples` (one global toggle
// per workspace) but moved to the household so each party can carry its own
// decision — e.g. the venue-block guests get the accommodation question, the
// locals don't. The couple-level columns + PATCH still exist for back-compat
// (schema additive; never drop). Defaults match the original couple-level
// defaults so a fresh household behaves the same as the legacy global.
addColumnIfMissing(
  "households",
  "rsvp_offers_accommodation",
  "rsvp_offers_accommodation INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing(
  "households",
  "rsvp_collects_meal",
  "rsvp_collects_meal INTEGER NOT NULL DEFAULT 1",
);
// One-time backfill — when these per-household columns were first added,
// pull the couple-level setting forward so existing weddings don't silently
// lose their pre-set values. `addColumnIfMissing` only adds the column once
// (idempotent), and the backfill below is keyed off the column default so a
// subsequent boot finds every row already at the matching value and these
// UPDATEs are no-ops. Households whose couple has accommodation ON: flip the
// household ON (the per-household column was just initialised to 0).
db.exec(`
  UPDATE households
     SET rsvp_offers_accommodation = 1
   WHERE rsvp_offers_accommodation = 0
     AND couple_id IN (SELECT id FROM couples WHERE rsvp_offers_accommodation = 1)
`);
// Households whose couple has meal collection OFF: flip the household OFF
// (the per-household column was just initialised to 1).
db.exec(`
  UPDATE households
     SET rsvp_collects_meal = 0
   WHERE rsvp_collects_meal = 1
     AND couple_id IN (SELECT id FROM couples WHERE rsvp_collects_meal = 0)
`);

// Logistics assignments live on the guest row. One accommodation + one
// transfer per guest, both nullable. We index on the foreign-key columns so
// the LogisticsPage can pull "guests assigned to this accommodation" with a
// single seek instead of scanning every guest in the couple. Indexes live in
// db.ts (not schema.sql) so they apply even when the column was added on a
// pre-existing prod DB — same pattern as supplier_votes.couple_id.
addColumnIfMissing(
  "guests",
  "accommodation_id",
  "accommodation_id INTEGER REFERENCES accommodations(id) ON DELETE SET NULL",
);
addColumnIfMissing(
  "guests",
  "transfer_id",
  "transfer_id INTEGER REFERENCES transfers(id) ON DELETE SET NULL",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_guests_accommodation ON guests(accommodation_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_guests_transfer ON guests(transfer_id)");

// `auto_created = 1` marks the household-of-one that `guests.create` spawns
// implicitly when the caller passes no `household_id` and no
// `new_household_label`. Distinguishes "the user typed a guest name and a
// stub household tagged along" from "the user deliberately created a
// household with a label". Lets /api/households?exclude_auto_singletons=1
// hide the implicit singletons from the household tab. Default 0 so every
// historical row stays in the visible set.
addColumnIfMissing("households", "auto_created", "auto_created INTEGER NOT NULL DEFAULT 0");

// Multi-workspace membership: a user can belong to several couple
// workspaces (Alpha / Bravo / Charlie for a wedding with multiple events).
// `users.couple_id` continues to mean "the workspace this user is currently
// viewing" — every couple-scoped query stays unchanged. This table tracks
// the full set so the profile can list every workspace and the header can
// offer a switcher. (couple_id, user_id) is unique per pair; role mirrors
// `users.role` at the time of membership (owner / partner). created_at is
// the moment the user joined that specific workspace.
db.exec(`
  CREATE TABLE IF NOT EXISTS couple_members (
    couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (couple_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_couple_members_user ON couple_members(user_id);
`);

// Backfill: every existing (couple, partner_a_id|partner_b_id) pair becomes
// a couple_members row. INSERT OR IGNORE means a re-boot is a no-op. We
// stamp created_at = couples.created_at so the membership clock matches the
// workspace clock for legacy data. The role mirrors users.role at the time
// of the backfill so an admin partner_a still reads as 'owner'.
db.exec(`
  INSERT OR IGNORE INTO couple_members (couple_id, user_id, role, created_at)
    SELECT c.id, c.partner_a_id, COALESCE(u.role, 'owner'), c.created_at
      FROM couples c
      JOIN users u ON u.id = c.partner_a_id
     WHERE c.partner_a_id IS NOT NULL;
  INSERT OR IGNORE INTO couple_members (couple_id, user_id, role, created_at)
    SELECT c.id, c.partner_b_id, COALESCE(u.role, 'partner'), c.created_at
      FROM couples c
      JOIN users u ON u.id = c.partner_b_id
     WHERE c.partner_b_id IS NOT NULL;
`);

// Ephemeral demo workspaces — the public landing's "Try the demo" button hits
// `POST /api/demo/start`, which seeds a Shrek & Fiona wedding into a fresh
// couple stamped with `is_demo = 1`. The flag drives the persistent banner +
// conversion popup inside /app, AND lets the demo housekeeping sweep purge
// abandoned demo workspaces older than ~24 h so the database doesn't grow
// unbounded. 0/1 to match the project's other booleans; default 0 so legacy
// couples keep their existing read.
addColumnIfMissing("couples", "is_demo", "is_demo INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_couples_is_demo ON couples(is_demo, created_at)");

export function now(): number {
  return Date.now();
}
