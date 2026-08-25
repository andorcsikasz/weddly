// SQLite + idempotent migrations. New tables go in schema.sql; new columns
// go through addColumnIfMissing(). Never DROP or RENAME — old servers still
// need to read the DB during a rolling deploy.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PAID_LAUNCH_DATE, partnerFreeWindowEnd, TRIAL_DURATION_MS } from "@shared/billing";
import { CONFIG } from "./config";
import { generateOrganiserCode, generateVendorCode } from "./domain/invite_codes";
import { verifyExistingUnverifiedAccounts } from "./domain/verify_backfill";

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
// Admin authorization uses a short recent-auth window. Keep this timestamp
// separate from sessions.created_at: created_at slides at half-life for normal
// 30-day sessions, while authenticated_at changes only after a real sign-in.
addColumnIfMissing("sessions", "authenticated_at", "authenticated_at INTEGER");
addColumnIfMissing("sessions", "auth_method", "auth_method TEXT");
addColumnIfMissing("sessions", "totp_counter", "totp_counter INTEGER");
// TOTP codes are shared by a user's devices for one 30-second time step. Keep
// the replay watermark on the admin principal as well as the elevated session
// so the same code cannot elevate a second stolen/parallel session.
addColumnIfMissing("users", "admin_totp_counter", "admin_totp_counter INTEGER");

// DSA statements of reasons and the affected uploader/vendor's independent
// complaint path. Existing notice rows remain valid with null recipient data.
addColumnIfMissing("content_notices", "affected_email", "affected_email TEXT");
addColumnIfMissing("content_notices", "affected_notified_at", "affected_notified_at INTEGER");
addColumnIfMissing("content_notices", "affected_appeal_text", "affected_appeal_text TEXT");
addColumnIfMissing("content_notices", "affected_appealed_at", "affected_appealed_at INTEGER");
addColumnIfMissing("content_notices", "affected_appeal_decision", "affected_appeal_decision TEXT");
addColumnIfMissing(
  "content_notices",
  "affected_appeal_decided_at",
  "affected_appeal_decided_at INTEGER",
);

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
// EN slug for bilingual blog URLs (backfilled from SEED_EN_SLUG_BY_SLUG on
// every boot via seedBlogPostsIfEmpty). UNIQUE so two posts can't share an
// EN slug; NULL on EN-primary posts whose `slug` is already English-readable.
// SQLite does not allow ADD COLUMN with UNIQUE — index is created below.
addColumnIfMissing("blog_posts", "en_slug", "en_slug TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_en_slug_unique ON blog_posts(en_slug) WHERE en_slug IS NOT NULL",
);
// A post now carries copy in every UI locale, not just the authored HU/EN
// pair. The columns mirror the hu_*/en_* set exactly so `toBlogPost` can
// address them by a single template (`${locale}_title`) instead of five
// hand-written branches. Empty is the resting value and it MEANS
// "not translated yet": `blogCopy` reads a locale with no title or no body
// as absent and serves EN, so shipping the columns before the copy changes
// nothing a reader sees.
for (const locale of ["es", "hr", "de"] as const) {
  for (const field of ["category", "title", "lead", "seo_title", "seo_description"] as const) {
    addColumnIfMissing(
      "blog_posts",
      `${locale}_${field}`,
      `${locale}_${field} TEXT NOT NULL DEFAULT ''`,
    );
  }
  addColumnIfMissing(
    "blog_posts",
    `${locale}_body_json`,
    `${locale}_body_json TEXT NOT NULL DEFAULT '[]'`,
  );
}
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

// Email open tracking pixel — stamped the first time the guest_invite pixel
// loads. Requires invited_at to be set (can't open an invite you haven't received).
addColumnIfMissing("guests", "invitation_opened_at", "invitation_opened_at INTEGER");

// Explicit invite-channel stamps for the /app/invites monitoring page. The
// legacy invited_at / invitation_delivered_at columns are overloaded (a single
// "invited" chip), so we track the two channels separately: online (emailed /
// digital) and physical (handed over in person). Either, both, or neither can
// be set; the derived channel is none/online/physical/both. Sends keep the
// legacy columns in sync so the existing guest-list chip keeps working.
addColumnIfMissing("guests", "invited_online_at", "invited_online_at INTEGER");
addColumnIfMissing("guests", "invited_physical_at", "invited_physical_at INTEGER");

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
// Stable identity for a task materialised from the shared wedding checklist.
// Completion stays on planning_items.done: the checklist and normal task views
// are two presentations of the same row, never two independently-syncing flags.
addColumnIfMissing("planning_items", "checklist_template_id", "checklist_template_id TEXT");
addColumnIfMissing("planning_items", "decision_status", "decision_status TEXT");
addColumnIfMissing("planning_items", "resolution", "resolution TEXT");
// One prompt row per (couple, seed): the generator dedupes on this when it
// lazily materialises a group, so re-opening a group never double-inserts.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planning_seed ON planning_items(couple_id, seed_key) WHERE seed_key IS NOT NULL",
);
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_checklist_template ON planning_items(couple_id, checklist_template_id) WHERE checklist_template_id IS NOT NULL",
);
// Idea triage on kind='idea' rows. `idea_status` is the maybe-pile sorting
// ('doing' | 'maybe' | 'skip', see shared IdeaStatus); `idea_tag` is a loose
// category ('program' | 'decor' | 'surprise' | 'keepsake' | 'experience').
// Both nullable so existing ideas + non-idea kinds stay clean — validation
// only checks the enum, it doesn't force ideas to carry them.
addColumnIfMissing("planning_items", "idea_status", "idea_status TEXT");
addColumnIfMissing("planning_items", "idea_tag", "idea_tag TEXT");
// Kanban lane on kind='task' rows for the planner board ('todo' | 'doing' |
// 'done', see shared PlannerBoardStatus). Kept in lockstep with `done` by the
// writers (done=1 ⇔ 'done') so every done-based reader (couple checklist,
// stats, timeline) stays correct without knowing about lanes. NULL derives as
// done ? 'done' : 'todo', so existing rows need no backfill.
addColumnIfMissing("planning_items", "board_status", "board_status TEXT");
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
addColumnIfMissing("vendor_waitlist", "travel_radius_km", "travel_radius_km INTEGER");
addColumnIfMissing("vendor_waitlist", "tax_number", "tax_number TEXT");
addColumnIfMissing("vendor_waitlist", "registration_number", "registration_number TEXT");

// `couple_supplier_id` back-reference on auto-synced budget lines. When a
// DIY supplier entry on /app/suppliers has a price, the backend creates a
// matching `budget_lines` row stamped with this id. The frontend renders
// those rows as read-only (price is owned by the supplier card) and the
// supplier's update / delete flow keeps them in sync.
addColumnIfMissing("budget_lines", "couple_supplier_id", "couple_supplier_id TEXT");

// `listing_id` is the same back-reference for the OTHER kind of supplier: one
// the couple booked out of the directory rather than typing in by hand. A
// priced directory supplier only earns a line while it is the couple's PICK in
// its category (a price on a candidate they are still comparing is a note, not
// a commitment), so the line is owned by `couple_picks` + `couple_supplier_costs`
// together and is locked here exactly like a `couple_supplier_id` line.
// See domain/listing_budget_mirror.ts for the whole rule.
addColumnIfMissing("budget_lines", "listing_id", "listing_id TEXT");

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

// Tracks which honeymoon preset chip created this line so the label can be
// rendered via i18n regardless of the locale active at creation time.
// NULL for custom rows and any line created before this column existed.
addColumnIfMissing("budget_lines", "preset_key", "preset_key TEXT");

// Optional PDF invoice/receipt attached to a single recorded payment
// (budget_payments). Private financial proof: `pdf_url` is an internal
// `/uploads/couples/<id>/budget-payments/<pid>.pdf` reference served ONLY via
// the gated /api/budget/payments/:id/download route, never the public
// /uploads/* handler (which refuses budget-payments keys — see server.ts).
addColumnIfMissing("budget_payments", "pdf_url", "pdf_url TEXT");
addColumnIfMissing("budget_payments", "pdf_name", "pdf_name TEXT");

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
addColumnIfMissing("couple_suppliers", "probability", "probability INTEGER");
addColumnIfMissing("couple_suppliers", "next_step", "next_step TEXT");

// Location + contact for DIY entries — added so a couple can capture a real
// VENUE they picked on the map (name + address + coordinates + phone/email)
// straight from the guest-page venue picker, and have it double as a reusable
// venue vendor (its coords also drive the guest-page map pin via
// couples.location_lat/lng once selected). All nullable: the vast majority of
// DIY rows (mum's cooking, friend DJ) never set these.
addColumnIfMissing("couple_suppliers", "city", "city TEXT");
addColumnIfMissing("couple_suppliers", "address", "address TEXT");
addColumnIfMissing("couple_suppliers", "lat", "lat REAL");
addColumnIfMissing("couple_suppliers", "lng", "lng REAL");
addColumnIfMissing("couple_suppliers", "contact_email", "contact_email TEXT");
addColumnIfMissing("couple_suppliers", "contact_phone", "contact_phone TEXT");

// The directory listing this private row IS. Two ways it gets set: the couple
// adopted a listing that already existed (the repair path on a duplicate card),
// or the row named a business Weddly didn't list yet and we published it to the
// community directory. Either way the row stops being a second card for the
// same business — every surface renders it from the listing. NULL is the
// ordinary private entry (mum's cooking) that has no listing and wants none.
addColumnIfMissing("couple_suppliers", "listing_id", "listing_id TEXT");

// The other answer to "is this the business we already list?". `listing_id` records
// a yes; this records a no, given by a couple who was shown the listing and said
// theirs is a different business (folding drops the town, so two real venues can
// share a name). Without it the card would re-offer the same listing on every
// load, nagging about a question they already settled.
addColumnIfMissing(
  "couple_suppliers",
  "not_listed_confirmed",
  "not_listed_confirmed INTEGER NOT NULL DEFAULT 0",
);

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
// Explicit, short-lived collaboration presence. Unlike last_seen_at this is
// refreshed only by user interaction in the app, never by background polling.
addColumnIfMissing("users", "working_presence_at", "working_presence_at INTEGER");

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
// Stored as a JSON array of `{v: number, fp: string, last_seen_at: number}`
// records. The fingerprint is a SHA-256 (16 hex chars) of the browser's own
// persisted device id, falling back to browser-family + OS-family from the
// User-Agent: irreversible, no raw PII, and deliberately free of any IP
// component so a dynamic-IP re-lease or a Wi-Fi/mobile switch is NOT read as a
// new machine. `v` is the format version: entries written under an older
// formula are discarded on read, which makes the next sign-in register
// silently instead of mailing every existing user about a hash change.
// First sign-in is likewise silent. See domain/known_devices.ts.
addColumnIfMissing("users", "known_devices_json", "known_devices_json TEXT NOT NULL DEFAULT '[]'");

// Cooldown clock for the alert above: at most one new-device mail per user per
// 24h, so a client that cannot persist its device id (private window, storage
// blocked) can't mint one mail per sign-in. Null = never alerted.
addColumnIfMissing("users", "new_device_alert_at", "new_device_alert_at INTEGER");

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
addColumnIfMissing("users", "survey_prompted_at", "survey_prompted_at INTEGER");

// Distinguishes planner accounts (wedding organiser business) from couple
// accounts. Defaults to 'couple' so every existing + new self-registered user
// stays on the couple path. Planners are promoted via admin action after their
// waitlist application is approved.
addColumnIfMissing("users", "user_type", "user_type TEXT NOT NULL DEFAULT 'couple'");

// Group the acquisition dashboard's hottest breakdowns. Index AFTER the column
// adds (the May 2026 prod-crash rule: indexes on addColumnIfMissing columns
// live in db.ts, never schema.sql).
db.exec("CREATE INDEX IF NOT EXISTS idx_users_signup_country ON users(signup_country)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_utm_campaign ON users(utm_campaign)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type)");

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

// Per-couple meal-menu customisation (custom labels + offered flags for the six
// fixed slots). JSON array of {choice,label,enabled}; null/empty means the
// all-default menu. Cosmetic on top of the stable `meal_choice` enum — see
// shared/meals.ts.
addColumnIfMissing("couples", "meal_menu", "meal_menu TEXT");

// The dinner as printed on the A5 menu card: `{courses:[{title,lines[]}]}` as
// JSON, null/empty meaning "not written yet". A DIFFERENT thing from
// `meal_menu` directly above, which is the six RSVP slots a guest chooses
// between; this is the card on the table, and a wedding has both.
//
// Before this the menu card drew three hardcoded English course labels over
// blank writing rules, and no screen in the product let a couple type a dish.
// An empty value still renders exactly that card (now with localised labels),
// because a blank menu to fill in by hand is a real thing to print.
addColumnIfMissing("couples", "menu_card", "menu_card TEXT");

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

// Free-text note the GUEST writes on the public RSVP, one per household. It is
// deliberately not `households.notes`, which is the couple's own private note
// about the party and would be overwritten by whoever RSVP'd last. Until this
// existed the only free-text box a guest could reach on the whole form was
// "Song request", so anyone with something to say (arriving late, a wheelchair,
// congratulations) had to put it there or nowhere. Nullable: an empty box
// stores NULL rather than "", so "wrote nothing" and "cleared it" read alike.
addColumnIfMissing("households", "guest_message", "guest_message TEXT");

// Does this lodging appear as a CHOICE on the public RSVP form? Default 0,
// because these rows were only ever the couple's private logistics board and
// silently publishing an address, a price and a booking link to every guest
// with a code is not something an existing couple asked for.
//
// Turning it on is what upgrades the RSVP's accommodation question from "do
// you need somewhere to stay?" (a bare 0/1 the couple then had to chase up by
// hand) to "which of these?", writing `guests.accommodation_id` directly. The
// FK and the whole assignment UI already existed; only the guest was never
// asked.
addColumnIfMissing("accommodations", "offer_on_rsvp", "offer_on_rsvp INTEGER NOT NULL DEFAULT 0");

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
// Optional finer-grained lodging: the specific room (within accommodation_id)
// a guest sits in. Cleared when its room is deleted; the parent accommodation
// delete also clears accommodation_id via that column's own SET NULL FK.
addColumnIfMissing(
  "guests",
  "accommodation_room_id",
  "accommodation_room_id INTEGER REFERENCES accommodation_rooms(id) ON DELETE SET NULL",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_guests_accommodation ON guests(accommodation_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_guests_transfer ON guests(transfer_id)");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_guests_accommodation_room ON guests(accommodation_room_id)",
);

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

// Manual display order for the /app/guests household list. Default 0 so the
// existing partner-first → created_at ordering is fully preserved until a
// couple actually drags a card; `listHouseholdsByCouple` tie-breaks an equal
// sort_index by created_at. Written by PATCH /api/households/reorder.
addColumnIfMissing("households", "sort_index", "sort_index INTEGER NOT NULL DEFAULT 0");

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
// What KIND of demo row an is_demo couple is: 'couple' = a visitor-started
// workspace demo, 'planner_client' / 'vendor_client' = throwaway client
// couples the planner/vendor demo seeders create as props. The admin demo
// analytics counts only 'couple' rows as visitor demos; NULL (pre-column
// rows, gone within one 4h sweep) is treated as 'couple'.
addColumnIfMissing("couples", "demo_kind", "demo_kind TEXT");
// Which entry point a purged demo snapshot came from: 'couple' | 'planner' |
// 'vendor' | 'planner_client' | 'vendor_client'. Planner/vendor rows store
// the demo USER id in source_couple_id (a stable retroactive handle, not a
// FK). Historic pre-column rows default to 'couple' — they are a
// couple-heavy blend and stay in the couple bucket.
addColumnIfMissing("demo_usage", "kind", "kind TEXT NOT NULL DEFAULT 'couple'");

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
// Couple-entered venue contact details for the private "Kulcsinfó" dashboard
// panel (NOT the public site, unlike venue_name/venue_city). Free-text; the
// couple fills these in when their venue isn't a picked directory listing.
// venue_address doubles as the Google-Maps search query. Phone fields power a
// one-tap tel: call button; coordinator/emergency are day-of point-of-contact.
addColumnIfMissing("couples", "venue_address", "venue_address TEXT");
addColumnIfMissing("couples", "venue_phone", "venue_phone TEXT");
addColumnIfMissing("couples", "coordinator_name", "coordinator_name TEXT");
addColumnIfMissing("couples", "coordinator_phone", "coordinator_phone TEXT");
addColumnIfMissing("couples", "emergency_name", "emergency_name TEXT");
addColumnIfMissing("couples", "emergency_phone", "emergency_phone TEXT");
addColumnIfMissing("couples", "cover_image_url", "cover_image_url TEXT");
// Cover-photo focal point as object-position percentages (0..100, default 50 =
// centred). The hero crops the cover to a wide band, so the couple drags the
// photo in the guest-page editor to choose which part stays in frame.
addColumnIfMissing("couples", "cover_position_x", "cover_position_x INTEGER NOT NULL DEFAULT 50");
addColumnIfMissing("couples", "cover_position_y", "cover_position_y INTEGER NOT NULL DEFAULT 50");
// Cover-photo zoom as a percent (100 = fit-to-frame, up to 300 = 3x in). Paired
// with the focal point above: the couple drags to reposition + zooms in to crop
// tighter. Stored INTEGER; the guest page scales the image from the focal point.
addColumnIfMissing("couples", "cover_scale", "cover_scale INTEGER NOT NULL DEFAULT 100");
// Two OPTIONAL fixed-slot photos on the public wedding site (slot 1 renders
// after the welcome band, slot 2 before the RSVP ask). Uploaded via
// POST /api/couples/current/site-photo/:slot; stores the /uploads/... URL.
addColumnIfMissing("couples", "site_image_1_url", "site_image_1_url TEXT");
addColumnIfMissing("couples", "site_image_2_url", "site_image_2_url TEXT");

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

// `hero_checked_at` records the last attempt to AUTO-fetch a hero image from the
// listing's own `website` (domain/listing_image_backfill) — the og:image of the
// venue's homepage, downloaded and stored under `listings/<id>/hero.<ext>`. NULL
// means "never attempted": the marker the boot sweep uses to find curated /
// community rows that have a website but no vendor-uploaded hero. Stamped on
// every attempt (hit or miss) so a site without a usable image is tried exactly
// once and never re-hammered on the next deploy. A vendor upload via
// vendor_listing.ts always wins (the sweep skips rows with a vendor_account_id).
addColumnIfMissing("listings", "hero_checked_at", "hero_checked_at INTEGER");

// `gallery_checked_at` is the same one-shot marker as `hero_checked_at`, but for
// the portfolio strip: domain/listing_gallery_backfill downloads a curated
// venue's static seed `gallery_urls` (which hotlink the venue's own website and
// are therefore blocked by our CSP img-src allow-list when rendered) and re-hosts
// them under `listings/<id>/gallery/…` as CSP-safe local copies. NULL means
// "never attempted"; stamped on every attempt (hit or miss) so a venue whose
// images 404 is tried exactly once. Vendor-owned listings are skipped — a paying
// vendor manages their own gallery via vendor_listing.ts.
addColumnIfMissing("listings", "gallery_checked_at", "gallery_checked_at INTEGER");

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

// Cadence for the founding-cohort push (kind 'founding_partner_push'), the
// recurring follow-up to the one-shot stamp above. Deliberately SEPARATE
// columns: reusing invite_partner_reminded_at would break both the admin
// "already reminded" icon and the auto-sweep's one-shot guarantee, and
// email_dispatches can only express once-forever, not "3 times, 5 days
// apart". Count is capped in the worker, not here.
addColumnIfMissing(
  "couples",
  "founding_push_count",
  "founding_push_count INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("couples", "founding_push_last_at", "founding_push_last_at INTEGER");

// Stamp set when an admin asks a churned couple what was actually missing for
// them (the "Missing features" exit reason names a category and nothing else).
// One-shot per pause request, and it lives HERE rather than on `couples`
// because the question is about a specific departure: a couple who cancels the
// pause, comes back and later leaves again is a new conversation, and the new
// request row starts with a NULL. NULL = never asked.
addColumnIfMissing("couple_pause_requests", "feedback_asked_at", "feedback_asked_at INTEGER");

// Provenance for couple_invites. NULL = a human created it from the dashboard
// or profile card. 'founding_push' = the email worker minted it purely so the
// founding-cohort mail could carry a real shareable link. Campaign-minted rows
// are hidden from GET /api/couples/invites/current (so they never tick the
// "invite your partner" checklist or collapse the dashboard card) and are
// ADOPTED rather than 409'd by handleCreateInvite, which keeps the "max one
// outstanding invite per couple" invariant intact.
addColumnIfMissing("couple_invites", "source", "source TEXT");

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
// Start of the CURRENT past-due episode. Unlike current_period_end (which is
// commonly a month in the future), this gives dunning a real seven-day bound.
addColumnIfMissing("couples", "past_due_since", "past_due_since INTEGER");
addColumnIfMissing("planner_subscriptions", "past_due_since", "past_due_since INTEGER");
addColumnIfMissing("vendor_subscriptions", "past_due_since", "past_due_since INTEGER");
// Existing past_due rows predate the transition timestamp. Give that legacy
// cohort one final seven-day window from the first upgraded boot; COALESCE
// makes this idempotent and prevents every restart from extending it.
{
  const migratedAt = Date.now();
  db.prepare(
    "UPDATE couples SET past_due_since = ? WHERE subscription_status = 'past_due' AND past_due_since IS NULL",
  ).run(migratedAt);
  db.prepare(
    "UPDATE planner_subscriptions SET past_due_since = ? WHERE subscription_status = 'past_due' AND past_due_since IS NULL",
  ).run(migratedAt);
  db.prepare(
    "UPDATE vendor_subscriptions SET past_due_since = ? WHERE subscription_status = 'past_due' AND past_due_since IS NULL",
  ).run(migratedAt);
}
// Planner-managed billing extra (the "vendégoldal" guest-page edit add-on).
// A planner-managed couple is viewer-only by default once their own free
// window lapses; the planner edits. `guest_page_prepaid` = the couple paid
// their 30% share (the 70%-off add-on checkout completed) — the precondition
// the planner needs before they can switch on guest-page editing for the
// couple. `guest_page_addon` = the add-on is switched on, so couple members
// regain edit access to their own guest page / website. See domain/billing.ts.
addColumnIfMissing(
  "couples",
  "guest_page_prepaid",
  "guest_page_prepaid INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("couples", "guest_page_addon", "guest_page_addon INTEGER NOT NULL DEFAULT 0");
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

// One-time backfill: additional workspaces (couple.create_additional) were
// historically inserted at the schema-default subscription_status='none' and
// never trialed, so they went read-only ("Csak olvasható") the instant they
// were created — a user running several events could only edit the first. The
// route now starts a trial like onboarding does; this heals the rows created
// before that fix. Discriminator: a couple that went through onboarding ALWAYS
// has trial_ends_at stamped by startTrial, so status='none' AND trial_ends_at
// IS NULL uniquely marks a never-trialed additional workspace — a revoked comp
// (which trialed first) keeps its trial_ends_at and is left untouched.
// Pre-launch 'none' rows were already flipped to 'founding' by the grandfather
// above, so they don't match either. Idempotent: once trialed the rows are
// 'trialing' and never match again.
{
  const nowMs = Date.now();
  const trialEnd = Math.max(nowMs + TRIAL_DURATION_MS, PAID_LAUNCH_DATE);
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'trialing', trial_ends_at = ?, updated_at = ?
      WHERE is_demo = 0
        AND subscription_status = 'none'
        AND trial_ends_at IS NULL`,
  ).run(trialEnd, nowMs);
}

// Carry the already-stamped trials forward whenever PAID_LAUNCH_DATE moves.
// `startTrial` stamps `max(now + 14d, PAID_LAUNCH_DATE)`, so every couple that
// onboarded before the launch date holds it as their literal trial_ends_at —
// 112 of them shared 2026-08-01 when the date was pushed to the end of August
// on 2026-08-03. Without this they would keep an end date a month behind the
// promise, and the `trial_ended` mail would fire against the old boundary.
//
// Only ever moves a date FORWARD, and only for live trials, so it can never
// shorten a window somebody is relying on, can never resurrect an expired one
// into a fresh month, and settles to a no-op on the next boot. A couple whose
// own 14-day window already reaches past the launch date is untouched: the
// condition is exactly `startTrial`'s max(), read back.
{
  const nowMs = Date.now();
  db.prepare(
    `UPDATE couples
        SET trial_ends_at = ?, updated_at = ?
      WHERE is_demo = 0
        AND subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < ?`,
  ).run(PAID_LAUNCH_DATE, nowMs, PAID_LAUNCH_DATE);
}

// One-time grandfather: every planner that existed BEFORE planner billing
// launched is an early adopter, so give them a founding comp (free for two years
// from boot, no card). Idempotent — only planners with no planner_subscriptions
// row yet are touched, so after the first run (and for planners granted after
// launch, who get a row at grant time via initPlannerBilling) this never repeats.
// Currency is pinned from each planner's locale.
{
  const ungranted = db
    .prepare(
      `SELECT u.id, u.locale FROM users u
        WHERE u.user_type = 'planner'
          AND NOT EXISTS (SELECT 1 FROM planner_subscriptions ps WHERE ps.user_id = u.id)`,
    )
    .all() as Array<{ id: number; locale: string | null }>;
  if (ungranted.length > 0) {
    const nowMs = Date.now();
    const foundingUntil = nowMs + 1000 * 60 * 60 * 24 * 365 * 2;
    const insert = db.prepare(
      `INSERT INTO planner_subscriptions
         (user_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'founding', NULL, ?, 1, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const p of ungranted) {
        const currency = p.locale === "hu" ? "HUF" : "EUR";
        insert.run(p.id, foundingUntil, currency, nowMs, nowMs);
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

// A new payment surface is never live by accident. INSERT OR IGNORE preserves
// the operator's runtime choice across deploys while safely seeding products
// added by a newer release as OFF.
addColumnIfMissing(
  "payment_launch_control",
  "version",
  "version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)",
);
for (const product of [
  "couple_subscriptions",
  "planner_subscriptions",
  "vendor_billing",
  "film_checkout",
  "guest_page_addon",
] as const) {
  db.prepare("INSERT OR IGNORE INTO payment_launch_control (product, enabled) VALUES (?, 0)").run(
    product,
  );
}

/** A paid-access wall is safe only while every affected audience has a working
 * recovery checkout. Keep this low-level so every entitlement read fails open
 * if a launch is paused or a required deployment value disappears. */
function subscriptionRecoveryAvailable(): boolean {
  const launched = db
    .prepare(
      `SELECT COUNT(*) AS n FROM payment_launch_control
        WHERE enabled = 1 AND product IN (
          'couple_subscriptions', 'planner_subscriptions', 'vendor_billing'
        )`,
    )
    .get() as { n: number };
  const configured = [
    CONFIG.stripeSecretKey,
    CONFIG.stripeWebhookSecret,
    CONFIG.stripePriceEur,
    CONFIG.stripePriceHuf,
    CONFIG.stripePlannerWebhookSecret,
    CONFIG.stripePricePlanner.starter.EUR,
    CONFIG.stripePricePlanner.starter.HUF,
    CONFIG.stripePricePlanner.pro.EUR,
    CONFIG.stripePricePlanner.pro.HUF,
    CONFIG.stripePricePlanner.premium.EUR,
    CONFIG.stripePricePlanner.premium.HUF,
    CONFIG.stripeVendorWebhookSecret,
    CONFIG.stripePriceVendorEur,
    CONFIG.stripePriceVendorHuf,
  ].every((value) => value.trim() !== "");
  return launched.n === 3 && configured;
}

// A deploy can remove a Stripe value while the persisted paywall flag is ON.
// Reconcile that invalid state once at boot and leave an append-only system
// audit trail. Restoring configuration never turns the wall back on by itself.
const storedBillingControl = db
  .prepare("SELECT enforcement_on FROM billing_control WHERE id = 1")
  .get() as { enforcement_on: number } | undefined;
if (storedBillingControl?.enforcement_on === 1 && !subscriptionRecoveryAvailable()) {
  db.transaction(() => {
    db.prepare(
      `UPDATE billing_control
          SET enforcement_on = 0, enforced_at = NULL, enforced_by_user_id = NULL
        WHERE id = 1`,
    ).run();
    db.prepare(
      `INSERT INTO audit_log
        (actor_user_id, couple_id, action, target_kind, target_id,
         before_json, after_json, note, created_at)
       VALUES (NULL, NULL, ?, 'billing_control', 1, ?, ?, ?, ?)`,
    ).run(
      "system.billing_enforcement.auto_disabled",
      JSON.stringify({ enforcement_on: true }),
      JSON.stringify({ enforcement_on: false }),
      "Subscription payment recovery was unavailable at boot",
      Date.now(),
    );
  })();
  console.warn("[billing] global paywall disabled: subscription payment recovery is unavailable");
}

/** Whether the read-only paywall is currently being enforced. When false the
 *  freeze is deferred and every couple stays editable (see toCoupleBilling). A
 *  boot-time reconciliation and admin mutation invariant guarantee that a
 *  persisted ON is never retained without subscription recovery. */
export function billingEnforcementOn(): boolean {
  const row = db.prepare("SELECT enforcement_on FROM billing_control WHERE id = 1").get() as
    | { enforcement_on: number }
    | undefined;
  return row?.enforcement_on === 1;
}

/** When the switch was last flipped ON, or null while the freeze is deferred.
 *  This is the instant the wall APPEARS, and so the instant a couple's post-
 *  trial grace week can start counting: a couple whose trial lapsed months
 *  before go-live has not had a week's warning just because the calendar moved.
 *  Returns null when enforcement is off, since there is no wall to count from
 *  and the deferred-freeze override makes everyone entitled anyway. */
export function billingEnforcedAt(): number | null {
  const row = db
    .prepare("SELECT enforcement_on, enforced_at FROM billing_control WHERE id = 1")
    .get() as { enforcement_on: number; enforced_at: number | null } | undefined;
  if (row?.enforcement_on !== 1) return null;
  return row.enforced_at ?? null;
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
// `image_kind` says whether `image_url` is the product's own photo or the
// shop's logo, which is the fallback we resolve when a page publishes no
// og:image. The two want opposite framing (a photo fills the tile, a logo is
// contained on the ground), and the mirrored /uploads key cannot tell them
// apart. NULL on every legacy row, which the mappers read as "photo" — that is
// what those rows are, since the logo ladder did not exist when they were
// written.
//
// Adding it is ALSO the one-time trigger to re-open the image sweep for linked
// rows that never got a picture. Those were stamped `image_checked_at` by a
// version that could only look for an og:image, so a page publishing none
// dead-ended for good — and the logo ladder now has a real answer for exactly
// those links. Clearing the stamp is what puts them back in
// `listWishlistRowsNeedingImageBackfill`; the sweep re-stamps each one, so this
// costs one attempt per row and then converges, found or not. The column's own
// absence is the guard, so the boot that adds it is the only one that runs it.
{
  const cols = db.query("PRAGMA table_info(wishlist_items)").all() as { name: string }[];
  const isNew = !cols.some((c) => c.name === "image_kind");
  addColumnIfMissing("wishlist_items", "image_kind", "image_kind TEXT");
  if (isNew) {
    const r = db
      .prepare(
        "UPDATE wishlist_items SET image_checked_at = NULL WHERE url IS NOT NULL AND image_url IS NULL",
      )
      .run();
    if (r.changes > 0) {
      console.log(`[db.backfill] re-opened the image sweep on ${r.changes} linked wishlist row(s)`);
    }
  }
}
// `icon` is the couple's chosen glyph for a wish with no picture at all, a slug
// from WISHLIST_ICON_SLUGS. NULL means "use the default for the kind", so every
// existing row keeps a sensible mark with no backfill.
addColumnIfMissing("wishlist_items", "icon", "icon TEXT");
// `currency` is a per-item override of the couple's display currency. NULL (the
// default for every existing row) means "inherit the couple's currency", so the
// additive add is a safe no-op for legacy data.
addColumnIfMissing("wishlist_items", "currency", "currency TEXT");
// `pledged_amount_minor` is the soft, non-binding amount a household enters when
// tapping "I'd like to help" on a group gift. NULL on every legacy row (tapped
// in without a number), so the additive add is a safe no-op.
addColumnIfMissing("wishlist_interests", "pledged_amount_minor", "pledged_amount_minor INTEGER");
// `notification_email` is the opt-in address a guest provides at pledge time so
// they can receive group-gift coordination emails when other households join.
// NULL when the guest didn't provide one (the common case). Never returned in
// any HTTP response — only read server-side by the mailer. Additive: all
// existing rows default to NULL (no notification).
addColumnIfMissing("wishlist_interests", "notification_email", "notification_email TEXT");
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
// category + amount_minor: gift classification ("gift","money","experience","voucher")
// and optional money value (integer minor units, same convention as wishlist).
addColumnIfMissing("received_gifts", "category", "category TEXT NOT NULL DEFAULT 'gift'");
addColumnIfMissing("received_gifts", "amount_minor", "amount_minor INTEGER");
// `income_id` records which `couple_income` row a gift was carried over from
// when the budget page's separate money-in ledger was folded into this one.
// NULL for everything the couple typed here. It is provenance, but its real
// job is the UNIQUE index below: that is what makes the carry-over idempotent,
// and therefore safe to run on every boot rather than once by hand.
addColumnIfMissing("received_gifts", "income_id", "income_id INTEGER");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_received_gifts_income ON received_gifts(income_id) WHERE income_id IS NOT NULL",
);

// Notification preference columns (cadence + focus areas).
addColumnIfMissing(
  "couples",
  "notif_email_cadence",
  "notif_email_cadence TEXT NOT NULL DEFAULT '1_weekly'",
);
addColumnIfMissing(
  "couples",
  "notif_focus",
  "notif_focus TEXT NOT NULL DEFAULT 'timeline,rsvp,partner'",
);

// One-shot: reset invite_partner_reminded_at for solo couples whose
// partner_invite_reminder email was 429-rate-limited by Resend and never
// actually delivered. The stamp was written before the fire-and-forget send,
// so without this reset those accounts would never receive the nudge.
// Safe to re-run: once the sweep successfully sends the email the log has a
// 'sent' entry, so the WHERE clause no longer matches.
{
  const result = db
    .prepare(
      `UPDATE couples
          SET invite_partner_reminded_at = NULL
        WHERE invite_partner_reminded_at IS NOT NULL
          AND partner_b_id IS NULL
          AND status = 'active'
          AND id IN (
            SELECT DISTINCT couple_id FROM email_log
             WHERE kind = 'partner_invite_reminder'
               AND status = 'failed'
               AND error LIKE '%429%'
               AND couple_id NOT IN (
                 SELECT DISTINCT couple_id FROM email_log
                  WHERE kind = 'partner_invite_reminder' AND status = 'sent'
               )
          )`,
    )
    .run();
  if (result.changes > 0) {
    console.log(
      `[db.fix] reset invite_partner_reminded_at on ${result.changes} couple(s) blocked by Resend 429`,
    );
  }
}

// Referral system. Each couple gets a unique 8-char invite code (generated
// lazily on first GET /api/referral). When a new couple onboards with a valid
// code, `referred_by_couple_id` records the referrer. The actual reward
// (extending trial_ends_at / founding_until) is applied in domain/referrals.ts
// and logged to referral_grants to prevent double-granting.
addColumnIfMissing("couples", "referral_code", "referral_code TEXT");
addColumnIfMissing(
  "couples",
  "referred_by_couple_id",
  "referred_by_couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL",
);
// Unique index lives here (not schema.sql) — the column is added above via
// addColumnIfMissing, and indexes on addColumnIfMissing columns must come after
// the column call (May 2026 prod-crash rule).
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_couples_referral_code_unique " +
    "ON couples(referral_code) WHERE referral_code IS NOT NULL",
);

// Vendor waitlist entries can carry a referral code so the referring couple
// is credited when the vendor activates. Stored as couple_id (resolved at
// submit time) so it survives even if the code is later regenerated.
addColumnIfMissing(
  "vendor_waitlist",
  "referred_by_couple_id",
  "referred_by_couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL",
);

export function now(): number {
  return Date.now();
}

// Guest photo album tables (defined in schema.sql) — indexes here per the
// May 2026 addColumnIfMissing/schema.sql ordering rule.
db.exec("CREATE INDEX IF NOT EXISTS idx_photo_albums_couple ON photo_albums(couple_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_photo_albums_token ON photo_albums(upload_token)");
db.exec("CREATE INDEX IF NOT EXISTS idx_photo_uploads_album ON photo_uploads(album_id)");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_photo_uploads_device ON photo_uploads(album_id, device_id)",
);

// Wedding Film: new columns on existing tables (additive only).
addColumnIfMissing("photo_albums", "cover_image_url", "cover_image_url TEXT");
addColumnIfMissing(
  "photo_albums",
  "film_aesthetic",
  "film_aesthetic TEXT NOT NULL DEFAULT 'natural'",
);
addColumnIfMissing("photo_albums", "event_ends_at", "event_ends_at INTEGER");
addColumnIfMissing("photo_albums", "guest_cap", "guest_cap INTEGER NOT NULL DEFAULT 15");
addColumnIfMissing("photo_albums", "stripe_payment_id", "stripe_payment_id TEXT");
addColumnIfMissing("photo_albums", "stripe_tier", "stripe_tier TEXT");
addColumnIfMissing("photo_albums", "paid_at", "paid_at INTEGER");
// Bump existing free-tier albums from the old trial cap of 5 to 15.
// Must run after paid_at column exists.
db.exec("UPDATE photo_albums SET guest_cap = 15 WHERE guest_cap = 5 AND paid_at IS NULL");
addColumnIfMissing("photo_uploads", "filter_applied", "filter_applied TEXT");
addColumnIfMissing("photo_uploads", "thumbnail_path", "thumbnail_path TEXT");
// Custom guest-link slug (#17). Partial unique index lives AFTER the column add
// (May 2026 ordering rule); WHERE slug IS NOT NULL so NULLs never collide.
addColumnIfMissing("photo_albums", "slug", "slug TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_albums_slug " +
    "ON photo_albums(slug) WHERE slug IS NOT NULL",
);
// Participant soft-remove (#6) — never hard-delete (data-loss ban).
addColumnIfMissing("film_devices", "removed_at", "removed_at INTEGER");
addColumnIfMissing("photo_uploads", "hidden_at", "hidden_at INTEGER");
// Couple-upload source tag (#11). Retro-tag pre-existing couple uploads — must
// run AFTER the column add.
addColumnIfMissing("photo_uploads", "source", "source TEXT NOT NULL DEFAULT 'guest'");
db.exec("UPDATE photo_uploads SET source = 'couple' WHERE device_id = 'couple'");
// A device row represents a guest-camera session, not necessarily a guest.
// Keep its source explicit so legacy couple-upload sessions never consume the
// guest cap or appear in the host's joined-guests dashboard.
addColumnIfMissing("film_devices", "source", "source TEXT NOT NULL DEFAULT 'guest'");
// SQLite's LOWER() is ASCII-only in our build. Store the Unicode-normalized
// identity key explicitly so Hungarian names group consistently across
// browsers (`Nóra` and `nÓRA` are one guest).
addColumnIfMissing("film_devices", "guest_name_key", "guest_name_key TEXT");
const filmDeviceNames = db
  .prepare("SELECT id, guest_name AS guestName FROM film_devices")
  .all() as Array<{ id: number; guestName: string | null }>;
const backfillFilmDeviceNameKey = db.transaction(
  (rows: Array<{ id: number; guestName: string | null }>) => {
    const update = db.prepare("UPDATE film_devices SET guest_name_key = ? WHERE id = ?");
    for (const row of rows) {
      const key = row.guestName?.trim()
        ? row.guestName.trim().normalize("NFKC").toLocaleLowerCase("hu")
        : null;
      update.run(key, row.id);
    }
  },
);
backfillFilmDeviceNameKey(filmDeviceNames);
db.exec("UPDATE film_devices SET source = 'couple' WHERE device_id = 'couple'");
db.exec(
  `UPDATE film_devices AS fd
      SET source = 'couple'
    WHERE EXISTS (
            SELECT 1 FROM photo_uploads pu
             WHERE pu.album_id = fd.album_id
               AND pu.device_id = fd.device_id
               AND pu.source = 'couple'
          )
      AND NOT EXISTS (
            SELECT 1 FROM photo_uploads pu
             WHERE pu.album_id = fd.album_id
               AND pu.device_id = fd.device_id
               AND pu.source = 'guest'
          )`,
);
addColumnIfMissing("couples", "honeymoon_cover_path", "honeymoon_cover_path TEXT");
// Which rung of the destination breadcrumb the cached photo is actually of.
// The cache is keyed by the full saved destination as well as by the place
// that won, so this is what lets the hero caption say "Roma" when the couple
// saved a church address in Rome. NULL on rows cached before the ladder, and
// on the empty-path rows that remember a miss.
addColumnIfMissing("destination_photo_cache", "matched", "matched TEXT");
addColumnIfMissing("planner_waitlist", "selected_plan", "selected_plan TEXT");
addColumnIfMissing("planner_waitlist", "website", "website TEXT");
addColumnIfMissing("planner_waitlist", "weddings_per_year", "weddings_per_year INTEGER");
addColumnIfMissing("planner_waitlist", "usage", "usage TEXT");
addColumnIfMissing("planner_waitlist", "km_radius", "km_radius INTEGER");
addColumnIfMissing("planner_waitlist", "wedding_style_1", "wedding_style_1 TEXT");
addColumnIfMissing("planner_waitlist", "wedding_style_2", "wedding_style_2 TEXT");
addColumnIfMissing("planner_waitlist", "wedding_style_3", "wedding_style_3 TEXT");
addColumnIfMissing("planner_waitlist", "other_style", "other_style TEXT");
addColumnIfMissing("planner_waitlist", "reference_links", "reference_links TEXT");
addColumnIfMissing("planner_waitlist", "early_bird", "early_bird INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("planner_waitlist", "sent_subject", "sent_subject TEXT");
addColumnIfMissing("planner_waitlist", "sent_body", "sent_body TEXT");

// film_devices index lives here (not schema.sql) per project rule.
db.exec("CREATE INDEX IF NOT EXISTS idx_film_devices_album ON film_devices(album_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_film_devices_device ON film_devices(album_id, device_id)");

// Guest email on the wedding-film camera page: identifies a guest more
// precisely than a first name (two "Anna"s no longer merge into one
// participant), lets the couple get a guest's own photos back to them, and,
// only with its own explicit checkbox, records marketing consent. Same
// lowercased-key idiom as guest_name_key, for the same reason (case-insensitive
// matching across sessions).
addColumnIfMissing("film_devices", "email", "email TEXT");
addColumnIfMissing("film_devices", "email_key", "email_key TEXT");
addColumnIfMissing(
  "film_devices",
  "marketing_opt_in",
  "marketing_opt_in INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("film_devices", "marketing_opt_in_at", "marketing_opt_in_at INTEGER");
db.exec("CREATE INDEX IF NOT EXISTS idx_film_devices_email ON film_devices(album_id, email_key)");

// Stamped on every device row in a guest's identity group once the couple's
// "email guests their photos" action has mailed that guest — the group-wide
// stamp (not per-device) is what makes a second click only reach guests who
// joined or uploaded since the last round, never a repeat send.
addColumnIfMissing("film_devices", "photos_emailed_at", "photos_emailed_at INTEGER");

// planner_clients indexes live here (not schema.sql) per the May 2026 ordering rule.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planner_clients_planner ON planner_clients(planner_user_id)",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_planner_clients_couple ON planner_clients(couple_id)");

// planner_messages indexes — same ordering rule.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planner_messages_planner ON planner_messages(planner_user_id, created_at DESC)",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planner_messages_thread ON planner_messages(planner_user_id, couple_id, created_at ASC)",
);

// Planner private notes per client — additive, null = no notes yet.
addColumnIfMissing("planner_clients", "notes", "notes TEXT");
// Planner-side CRM fields — contact info, financials, pipeline stage.
addColumnIfMissing("planner_clients", "client_phone", "client_phone TEXT");
addColumnIfMissing("planner_clients", "client_alt_email", "client_alt_email TEXT");
addColumnIfMissing("planner_clients", "lead_source", "lead_source TEXT");
addColumnIfMissing("planner_clients", "contract_value", "contract_value INTEGER");
addColumnIfMissing("planner_clients", "deposit_paid", "deposit_paid INTEGER");
addColumnIfMissing("planner_clients", "stage", "stage TEXT DEFAULT 'active'");
// Who created the link — gates the pending→active accept transition by
// direction. 'couple' = couple invited the planner (planner accepts);
// 'planner' = planner requested the couple (couple accepts). Defaulting
// existing rows to 'couple' is safe: every pre-existing pending row WAS a
// couple-initiated invite (the only pending path before this column), and
// active rows have already cleared the accept gate so their direction is moot.
addColumnIfMissing(
  "planner_clients",
  "initiated_by",
  "initiated_by TEXT NOT NULL DEFAULT 'couple'",
);

// planner_events index (same ordering rule; table created in schema.sql).
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_planner_events_user ON planner_events(planner_user_id, event_date)",
);
// Optional end time (HH:MM) so meetings/appointments can carry a duration.
addColumnIfMissing("planner_events", "end_time", "end_time TEXT");

// Planner profile fields — additive, all nullable (planners fill in later).
addColumnIfMissing("users", "business_name", "business_name TEXT");
addColumnIfMissing("users", "planner_bio", "planner_bio TEXT");
addColumnIfMissing("users", "planner_city", "planner_city TEXT");
addColumnIfMissing("users", "planner_website", "planner_website TEXT");
addColumnIfMissing("users", "planner_phone", "planner_phone TEXT");
addColumnIfMissing("users", "planner_max_clients", "planner_max_clients INTEGER DEFAULT 4");
addColumnIfMissing("users", "planner_plan", "planner_plan TEXT DEFAULT 'starter'");
addColumnIfMissing("users", "planner_onboarding_done", "planner_onboarding_done INTEGER DEFAULT 0");
// Business attributes carried over from the public planner waitlist — useful
// CRM/directory data, all nullable. planner_styles holds a JSON string[].
addColumnIfMissing("users", "planner_weddings_per_year", "planner_weddings_per_year INTEGER");
addColumnIfMissing("users", "planner_km_radius", "planner_km_radius INTEGER");
addColumnIfMissing("users", "planner_styles", "planner_styles TEXT");
// Planner-set free-text availability shown to couples in the directory detail
// (e.g. "2027 Q3-ra van szabad dátumom"). Nullable, planner-editable.
addColumnIfMissing("users", "planner_availability", "planner_availability TEXT");
// Planner profile photo — an uploaded avatar served from /uploads/planners/...
addColumnIfMissing("users", "planner_avatar_url", "planner_avatar_url TEXT");
// Business category typed by the admin at planner provisioning (free text,
// e.g. "esküvőszervező", "dekoratőr"). Surfaced on the admin Szervezők list
// and in the activation email; not used for matching.
addColumnIfMissing("users", "planner_category", "planner_category TEXT");
// Admin-granted trust badge. When 1 the couple-facing planner directory shows a
// "verified" badge on the card + detail. Toggled from the admin Szervezők list;
// defaults to 0 so a badge is an explicit editorial signal, never automatic.
addColumnIfMissing("users", "planner_verified", "planner_verified INTEGER DEFAULT 0");
// Official business identity, filled by the company lookup (routes/company_lookup.ts)
// or typed manually. planner_country is ISO 3166-1 alpha-2 (shared/country_list.ts)
// and decides whether the lookup UI appears at all.
addColumnIfMissing("users", "planner_country", "planner_country TEXT");
addColumnIfMissing("users", "planner_registry_number", "planner_registry_number TEXT");
addColumnIfMissing("users", "planner_vat_number", "planner_vat_number TEXT");
addColumnIfMissing("users", "planner_legal_form", "planner_legal_form TEXT");
addColumnIfMissing("users", "planner_address", "planner_address TEXT");
// Planner opted in to be notified when paid plans launch (1 = notify me).
addColumnIfMissing("users", "planner_plan_notify", "planner_plan_notify INTEGER DEFAULT 0");

// Unix ms the "share Weddly" prompt was auto-shown to this user. Write-once
// latch (POST /api/auth/share-prompt-seen) so the automatic popup fires at most
// once per ACCOUNT rather than once per browser — clearing storage or moving to
// a second device must not re-ask. Null on every pre-feature row, which is the
// correct "never shown" reading.
addColumnIfMissing("users", "share_prompt_seen_at", "share_prompt_seen_at INTEGER");

// JSON array of the workspace nav destinations this user has actually opened
// ("/app/guests", "/app/seating", …). Drives the rail's "not explored yet"
// treatment: a destination the couple has never opened stays muted and carries
// a small dot until they land on it once. Server-side rather than
// localStorage-only for the same reason as the share latch above — a new device
// must not re-mark a workspace the couple has used for months as unexplored.
// NULL on every pre-feature row, which reads as "explored nothing yet"; those
// couples get one pass of dots and clear them by using the app.
addColumnIfMissing("users", "visited_nav", "visited_nav TEXT");

// Public reference codes for the two principal parties — organisers (couples)
// get "O" + 5 digits, vendors get "V" + 5 digits. New rows are assigned a code
// at creation time (routes/couples.ts onboarding, domain/vendor_accounts.create);
// pre-existing rows get backfilled once on boot below.
addColumnIfMissing("couples", "organiser_code", "organiser_code TEXT");
addColumnIfMissing("vendor_accounts", "vendor_code", "vendor_code TEXT");
// Self-serve vendor signup runs a short in-app onboarding wizard after the
// account is created; this flag is flipped on completion so the dashboard
// stops redirecting back into the wizard. DEFAULT 1 (= already onboarded) so
// every pre-existing row and every account minted by the claim flow (which has
// no wizard) is treated as done — only the self-serve register path inserts a
// 0 to opt a fresh signup into the wizard.
addColumnIfMissing(
  "vendor_accounts",
  "onboarding_done",
  "onboarding_done INTEGER NOT NULL DEFAULT 1",
);
// Company identity collected at vendor signup (mirrors the planner_* block on
// users), auto-filled from the free official registry lookup where one
// exists, manual entry elsewhere. All nullable; signup only requires the
// business name + category.
addColumnIfMissing("vendor_accounts", "country", "country TEXT");
addColumnIfMissing("vendor_accounts", "registry_number", "registry_number TEXT");
addColumnIfMissing("vendor_accounts", "legal_form", "legal_form TEXT");
addColumnIfMissing("vendor_accounts", "address", "address TEXT");
addColumnIfMissing("vendor_accounts", "city", "city TEXT");
addColumnIfMissing("vendor_accounts", "postal_code", "postal_code TEXT");
// Legal company name, kept DISTINCT from `display_name` (the public brand / ad
// name shown on the listing). A vendor trades under a brand but invoices under
// a Kft./Bt./etc.; the public card shows the brand big and the company name
// small underneath. Nullable — only ever surfaces when it diverges from the
// display name. One-time backfill seeds it from the current display_name so the
// admin edit modal opens pre-populated and nothing visually changes until the
// two are made to differ (guarded so it runs exactly once, like share_nudge).
const companyNameColExisted = (
  db.query("PRAGMA table_info(vendor_accounts)").all() as { name: string }[]
).some((r) => r.name === "company_name");
addColumnIfMissing("vendor_accounts", "company_name", "company_name TEXT");
if (!companyNameColExisted) {
  db.prepare(
    "UPDATE vendor_accounts SET company_name = display_name WHERE company_name IS NULL",
  ).run();
}
// One-shot stamp for the "share your profile" nudge the email worker fires ~2h
// after a vendor account is created (domain/emails/worker.ts →
// sweepVendorProfileShareNudge). NULL = not yet sent; a fresh account inserts
// NULL and becomes eligible once 2h have passed. The one-time backfill just
// below stamps every PRE-EXISTING vendor to its created_at, so shipping this
// never floods the back catalogue with "you just created your profile" mail.
// Guarded by the column-just-added check so it runs exactly once (a plain
// boot-time UPDATE would also re-stamp brand-new vendors before their 2h mark
// and silently kill the nudge).
const shareNudgeColumnExisted = (
  db.query("PRAGMA table_info(vendor_accounts)").all() as { name: string }[]
).some((r) => r.name === "share_nudge_sent_at");
addColumnIfMissing("vendor_accounts", "share_nudge_sent_at", "share_nudge_sent_at INTEGER");
if (!shareNudgeColumnExisted) {
  db.prepare(
    "UPDATE vendor_accounts SET share_nudge_sent_at = created_at WHERE share_nudge_sent_at IS NULL",
  ).run();
}
// Recurring "your listing is still incomplete" reminder bookkeeping
// (sweepVendorProfileIncomplete). `profile_nudge_last_at` = epoch ms of the last
// incomplete-nudge sent (NULL = never); `profile_nudge_count` = how many have
// gone out, which both CAPS the series and drives copy-variant rotation. No
// backfill on purpose: a pre-existing incomplete vendor SHOULD start getting
// nudged, and the first-send grace is anchored on vendor_accounts.created_at in
// the worker (so brand-new signups still get their grace window).
addColumnIfMissing("vendor_accounts", "profile_nudge_last_at", "profile_nudge_last_at INTEGER");
addColumnIfMissing(
  "vendor_accounts",
  "profile_nudge_count",
  "profile_nudge_count INTEGER NOT NULL DEFAULT 0",
);
// A retained-but-inactive contact address from a duplicate account merged into
// this one (mergeVendorAccounts in domain/vendor_merge.ts). The primary
// `contact_email` is the only address anything mails or shows the vendor as
// their own; this is kept on file only so the old inbox isn't forgotten.
addColumnIfMissing("vendor_accounts", "secondary_contact_email", "secondary_contact_email TEXT");
// Vendor-written label behind category='other' listings: the "my service
// isn't in the taxonomy yet" escape hatch on the signup form.
addColumnIfMissing("listings", "custom_category", "custom_category TEXT");
// Anti-fraud pricing cooldown anchor: epoch ms of the vendor's last accepted
// price_band change (see PRICE_BAND_COOLDOWN_DAYS in shared/listings.ts).
// NULL = the published band was never changed, so the next change is free.
addColumnIfMissing("listings", "price_band_changed_at", "price_band_changed_at INTEGER");
// Anchors the 7-day rename cooldown (shared/listings.ts). Null until the first
// self-serve rename, so the name a listing was moderated under never starts the
// clock and the first correction is free.
addColumnIfMissing("listings", "name_changed_at", "name_changed_at INTEGER");
// Comma-separated ISO 639-1 codes a verbal vendor (celebrant / MC) confidently
// works in. NULL on every other category and until a vendor fills it in.
addColumnIfMissing("listings", "spoken_languages", "spoken_languages TEXT");
// Google Places reputation, refreshed by the operator-run
// `scripts/google_places_sync.ts` (billed API, so nothing syncs automatically).
// Read-only ranking input for the public browse teaser: a country's vendors
// lead, and inside that the better-rated ones do. NULL means "never resolved"
// and sorts after every rated listing rather than as a zero.
addColumnIfMissing("listings", "google_place_id", "google_place_id TEXT");
addColumnIfMissing("listings", "google_rating", "google_rating REAL");
addColumnIfMissing("listings", "google_ratings_count", "google_ratings_count INTEGER");
addColumnIfMissing("listings", "google_synced_at", "google_synced_at INTEGER");
// When `scripts/geocode_listings.ts` last asked the geocoder about this row.
// Stamped on a miss too, so an unfindable address can't be re-queried on every
// run; NULL means "never asked". Curated rows get their coords from
// suppliers_data.ts instead and never enter that script's candidate set.
addColumnIfMissing("listings", "geo_synced_at", "geo_synced_at INTEGER");
// 1 when this card's content was imported from the business's own profile on
// another platform, rather than assembled from what they publish themselves.
// While such a listing is unclaimed the public surfaces redact it down to a
// teaser (one photo, no bio, no price, no phone) — see `redactUnclaimedImport`
// in domain/listings.ts. Written by the curated re-sync from
// `profile_imported` in suppliers_data.ts; 0 for everything else.
addColumnIfMissing("listings", "profile_imported", "profile_imported INTEGER NOT NULL DEFAULT 0");

// Why a listing's contact_email is held back from use; NULL means usable, and
// almost every row is NULL. See ContactEmailFlag in shared/suppliers.ts: a
// flagged listing is skipped by the claim-invite campaign and reports itself
// as having no email at every couple-facing exit, while an admin still sees
// the address and the reason.
addColumnIfMissing("listings", "contact_email_flag", "contact_email_flag TEXT");
// The currency this listing quotes packages in. NULLABLE, and NULL is a real
// answer rather than a missing one: it means "whatever this country trades in"
// (`currencyForCountry`), so a whole market is correct with no row edited and
// stays correct if a listing changes country. A value here is the vendor saying
// otherwise on purpose. Read only through `listingCurrency`.
addColumnIfMissing("listings", "currency", "currency TEXT");
// Structured package pricing, replacing the free-text `price_text` (kept, and
// still rendered for rows written before this — see shared/listing_packages.ts).
// Whole units of the listing's currency. `price_mode` is what makes the numbers
// readable at all: "250 000" is not a price until you know whether it buys the
// whole job or one seat.
addColumnIfMissing("listing_packages", "price_min", "price_min INTEGER");
addColumnIfMissing("listing_packages", "price_max", "price_max INTEGER");
addColumnIfMissing("listing_packages", "price_mode", "price_mode TEXT");
// Vendor opt-in: hide the tail of the public-page address + contact email from
// anonymous visitors (a reason to register — same gate as the always-on phone
// mask). Off by default, so existing listings show full contact exactly as
// before. Only vendor-owned (claimed) listings expose the toggle.
addColumnIfMissing(
  "listings",
  "hide_contact_public",
  "hide_contact_public INTEGER NOT NULL DEFAULT 0",
);
// Per-photo vertical focal point (object-position %, 0..100, 50 = centred).
// Every gallery slot crops to a fixed aspect, so a portrait shot loses its
// subject to the crop; the vendor drags the tile in the listing editor to say
// which band matters. Only Y — the crop is vertical, so an X knob would do
// nothing. Legacy rows default to centred, i.e. exactly today's rendering.
addColumnIfMissing("listing_photos", "position_y", "position_y INTEGER NOT NULL DEFAULT 50");
// Uniqueness indexes live here (not schema.sql) per the May 2026 ordering rule —
// the column must exist before the index that references it. Partial so the
// pre-backfill NULLs don't collide with each other.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_couples_organiser_code ON couples(organiser_code) WHERE organiser_code IS NOT NULL",
);
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_accounts_vendor_code ON vendor_accounts(vendor_code) WHERE vendor_code IS NOT NULL",
);

// Vendor freemium lifecycle (shared/vendor_billing.ts): a saved card flips the
// expired trial into the lead_window status; each couple inquiry delivered in
// that window spends a free lead credit; the credit that hits
// VENDOR_FREE_LEAD_CREDITS schedules the first payment for the start of the
// next month (billing_starts_at, also the Stripe trial_end).
addColumnIfMissing(
  "vendor_subscriptions",
  "card_on_file",
  "card_on_file INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("vendor_subscriptions", "card_added_at", "card_added_at INTEGER");
addColumnIfMissing(
  "vendor_subscriptions",
  "lead_credits_used",
  "lead_credits_used INTEGER NOT NULL DEFAULT 0",
);
addColumnIfMissing("vendor_subscriptions", "billing_starts_at", "billing_starts_at INTEGER");

// Second free cohort (VENDOR_EARLY_CAP = 300 × three months), handed out once
// the founding 100 are gone. It rides the same status='founding' +
// founding_until pair as the founding year, so this badge column is the ONLY
// thing that tells the two apart, and it is what `vendorEarlySlotsUsed()`
// counts. Default 0 means every pre-existing row stays in whichever cohort it
// was already in.
addColumnIfMissing(
  "vendor_subscriptions",
  "is_early_member",
  "is_early_member INTEGER NOT NULL DEFAULT 0",
);
// Mirrors idx_vendor_subs_founding for the other cohort counter. Lives HERE and
// not in schema.sql because the column it indexes is added above at boot:
// schema.sql runs first and would reference a column that doesn't exist yet.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_vendor_subs_early ON vendor_subscriptions(is_early_member)",
);

// Partial-day availability: a vendor can block only certain hours of a day
// instead of the whole day. blocked_hours holds a JSON array of blocked
// hour-starts (integers 0-23, sorted); NULL = the whole day is blocked (the
// original behaviour, so every pre-existing row stays a full-day block and the
// couple-facing busy calendar / next-free logic is unchanged for them).
addColumnIfMissing("vendor_unavailable_dates", "blocked_hours", "blocked_hours TEXT");

// Availability EXCEPTIONS gained a direction. With the weekly pattern in
// `vendor_availability_settings`, a per-date row can now also mean the OPPOSITE
// of a block: is_available = 1 marks a day the vendor exceptionally works even
// though the pattern excludes that weekday. Defaults to 0, so every pre-existing
// row keeps meaning exactly what it did — a block.
//
// (The table name is now a slight misnomer: it holds both directions. Renaming
// is off the table under the additive-only rule, so the semantics live in the
// schema comment and in shared/vendor_availability.ts.)
addColumnIfMissing(
  "vendor_unavailable_dates",
  "is_available",
  "is_available INTEGER NOT NULL DEFAULT 0",
);

// The vendor Google connection gained the PULL direction. `pull_enabled` is the
// master switch (on by default: the vendor connected a calendar to have it
// respected), `selected_calendar_ids` is the JSON array of calendar ids the
// vendor ticked (NULL = their primary only, which is the conservative default
// before they have chosen), and `busy_synced_at` paces the pull worker
// independently of the push queue's `last_synced_at`.
addColumnIfMissing(
  "vendor_google_calendar_connections",
  "pull_enabled",
  "pull_enabled INTEGER NOT NULL DEFAULT 1",
);
addColumnIfMissing(
  "vendor_google_calendar_connections",
  "selected_calendar_ids",
  "selected_calendar_ids TEXT",
);
addColumnIfMissing(
  "vendor_google_calendar_connections",
  "busy_synced_at",
  "busy_synced_at INTEGER",
);

// The weekly schedule gained a NAME when it gained hours: the editor header
// reads as a document the vendor can retitle ("Nyári munkarend"), and a second
// named schedule is the obvious next step. NULL / empty = unnamed, which the
// editor renders as a localised placeholder rather than storing one language's
// default into every account.
addColumnIfMissing("vendor_availability_settings", "schedule_name", "schedule_name TEXT");

// Setup / teardown padding around confirmed bookings and external busy time.
// NULL is meaningful and is NOT the same as 0: NULL means "never set, follow the
// category default" (a venue starts at 4h before / 8h after), while 0 is a
// vendor stating they need none, and that answer has to survive a category
// default that says otherwise.
addColumnIfMissing(
  "vendor_availability_settings",
  "buffer_before_min",
  "buffer_before_min INTEGER",
);
addColumnIfMissing("vendor_availability_settings", "buffer_after_min", "buffer_after_min INTEGER");

// Whether this vendor's availability is PUBLISHED at all. Default 1, because
// that is what every existing account already does and a silent opt-out would
// hide dates couples are reading today.
//
// 0 is a vendor saying "my calendar is not public information", which several
// have: in photography and music, an openly readable booked/free calendar is a
// marketing liability (a page that looks empty in the off season) and a second
// calendar to maintain beside the one their own business already runs. With it
// off, availability simply becomes UNKNOWN to Weddly — no busy dates, no
// next-free date, and no date filter can drop them from a search — while the
// inquiry channel is untouched, which is the only part a couple actually needs.
addColumnIfMissing(
  "vendor_availability_settings",
  "calendar_public",
  "calendar_public INTEGER NOT NULL DEFAULT 1",
);

// One-time grandfather: every vendor account that existed BEFORE the vendor
// freemium launch is an early adopter: grant the founding year (free, no
// card), the same promise activation makes. Idempotent: only accounts with no
// vendor_subscriptions row are touched; accounts created after launch get
// their row at activation (initVendorBilling) or claim-complete, never here.
// Mirrors the planner grandfather above. Currency pinned from owner locale.
{
  const ungrantedVendors = db
    .prepare(
      `SELECT va.id, u.locale FROM vendor_accounts va
        LEFT JOIN users u ON u.id = va.owner_user_id
        WHERE NOT EXISTS
          (SELECT 1 FROM vendor_subscriptions vs WHERE vs.vendor_account_id = va.id)`,
    )
    .all() as Array<{ id: number; locale: string | null }>;
  if (ungrantedVendors.length > 0) {
    const nowMs = Date.now();
    const foundingUntil = nowMs + 1000 * 60 * 60 * 24 * 365;
    const insertVendorSub = db.prepare(
      `INSERT INTO vendor_subscriptions
         (vendor_account_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'founding', NULL, ?, 1, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const v of ungrantedVendors) {
        const currency = v.locale === "hu" ? "HUF" : "EUR";
        insertVendorSub.run(v.id, foundingUntil, currency, nowMs, nowMs);
      }
    })();
  }
}

// Vendor "clients" + payment tracking (vendor workspace). The client view is
// supplier_bookings enriched with vendor-managed CRM fields: an agreed contract
// value + deposit (integer minor units), a free-form pipeline stage, and the
// vendor's private notes. Additive columns; the installment schedule lives in
// the vendor_client_payments table (schema.sql).
addColumnIfMissing("supplier_bookings", "contract_value", "contract_value INTEGER");
addColumnIfMissing("supplier_bookings", "deposit_paid", "deposit_paid INTEGER");
addColumnIfMissing("supplier_bookings", "stage", "stage TEXT");
addColumnIfMissing("supplier_bookings", "vendor_notes", "vendor_notes TEXT");
// When the vendor first reacted to this inquiry (any status change of their
// own). Write-once: `updated_at` moves on every later edit, so it can't answer
// "how fast did they reply" retroactively — this column starts measuring it
// honestly from the day it lands. Feeds the `fast_reply` points rule
// (shared/vendor_points.ts); NULL on every pre-existing row by design, and the
// backfill deliberately awards nothing for those.
addColumnIfMissing("supplier_bookings", "first_response_at", "first_response_at INTEGER");
// When the vendor OPENED this inquiry (the client detail page), stamped
// first-wins by POST /api/vendor/clients/:id/seen. Deliberately NOT the
// `vendor_seen` status: that one is a triage decision the vendor makes and the
// COUPLE reads ("Megtekintve"), while this is only "I have looked at it", which
// is what the Ügyfelek nav badge counts. Server-side rather than a per-device
// watermark for the same reason `booking_messages.seen_at` is: a lead read on
// the laptop must not badge again on the phone. NULL on every pre-existing row,
// so an old untouched `requested` inquiry still counts once.
addColumnIfMissing("supplier_bookings", "vendor_seen_at", "vendor_seen_at INTEGER");
// "Stop putting this one in my attention band until <stamp>" — the vendor
// dismissing a row on the clients list. Mutes the BAND ONLY, deliberately: the
// nav badge, the unread-message count and the next action all ignore it, so a
// snoozed lead goes quiet without going invisible. NULL on every pre-existing
// row, which is the resting state (nothing snoozed).
addColumnIfMissing(
  "supplier_bookings",
  "attention_snoozed_until",
  "attention_snoozed_until INTEGER",
);
// Index on the payments table AFTER it exists (schema.sql) — every payment query
// is scoped by booking, so the booking_id lookup is the hot path.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_vendor_client_payments_booking ON vendor_client_payments(booking_id)",
);

// Envelope-tip settings for the pre-wedding info message (the "what to put in
// the envelope, the wedding costs ~X per head" block). The override is a manual
// per-head amount (couple currency, minor units) that wins over the
// budget-derived auto value when set.
//
// `envelope_tip_enabled` is NOT the whole answer to "is the tip on": the column
// shipped `NOT NULL DEFAULT 1`, so a 1 cannot tell "the couple asked for this"
// from "nobody ever opened the block". Telling guests what to put in an
// envelope is exactly the kind of thing that must be asked for, so
// `envelope_tip_choice_at` is the opt-in stamp and NULL means off no matter
// what the flag says (`computeEnvelopeTip`). Deriving it rather than migrating
// the old rows keeps this true for couples created later on an existing DB,
// where the column's baked-in default still writes a 1.
addColumnIfMissing(
  "couples",
  "envelope_tip_enabled",
  "envelope_tip_enabled INTEGER NOT NULL DEFAULT 1",
);
addColumnIfMissing("couples", "envelope_tip_choice_at", "envelope_tip_choice_at INTEGER");
addColumnIfMissing(
  "couples",
  "envelope_tip_amount_override",
  "envelope_tip_amount_override INTEGER",
);

// When we first noticed that this workspace's partner names are placeholders
// rather than names ("x & y", "NŐ & FÉRFI", "Bridee & Groomy"). NULL for every
// healthy couple, which is almost all of them.
//
// Only the TIMESTAMP is stored. Whether the couple is currently in breach is
// re-derived from the live names on every read (`computeNameReview`), so the
// notice and the lock disappear the instant someone types a real name, with no
// job in between. Storing the verdict would mean a couple who fixed their names
// stays locked until a sweep catches up, and that is the kind of bug support
// tickets are made of.
addColumnIfMissing("couples", "name_flagged_at", "name_flagged_at INTEGER");
// Stamped when the "your names don't look real" notice is emailed, so the
// sweep sends it once per flagged couple rather than once per sweep.
addColumnIfMissing("couples", "name_notice_sent_at", "name_notice_sent_at INTEGER");

// Seating canvas room size, in millimetres, matching the units the whole
// seating model uses (see the print-export rule in CLAUDE.md). This lived in a
// single browser-wide localStorage key, which got it wrong in three directions
// at once: partner B opened the same plan in a default 12x9 m room with the
// tables laid outside it, the seating PDF is rendered from a room size the
// CLIENT sends so the two partners printed different charts, and a couple with
// a second event shared one room between both weddings. NULL means "never set"
// and resolves to the 12x9 m default at read time, so nothing needs migrating.
addColumnIfMissing("couples", "seating_room_w_mm", "seating_room_w_mm INTEGER");
addColumnIfMissing("couples", "seating_room_h_mm", "seating_room_h_mm INTEGER");

// Scheduled-send lookup for the guest broadcast worker. Table lives in
// schema.sql; the index is created here AFTER the table exists, per the May 2026
// additive-ordering rule. The worker scans (status='scheduled', scheduled_at<=now).
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_guest_messages_couple ON guest_messages(couple_id, created_at DESC)",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_guest_messages_due ON guest_messages(status, scheduled_at)",
);

backfillReferenceCodes();
function backfillReferenceCodes(): void {
  // One-time fill for rows that pre-date the columns. Runs at boot before any
  // concurrent writers, so a plain generate-check-insert loop is collision-safe.
  for (const spec of [
    { table: "couples", column: "organiser_code", gen: generateOrganiserCode },
    { table: "vendor_accounts", column: "vendor_code", gen: generateVendorCode },
  ] as const) {
    const missing = db.query(`SELECT id FROM ${spec.table} WHERE ${spec.column} IS NULL`).all() as {
      id: number;
    }[];
    if (missing.length === 0) continue;
    const check = db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${spec.column} = ?`);
    const update = db.prepare(`UPDATE ${spec.table} SET ${spec.column} = ? WHERE id = ?`);
    db.transaction(() => {
      for (const r of missing) {
        let code = "";
        for (let attempt = 0; attempt < 64; attempt++) {
          code = spec.gen();
          if (!check.get(code)) break;
          code = "";
        }
        if (!code) throw new Error(`Could not backfill a unique ${spec.column}`);
        // updated_at intentionally left untouched — a backfill is not an edit.
        update.run(code, r.id);
      }
    })();
    console.log(`[db.backfill] assigned ${spec.column} to ${missing.length} ${spec.table} row(s)`);
  }
}

// ── v2 taxonomy remap (July 2026) ────────────────────────────────────────────
// The supplier-category taxonomy was reshaped into business-type buckets. A few
// slugs were renamed/split/merged; the rest kept their slug. This idempotent
// boot migration rewrites any stored row still holding a pre-v2 slug so no
// listing/pick/DIY entry keeps an orphaned value (which would break the category
// icon + label lookups on read). Free-TEXT columns only; the DB taxonomy table
// itself is reconciled by seedSupplierTaxonomy + the legacy-hide pass in
// server.ts. Splits land on their default child (photographers stay photography,
// DJs stay dj, etc.); the empty spin-offs fill as vendors register.
//
// 'stationery' → 'invitation_graphics' (August 2026) is a later merge of the
// same kind: two paper-goods categories collapsed into one, so it rides the
// same remap rather than a new mechanism.
const LEGACY_CATEGORY_REMAP: Record<string, string> = {
  photo_video: "photography",
  music_dj: "dj",
  decor_floral: "wedding_decor",
  attire: "bridal_boutique",
  rings: "wedding_jewelry",
  wedding_website: "invitation_graphics",
  pizza: "food_trucks",
  stationery: "invitation_graphics",
};
remapLegacySupplierCategories();
function remapLegacySupplierCategories(): void {
  const plainTables = [
    "listings",
    "community_suppliers",
    "couple_suppliers",
    "vendor_onboarding",
    "vendor_waitlist",
  ];
  let total = 0;
  for (const [oldSlug, newSlug] of Object.entries(LEGACY_CATEGORY_REMAP)) {
    for (const table of plainTables) {
      total += db
        .prepare(`UPDATE ${table} SET category = ? WHERE category = ?`)
        .run(newSlug, oldSlug).changes;
    }
    // couple_picks has UNIQUE(couple_id, category): a merge can collide two picks
    // into one key. Move what can move, then drop any old-slug loser that would
    // have duplicated an existing pick (the couple keeps their other pick).
    db.prepare("UPDATE OR IGNORE couple_picks SET category = ? WHERE category = ?").run(
      newSlug,
      oldSlug,
    );
    total += db.prepare("DELETE FROM couple_picks WHERE category = ?").run(oldSlug).changes;
  }
  if (total > 0) console.log(`[db.backfill] remapped ${total} row(s) to the v2 supplier taxonomy`);
}

// One-time: every account that exists today must carry a verified email. Legacy
// couples predate the pending_signups gate (a couple can no longer be born
// unverified), so they are the stragglers this clears, along with any vendor
// that registered but never clicked. Bounded to accounts created before the
// cutoff so future registrations still verify the normal way; skips dormant
// provisioned planners (password_set=0) and @purged.local tombstones. See
// domain/verify_backfill.ts for the full rationale. Idempotent.
const VERIFY_BACKFILL_CUTOFF_MS = 1_784_678_400_000; // 2026-07-22T00:00:00Z
{
  const verified = verifyExistingUnverifiedAccounts(VERIFY_BACKFILL_CUTOFF_MS);
  if (verified > 0) {
    console.log(`[db.backfill] marked ${verified} pre-existing account(s) email-verified`);
  }
}

// ── Open reviews: additive author-kind + moderation columns ─────────────────
// The verified-visitor identity, the reserved system user (VISITOR_SYSTEM_USER_EMAIL
// / getVisitorSystemUserId) and supplier_reviews.author_visitor_id are all owned
// by the verified-visitor block below. This block adds ONLY what the open-reviews
// feature needs on top: author_kind (admin/couple/user/visitor), the
// engagement-proof `verified` badge (decoupled from editorial), and the `flagged`
// moderation flag for low-rating open reviews. Columns + backfill + indexes live
// here (not schema.sql) per the additive-ordering rule.
addColumnIfMissing("supplier_reviews", "author_kind", "author_kind TEXT");
addColumnIfMissing("supplier_reviews", "verified", "verified INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("supplier_reviews", "flagged", "flagged INTEGER NOT NULL DEFAULT 0");
// Backfill the discriminator + verified badge from the legacy couple_id shape:
// admin rows left couple_id NULL, couple rows populated it, and every legacy
// couple review passed the old engagement-proof gate (so it was verified).
db.exec(
  "UPDATE supplier_reviews SET author_kind = 'admin' WHERE author_kind IS NULL AND couple_id IS NULL",
);
db.exec(
  "UPDATE supplier_reviews SET author_kind = 'couple' WHERE author_kind IS NULL AND couple_id IS NOT NULL",
);
db.exec("UPDATE supplier_reviews SET verified = 1 WHERE couple_id IS NOT NULL AND verified = 0");
// One review per no-couple `user` per supplier. Visitor dedup is the
// author_visitor_id unique index in the verified-visitor block; couple dedup is
// the existing idx_supplier_reviews_couple_unique; admin editorial rows are exempt.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_reviews_user_unique " +
    "ON supplier_reviews(supplier_id, author_user_id) WHERE author_kind = 'user'",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_supplier_reviews_flagged ON supplier_reviews(flagged) WHERE flagged = 1",
);

// ── Optional "what it cost" on a review ──────────────────────────────────────
// A reviewer may (optionally) share what they paid and what that bought, so a
// couple reading reviews gets a price signal, not just a star rating. `amount_paid`
// is a whole-unit integer in `amount_currency` (same whole-unit model as the
// budget — no minor units), captured at write time so it stays unambiguous for
// every later viewer regardless of their own currency. `amount_note` is the
// short "napi csomag + album" free text. All nullable — reviews without a price
// are the norm.
addColumnIfMissing("supplier_reviews", "amount_paid", "amount_paid INTEGER");
addColumnIfMissing("supplier_reviews", "amount_currency", "amount_currency TEXT");
addColumnIfMissing("supplier_reviews", "amount_note", "amount_note TEXT");

// ── Verified-visitor content anchoring ───────────────────────────────────────
// community_suppliers.submitter_user_id and supplier_reviews.author_user_id are
// NOT-NULL FKs to users(id). A verified visitor is NOT a user, and the schema is
// additive-only (no table rebuild to relax the constraint). So visitor-authored
// rows point that FK at ONE reserved system user (below) and record the REAL
// author in these additive columns; every display path reads the visitor column
// first. ON DELETE SET NULL so deleting a visitor de-attributes rather than
// cascading a whole listing/review away.
addColumnIfMissing(
  "community_suppliers",
  "submitter_visitor_id",
  "submitter_visitor_id INTEGER REFERENCES verified_visitors(id) ON DELETE SET NULL",
);
addColumnIfMissing(
  "supplier_reviews",
  "author_visitor_id",
  "author_visitor_id INTEGER REFERENCES verified_visitors(id) ON DELETE SET NULL",
);
// Indexes AFTER the column calls (May 2026 ordering rule). The unique index is
// the visitor mirror of idx_supplier_reviews_couple_unique: one review per
// visitor per supplier, partial so pre-visitor NULL rows don't collide.
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_community_suppliers_visitor ON community_suppliers(submitter_visitor_id)",
);
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_reviews_visitor_unique " +
    "ON supplier_reviews(supplier_id, author_visitor_id) WHERE author_visitor_id IS NOT NULL",
);

// ── Campaign launch/end timestamps ───────────────────────────────────────────
// `updated_at` moves on every pause / daily-cap edit, so it can't answer "when
// did this launch?". `started_at` is stamped the first time a campaign goes
// Running (never overwritten on a re-launch); `ended_at` when it retires to
// Done. Applies to both the claim-invite and review-invite campaigns.
addColumnIfMissing("vendor_claim_campaigns", "started_at", "started_at INTEGER");
addColumnIfMissing("vendor_claim_campaigns", "ended_at", "ended_at INTEGER");
addColumnIfMissing("vendor_review_campaigns", "started_at", "started_at INTEGER");
addColumnIfMissing("vendor_review_campaigns", "ended_at", "ended_at INTEGER");

// ── Open + click tracking on the two campaigns that shipped without it ───────
// The vendor claim + review families carried a pixel and a click redirect from
// the start; personal-invite and onboarding were sent blind, attributed only by
// the conversion join at the far end (a users row appeared / the couple
// onboarded). That answers "did it work" and nothing about WHY it didn't: a
// campaign at 0% conversion with 40% clicks is bad copy on the landing page, and
// the same campaign with 2% clicks is a bad subject line, and until now those
// two looked identical. Same column names and same semantics as the vendor
// tables, so every reader (admin console, cross-family analytics) treats all
// four families alike.
addColumnIfMissing("personal_invite_campaign_sends", "opened_at", "opened_at INTEGER");
addColumnIfMissing("personal_invite_campaign_sends", "clicked_at", "clicked_at INTEGER");
addColumnIfMissing("onboarding_campaign_sends", "opened_at", "opened_at INTEGER");
addColumnIfMissing("onboarding_campaign_sends", "clicked_at", "clicked_at INTEGER");

// ── Which outreach messages actually reached a vendor's Weddly inbox ─────────
// An outreach message and the `supplier_bookings` inquiry it delivers had no
// link between them, and the absence cost us three ways. The couple was told
// "sent" whether the vendor found it in their client list or only in a shared
// info@ inbox. A vendor who claimed their listing AFTER being messaged had no
// way to be handed the earlier leads, because nothing knew which messages had
// been delivered. And the July 2026 window where outreach wrote no inquiry row
// at all could only be repaired by a backfill that had no way to tell an
// already-delivered message from a pending one, i.e. no way to be idempotent.
// One nullable column answers all three.
addColumnIfMissing("outreach_messages", "booking_id", "booking_id INTEGER");

// Which mailbox a send actually left from. Admin-console mail goes out as the
// support address rather than `noreply@` (owner rule, 2026-07-31) and the log
// is the only place that records it, so "did that reply reach them from a
// mailbox they can answer?" stays answerable after the fact. Null on rows
// written before this column, and on the two failure paths that never got as
// far as choosing a sender.
addColumnIfMissing("email_log", "from_email", "from_email TEXT");

// ── Community listing: the facts the submission form never asked for ────────
// The couple-facing "recommend a supplier" modal collects nine fields, so a
// community row could never carry a coordinate, a capacity, a venue character
// or the languages the business speaks — the `listings` mirror wrote NULL into
// all of them. That is fine while a submission is a tip; it stops being fine
// once an admin researches the business and has the facts in hand, because a
// listing with no lat/lng is INVISIBLE on the /app/suppliers map tab and one
// with no venue_style drops out of every style filter. Additive columns so the
// admin edit form (PATCH /api/admin/suppliers/:id) has somewhere to put them
// and `syncListingFromCommunityRow` has something to mirror.
addColumnIfMissing("community_suppliers", "lat", "lat REAL");
addColumnIfMissing("community_suppliers", "lng", "lng REAL");
addColumnIfMissing("community_suppliers", "capacity_min", "capacity_min INTEGER");
addColumnIfMissing("community_suppliers", "capacity_max", "capacity_max INTEGER");
addColumnIfMissing("community_suppliers", "venue_style", "venue_style TEXT");
addColumnIfMissing("community_suppliers", "spoken_languages", "spoken_languages TEXT");

// ── Annual billing: a second cadence, not a second price table ──────────────
// Both vendor and planner subscriptions can now be billed monthly OR annually
// (25% off × 12, shared/vendor_billing.ts + shared/planner_billing.ts). The
// cadence is set ONLY by applyVendorSubscriptionState / applyPlannerSubscriptionState
// from the Stripe subscription's own price.recurring.interval — never chosen
// or trusted from the checkout request body — so the stored value can never
// disagree with what Stripe is actually charging. Default 'month' is correct
// for every pre-existing row (all of them were monthly-only) and for a row
// that has never reached a paid Stripe subscription yet (trial/founding/lead
// window bill nothing, so the column is inert until then).
addColumnIfMissing(
  "vendor_subscriptions",
  "billing_interval",
  "billing_interval TEXT NOT NULL DEFAULT 'month'",
);
addColumnIfMissing(
  "planner_subscriptions",
  "billing_interval",
  "billing_interval TEXT NOT NULL DEFAULT 'month'",
);

// ── Public counters: withholding one, which is not the same as boosting it ───
// A boost of 0 says "the measured number is what we show"; there was no way to
// say "we are not quoting this one at all" while the figure is young. Additive
// flag on the same per-counter row, defaulting to 0 so every existing counter
// keeps being published exactly as before.
addColumnIfMissing("public_stat_boosts", "hidden", "hidden INTEGER NOT NULL DEFAULT 0");

// Reserved system user that anchors the NOT-NULL author FK for verified-visitor
// content (see above). Login-disabled (status='suspended' and password_hash that
// can never verify); verified_email=1 + password_set=0 so no unverified-account
// sweep touches it. It is filtered out of the admin user list. NEVER delete it —
// ON DELETE CASCADE on those FKs would take every visitor-authored row with it.
export const VISITOR_SYSTEM_USER_EMAIL = "community-visitor@weddly.internal";
let visitorSystemUserId: number | null = null;
export function getVisitorSystemUserId(): number {
  if (visitorSystemUserId !== null) return visitorSystemUserId;
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(VISITOR_SYSTEM_USER_EMAIL) as { id: number } | undefined;
  if (existing) {
    visitorSystemUserId = existing.id;
    return existing.id;
  }
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email, password_set, created_at, updated_at)
       VALUES (?, '!', 'Community submissions', 'suspended', 'owner', 1, 0, ?, ?)`,
    )
    .run(VISITOR_SYSTEM_USER_EMAIL, ts, ts);
  visitorSystemUserId = Number(info.lastInsertRowid);
  return visitorSystemUserId;
}
// Materialize at boot so the row exists before any request references it.
getVisitorSystemUserId();

// ── Review-summary cold-start gate lowered to 1 (was 3, 2026-08-25) ────────
// recomputeSupplierAggregate only writes avg_rating on the review write path,
// so a supplier already sitting at 1-2 published reviews keeps the NULL an
// earlier boot stored under the old threshold until something touches that
// review again. This one-time sweep fills it in directly from the live
// reviews rather than waiting for a write; self-limiting because a filled
// avg_rating no longer matches the WHERE clause on the next boot.
{
  const filled = db
    .prepare(
      `UPDATE supplier_aggregates
          SET avg_rating = (
                SELECT AVG(rating) FROM supplier_reviews
                 WHERE supplier_reviews.supplier_id = supplier_aggregates.supplier_id
                   AND published = 1 AND deleted_at IS NULL
              ),
              updated_at = ?
        WHERE avg_rating IS NULL AND reviews_count >= 1`,
    )
    .run(now());
  if (filled.changes > 0) {
    console.log(
      `[db.backfill] revealed avg_rating on ${filled.changes} supplier(s) held below the old 3-review floor`,
    );
  }
}
