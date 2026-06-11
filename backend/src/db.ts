// SQLite + idempotent migrations. New tables go in schema.sql; new columns
// go through addColumnIfMissing(). Never DROP or RENAME — old servers still
// need to read the DB during a rolling deploy.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { partnerFreeWindowEnd } from "@shared/billing";
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

// Set the moment `purgeOneCouple` scrubs this row. Tombstones (status='deleting')
// with purged_at IS NULL are LEGACY rows scrubbed by an older purge pass; the
// hourly sweep re-finalises them once to clean residue, then stamps purged_at so
// they're never re-swept. New purges stamp it immediately, so the sweep is a
// self-limiting backfill rather than an unbounded hourly re-hammer.
addColumnIfMissing("couples", "purged_at", "purged_at INTEGER");

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

// "This guest is a supplier" (DJ, photographer, ...). Orthogonal to kind +
// group_tag. They often eat at a reduced "supplier menu" rate and sit at a
// separate supplier table, so the couple tags them to count + seat them apart.
addColumnIfMissing("guests", "is_supplier", "is_supplier INTEGER NOT NULL DEFAULT 0");

// Materialised plus-one marker. 1 when this guest was auto-created from another
// guest's "+1" field (so the list can flag it). Default 0 for every normal row.
addColumnIfMissing("guests", "is_plus_one", "is_plus_one INTEGER NOT NULL DEFAULT 0");

// Parent guest a materialised plus-one hangs off — the guest who "brought" them
// and who fills in their RSVP on their behalf. Null on every primary guest.
// Lets /app/guests nest the +1 directly under its host with a connecting line,
// and lets the public check-in form refuse a +1-of-a-+1.
addColumnIfMissing("guests", "plus_one_of", "plus_one_of INTEGER REFERENCES guests(id)");

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

// "Döntések" (decision-prompt) layer on planning tasks: the long tail of small
// yes/no decisions and "did you think of this?" prompts (entrance music, ring
// bearer, the venue's default coffee, rain plan...). A prompt is just a
// kind='task' row carrying a stable `seed_key` (matching shared/planning_prompts
// PROMPT_SEEDS) so it inherits the existing Gantt / notification plumbing for
// free, and the immutable seed metadata (prompt_kind, target, supplier category,
// hint, group) is derived frontend-side from the master by seed_key rather than
// duplicated into columns. `seed_key IS NOT NULL` is the discriminator that
// keeps these rows out of the dated Tasks list until they're promoted.
//   decision_status: 'open' | 'decided' | 'not_relevant' | 'promoted'. Orthogonal
//     to `done`: an open prompt has no due_date, so summarizeTimeline / the Gantt
//     treat it as 'undated' and it never pollutes the bell badge.
//   resolution: free-text answer / decision log ("Bevonulás: Canon in D",
//     "Igen, van koffeinmentes kávé").
addColumnIfMissing("planning_items", "seed_key", "seed_key TEXT");
addColumnIfMissing("planning_items", "decision_status", "decision_status TEXT");
addColumnIfMissing("planning_items", "resolution", "resolution TEXT");
// One prompt row per (couple, seed): the generator dedupes on this when it
// lazily materialises a group, so re-opening a group never double-inserts.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planning_seed ON planning_items(couple_id, seed_key) WHERE seed_key IS NOT NULL",
);
// Lightweight intake for the decision layer: the couple's manual answers to the
// 6 conditional dimensions (outdoor? pets? destination?...) that aren't already
// derivable from couples.ceremony_kind / the guest list. Stored as a small JSON
// blob ({ "outdoor": "yes", "pets": "no", ... }); absent dimensions stay
// "unanswered" and the prompt resolver keeps their tagged prompts visible
// (inclusive by design: a missed rain plan is costlier than one extra card).
addColumnIfMissing("couples", "planning_profile", "planning_profile TEXT");

// Run-sheet ("forgatókönyv") fields on the day-of schedule: who runs each beat
// (free-text, like planning_items.assignee) and which booked supplier it ties
// to (loose reference to couple_suppliers.id, no hard FK — same as
// planning_items.supplier_id). Turns the program timeline into a backstage
// production script the couple can hand to a helper.
addColumnIfMissing("schedule_events", "responsible", "responsible TEXT");
addColumnIfMissing("schedule_events", "couple_supplier_id", "couple_supplier_id TEXT");
// Couple-flagged "key moment" — the public wedding site shows only these (max
// MAX_KEY_MOMENTS) as a single headline row, falling back to a heuristic when
// none are set. Boolean stored as 0/1.
addColumnIfMissing("schedule_events", "is_key_moment", "is_key_moment INTEGER NOT NULL DEFAULT 0");

// Global slug uniqueness — couples.slug paired with the 8-character household
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
addColumnIfMissing("vendor_waitlist", "price_list_path", "price_list_path TEXT");

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

// How much of this line has actually been settled, in integer Forint (the
// "kifizetett összeg" column on /app/budget). Defaults to 0 (nothing paid).
// For DIY-supplier-mirrored lines it is kept in lock-step with the supplier's
// paid installments by `recomputePaidState`; plain lines are hand-editable.
addColumnIfMissing("budget_lines", "paid_huf", "paid_huf INTEGER NOT NULL DEFAULT 0");

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
// Departure IATA code used by the Amadeus flight estimate. Defaults applied
// at read-time (HU couple → BUD, EN → VIE) so existing rows keep working
// without a backfill; this column only carries the explicit override.
addColumnIfMissing("couples", "honeymoon_origin_iata", "honeymoon_origin_iata TEXT");

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

// Country the couple is getting married in (ISO 3166-1 alpha-2). Captured
// up-front from signup country selectors once those land; for now it's a
// schema-only foundation so wedding-domain logic (legal-ceremony calendar,
// localized supplier suggestions, postcode validators) can read it without
// a future migration. Default 'HU' preserves the historical implicit
// assumption while making future non-HU couples a 1-line frontend wiring
// instead of a schema change + backfill.
addColumnIfMissing("couples", "country", "country TEXT NOT NULL DEFAULT 'HU'");

// Anchor every historical couple to a country-LEVEL scope of Hungary — the
// product launched Hungary-only, so "the country we're getting married in" is
// HU for everyone who signed up before the international expansion. This keeps
// the newly-introduced country-scoped assists (venue-name autocomplete, supplier
// suggestions) inside the user's own country instead of offering cross-border
// places. The column DEFAULT already backfilled existing rows on the ALTER;
// this UPDATE is the explicit, idempotent guard that also catches any null/empty
// row from a manual import. Country is deliberately a collective concept, kept
// separate from the precise `location_lat`/`location_lng` venue — so setting it
// never disturbs a couple who already pinned a concrete location.
backfillCoupleCountry();
function backfillCoupleCountry(): void {
  const filled = db
    .prepare("UPDATE couples SET country = 'HU' WHERE country IS NULL OR TRIM(country) = ''")
    .run();
  if (filled.changes > 0) {
    console.log(`[db.backfill] set country='HU' on ${filled.changes} couple(s) with no country`);
  }
  // Flag the exception the user asked us to watch for: a couple whose CONCRETE
  // venue sits OUTSIDE Hungary's bounding box (lat 45.74..48.58, lng 16.11..22.90)
  // shouldn't silently read as HU. We don't guess the foreign country at boot
  // (no reverse-geocode), so we surface the rows for a human to correct the
  // country on. Given the Hungary-only history this list is expected to be empty.
  const outside = db
    .prepare(
      `SELECT id, location_lat AS lat, location_lng AS lng FROM couples
        WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL
          AND country = 'HU'
          AND (location_lat < 45.74 OR location_lat > 48.58
               OR location_lng < 16.11 OR location_lng > 22.90)`,
    )
    .all() as { id: number; lat: number; lng: number }[];
  if (outside.length > 0) {
    console.warn(
      `[db.backfill] ${outside.length} couple(s) read country='HU' but have a venue OUTSIDE Hungary — review and correct: ` +
        outside.map((c) => `#${c.id}(${c.lat.toFixed(3)},${c.lng.toFixed(3)})`).join(", "),
    );
  }
}

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

// Apple account linkage. Mirrors `google_sub` exactly: `users.apple_sub` is the
// Apple-issued `sub` claim — a stable, opaque user id scoped to our Services ID
// that never changes. Null for accounts that never used Sign in with Apple.
// Partial unique index (NULL excluded) so a second Apple sign-in for the same
// account is caught at the DB layer too, not just by the application check.
// Index lives in db.ts (not schema.sql) because the column is added by
// addColumnIfMissing — see [[project_schema_additive_ordering]].
addColumnIfMissing("users", "apple_sub", "apple_sub TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub_unique " +
    "ON users(apple_sub) WHERE apple_sub IS NOT NULL",
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

// Per-user UI locale, captured at signup from navigator.language and
// surfaced on /api/auth/me. Foundation for per-locale outbound email
// (currently still bilingual HU+EN — that rewrite is a separate change).
// Nullable so legacy users get falsy until they next sign in / update it.
// Validation lives in the routes that write to it; here it's just TEXT.
addColumnIfMissing("users", "locale", "locale TEXT");

// Inline known-device list for the "new device sign-in" security alert.
// Stored as a JSON array of `{fp: string, last_seen_at: number}` records,
// capped to the most recent ~10 devices. The fingerprint is a SHA-256 of
// `user-agent-family + ip-first-two-octets`, truncated to 16 hex chars —
// irreversible, /16 IP prefix (~city-level), no raw PII. First sign-in is
// silently registered without emailing (otherwise every new user gets an
// alert about themselves). Subsequent unrecognised fingerprints trigger a
// `new_device_signin` mail.
addColumnIfMissing("users", "known_devices_json", "known_devices_json TEXT NOT NULL DEFAULT '[]'");

// Beta-tester marker — admin-set label that buckets an account (and its whole
// workspace) into the "Beta testers" group in the admin directory so the team's
// own test accounts don't pollute the real-signup metrics. Non-destructive,
// unlike user_flags: purely a grouping signal, no email and no auto-purge.
addColumnIfMissing("users", "is_beta_tester", "is_beta_tester INTEGER NOT NULL DEFAULT 0");

// Signup acquisition analytics — where a user came from, captured once at
// registration and surfaced only in the admin "Acquisition" dashboard. All
// nullable: legacy rows, organic (no-UTM) signups, and unresolvable IPs all
// stay null. Privacy posture (GDPR Art 6(1)(f) legitimate interest):
//   - signup_country  : ISO-3166-1 alpha-2, derived from the request IP via
//                       GeoLite2 at signup; the IP itself is NEVER stored here.
//   - device_type     : coarse 'mobile' | 'tablet' | 'desktop' bucket — no raw
//                       User-Agent, OS, or browser version (no fingerprint).
//   - utm_*           : marketing campaign params, length-capped at the route
//                       boundary. Not personal data on their own.
// Scrubbed to NULL on account purge (see domain/purge.ts) and surfaced in the
// GDPR data export (see routes/export.ts).
addColumnIfMissing("users", "signup_country", "signup_country TEXT");
addColumnIfMissing("users", "device_type", "device_type TEXT");
addColumnIfMissing("users", "utm_source", "utm_source TEXT");
addColumnIfMissing("users", "utm_medium", "utm_medium TEXT");
addColumnIfMissing("users", "utm_campaign", "utm_campaign TEXT");
addColumnIfMissing("users", "utm_content", "utm_content TEXT");
addColumnIfMissing("users", "utm_term", "utm_term TEXT");

// Group the acquisition dashboard's hottest breakdowns. Index AFTER the column
// adds (the May 2026 prod-crash rule: indexes on addColumnIfMissing columns
// live in db.ts, never schema.sql).
db.exec("CREATE INDEX IF NOT EXISTS idx_users_signup_country ON users(signup_country)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_utm_campaign ON users(utm_campaign)");

// One-shot stamp so the cron sweep doesn't re-send the "you forgot to pick
// a meal" nudge every hour. NULL until we send, then frozen — the guest is
// expected to revisit the RSVP link if they actually want to update their
// meal choice, not get pestered.
addColumnIfMissing("guests", "meal_followup_sent_at", "meal_followup_sent_at INTEGER");

// Per-couple toggle for RSVP-notification cadence. Default 'per_event' is
// the legacy behaviour — a separate mail for every RSVP. 'weekly' suppresses
// the per-event mail and rolls up activity into a single Monday digest.
// Stored as TEXT (not boolean) so we can grow the union if a "daily" middle
// ground turns out to be wanted.
addColumnIfMissing(
  "couples",
  "rsvp_digest_mode",
  "rsvp_digest_mode TEXT NOT NULL DEFAULT 'per_event'",
);

// Per-couple trigger for the proactive-timeline EMAIL escalation (the in-app
// bell is always on; email is the push when the couple is slipping). The hourly
// worker emails a nudge only when a task is in the configured trigger set and a
// weekly cooldown has elapsed. 'overdue' (default) is the "only when it really
// matters" push the product asked for; 'overdue_due_soon' also warns ahead of
// the deadline; 'off' silences email entirely. TEXT so the union can grow.
// Honors lifecycle_opt_out like every other lifecycle mail.
addColumnIfMissing(
  "couples",
  "timeline_email_escalation",
  "timeline_email_escalation TEXT NOT NULL DEFAULT 'overdue'",
);

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

// Opt-IN toggle for the meal-choice row on the public RSVP form (legacy
// couple-level mirror; the live gate is the per-household column below). It
// now defaults OFF: many couples run a buffet or decide the menu themselves,
// so the meat/fish/veg/vegan/child/none row is opt-in, not opt-out. Existing
// couples keep their stored value (this DEFAULT only applies to fresh DBs).
// When on, a flip-off hides the row on the public form; the per-member
// `meal_choice` value isn't touched, so prior selections re-appear if turned
// back on.
addColumnIfMissing(
  "couples",
  "rsvp_collects_meal",
  "rsvp_collects_meal INTEGER NOT NULL DEFAULT 0",
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
  "rsvp_collects_meal INTEGER NOT NULL DEFAULT 0",
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
// Households whose couple has meal collection OFF: flip the household OFF.
// Historical: ran once when the per-household column was first added with a
// DEFAULT 1. The column now defaults to 0 (meal collection is opt-in), so on
// fresh DBs nothing matches this and it is a no-op; on DBs that pre-date the
// change it already reconciled the legacy global setting.
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

// Marks the single per-couple household that collects suppliers (DJ,
// photographer, …). Guests flagged is_supplier are routed here; the first
// supplier creates the row. Default 0 so every existing household is a normal
// guest party.
addColumnIfMissing(
  "households",
  "is_supplier_household",
  "is_supplier_household INTEGER NOT NULL DEFAULT 0",
);

// Set the first time a digital invite goes out to the household (the
// `POST /api/households/invite-batch` mass-send, or a future single send).
// Drives the "never invite twice" guard: the batch send only targets
// households where this is still NULL. A failed send leaves it NULL so a
// retry re-sends. Mapped to `Household.invited_at` in `toHousehold`.
addColumnIfMissing("households", "invited_at", "invited_at INTEGER");

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

// Public wedding website (`/w/:slug`) — Next-7 schema additions, settled
// via 3-agent consensus (Agent C, moderating between privacy-default and
// activation-default). Three nullable / off-by-default fields:
//
// - is_public: 0 (private) by default. GDPR Art. 25 — every existing slug
//   stays NOT publicly readable until the couple flips the toggle on the
//   /app/wedding-site editor. The public endpoint adds an `is_public = 1`
//   guard alongside the existing `status = 'active'` check.
// - venue_name: free-text TEXT. No `places` table to join to (it's an OSM
//   autocomplete proxy route, not persistence). Sits next to the existing
//   location_lat/lng on the same couple row.
// - cover_image_url: plain http(s) URL the couple pastes in. No upload
//   pipeline yet — that's a v2 storage decision once we see the access
//   patterns. Validated at the boundary (≤2048 chars, http(s) scheme).
addColumnIfMissing("couples", "is_public", "is_public INTEGER NOT NULL DEFAULT 0");
// - wishlist_published: gift-list publish toggle for the guest page. 0 by
//   default; the couple flips it from the wishlist editor. The confirmed-tier
//   public-wedding embed is gated on this, so an unpublished list never ships
//   even to a guest who already RSVP'd yes.
addColumnIfMissing(
  "couples",
  "wishlist_published",
  "wishlist_published INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("couples", "venue_name", "venue_name TEXT");
// Settlement (city/town) shown alongside the venue name on the public site,
// e.g. venue_name "Sári Csárda" + venue_city "Dunakiliti". Auto-filled from the
// place picker's locality; the display also falls back to the part of
// venue_name after a comma when this is empty.
addColumnIfMissing("couples", "venue_city", "venue_city TEXT");
addColumnIfMissing("couples", "cover_image_url", "cover_image_url TEXT");
// Cover-photo focal point as object-position percentages (0..100, default 50 =
// centred). The hero crops the cover to a wide band, so the couple drags the
// photo in the guest-page editor to choose which part stays in frame.
addColumnIfMissing("couples", "cover_position_x", "cover_position_x INTEGER NOT NULL DEFAULT 50");
addColumnIfMissing("couples", "cover_position_y", "cover_position_y INTEGER NOT NULL DEFAULT 50");

// Moodboard source state. Every couple defaults to 'preset' — a curated
// Pinterest board rendered automatically so /app/moodboard is never blank.
// Switching to 'pinterest' stores the couple's own board link in
// moodboard_url; 'upload' renders the rows in the moodboard_images table.
addColumnIfMissing(
  "couples",
  "moodboard_source",
  "moodboard_source TEXT NOT NULL DEFAULT 'preset'",
);
addColumnIfMissing("couples", "moodboard_url", "moodboard_url TEXT");

// Vendégoldal Phase 2 — markdown blocks the couple authors for the guest
// page. Both nullable / NULL by default; the editor surfaces them in the
// Public and Post-RSVP sections respectively.
//
// - guest_page_intro: pre-RSVP welcome block. Shown to anyone with the
//   link (`/w/:slug`) AND to invited guests on `/w/:slug/:code` before
//   they RSVP yes. Plain text / lightweight markdown — no upload pipe.
// - post_rsvp_content: unlocked only after at least one household member
//   RSVPs yes. Server omits the field from the response at lower tiers so
//   the data never reaches the client unless the credential allows it.
addColumnIfMissing("couples", "guest_page_intro", "guest_page_intro TEXT");
addColumnIfMissing("couples", "post_rsvp_content", "post_rsvp_content TEXT");
// - useful_info: "good to know" block (parking, getting there, accommodation,
//   …). Same public visibility as guest_page_intro. Plain text / light markdown.
addColumnIfMissing("couples", "useful_info", "useful_info TEXT");
// - media_links_json: photo-share URLs for the Photos page, one Google Drive
//   (or any http(s)) link per source. JSON blob `{ guests, photographer, other }`.
addColumnIfMissing("couples", "media_links_json", "media_links_json TEXT");
// - design_json: curated visual identity for the Design feature (style /
//   palette / font slugs + print toggles), one JSON blob. NULL/legacy rows
//   resolve to the Botanical Green default at read-time (resolveDesign), so
//   existing guest pages keep working. No index (always read via the loaded
//   couple row); validation lives in the PATCH allowlist, not the column.
addColumnIfMissing("couples", "design_json", "design_json TEXT");
// Wedding-day "Welcome Desk" mode — couple flips this to 1 when they set up
// a kiosk tablet at the entrance so the Settings card can surface the
// current status persistently (across devices, across reloads) instead of
// relying on a query-string flag the owner had to remember each time.
// 0 = inactive (default).
addColumnIfMissing(
  "couples",
  "welcome_desk_active",
  "welcome_desk_active INTEGER NOT NULL DEFAULT 0",
);

// Vendor listing hero image. Stored as a relative path under the public
// `/uploads/` prefix (e.g. `/uploads/listings/v3/hero.webp`) — files live
// on the persistent `CONFIG.uploadsDir` volume and the server.ts static
// handler serves the `/uploads/*` URL space. Null = vendor hasn't uploaded
// one yet; the supplier card falls back to the monogram avatar. Only
// vendors who own the listing can upload + delete via `vendor_listing.ts`
// — couples / curated entries see read-only.
addColumnIfMissing("listings", "hero_image_url", "hero_image_url TEXT");

// `venue_style` characterises a venue (castle, boat, restaurant…) beyond its
// always-"venue" category. Sourced from the curated directory's "jelleg" tag.
// Null on non-venue + unclassified listings. See @shared/suppliers VenueStyle.
addColumnIfMissing("listings", "venue_style", "venue_style TEXT");

// Email the claimer typed into the "this is mine" modal — WHO is asking to
// take over the listing. Distinct from `email_sent_to` (the listing's
// contact_email, where the verification link actually goes). Surfaced to
// admins in the immediate heads-up mail so a human can keep an eye on claims
// before the verify link is clicked. NULL on legacy rows created before the
// field existed.
addColumnIfMissing("listing_claims", "claimant_email", "claimant_email TEXT");

// Soft-hide for the admin-editable supplier taxonomy. Couples no longer
// see hidden groups / categories on the public dropdowns + directory
// surfaces, but the rows stay in the DB so existing community-supplier
// references (`community_suppliers.category = slug`) don't orphan. Admin
// can still find and unhide them from /app/admin/categories. Default 0
// preserves the legacy "everything visible" behaviour for seeded rows.
addColumnIfMissing("supplier_groups", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("supplier_categories", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");

// Unix-ms timestamp of the last bride/groom name change. Drives a 7-day
// rename cooldown surfaced on the workspace hero card — once a couple
// renames themselves, the API rejects further bride/groom/display_name
// PATCHes until 7 days have passed so the audit trail + outbound emails
// don't churn on accidental edits. NULL means "never renamed via the
// gated endpoint" (legacy rows + onboarding writes) and is treated as
// out-of-cooldown.
addColumnIfMissing("couples", "names_last_changed_at", "names_last_changed_at INTEGER");

// "Lock" flag for the cost-planning headcount slider on /app/budget.
// 0 = unlocked (default — the slider sits under the big "90 vendég"
// number and the per-guest categories rescale on drag). 1 = locked,
// rendered as a closed lock badge next to the number and the slider
// collapses out of view. Per-row planned amounts still drag on their
// own sliders; only the global headcount factor is pinned.
addColumnIfMissing(
  "couples",
  "planning_count_locked",
  "planning_count_locked INTEGER NOT NULL DEFAULT 0",
);

// Stamp set when an admin clicks the "remind partner invite" mail icon on
// the admin workspace list. One-shot: subsequent admin clicks are refused
// so the lone partner doesn't get pestered. NULL = never reminded.
addColumnIfMissing("couples", "invite_partner_reminded_at", "invite_partner_reminded_at INTEGER");

// ── Subscription / billing (Stripe) ──────────────────────────────────────
// State machine: see shared/billing.ts. `subscription_status` is the stored
// state; entitlement (edit access) is COMPUTED from it + the timestamps at
// read-time so a lapsed trial flips to read-only without a background job.
// Money/access NEVER mutate the couple's `status` column (that drives the
// pause-to-delete countdown), so a non-paying couple keeps all its data.
addColumnIfMissing(
  "couples",
  "subscription_status",
  "subscription_status TEXT NOT NULL DEFAULT 'none'",
);
// Epoch-ms end of the 14-day in-app trial (set at onboarding for new couples).
addColumnIfMissing("couples", "trial_ends_at", "trial_ends_at INTEGER");
// Epoch-ms end of the 18-month founding-member free window.
addColumnIfMissing("couples", "founding_until", "founding_until INTEGER");
// 1 = among the first 200 couples → eligible for the founding free window.
addColumnIfMissing(
  "couples",
  "is_founding_member",
  "is_founding_member INTEGER NOT NULL DEFAULT 0",
);
// Stripe linkage + paid-period end (filled by the billing webhook).
addColumnIfMissing("couples", "stripe_customer_id", "stripe_customer_id TEXT");
addColumnIfMissing("couples", "stripe_subscription_id", "stripe_subscription_id TEXT");
addColumnIfMissing("couples", "current_period_end", "current_period_end INTEGER");
// Index AFTER the column adds (see the May-2026 ordering rule): a column added
// via addColumnIfMissing can't carry an inline index in schema.sql.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_couples_stripe_customer ON couples(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_couples_subscription_status ON couples(subscription_status)",
);

// One-time grandfather: every real couple that existed BEFORE billing launched
// is one of our earliest adopters, so make them founding members (free for 18
// months from launch). Idempotent + bounded by the launch timestamp so it only
// ever touches pre-launch rows: after the first run those rows are 'founding'
// (no longer 'none'), and couples created after launch start at 'trialing' via
// the onboard INSERT, never 'none'. Demo couples are excluded — they're always
// entitled regardless of billing.
const BILLING_LAUNCH_MS = 1_748_822_400_000; // 2026-06-02T00:00:00Z
const FOUNDING_GRANDFATHER_UNTIL = BILLING_LAUNCH_MS + 1000 * 60 * 60 * 24 * 30 * 18;
db.prepare(
  `UPDATE couples
     SET subscription_status = 'founding',
         is_founding_member = 1,
         founding_until = ?
   WHERE is_demo = 0
     AND created_at < ?
     AND subscription_status = 'none'`,
).run(FOUNDING_GRANDFATHER_UNTIL, BILLING_LAUNCH_MS);

// Re-pin the first-200 grandfathered cohort from the flat 18-month window to
// "free until their wedding day" (the founder's first-200 promise). Targets only
// the rows the grandfather stamped (founding_until = FOUNDING_GRANDFATHER_UNTIL,
// is_founding_member = 1), so admin comps and partner-reward couples are
// untouched. Idempotent: once re-pinned, founding_until no longer matches, so it
// never runs twice. A couple with no wedding date falls back to 18 months from
// now (computed once here, then frozen).
{
  const grandfathered = db
    .prepare(
      `SELECT id, wedding_date FROM couples
        WHERE is_demo = 0 AND subscription_status = 'founding'
          AND is_founding_member = 1 AND founding_until = ?`,
    )
    .all(FOUNDING_GRANDFATHER_UNTIL) as Array<{ id: number; wedding_date: string | null }>;
  if (grandfathered.length > 0) {
    const nowMs = Date.now();
    const repin = db.prepare("UPDATE couples SET founding_until = ?, updated_at = ? WHERE id = ?");
    db.transaction(() => {
      for (const c of grandfathered) {
        const weddingMs = c.wedding_date ? Date.parse(c.wedding_date) : Number.NaN;
        const until = partnerFreeWindowEnd(Number.isNaN(weddingMs) ? null : weddingMs, nowMs);
        repin.run(until, nowMs, c.id);
      }
    })();
  }
}

// Billing kill-switch singleton. Default enforcement_on=0 means the read-only
// paywall is DEFERRED — no couple is locked out until the founder flips it on
// from the admin financial planner (after the 200-couple cohort fills). Lives
// in the DB (not env) so it is flippable at runtime from the UI with no
// redeploy. INSERT OR IGNORE keeps the existing value on every boot.
db.exec("INSERT OR IGNORE INTO billing_control (id, enforcement_on) VALUES (1, 0)");

/** Whether the read-only paywall is currently being enforced. When false the
 *  freeze is deferred and every couple stays editable (see toCoupleBilling). A
 *  single indexed PK read; cheap enough to call per request. */
export function billingEnforcementOn(): boolean {
  const row = db.prepare("SELECT enforcement_on FROM billing_control WHERE id = 1").get() as
    | { enforcement_on: number }
    | undefined;
  return row?.enforcement_on === 1;
}

// JSON array of the top-N Amadeus offers cached for a given route. We used to
// cache only the cheapest price in `price_amount`; this column carries the
// richer payload (carrier, duration, stops, depart/arrival ISO timestamps) so
// the honeymoon card can render multiple options without a re-query. Nullable:
// rows written by the pre-multi-offer code keep working and get backfilled on
// the next refresh.
addColumnIfMissing("flight_estimates", "offers_json", "offers_json TEXT");

// In-app route the feedback dialog was opened from (e.g. "/app/media"). The
// binary `source` ('landing' | 'app') couldn't tell admins which surface an
// in-product report was actually about; this carries the pathname so the
// triage list can label it "Photos", "Budget", etc. Null for landing rows
// and for any pre-existing in-app rows written before this column existed.
addColumnIfMissing("feedback_submissions", "context", "context TEXT");
// Triage workflow (see shared/feedback.ts). Full URL the dialog was opened
// from (context is just the route); admin-set priority / product area /
// internal notes; and User-Agent-derived device/browser/os captured at
// submission so admins can reproduce. All nullable — older rows stay valid.
addColumnIfMissing("feedback_submissions", "url", "url TEXT");
addColumnIfMissing("feedback_submissions", "priority", "priority TEXT");
addColumnIfMissing("feedback_submissions", "feature_area", "feature_area TEXT");
addColumnIfMissing("feedback_submissions", "admin_notes", "admin_notes TEXT");
addColumnIfMissing("feedback_submissions", "device", "device TEXT");
addColumnIfMissing("feedback_submissions", "browser", "browser TEXT");
addColumnIfMissing("feedback_submissions", "os", "os TEXT");
// One-time data migration: fold the legacy four-state model onto the new
// triage lifecycle. Idempotent — after the first boot no rows match. read →
// reviewed (looked at), resolved → fixed (shipped), dismissed → rejected.
db.exec(
  `UPDATE feedback_submissions SET status = 'reviewed' WHERE status = 'read';
   UPDATE feedback_submissions SET status = 'fixed'    WHERE status = 'resolved';
   UPDATE feedback_submissions SET status = 'rejected' WHERE status = 'dismissed';`,
);
// Relax the NOT NULL on `price_amount` for the multi-offer cache rows where
// no offer came back. SQLite doesn't support "ALTER COLUMN", so the schema
// migration is a no-op; the bug only bites on prod DBs that already hit the
// constraint when writing a null "no offers" sentinel. The runtime now
// writes 0 instead of null when the offer count is zero — same null-meaning,
// no constraint violation.

// Wishlist / gift-registry indexes. Both `wishlist_items` and
// `wishlist_interests` are created in schema.sql, but their indexes live here
// per the additive-table ordering rule (see [[project_schema_additive_ordering]])
// so they apply uniformly whether the table was just created or already
// existed on a prod DB. The couple-list query walks
// (couple_id, sort_order, id); the interest count/exists lookups seek by item.
// `image_url` (og:image resolved from the link) is additive on a table that
// may already exist from an earlier wishlist deploy, so add it the canonical
// way rather than only in the CREATE TABLE.
addColumnIfMissing("wishlist_items", "image_url", "image_url TEXT");
// `image_checked_at` records the last og:image resolution attempt. NULL means
// "never attempted" — the marker the boot backfill (domain/wishlist_image_backfill)
// uses to find legacy rows (created before link-preview shipped, or before this
// column existed) that have a link but no thumbnail. New/edited rows are always
// stamped, so the backfill is a one-time legacy sweep that never re-hammers a
// dead link.
addColumnIfMissing("wishlist_items", "image_checked_at", "image_checked_at INTEGER");
// `currency` is a per-item override of the couple's display currency. NULL (the
// default for every existing row) means "inherit the couple's currency", so the
// additive add is a safe no-op for legacy data.
addColumnIfMissing("wishlist_items", "currency", "currency TEXT");
// `pledged_amount_minor` is the soft, non-binding amount a household enters when
// tapping "I'd like to help" on a group gift. NULL on every legacy row (tapped
// in without a number), so the additive add is a safe no-op.
addColumnIfMissing("wishlist_interests", "pledged_amount_minor", "pledged_amount_minor INTEGER");
// Wishlist kinds collapsed from three (item / group_gift / personal) to two
// (gift / request): item + group_gift are one "gift" bucket now, personal reads
// as a "request". Normalize legacy rows once at boot so the stored value matches
// the new vocabulary (mappers also normalize on read, so this is belt-and-braces
// for the few pre-change rows). Idempotent — only touches legacy values.
db.exec("UPDATE wishlist_items SET kind = 'gift' WHERE kind IN ('item', 'group_gift')");
db.exec("UPDATE wishlist_items SET kind = 'request' WHERE kind = 'personal'");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_wishlist_items_couple ON wishlist_items(couple_id, sort_order, id)",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_wishlist_interests_item ON wishlist_interests(item_id)");

// Received-gifts ledger index. The table is created in schema.sql; its index
// lives here per the additive-table ordering rule. Listed couple-scoped + in
// grid order.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_received_gifts_couple ON received_gifts(couple_id, sort_order, id)",
);
// household_id shipped after the table did (guest-only at first). Nullable FK
// with a NULL default, so ALTER ADD COLUMN with the REFERENCES clause is allowed.
addColumnIfMissing(
  "received_gifts",
  "household_id",
  "household_id INTEGER REFERENCES households(id) ON DELETE SET NULL",
);

export function now(): number {
  return Date.now();
}
