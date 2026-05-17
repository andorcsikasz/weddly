-- weddly schema. Additive only — CREATE TABLE IF NOT EXISTS everywhere; new
-- columns go through addColumnIfMissing() in db.ts. Money is integer Forint.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',                       -- 'active' | 'suspended'
  role TEXT NOT NULL DEFAULT 'owner',                          -- 'owner' | 'partner' | 'guest_admin' | 'admin'
  couple_id INTEGER REFERENCES couples(id),                    -- nullable: set after onboarding
  verified_email INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_couple ON users(couple_id);

CREATE TABLE IF NOT EXISTS couples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_a_id INTEGER NOT NULL,                               -- FK lazily; users row references couples.id, chicken-and-egg
  partner_b_id INTEGER,
  display_name TEXT NOT NULL,                                  -- derived as "{bride_name} & {groom_name}" on write
  bride_name TEXT NOT NULL DEFAULT '',
  groom_name TEXT NOT NULL DEFAULT '',
  wedding_date TEXT,                                           -- YYYY-MM-DD
  target_guest_count INTEGER,
  budget_ceiling_huf INTEGER,
  location_lat REAL,
  location_lng REAL,
  location_radius_km INTEGER,
  style_tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',                       -- 'active' | 'paused' | 'deleting'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  onboarded_at INTEGER
);

CREATE TABLE IF NOT EXISTS couple_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  invited_email TEXT,
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  consumed_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_couple ON couple_invites(couple_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                                         -- random opaque id (24 bytes hex)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  planned_huf INTEGER NOT NULL DEFAULT 0,
  actual_huf INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER,                                         -- v2: FK to suppliers
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_couple ON budget_lines(couple_id);

CREATE TABLE IF NOT EXISTS budget_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_couple ON budget_snapshots(couple_id);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  group_tag TEXT NOT NULL DEFAULT 'other',
  invite_code TEXT NOT NULL UNIQUE,
  rsvp_status TEXT NOT NULL DEFAULT 'pending',                 -- 'pending' | 'yes' | 'no' | 'maybe'
  meal_choice TEXT,
  dietary TEXT,
  plus_one_name TEXT,
  plus_one_meal TEXT,
  accommodation_needed INTEGER NOT NULL DEFAULT 0,
  song_request TEXT,
  notes TEXT,
  rsvp_responded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guests_couple ON guests(couple_id);
CREATE INDEX IF NOT EXISTS idx_guests_invite ON guests(invite_code);

-- Airport-style "check-in": one household = one party that RSVPs together.
-- Solo guests still get a household-of-one. The 4-digit `code` is unique per
-- couple (UNIQUE(couple_id, code)); paired with `couples.slug` it's the public
-- credential a guest types into /rsvp.
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(couple_id, code)
);
CREATE INDEX IF NOT EXISTS idx_households_couple ON households(couple_id);

CREATE TABLE IF NOT EXISTS seating_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  shape TEXT NOT NULL DEFAULT 'round',                         -- 'round' | 'long' | 'square'
  seats INTEGER NOT NULL DEFAULT 8,
  x_mm INTEGER NOT NULL DEFAULT 0,
  y_mm INTEGER NOT NULL DEFAULT 0,
  width_mm INTEGER NOT NULL DEFAULT 1500,                      -- diameter (round) or shorter side
  length_mm INTEGER NOT NULL DEFAULT 1500,                     -- only differs from width for 'long'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tables_couple ON seating_tables(couple_id);

CREATE TABLE IF NOT EXISTS seat_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES seating_tables(id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  UNIQUE(table_id, seat_index),
  UNIQUE(guest_id)
);
CREATE INDEX IF NOT EXISTS idx_seat_assign_table ON seat_assignments(table_id);

CREATE TABLE IF NOT EXISTS seating_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  guest_a_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  guest_b_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                                          -- 'split' | 'avoid'
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_couple ON seating_conflicts(couple_id);

-- Append-only. Never UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  couple_id INTEGER REFERENCES couples(id),
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_couple ON audit_log(couple_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
-- Activity feed walks newest-first within a couple (ORDER BY id DESC LIMIT 60).
-- The composite (couple_id, id DESC) lets the planner walk the index in order
-- instead of scanning every audit row for the couple and re-sorting.
CREATE INDEX IF NOT EXISTS idx_audit_couple_id_desc ON audit_log(couple_id, id DESC);

-- Pause-to-delete: either partner can request, 30-day window, either can cancel.
CREATE TABLE IF NOT EXISTS couple_pause_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  scheduled_delete_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',                      -- 'pending' | 'cancelled' | 'completed'
  reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pause_couple ON couple_pause_requests(couple_id);

-- Per-IP rate-limit buckets for auth endpoints.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,                                 -- "{client_ip}:{endpoint}"
  tokens REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Password reset tokens. Single-use (consumed_at), 1h TTL.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- Email verification tokens. Single-use (consumed_at), 7-day TTL — email
-- verification is "soft" (not required to use the app) so we give users
-- plenty of time to click the link.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verify_user ON email_verification_tokens(user_id);

-- Email-change tokens. Issued when a logged-in user starts a new-email
-- change; consuming the link in the new inbox flips users.email to
-- new_email + revokes sessions. Single-use, 1h TTL (short — the user
-- just authenticated their password to start this flow).
CREATE TABLE IF NOT EXISTS email_change_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_change_user ON email_change_tokens(user_id);

-- Per-user email preferences. Created lazily on first send. The
-- `unsubscribe_token` is a stable random hex used for one-click unsubscribe
-- links in the footer (only `lifecycle` mail honours opt-out — `transactional`
-- always sends because it carries account-critical info).
CREATE TABLE IF NOT EXISTS email_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  lifecycle_opt_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Append-only log of every transactional email attempt. Used for support
-- ("did Anna get her verify mail?") and re-send tooling. We keep `payload_json`
-- so a stuck send can be replayed later. Recipient PII is purged when the
-- couple is purged (purge.ts deletes via user-id link).
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- nullable for guest-bound mail
  couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                                          -- e.g. 'welcome_verify', 'rsvp_thanks'
  category TEXT NOT NULL,                                      -- 'transactional' | 'lifecycle'
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,                                        -- 'sent' | 'failed' | 'skipped_opt_out' | 'skipped_no_provider'
  error TEXT,
  payload_json TEXT,                                           -- redacted JSON of the template payload
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_couple ON email_log(couple_id);
CREATE INDEX IF NOT EXISTS idx_email_log_kind ON email_log(kind);

-- User-submitted ("Drop your own") suppliers. Auto-active on submit; admins
-- can hide (status='hidden') or hard-delete. The static curated list lives in
-- code (domain/suppliers_data.ts) — the public list endpoint merges both.
CREATE TABLE IF NOT EXISTS community_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitter_type TEXT NOT NULL DEFAULT 'user',                 -- 'user' (recommendation) | 'self' (vendor)
  category TEXT NOT NULL,                                      -- one of SupplierCategory
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,                                                -- optional street address
  website TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  blurb TEXT NOT NULL,
  price_band INTEGER NOT NULL,                                 -- 1..5 ($ to $$$$$)
  status TEXT NOT NULL DEFAULT 'active',                       -- 'active' | 'hidden'
  hide_reason TEXT,
  hidden_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hidden_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_suppliers_status_category
  ON community_suppliers(status, category);
CREATE INDEX IF NOT EXISTS idx_community_suppliers_submitter
  ON community_suppliers(submitter_user_id);

-- Email-ownership verification tokens for community-submitted suppliers.
-- A submission lands as status='pending'; the row only flips to 'active'
-- after the contact email is verified via the token in this table. Single-
-- use (consumed_at), 7-day TTL — vendors often check generic business
-- inboxes infrequently. Stale (unconsumed + expired) rows are cleaned up
-- by the same lifecycle worker that purges other one-shot tokens.
CREATE TABLE IF NOT EXISTS community_supplier_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES community_suppliers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_verifications_supplier
  ON community_supplier_verifications(supplier_id);

-- Couple-side abuse reports against community-submitted suppliers. One row
-- per (supplier, reporter_user) so a single user can't stack reports to
-- brigade a hide. When three distinct reporters land, the supplier is
-- auto-hidden with a synthetic hide_reason and an admin can review the
-- queue at /app/admin/suppliers (status = 'hidden'). Reports survive an
-- admin "unhide" so the count stays informative; admins dismiss the report
-- queue separately.
CREATE TABLE IF NOT EXISTS community_supplier_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES community_suppliers(id) ON DELETE CASCADE,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,                                        -- 'spam' | 'fake' | 'offensive' | 'wrong_info' | 'other'
  note TEXT,                                                   -- optional free-text, max 500 chars
  status TEXT NOT NULL DEFAULT 'open',                         -- 'open' | 'dismissed'
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(supplier_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_reports_supplier
  ON community_supplier_reports(supplier_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_open
  ON community_supplier_reports(status, created_at DESC);

-- Up/down vote on each directory supplier, one row per (couple, supplier_id).
-- `supplier_id` is the public string id (curated slug or "c{N}"), same as
-- couple_supplier_costs — no FK because curated suppliers live in code.
-- `value` is +1 (up) or -1 (down); to clear a vote we DELETE the row.
--
-- Per-couple keying (not per-user) so partners A + B share one vote — without
-- this, a couple submitting their own venue gets two free upvotes and the
-- "Top voted" sort becomes trivially brigadeable. `user_id` is kept to record
-- which partner actually cast the vote (audit only; not part of the unique key).
CREATE TABLE IF NOT EXISTS supplier_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_votes_supplier ON supplier_votes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_votes_user ON supplier_votes(user_id);
-- Unique (couple_id, supplier_id) partial index is created in db.ts AFTER
-- `addColumnIfMissing("supplier_votes","couple_id",…)` so existing prod DBs
-- (where supplier_votes pre-dates the column) don't fail with
-- `no such column: couple_id` when re-applying schema.sql.

-- Per-couple planned + final cost for each supplier the couple is interested
-- in. `supplier_id` is the public string id from the directory (curated slug
-- like "normafa-rendezvenyhaz" or community "c123"). No FK because curated
-- suppliers live in code, not the DB.
CREATE TABLE IF NOT EXISTS couple_supplier_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,
  planned_huf INTEGER NOT NULL DEFAULT 0,
  actual_huf INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(couple_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_couple_supplier_costs_couple
  ON couple_supplier_costs(couple_id);

-- Saved download archive. Every JSON / PDF / CSV export the user generates is
-- snapshotted here so they can re-download past versions from the Profile
-- page. Capped at the most recent 10 per couple (older rows auto-purged on
-- new insert by domain/exports.ts). Body is the raw bytes; for JSON it's the
-- UTF-8 encoded text the user downloaded.
CREATE TABLE IF NOT EXISTS data_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                                          -- 'json' | 'seating_pdf' | 'place_cards_pdf' | 'guest_csv'
  format TEXT,                                                 -- 'a4' | 'a3' for seating; null otherwise
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  body BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_exports_couple ON data_exports(couple_id, created_at DESC);

-- Per-couple lifecycle dispatch ledger. Idempotency for cron-driven sends:
-- one row per (couple_id, kind) so the worker doesn't re-fire the same
-- milestone reminder if it crashes mid-sweep.
CREATE TABLE IF NOT EXISTS email_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dispatched_at INTEGER NOT NULL,
  UNIQUE(couple_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_email_dispatches_kind ON email_dispatches(kind);

-- Public-form "we want to get listed" submissions from /vendors. Anonymous
-- (no auth), captured by /api/vendors/waitlist. Admins triage them at
-- /app/admin/vendor-waitlist — status moves from 'new' → 'contacted' or
-- 'dismissed' as the admin works through the queue. PII (email) hangs
-- around until manually deleted; there's no auto-purge yet.
CREATE TABLE IF NOT EXISTS vendor_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,                                      -- one of SupplierCategory
  location TEXT,                                               -- address or Google Maps URL — free text
  website TEXT,                                                -- optional portfolio / business URL
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',                          -- 'new' | 'contacted' | 'dismissed'
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_waitlist_status ON vendor_waitlist(status, created_at DESC);

-- Feedback submissions from the in-product "Visszajelzés" dialog. The
-- dialog is exposed on both the public landing (source='landing') and
-- the signed-in app shell (source='app'); when the submitter is
-- authenticated we capture user_id so admins can triage by user. All
-- three content fields (message / rating / monthly_value_ft) are
-- optional but at least one is required. Admins triage at
-- /app/admin/feedback — status moves new → read → resolved → dismissed.
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'landing',                      -- 'landing' | 'app'
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT,
  rating INTEGER,                                              -- 1..10
  monthly_value_ft INTEGER,                                    -- 0..15000
  from_email TEXT,
  locale TEXT,                                                 -- 'hu' | 'en'
  status TEXT NOT NULL DEFAULT 'new',                          -- 'new' | 'read' | 'resolved' | 'dismissed'
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_submissions(user_id, created_at DESC);

-- Admin-editable supplier taxonomy. Seeded once from the legacy
-- SUPPLIER_GROUPS / SupplierCategory TypeScript literals + the matching
-- `suppliers.group.*` / `suppliers.cat.*` i18n keys (see seed_supplier_taxonomy).
-- After seed, every label edit / new group / new category lives here.
-- Slugs are the public-API identifiers — keep them URL-safe and stable.
CREATE TABLE IF NOT EXISTS supplier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label_hu TEXT NOT NULL,
  label_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_groups_order ON supplier_groups(sort_order);

CREATE TABLE IF NOT EXISTS supplier_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES supplier_groups(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  label_hu TEXT NOT NULL,
  label_en TEXT NOT NULL,
  -- Budget-line bucket this category folds into for the cost panel.
  -- See shared/suppliers.ts SUPPLIER_TO_BUDGET for the v1 mapping.
  budget_category TEXT NOT NULL DEFAULT 'other',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_categories_group ON supplier_categories(group_id, sort_order);

-- Day-of run-of-show. Each event is wedding-day-local time (minutes from
-- midnight, 0..1439) so the timeline survives a date shift right up to D-1
-- without rewriting every row. `duration_minutes` is optional (some events
-- are "open-ended" — first dance / late-night snack). `sort_order` is a
-- tiebreaker for events that share the same starts_at_minutes; PDF + UI
-- render strictly by (starts_at_minutes, sort_order, id).
CREATE TABLE IF NOT EXISTS schedule_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  starts_at_minutes INTEGER NOT NULL,
  duration_minutes INTEGER,
  location TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_events_couple ON schedule_events(couple_id, starts_at_minutes);

-- DIY / "Csinálom magam" supplier entries — private to a couple. Never shown
-- in the public directory, never seen by other couples or admins. Created
-- when the couple chooses to handle a category in-house (e.g. mum is doing
-- the catering, friend's playing the music). When `price_huf` is set the
-- backend mirrors the value into a locked `budget_lines` row via the
-- `couple_supplier_id` back-reference so /app/budget stays in sync.
CREATE TABLE IF NOT EXISTS couple_suppliers (
  id TEXT PRIMARY KEY,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  notes TEXT,
  price_huf INTEGER,
  budget_line_id INTEGER REFERENCES budget_lines(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_suppliers_couple ON couple_suppliers(couple_id);


-- Per-category "this is our pick" supplier selections. One row per
-- (couple, category) — picking a new supplier in the same category REPLACES
-- the prior one via the UNIQUE constraint. `supplier_id` is the public string
-- id from the directory (curated slug, "c{N}" community id, or DIY hex) —
-- same shape as `couple_supplier_costs`, no FK because curated suppliers
-- live in code. Migrating from per-device localStorage (Loop C₁) so both
-- partners on any device see the same pick.
CREATE TABLE IF NOT EXISTS couple_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  category TEXT NOT NULL,                                      -- one of SupplierCategory
  supplier_id TEXT NOT NULL,                                   -- curated slug, "c{N}", or DIY hex
  picked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  picked_at INTEGER NOT NULL,
  UNIQUE(couple_id, category)
);
CREATE INDEX IF NOT EXISTS idx_couple_picks_couple ON couple_picks(couple_id);

-- Free-form planning surface for the /app/planning page. One table, three
-- "kinds": tasks (checklist with optional due_date), ideas (note-style free
-- text), schedule (wedding-day timeline with optional HH:MM slot). Couple-
-- scoped; nothing is shared across workspaces. `position` lets the couple
-- manually re-order items within a tab. (The newer `schedule_events` table
-- above powers /app/day-of with structured minute-precise events + a PDF
-- export — keep both per the additive-only rule.)
CREATE TABLE IF NOT EXISTS planning_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                                          -- 'task' | 'idea' | 'schedule'
  title TEXT NOT NULL,
  body TEXT,
  done INTEGER NOT NULL DEFAULT 0,                             -- 0/1; only meaningful for kind='task'
  due_date TEXT,                                               -- ISO YYYY-MM-DD; tasks only
  scheduled_time TEXT,                                         -- HH:MM; schedule entries only
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planning_couple ON planning_items(couple_id);
CREATE INDEX IF NOT EXISTS idx_planning_kind ON planning_items(couple_id, kind, position);

-- Cache for Amadeus flight-offer lookups powering the honeymoon flight
-- estimate card. Rows are keyed by (origin, destination_text, depart_date,
-- return_date, adults) so every couple targeting the same route shares the
-- cache hit. `fetched_at` is checked against a 12 h TTL on read; stale rows
-- are refreshed in-place. Price stored as minor units in the requested
-- currency (HUF: forints directly, no cents).
CREATE TABLE IF NOT EXISTS flight_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,
  destination_text TEXT NOT NULL,
  destination_iata TEXT,
  depart_date TEXT NOT NULL,                                   -- ISO YYYY-MM-DD
  return_date TEXT NOT NULL,                                   -- ISO YYYY-MM-DD
  adults INTEGER NOT NULL DEFAULT 2,
  currency TEXT NOT NULL,
  price_amount INTEGER NOT NULL,                               -- whole units in `currency` (no cents for HUF)
  fetched_at INTEGER NOT NULL,                                 -- unix ms
  UNIQUE(origin, destination_text, depart_date, return_date, adults)
);
CREATE INDEX IF NOT EXISTS idx_flight_estimates_fetched ON flight_estimates(fetched_at);

-- Admin moderation flags. An admin flags a user with a reason; the
-- system emails the user explaining the concern and giving 7 days to
-- reply. After the deadline, the hourly purge sweep auto-deletes the
-- account unless the flag has been resolved (admin sets `resolved_at`
-- with a note after the user explains by email).
--
-- Lifecycle:
--   created_at        — stamped on insert
--   scheduled_delete_at = created_at + 7 days
--   resolved_at        — null while pending; non-null after admin clears
--                        the flag (manual decision, e.g. user replied)
--   resolution_note    — admin's own note recording why the flag was cleared
CREATE TABLE IF NOT EXISTS user_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flagged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  scheduled_delete_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_flags_user ON user_flags(user_id);
-- Index for the sweep query (filter on unresolved, sort by deadline).
CREATE INDEX IF NOT EXISTS idx_user_flags_pending ON user_flags(scheduled_delete_at, resolved_at);

-- Logistics: lodgings the couple has booked / proposed for guests. One row per
-- bookable unit (a hotel room, an apartment, "Mama háza"). `capacity` caps how
-- many guests can be assigned via `guests.accommodation_id`; the route layer
-- treats it as an advisory soft cap — overflow is allowed but flagged in the UI
-- so the couple can fix it. `price_huf` is the total cost for the unit (not per
-- guest), kept as integer Forint to match the rest of the money columns.
CREATE TABLE IF NOT EXISTS accommodations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  price_huf INTEGER,
  link TEXT,
  contact TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accommodations_couple ON accommodations(couple_id);

-- Logistics: transfer trips between airport/lodging/venue. A guest can sit in
-- one transfer at a time (1:N via `guests.transfer_id`). v1 is intentionally
-- "basic" per product spec — a flat list with a label + optional time/capacity;
-- richer routing (multi-leg, return trip) lands later.
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  direction TEXT,                                              -- free-form: 'oda', 'vissza', or anything the couple writes
  depart_at TEXT,                                              -- ISO 8601 local: 'YYYY-MM-DDTHH:MM' or NULL
  capacity INTEGER,                                            -- advisory; NULL = unbounded
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_couple ON transfers(couple_id);

-- Directory visit analytics. One row per recorded event (page-view of a
-- supplier card, click on its website link, click on its phone number).
-- `supplier_id` is the public string id — curated slugs like "etyeki-kuria"
-- or community ids like "c123". No FK because curated suppliers live in code.
-- `user_id` and `couple_id` are nullable so anonymous visits still count.
-- Aggregated by the admin directory view to show per-supplier reach.
CREATE TABLE IF NOT EXISTS supplier_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  event_type TEXT NOT NULL,                                    -- 'view' | 'website_click' | 'phone_click'
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_events_supplier
  ON supplier_events(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_events_type
  ON supplier_events(event_type, created_at DESC);

-- Per-admin "I looked at this section" watermark. Instagram-style: the
-- sidebar red badge counts only rows newer than the admin's `seen_at`
-- for that section, so opening the page clears the dot. PK is composite
-- (user_id, section); `section` is one of 'suppliers' | 'users' |
-- 'vendor_waitlist' | 'feedback' — validated server-side.
CREATE TABLE IF NOT EXISTS admin_section_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, section)
);
