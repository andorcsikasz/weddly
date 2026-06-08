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

-- Money that came IN (cash gifts, contributions). A standalone ledger — not
-- tied to suppliers or budget lines. Powers the post-wedding "how much did we
-- recover vs spend" report. amount_huf is integer minor units of the couple's
-- currency (the _huf suffix is historical; display via formatMoney(currency)).
CREATE TABLE IF NOT EXISTS couple_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                                        -- "Kovács család", "Nagyi", ...
  amount_huf INTEGER NOT NULL,
  received_on TEXT,                                           -- ISO YYYY-MM-DD; NULL = undated
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_income_couple ON couple_income(couple_id);

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
-- Solo guests still get a household-of-one. The 8-character `code` is unique per
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
  status TEXT NOT NULL DEFAULT 'new',                          -- triage lifecycle, see shared/feedback.ts (new|reviewed|planned|fixed|rejected|archived; legacy read/resolved/dismissed migrated in db.ts)
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

-- Payment schedule for a couple's priced supplier (couple_suppliers). One row
-- per installment (deposit, balance on the day, ...). When a supplier has any
-- installments they become the source of truth for "how much is actually
-- paid": the mirrored budget line's actual_huf is recomputed as
-- SUM(amount_huf WHERE paid_at IS NOT NULL), and couple_suppliers.paid is
-- derived (fully paid). With zero installments the legacy all-or-nothing
-- `paid` toggle still drives the budget line. amount_huf is integer minor
-- units of the couple's currency (matches couple_suppliers.price_huf — the
-- _huf suffix is historical; display routes through formatMoney(currency)).
CREATE TABLE IF NOT EXISTS supplier_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES couple_suppliers(id) ON DELETE CASCADE,
  label TEXT,                                                 -- 'Deposit', 'Balance', free text
  amount_huf INTEGER NOT NULL,
  due_date TEXT,                                              -- ISO YYYY-MM-DD; NULL = undated / "on the day"
  paid_at INTEGER,                                            -- epoch ms when marked paid; NULL = unpaid
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_installments_supplier
  ON supplier_installments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_installments_due
  ON supplier_installments(couple_id, due_date);


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

-- Couple shortlist ("saved" star on /app/suppliers). Many rows per couple —
-- one per saved supplier, no per-category cap (a couple shortlists 3
-- photographers to compare them). Couple-scoped so partner A and partner B
-- share the same shortlist; migrating off per-device localStorage. Same
-- `supplier_id` shape as couple_picks (curated slug, "c{N}", or DIY hex), no
-- FK because curated suppliers live in code.
CREATE TABLE IF NOT EXISTS saved_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,                                   -- curated slug, "c{N}", or DIY hex
  saved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  saved_at INTEGER NOT NULL,
  UNIQUE(couple_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_suppliers_couple ON saved_suppliers(couple_id);

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

-- Append-only ledger proving GDPR Art. 7(1) "demonstrable consent". One row
-- per click-acceptance of a policy document. `subject_user_id` is nullable
-- because pre-auth surfaces (vendor waitlist, future newsletter) capture
-- consent too — `subject_kind` + `subject_ref` (e.g. 'vendor_waitlist' +
-- the row id, stringified) identify the actor in those cases. Never UPDATE
-- or DELETE: a withdrawal lands as a new row with `document` = '<doc>_revoked'.
CREATE TABLE IF NOT EXISTS user_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject_kind TEXT NOT NULL,                                  -- 'user' | 'vendor_waitlist'
  subject_ref TEXT,                                            -- e.g. waitlist row id when subject_kind != 'user'
  document TEXT NOT NULL,                                      -- 'privacy' | 'terms' | 'vendor_beta_notice'
  version TEXT NOT NULL,                                       -- e.g. '2026-05-18'
  ip TEXT,
  user_agent TEXT,
  accepted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_consents_subject
  ON user_consents(subject_kind, subject_user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_document
  ON user_consents(document, version);

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

-- Demo workspace usage snapshot. Demo couples are hard-deleted by the
-- continuous sweep once they cross the age threshold (4h); right before
-- the DELETE we aggregate their audit_log into one row here so the admin
-- analytics surface keeps a permanent record of who tried what. No FK to
-- couples/users — the source rows are gone by the time anyone reads this.
CREATE TABLE IF NOT EXISTS demo_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Original demo couple id at the time of purge. Not a FK (the row is
  -- about to be hard-deleted) — kept as a stable retroactive handle so
  -- two snapshots from the same demo never collide.
  source_couple_id INTEGER NOT NULL,
  source_slug TEXT,
  created_at INTEGER NOT NULL,
  purged_at INTEGER NOT NULL,
  lifetime_seconds INTEGER NOT NULL,
  total_events INTEGER NOT NULL,
  -- Map of feature-prefix → event count, e.g. {"guest":12,"budget":3}.
  -- Feature prefix is the substring before the first "." in audit.action.
  feature_counts_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_demo_usage_purged_at ON demo_usage(purged_at DESC);

-- ── P2.A: Unified directory listing model ───────────────────────────────────
--
-- Splits the public-facing card ("listing") from the legal payee
-- ("vendor_account"). Decided via multi-agent debate 2026-05-21: a single
-- `suppliers` table conflates the payee with the card, which doesn't survive
-- Phase 3 (Stripe Connect, KYC, multi-listing vendors — e.g. a photo+video
-- studio that wants one payout account and two directory cards). See
-- [[feedback_multi_agent_debate]].

-- A legal payee, 1:1 with a users row of role='vendor'. Created when a vendor
-- signs up self-serve OR claims an existing listing. Phase 3 will add
-- stripe_account_id, kyc_status, and payout fields — deliberately kept out of
-- P2.A scope (don't pre-build infra).
CREATE TABLE IF NOT EXISTS vendor_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  vat_number TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Unified directory listing — the public-facing card for ANY source.
-- id strategy preserves the existing public-string convention so couple_picks
-- / couple_supplier_costs / supplier_votes / supplier_events can target
-- `listings.id` without migrating their stored values:
--   curated:    slug from suppliers_data.ts          (e.g. "etyeki-kuria")
--   community:  'c' || community_suppliers.id        (e.g. "c47")
--   claimed:    'v' || vendor_accounts.id            (Phase 2.5+ — fresh vendor listings)
-- vendor_account_id is nullable so curated/unclaimed-community rows are
-- first-class. When a vendor claims an existing listing, this flips to
-- non-null without rewriting the id (couples' picks stay valid).
-- content_hash short-circuits the boot-time idempotent upsert from
-- suppliers_data.ts — identical content skips the UPDATE entirely. Also used
-- as a row-fingerprint for community syncs so re-syncs are no-ops when
-- nothing changed.
-- status mirrors the community_suppliers state machine
-- ('pending' | 'awaiting_review' | 'active' | 'hidden'); curated rows are
-- always 'active'.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                                        -- 'curated' | 'community' | 'claimed'
  vendor_account_id INTEGER REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  website TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  blurb_hu TEXT,
  blurb_en TEXT,
  price_band INTEGER,                                          -- 1..5; null when unpriced
  capacity_min INTEGER,
  capacity_max INTEGER,
  venue_style TEXT,                                            -- castle | hotel | boat | … | NULL (non-venue / unclassified)
  lat REAL,
  lng REAL,
  submitter_type TEXT,                                         -- 'user' | 'self' | NULL (curated)
  status TEXT NOT NULL DEFAULT 'active',                       -- 'active' | 'pending' | 'awaiting_review' | 'hidden'
  content_hash TEXT,                                           -- short-circuit for idempotent upserts
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_vendor_account ON listings(vendor_account_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
-- Partial index covers `/api/suppliers?near_lat=&near_lng=&radius_km=` proximity
-- queries. Curated listings ship lat/lng from VENUE_COORDS; community
-- submissions may lack coordinates (no geocode pipeline yet), and excluding
-- them from the index keeps it small until a geocode worker lands.
CREATE INDEX IF NOT EXISTS idx_listings_latlng ON listings(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ── P2.B: Growth instrumentation ────────────────────────────────────────────
--
-- Per-event log for the founder's 60-day commitment metric ("≥40% couples
-- publish microsite, ≥15% new signup via microsite referrer"). Anonymous-
-- tolerant — guest visits to /rsvp/* / /guest/portal don't carry user_id but
-- still count. `payload_json` holds per-kind extras (e.g. RSVP yes/no
-- counts, sign-up source). Indexed by kind+ts for the admin pull;
-- (couple_id, ts) covers the per-wedding funnel view.
--
-- Privacy: we store a *hashed* user-agent and a *truncated* Referer, not the
-- raw values, so the table can't be used to re-identify guests across
-- weddings. See domain/growth_events.ts for the hashing constants.
CREATE TABLE IF NOT EXISTS growth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
  referrer TEXT,                                               -- truncated to 500 chars
  user_agent_hash TEXT,                                        -- 16-hex SHA-256 prefix
  payload_json TEXT,                                           -- per-kind extras (JSON)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_events_kind ON growth_events(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_couple ON growth_events(couple_id, created_at DESC);

-- ── P2.C: Vendor listing claims ─────────────────────────────────────────────
--
-- Email-verification token for the "this listing is mine" flow. The token is
-- sent to listings.contact_email (the address the curator / submitter put on
-- the directory card — proof-of-control of the business inbox). Status flows
-- pending → verified (on token consume); expired-but-unused tokens are
-- swept by the same lifecycle worker that purges other one-shot tokens.
--
-- Consuming the token in `routes/vendor_claim.ts` happens atomically:
-- creates a users(role='vendor') row IF the email isn't already taken,
-- creates a vendor_accounts row, flips listings.vendor_account_id, issues a
-- session. If the email is taken by an existing user (e.g. a couple_id user),
-- the claim is rejected with a clear error — we don't silently merge roles.
CREATE TABLE IF NOT EXISTS listing_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,                                    -- targets listings.id; documented invariant, no FK
  email_sent_to TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',                      -- 'pending' | 'verified' | 'expired' | 'cancelled'
  expires_at INTEGER NOT NULL,
  verified_at INTEGER,
  vendor_account_id INTEGER REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_claims_listing ON listing_claims(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_claims_status ON listing_claims(status, created_at DESC);

-- ── Q3 prep: Supplier Outreach Inbox ────────────────────────────────────────
--
-- Schema-only foundation for the Q3 "couple picks 5 vendors → Weddly sends a
-- localised outreach mail per vendor → replies aggregate to an in-app thread"
-- feature. Tables created NOW (additive-only) so the future build doesn't ship
-- a schema-migration commit; routes/outreach.ts is a `GET /api/outreach/health`
-- stub today and grows into POST campaigns + inbound webhook in Q3.
--
-- Design (per the 5-agent debate Agent C verdict):
--   campaign → N messages → 0..N replies per message
--   `reply_token` is the per-message UNIQUE key embedded in the Reply-To
--   header (`reply+{token}@…`) so the Resend inbound webhook can route the
--   vendor's reply back to the correct campaign/couple without exposing the
--   couple's own email to the vendor.
--   The `Reply-To` strategy keeps deliverability-risk low: Weddly is the
--   relay, the couple is the From-side identity that the vendor reads.
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body_template TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_couple ON outreach_campaigns(couple_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outreach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,                                   -- listings.id-style public string
  supplier_email TEXT NOT NULL,
  sent_at INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',                       -- 'queued' | 'sent' | 'bounced' | 'replied'
  reply_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_campaign ON outreach_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_reply_token ON outreach_messages(reply_token);

CREATE TABLE IF NOT EXISTS outreach_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES outreach_messages(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_replies_message ON outreach_replies(message_id, received_at DESC);

-- ── Supplier detail page: reviews + Q&A + bookings ──────────────────────────
--
-- Admin-only in v1 (every write endpoint behind requireAdmin). Phase 3 flips
-- writes to requireAuth + engagement-proof gate (couple_picks / couple_supplier_costs).
-- Five-agent design debate concluded:
--   - schema lives now, content (editorial reviews) deferred to Phase 3
--   - author_user_id NOT NULL + couple_id NULL: admin authors leave couple_id NULL,
--     couple authors populate it; partial unique on (supplier_id, couple_id)
--     enforces "one review per couple per supplier" without blocking admins
--   - supplier_id stays the public string id (curated slug or "c{N}") — no FK
--     because curated suppliers live in code (domain/suppliers_data.ts)
--   - tag pool is hardcoded in shared/suppliers.ts (controlled vocabulary, not taxonomy)
--   - booking inquiries CLAIMED-VENDORS-ONLY in v1; unclaimed redirect via
--     supplier_views.website_click event (no separate table needed)

CREATE TABLE IF NOT EXISTS supplier_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,                                   -- curated slug or "c{N}"
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,  -- NULL = admin/editorial
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,                                                   -- nullable: rating-only review allowed
  published INTEGER NOT NULL DEFAULT 0,                        -- 0 = draft/hidden, 1 = surfaced publicly
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                                           -- soft-delete tombstone
);
CREATE INDEX IF NOT EXISTS idx_supplier_reviews_supplier
  ON supplier_reviews(supplier_id, published, deleted_at);
CREATE INDEX IF NOT EXISTS idx_supplier_reviews_author
  ON supplier_reviews(author_user_id);
-- Partial unique: one review per couple per supplier. Admin reviews (couple_id NULL)
-- are exempted so two admins can both seed an editorial entry for the same supplier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_reviews_couple_unique
  ON supplier_reviews(supplier_id, couple_id) WHERE couple_id IS NOT NULL;

-- Multi-select tags per review. Vocabulary is enforced application-side from
-- SUPPLIER_REVIEW_TAGS (shared/suppliers.ts) — keeping the DDL free of CHECK
-- clauses so we can add a tag in code without a schema bump.
CREATE TABLE IF NOT EXISTS supplier_review_tags (
  review_id INTEGER NOT NULL REFERENCES supplier_reviews(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (review_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_supplier_review_tags_tag ON supplier_review_tags(tag);

-- Q&A threads on a supplier. `visibility` separates admin-only notes (v1 default)
-- from public Q&A (Phase 3 flip). `parent_id` enables one-level reply (top-level
-- question + one answer); deeper nesting is intentionally rejected at write time.
CREATE TABLE IF NOT EXISTS supplier_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  parent_id INTEGER REFERENCES supplier_comments(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'admin_internal',           -- 'admin_internal' | 'public' | 'vendor_only'
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_supplier_comments_supplier
  ON supplier_comments(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_comments_parent
  ON supplier_comments(parent_id);

-- Booking inquiries. v1 = claimed-vendors-only (vendor_account_id NOT NULL
-- enforced at the route layer, not the DDL — the column is nullable so a
-- Phase-3 "inquiry to unclaimed via contact_email" flow can populate it later).
-- event_date is day-granular ISO 'YYYY-MM-DD'; no time-of-day in v1.
CREATE TABLE IF NOT EXISTS supplier_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  vendor_account_id INTEGER REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  event_date TEXT NOT NULL,                                    -- 'YYYY-MM-DD'
  status TEXT NOT NULL DEFAULT 'requested',                    -- 'requested' | 'vendor_seen' | 'confirmed' | 'declined' | 'cancelled' | 'expired'
  notes TEXT,
  amount_huf INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_bookings_supplier
  ON supplier_bookings(supplier_id, event_date);
CREATE INDEX IF NOT EXISTS idx_supplier_bookings_couple
  ON supplier_bookings(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_bookings_vendor
  ON supplier_bookings(vendor_account_id, status);

-- Vendor-published blocked dates. Sparse-row model: every row = one closed day.
-- Only claimed vendors can populate (enforced at the route layer via their
-- vendor_account_id session). UNIQUE prevents double-blocking the same day.
CREATE TABLE IF NOT EXISTS vendor_unavailable_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  blocked_date TEXT NOT NULL,                                  -- 'YYYY-MM-DD'
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(vendor_account_id, blocked_date)
);
CREATE INDEX IF NOT EXISTS idx_vendor_unavailable_dates_vendor
  ON vendor_unavailable_dates(vendor_account_id, blocked_date);

-- Denormalised supplier rollup. One row per supplier_id (lazy upsert from the
-- domain layer on every review write). Saves an aggregation pass on the
-- directory list endpoint and the detail GET. `top_tags` is a JSON array of
-- {tag, count} sorted desc — frontend reads as-is for the card pill row.
CREATE TABLE IF NOT EXISTS supplier_aggregates (
  supplier_id TEXT PRIMARY KEY,
  avg_rating REAL,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  top_tags TEXT NOT NULL DEFAULT '[]',                         -- JSON [{tag, count}, …]
  updated_at INTEGER NOT NULL
);

-- Public-facing blog posts. One row per post (slug-keyed); HU + EN copy live
-- in parallel columns so the admin can edit both languages from one form.
-- Bodies are stored as JSON-stringified BlogBlock[] (see shared/blog_posts.ts
-- for the block schema). cover_image_url points either to /uploads/blog/…
-- (local upload) or to an external http(s) URL (admin paste-in).
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,                                  -- 'YYYY-MM-DD'
  read_minutes INTEGER NOT NULL DEFAULT 5,
  cover_image_url TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,                     -- 0 = draft, 1 = live
  hu_category TEXT NOT NULL DEFAULT '',
  hu_title TEXT NOT NULL DEFAULT '',
  hu_lead TEXT NOT NULL DEFAULT '',
  hu_seo_title TEXT NOT NULL DEFAULT '',
  hu_seo_description TEXT NOT NULL DEFAULT '',
  hu_body_json TEXT NOT NULL DEFAULT '[]',                     -- JSON BlogBlock[]
  en_category TEXT NOT NULL DEFAULT '',
  en_title TEXT NOT NULL DEFAULT '',
  en_lead TEXT NOT NULL DEFAULT '',
  en_seo_title TEXT NOT NULL DEFAULT '',
  en_seo_description TEXT NOT NULL DEFAULT '',
  en_body_json TEXT NOT NULL DEFAULT '[]',                     -- JSON BlogBlock[]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON blog_posts(is_published, published_at DESC);

-- Couple-cards (100 kérdés a házasság előtt) feedback. Each row is one
-- anonymous "X" / "✓" / "✓✓" tap on a question. Aggregated in the admin
-- view to surface questions that visitors consistently flag as bad or
-- love. No PII beyond the optional IP/user-agent the rate limiter needs
-- to keep abuse in check.
CREATE TABLE IF NOT EXISTS couple_card_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id TEXT NOT NULL,
  card_index INTEGER NOT NULL,
  rating TEXT NOT NULL,                         -- 'bad' | 'ok' | 'great'
  locale TEXT NOT NULL,                         -- 'hu' | 'en'
  question_snapshot TEXT NOT NULL DEFAULT '',   -- the exact string shown
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_card_feedback_deck_card
  ON couple_card_feedback(deck_id, card_index, locale);
CREATE INDEX IF NOT EXISTS idx_couple_card_feedback_created
  ON couple_card_feedback(created_at DESC);

-- Visitor-submitted suggestions from the 26th "blank" card on every
-- deck. Anonymous, optional, free-text. Admin curates these into the
-- next copy iteration; nothing is auto-promoted.
CREATE TABLE IF NOT EXISTS couple_card_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id TEXT NOT NULL,                        -- 'roots' | 'everyday' | 'closeness' | 'deepwater' | 'lemonade' | 'firstdate'
  locale TEXT NOT NULL,                         -- 'hu' | 'en'
  suggestion TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_card_suggestions_created
  ON couple_card_suggestions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_card_suggestions_deck
  ON couple_card_suggestions(deck_id, locale);

-- Global billing kill-switch (single row, id always 1). While enforcement_on=0
-- the read-only paywall is DEFERRED: nobody is forced into read-only regardless
-- of trial/founding state. The founder flips it on from the admin financial
-- planner once the 200-couple founding cohort fills. Entitlement is still
-- computed/stored per couple; this only gates whether it is ENFORCED.
CREATE TABLE IF NOT EXISTS billing_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enforcement_on INTEGER NOT NULL DEFAULT 0,
  enforced_at INTEGER,
  enforced_by_user_id INTEGER
);

-- ── Wishlist / gift-registry ────────────────────────────────────────────────
--
-- The couple authors a list of things they'd love — a 'gift' (concrete thing
-- guests can buy or chip in on) or a 'request' (a non-object personal wish: a
-- letter, a childhood photo, a song), shown as two separate sections. Legacy
-- values item/group_gift are normalized to 'gift' and personal to 'request'
-- (boot migration in db.ts + read-time mapper). Confirmed guests (valid
-- household code + ≥1 RSVP yes) see the list embedded in the public-wedding
-- response. No money ever moves in-app: `target_amount_minor` is the couple's
-- informational "roughly what it costs" (integer minor units in the couple's
-- native currency), never a ledger. See shared/wishlist.ts for the contract.
-- Indexes live in db.ts (additive-table ordering rule) — NOT here.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'gift',                          -- 'gift' | 'request' (legacy: item/group_gift→gift, personal→request)
  target_amount_minor INTEGER,                                -- informational rough price; integer minor units (of `currency` when set, else the couple's); NULL when unset
  currency TEXT,                                              -- per-item currency override ('HUF'|'EUR'|'USD'); NULL = inherit the couple's display currency
  url TEXT,                                                    -- couple-pasted http(s) link; NULL when unset
  image_url TEXT,                                              -- og:image resolved server-side from url; NULL when none
  image_checked_at INTEGER,                                   -- last og:image resolution attempt (ms); NULL = never attempted (legacy rows the boot backfill sweeps)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The soft, non-money "I'd like to help" tap a confirmed household makes on a
-- 'gift' item. Idempotent per household via UNIQUE(item_id, household_id):
-- the toggle endpoint inserts if absent, deletes if present. `household_code` /
-- `household_label` are denormalised snapshots so the couple-side coordination
-- view can render who tapped in without a join even if the household is later
-- relabelled. Indexes live in db.ts.
CREATE TABLE IF NOT EXISTS wishlist_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  household_code TEXT NOT NULL,
  household_label TEXT NOT NULL,
  pledged_amount_minor INTEGER,                               -- soft, non-binding amount the household will chip in; minor units of the item's currency; NULL = tapped in without a number. No money moves.
  created_at INTEGER NOT NULL,
  UNIQUE(item_id, household_id)
);

-- Received-gifts ledger: a private, couple-only thank-you tracking table for
-- gifts that have actually arrived. Distinct from wishlist_items (what the
-- couple WANTS, surfaced to confirmed guests): this is what they GOT, never
-- published. `household_id` / `guest_id` optionally attribute the gift to a
-- whole household or a single guest (mutually exclusive; ON DELETE SET NULL so
-- removing the household / guest keeps the gift row). `household_id` is added in
-- db.ts via addColumnIfMissing for DBs created before it existed.
-- No money moves. See shared/received_gifts.ts. Index lives in db.ts.
CREATE TABLE IF NOT EXISTS received_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,         -- gift from a whole household; mutually exclusive with guest_id
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',                             -- free-text gift name; '' when the row carries only a guest/note
  note TEXT,                                                  -- free-text note (thank-you sent?, …); NULL when unset
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Moodboard uploads. A couple's moodboard has three sources (couples.moodboard_source):
-- 'preset' (a curated default Pinterest board, scraped), 'pinterest' (the couple's own
-- board link, in couples.moodboard_url), or 'upload' (the rows below — images the couple
-- uploaded from their own device, served from /uploads/couples/<id>/moodboard/).
CREATE TABLE IF NOT EXISTS moodboard_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,                                   -- public URL, e.g. /uploads/couples/12/moodboard/3.jpg
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moodboard_images_couple ON moodboard_images(couple_id, sort_order);

-- In-app notification feed: discrete, point-in-time EVENTS only (an RSVP came
-- in, a partner added a to-do, "we emailed you a timeline nudge"). Timeline
-- overdue / due-soon status is deliberately NOT stored here — it is computed
-- live from planning_items via summarizeTimeline at read time and merged into
-- the feed by the endpoint, so a completed / re-dated task's nudge updates for
-- free with no invalidation sweep. Rows are COUPLE-scoped (one row per event,
-- both partners share it); per-user read state lives in notification_seen, NOT
-- on the row, so partner A opening the bell never clears partner B's badge —
-- mirrors how email_dispatches fans out per (couple,user). actor_user_id is the
-- partner who caused the event (NULL for guest / system); the reader hides a row
-- from its own actor. data_json carries the render params (guest name, task
-- title, counts) — the human label is composed client-side via t() so locale
-- isn't frozen at write time. dedupe_key (nullable) collapses bursts (a family
-- RSVP, a bulk edit) into one row via the partial unique index below.
CREATE TABLE IF NOT EXISTS couple_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data_json TEXT,
  link TEXT,
  dedupe_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_notifications_couple ON couple_notifications(couple_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_notifications_dedupe
  ON couple_notifications(couple_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Per-(user,couple) read watermark for the notification bell. The timeline half
-- of the feed is computed, not stored, so "have I seen it?" can't be a per-row
-- flag — instead we stamp the moment the member last opened the bell, and any
-- feed item (computed or stored) whose timestamp is at or before seen_at counts
-- as read. Same shape + intent as admin_section_seen. A user can belong to more
-- than one couple over time, hence the composite key. NULL row = never opened
-- the bell, so everything actionable reads as unread.
CREATE TABLE IF NOT EXISTS notification_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, couple_id)
);
