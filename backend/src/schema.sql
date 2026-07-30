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

-- Uploaded invoices / receipts attached to a budget row. `scope` anchors each
-- document to what the user sees in the PAID column: 'cat:<category>' for an
-- aggregated category row, or 'line:<budget_line_id>' for a custom line. The
-- paid amount lives on budget_lines.paid_huf; this table is supplementary proof
-- (the bill icon next to the paid-percentage checkmark). file_path is the
-- public /uploads URL; the bytes live on the persistent volume.
CREATE TABLE IF NOT EXISTS budget_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,                                         -- 'cat:venue' | 'line:123'
  file_path TEXT NOT NULL,                                     -- public URL, e.g. /uploads/couples/12/budget-docs/3.pdf
  file_name TEXT NOT NULL,                                     -- original filename for display
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_documents_couple_scope ON budget_documents(couple_id, scope);

-- Timestamped payment ledger for a budget row. Each row is one payment the
-- couple recorded ("20% paid today"), anchored by the same `scope` as the PAID
-- column ('cat:<category>' | 'line:<id>'). The cumulative total stays on
-- budget_lines.paid_huf — this table is the additive history behind it.
CREATE TABLE IF NOT EXISTS budget_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,                                         -- 'cat:venue' | 'line:123'
  amount_huf INTEGER NOT NULL,                                 -- integer minor units, couple currency
  paid_at INTEGER NOT NULL,                                    -- epoch ms (editable, defaults to now)
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_payments_couple_scope ON budget_payments(couple_id, scope);

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

-- Email verification tokens. Single-use (consumed_at), 7-day TTL. Verification
-- is HARD: an unverified account never gets a session (see auth.ts login gate),
-- so the generous window is about giving a real user time to find the mail, not
-- about the check being optional.
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
-- Address-keyed lookup, NOCASE to match how we compare addresses everywhere
-- else. Needed because plenty of mail is logged with user_id = NULL: it was
-- sent BEFORE the account existed (welcome_verify to a pending signup) or to
-- someone who had no account at the time (partner_invite). The admin email
-- history stitches those onto the user by address.
CREATE INDEX IF NOT EXISTS idx_email_log_to_email ON email_log(to_email COLLATE NOCASE);

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

-- Admin moderation overrides for CURATED suppliers. Curated entries live in
-- code (domain/suppliers_data.ts), so there is no DB row to flip a status on.
-- This table tombstones a curated slug: 'hidden' removes it from the public
-- directory but keeps it visible (and restorable) in the admin catalog;
-- 'deleted' removes it from both. The override persists across deploys so a
-- re-shipped code entry stays suppressed until an admin restores it.
CREATE TABLE IF NOT EXISTS curated_supplier_overrides (
  supplier_id TEXT PRIMARY KEY,                                -- curated slug (DIRECTORY id)
  status TEXT NOT NULL,                                        -- 'hidden' | 'deleted'
  hide_reason TEXT,
  hidden_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hidden_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

-- Verified visitors: an email-verified party with NO login/session. They can
-- suggest suppliers and write supplier reviews without a Weddly account. Double
-- opt-in like newsletter_subscribers (own email-keyed row, single-use hashed
-- verify token, 7-day TTL) but verifying NEVER creates a `users` row or a
-- session. Their authored content (community_suppliers, supplier_reviews) anchors
-- the existing NOT-NULL author FK to a reserved system user (db.ts) and records
-- the REAL author in the additive *_visitor_id columns. See shared/verified_visitors.ts.
CREATE TABLE IF NOT EXISTS verified_visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,                                             -- optional display name
  locale TEXT NOT NULL DEFAULT 'en',                          -- confirmation-email language
  status TEXT NOT NULL DEFAULT 'pending',                     -- 'pending' | 'verified'
  verify_token_hash TEXT,                                     -- sha256 of the emailed link token; NULL once consumed
  verify_token_created_at INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verified_visitors_token
  ON verified_visitors(verify_token_hash);

-- Per-device auth tokens for a verified visitor ("verify once per device").
-- Mirrors the `sessions` table shape but for the session-less visitor principal:
-- the emailed link, when clicked, mints one of these; the browser stores the
-- plaintext and replays it on X-Visitor-Token. Only the sha256 hash is stored.
CREATE TABLE IF NOT EXISTS verified_visitor_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER NOT NULL REFERENCES verified_visitors(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,                            -- sha256 of the device token
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor
  ON verified_visitor_sessions(visitor_id);

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

-- Wedding-planner waitlist. Planners are not suppliers — they are a
-- separate user type with broader workspace access (Phase 2+). Phase 1
-- is pure data collection so we can qualify the cohort before building
-- the planner product surface.
CREATE TABLE IF NOT EXISTS planner_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company_name TEXT,
  city TEXT,
  years_experience INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'under_review' | 'accepted' | 'rejected'
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  outcome_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_waitlist_status ON planner_waitlist(status, created_at DESC);

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

-- Admin replies sent back to a feedback submitter, over email and/or an in-app
-- bell notification. Append-only thread (an admin may reply more than once);
-- rendered read-only in the /app/admin/feedback triage panel. Cascades away
-- with its parent submission (foreign_keys is ON).
CREATE TABLE IF NOT EXISTS feedback_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL,                    -- 'email' | 'notification' | 'both'
  email_status TEXT,                        -- mailer SendResult status; null when no email leg
  notified INTEGER NOT NULL DEFAULT 0,      -- 1 when an in-app bell notification was delivered
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_replies_feedback ON feedback_replies(feedback_id, created_at);

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

-- Logistics: rooms within a single accommodation. Optional — an accommodation
-- with zero rooms is one flat unit (guests drop straight onto it, capped by
-- accommodations.capacity). Once it has rooms, guests are placed into a
-- specific room and `capacity` is the per-room hard cap (the UI refuses drops
-- past it). Deleting the parent accommodation cascades its rooms; the matching
-- guest assignment is cleared via guests.accommodation_room_id ON DELETE SET NULL.
CREATE TABLE IF NOT EXISTS accommodation_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  accommodation_id INTEGER NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accommodation_rooms_accommodation ON accommodation_rooms(accommodation_id);
CREATE INDEX IF NOT EXISTS idx_accommodation_rooms_couple ON accommodation_rooms(couple_id);

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

-- Couple-facing planner directory analytics — the planner-side twin of
-- `supplier_events`. Records card impressions in the /app/vendors rail plus the
-- click-throughs (open profile, connect/Felkérés, website) so the admin
-- Szervezők list can show how much reach each planner card is getting.
-- `planner_user_id` targets the planner's `users` row. `couple_id` is nullable
-- for symmetry with supplier_events, though the rail is couple-authed today.
-- Named `planner_card_events` to stay clear of `planner_events` (the planner's
-- own CALENDAR table — a completely different aggregate).
CREATE TABLE IF NOT EXISTS planner_card_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                                    -- 'impression' | 'profile_click' | 'connect_click' | 'website_click'
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_card_events_planner
  ON planner_card_events(planner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_card_events_type
  ON planner_card_events(event_type, created_at DESC);

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

-- Vendor subscription / billing — a DIFFERENT aggregate from couples, so it
-- lives in its own table (1:1 with vendor_accounts) rather than overloading the
-- couple billing columns. Reuses the couple side's PURE entitlement math
-- (computeEntitlement) but has its own lifecycle: founding offer = the first
-- VENDOR_FOUNDING_CAP vendors free for one year (no card), then 3490 Ft / 10 €
-- per month. Entitlement (edit/publish access) is COMPUTED from status + the
-- timestamps at read-time — never stored — so a lapsed vendor goes read-only
-- without a background job. stripe_* are filled later by the vendor billing
-- webhook (Stripe fast-follow). Kept distinct from the Phase-3 payout fields
-- (stripe_account_id/KYC) reserved on vendor_accounts: billing is the vendor
-- paying us; payouts are the opposite money flow.
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  vendor_account_id INTEGER PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  subscription_status TEXT NOT NULL DEFAULT 'none',   -- trialing|founding|active|past_due|canceled|none
  trial_ends_at INTEGER,                              -- epoch ms; null unless trialing
  founding_until INTEGER,                             -- epoch ms; end of the 1-year founding window
  is_founding_member INTEGER NOT NULL DEFAULT 0,      -- first-100 badge; permanent (slot spent on grant)
  current_period_end INTEGER,                         -- epoch ms from Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  currency TEXT NOT NULL,                             -- HUF | EUR, pinned at activation from owner locale
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_subs_customer ON vendor_subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_subs_founding ON vendor_subscriptions(is_founding_member);

-- Planner subscription / billing — a `users` row with user_type='planner', priced
-- by TIER (starter/pro/premium). Its own table (1:1 with the planner user) rather
-- than overloading either the couple billing columns or the vendor table. Reuses
-- the couple side's PURE entitlement math (computeEntitlement). Founding offer =
-- the first PLANNER_FOUNDING_CAP planners free for two years (no card), then a
-- 3-day trial → paid. The tier itself is NOT stored here — users.planner_plan is
-- the single source of truth (kept in lockstep with users.planner_max_clients by
-- updatePlannerPlan); this row only tracks the subscription lifecycle. Entitlement
-- (edit access) is COMPUTED from status + timestamps at read-time — never stored —
-- so a lapsed planner goes read-only without a background job. stripe_* are filled
-- by the planner billing webhook.
CREATE TABLE IF NOT EXISTS planner_subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subscription_status TEXT NOT NULL DEFAULT 'none',   -- trialing|founding|active|past_due|canceled|none
  trial_ends_at INTEGER,                              -- epoch ms; null unless trialing
  founding_until INTEGER,                             -- epoch ms; end of the 2-year founding window
  is_founding_member INTEGER NOT NULL DEFAULT 0,      -- first-25 badge; permanent (slot spent on grant)
  current_period_end INTEGER,                         -- epoch ms from Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  currency TEXT NOT NULL,                             -- HUF | EUR, pinned at activation from user locale
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_subs_customer ON planner_subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planner_subs_founding ON planner_subscriptions(is_founding_member);

-- Vendor onboarding token — the bridge from an accepted waitlist entry to a
-- real vendor account. When the admin accepts a waitlist row, a token is minted
-- and the accept email carries /vendor/activate/:token. The vendor clicks, sets
-- a password, and the token is consumed to create users(role='vendor') +
-- vendor_accounts + a session (mirrors the listing_claims flow, but the
-- waitlist vendor has no existing listing to claim). Single-use: status flips
-- to 'completed' on success. Re-issuable so an admin can resend.
CREATE TABLE IF NOT EXISTS vendor_onboarding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waitlist_id INTEGER REFERENCES vendor_waitlist(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT,
  locale TEXT,                                        -- 'hu' | 'en' — fallback for currency + email language
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',             -- 'pending' | 'completed' | 'expired' | 'cancelled'
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  vendor_account_id INTEGER REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_onboarding_email ON vendor_onboarding(email);

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

-- Vendor availability SETTINGS — the recurring layer under the per-date rows
-- above. `weekdays` is the general pattern: which weekdays the vendor works at
-- all (JSON array of ISO weekday numbers, 1 = Monday … 7 = Sunday). NULL means
-- "every day", which is exactly the behaviour before this table existed, so
-- every pre-existing vendor keeps working with no migration.
--
-- `vendor_unavailable_dates` becomes the EXCEPTION layer on top: a row there
-- either blocks a day the pattern allows, or (with is_available = 1) opens a
-- day the pattern excludes. Resolution order lives in shared/vendor_availability.ts.
--
-- Its own table rather than columns on `vendor_accounts` because this is where
-- the rest of the scheduling controls belong as they land (minimum notice,
-- booking horizon, buffers, holiday auto-block) — one row of availability
-- policy per vendor, instead of steadily widening the account table.
CREATE TABLE IF NOT EXISTS vendor_availability_settings (
  vendor_account_id INTEGER PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  weekdays          TEXT,                                      -- JSON [1..7]; NULL = every day
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Vendor WEEKLY WORKING HOURS: the hour-granular half of the weekly layer.
-- One row per interval per weekday ('Monday 09:00-13:00'), minutes from
-- midnight, end exclusive, 0..1440.
--
-- `vendor_availability_settings.weekdays` above stays as the DERIVED day-level
-- mirror (a weekday with at least one interval is a working day) and remains
-- what every couple-facing read uses: the public availability payload, the
-- next-free date, the directory's date filter. Writes go through one function
-- (`setVendorSchedule`) that rewrites both, so the mirror cannot drift, and
-- nothing downstream of `weekdays` needed to change when hours landed.
--
-- No rows at all for a vendor = they never opened the hour editor; the schedule
-- is then synthesized from `weekdays` as whole days (hoursFromWeekdays), which
-- is lossless. That is why this needs no migration.
CREATE TABLE IF NOT EXISTS vendor_working_hours (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  weekday           INTEGER NOT NULL,                          -- ISO 1 = Monday … 7 = Sunday
  start_min         INTEGER NOT NULL,                          -- minutes from midnight
  end_min           INTEGER NOT NULL,                          -- exclusive; 1440 = end of day
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_working_hours_vendor
  ON vendor_working_hours(vendor_account_id, weekday, start_min);

-- Vendor "payments" — lightweight, in-app-only money tracking per Weddly-sourced
-- client (booking). NO real money movement / Stripe Connect: each row is one
-- labelled installment in the vendor's payment schedule for a booking. Amount is
-- integer minor units; currency follows the vendor's subscription (HUF | EUR).
-- A PRO-tier feature (see shared/vendor_plan.ts). The index lives in db.ts AFTER
-- this table per the additive-ordering rule.
CREATE TABLE IF NOT EXISTS vendor_client_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES supplier_bookings(id) ON DELETE CASCADE,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  label TEXT,
  amount INTEGER NOT NULL,                                     -- integer minor units
  currency TEXT NOT NULL,                                      -- 'HUF' | 'EUR'
  due_date TEXT,                                               -- 'YYYY-MM-DD' or NULL
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Couple ↔ vendor message thread, anchored on a booking (the "client" in the
-- vendor CRM). One row per message, either direction, replacing the appended
-- supplier_bookings.notes blob that had no sender and no timestamps.
--
-- delivered_at / seen_at are stamped on the RECIPIENT's read, first-wins, and
-- the sent/delivered/seen ladder is DERIVED from them (shared/booking_messages.ts):
-- a stored status column would be the same fact twice and would drift.
-- sender_user_id is who actually typed it (a partner, or the vendor owner) and
-- goes NULL on account deletion. sender_kind is what the thread renders from,
-- so a deleted author never orphans the message.
CREATE TABLE IF NOT EXISTS booking_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES supplier_bookings(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL,                                   -- 'vendor' | 'couple'
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  delivered_at INTEGER,
  seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_messages_thread
  ON booking_messages(booking_id, created_at ASC);
-- Drives both unread counters: "messages TO me that I have not seen".
CREATE INDEX IF NOT EXISTS idx_booking_messages_unseen
  ON booking_messages(booking_id, sender_kind) WHERE seen_at IS NULL;

-- Files hanging off a message. Same shape as budget_documents (the private-doc
-- precedent): the row owns the display name + sniffed mime, and file_path is a
-- storage key under couples/<id>/ so a GDPR purge of the couple takes the bytes
-- with it. PDF and JPG only, and served ONLY through the authenticated download
-- route, since /uploads/* is public, so this prefix is denylisted there.
CREATE TABLE IF NOT EXISTS booking_message_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES booking_messages(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,                                     -- /uploads/couples/<id>/booking-messages/<id>.pdf
  file_name TEXT NOT NULL,                                     -- original filename, for display
  mime TEXT NOT NULL,                                          -- 'application/pdf' | 'image/jpeg'
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_message_attachments_message
  ON booking_message_attachments(message_id);

-- A vendor's canned replies ("Szabad a dátum", "Árajánlat mellékelve"). Body may
-- contain {client_name}-style tokens, substituted at insert-into-the-composer
-- time, not at save time, so the stored template stays reusable across clients.
CREATE TABLE IF NOT EXISTS vendor_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_message_templates_account
  ON vendor_message_templates(vendor_account_id, created_at DESC);

-- Vendor to-do board. Private, vendor-scoped work items (not tied to a couple
-- or booking) shown on the Trello-style board in the vendor workspace. Lanes
-- mirror the planner board: 'todo' | 'doing' | 'done'.
CREATE TABLE IF NOT EXISTS vendor_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,                                               -- 'YYYY-MM-DD' or NULL
  board_status TEXT NOT NULL DEFAULT 'todo',                   -- 'todo' | 'doing' | 'done'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_tasks_vendor
  ON vendor_tasks(vendor_account_id, board_status);

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
-- relabelled. `notification_email` is the opt-in address a guest provides when
-- pledging so they can receive group-gift coordination emails (never returned in
-- any HTTP response; only read server-side for mailer). Indexes live in db.ts.
CREATE TABLE IF NOT EXISTS wishlist_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  household_code TEXT NOT NULL,
  household_label TEXT NOT NULL,
  pledged_amount_minor INTEGER,                               -- soft, non-binding amount the household will chip in; minor units of the item's currency; NULL = tapped in without a number. No money moves.
  notification_email TEXT,                                    -- opt-in email for group-gift coordination notifications; NULL when not provided; never returned in HTTP responses.
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

-- Per-item read state: which specific feed items a user has CLICKED (acted on),
-- keyed by the item's stable string id (tl:… / evt:… / stale:… / decstale:… /
-- survey:…). This is DISTINCT from notification_seen, the badge watermark:
-- opening the bell clears the badge but must NOT bury an unclicked item in
-- history. A notification only moves to "Korábbi értesítések" once its row lands
-- here, i.e. once the user actually clicks it.
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- Stripe webhook idempotency ledger. Stripe delivers events at-least-once and
-- its dashboard "resend" button + automatic retries WILL redeliver — so the
-- webhook handler must dedup by event id, otherwise a replayed
-- subscription.updated/deleted re-applies stale state (e.g. flips a canceled
-- couple back to active, restoring entitlement they no longer pay for). One row
-- per processed event id; the handler INSERT OR IGNOREs after verifying the
-- Stripe signature (so unsigned callers can't poison the table) and skips
-- processing when the row already existed. Rows are tiny and can be pruned by a
-- later cron; unbounded growth is not an incident-time concern.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  received_at INTEGER NOT NULL
);

-- Referral reward ledger. One row per unique referred entity (a couple or a
-- vendor waitlist entry that eventually activated). The UNIQUE constraint on
-- (referral_type, referred_id) prevents double-granting if the trigger fires
-- more than once (e.g. a webhook retry or a bug). `bonus_ms` records how much
-- time was added so the admin can audit the cohort impact. ON DELETE CASCADE
-- keeps the table clean if a referrer deletes their account.
CREATE TABLE IF NOT EXISTS referral_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  referral_type TEXT NOT NULL,   -- 'couple' | 'vendor'
  referred_id INTEGER NOT NULL,  -- couples.id  OR  vendor_waitlist.id (resolved at grant time)
  bonus_ms INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  UNIQUE(referral_type, referred_id)
);

-- Guest photo collection. One album per couple, created when they click
-- "Create upload link" on /app/media. upload_token is the credential
-- embedded in the QR code and share link (/photos/:token).
CREATE TABLE IF NOT EXISTS photo_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  upload_token TEXT NOT NULL UNIQUE,
  title TEXT,
  shots_per_guest INTEGER,
  is_upload_enabled INTEGER NOT NULL DEFAULT 1,
  allow_guest_viewing INTEGER NOT NULL DEFAULT 0,
  reveal_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Individual photos submitted by guests through /photos/:token.
CREATE TABLE IF NOT EXISTS photo_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  guest_name TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  filter_applied TEXT,
  thumbnail_path TEXT
);

-- Unique devices that have joined a film (registered on first visit, before any upload).
-- Used for guest-cap enforcement and real-time participation stats.
CREATE TABLE IF NOT EXISTS film_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  guest_name TEXT,
  joined_at INTEGER NOT NULL,
  UNIQUE(album_id, device_id)
);

-- Cache of Wikipedia destination cover photos downloaded to /uploads.
-- Keyed by the normalised city name (lower-case, stripped).
CREATE TABLE IF NOT EXISTS destination_photo_cache (
  city        TEXT    PRIMARY KEY,
  local_path  TEXT    NOT NULL,
  fetched_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Planner-to-couple links. A planner can manage multiple couple workspaces;
-- a couple can have at most one linked planner (enforced at the route layer).
CREATE TABLE IF NOT EXISTS planner_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE(planner_user_id, couple_id)
);

-- Planner email invitations — a planner invites a not-yet-onboarded person by
-- email to become their client. The invitee signs up (or logs in) and builds a
-- workspace; the onboarding hook then creates a PENDING planner_clients link
-- (initiated_by='planner') which the new couple must still approve before the
-- planner gains edit access (consent preserved end to end). `email` is matched
-- case-insensitively at onboarding. status: pending | accepted | revoked.
CREATE TABLE IF NOT EXISTS planner_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT    NOT NULL,
  token            TEXT    NOT NULL UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'pending',
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at      INTEGER,
  expires_at       INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_invitations_email ON planner_invitations(email, status);
CREATE INDEX IF NOT EXISTS idx_planner_invitations_planner ON planner_invitations(planner_user_id, status);

-- Planner ↔ client couple message thread. Each row is one outbound email
-- the planner composed + sent. direction='out' in v1 (planner→client);
-- reserved for future inbound webhook. Reply-To is the planner's own email
-- so the client's reply lands directly in the planner's inbox.
CREATE TABLE IF NOT EXISTS planner_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id        INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  direction        TEXT    NOT NULL DEFAULT 'out',
  subject          TEXT    NOT NULL,
  body_text        TEXT    NOT NULL,
  recipient_email  TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'sent',
  created_at       INTEGER NOT NULL
);

-- Planner-created calendar events. A planner can drop an event onto their
-- calendar, either tied to a specific client workspace (couple_id set) or
-- standalone (couple_id NULL, e.g. a personal scouting trip). Scoped to the
-- owning planner_user_id; couple_id, when present, must reference a couple the
-- planner is linked to (enforced at the route layer).
CREATE TABLE IF NOT EXISTS planner_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id        INTEGER REFERENCES couples(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  event_date       TEXT    NOT NULL,                            -- ISO YYYY-MM-DD
  start_time       TEXT,                                        -- HH:MM, nullable
  notes            TEXT,
  created_at       INTEGER NOT NULL
);

-- Timestamped private notes a planner keeps on one client workspace — the
-- comment-feed on the client CRM page. Append-style entries (newest first in
-- the UI); planner_clients.notes stays as the roster quick-note. Visible only
-- to the owning planner, never to the couple.
CREATE TABLE IF NOT EXISTS planner_client_notes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id        INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  body             TEXT    NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_client_notes_link
  ON planner_client_notes(planner_user_id, couple_id, created_at);

-- Planner portfolio / references — past work the planner showcases on their
-- profile. Each row is one reference entry: a title + free-text description and
-- an optional uploaded image (served from /uploads/planners/<user>/portfolio/).
CREATE TABLE IF NOT EXISTS planner_portfolio (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  image_url        TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_portfolio_user
  ON planner_portfolio(planner_user_id, sort_order);

-- Planner price packages (árajánlat) — the planner's published price offers,
-- mirroring listing_packages for vendors. Up to MAX_LISTING_PACKAGES named tiers,
-- each with an optional free-text price, description and attached price-list PDF
-- (public /uploads key). Couples see them on the planner detail page. Keyed by
-- planner_user_id; ordered by id ASC = creation order.
CREATE TABLE IF NOT EXISTS planner_packages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  price_text       TEXT,
  description      TEXT,
  pdf_url          TEXT,
  pdf_name         TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_packages_user ON planner_packages(planner_user_id);

-- Planner blocked dates — the days a planner is already booked / unavailable,
-- mirroring vendor_unavailable_dates. Whole-day only (a planner runs one wedding
-- a day, so there is no partial-hour concept). Couples see these as booked (red)
-- on the planner detail busy calendar; the next-free date is recomputed from
-- them. UNIQUE prevents double-blocking the same day.
CREATE TABLE IF NOT EXISTS planner_unavailable_dates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_date     TEXT    NOT NULL,                            -- 'YYYY-MM-DD'
  reason           TEXT,
  created_at       INTEGER NOT NULL,
  UNIQUE(planner_user_id, blocked_date)
);
CREATE INDEX IF NOT EXISTS idx_planner_unavailable_dates_user
  ON planner_unavailable_dates(planner_user_id, blocked_date);

-- Guest broadcasts composed on /app/invites. One row per send (immediate or
-- scheduled) of one of the three templates: 'invite' | 'major_update' |
-- 'pre_wedding_info'. Immediate sends are written straight as 'sent';
-- 'scheduled' rows wait for the hourly email worker to fire them once
-- scheduled_at passes. envelope_amount/include_envelope_tip snapshot the
-- per-head tip baked into a pre_wedding_info message at send time. Indexes live
-- in db.ts per the additive-ordering rule.
CREATE TABLE IF NOT EXISTS guest_messages (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id            INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  template             TEXT    NOT NULL,                       -- 'invite' | 'major_update' | 'pre_wedding_info'
  subject              TEXT,
  body                 TEXT,
  include_envelope_tip INTEGER NOT NULL DEFAULT 0,
  envelope_amount      INTEGER,
  audience             TEXT    NOT NULL DEFAULT 'all',         -- 'all' | 'pending' | 'confirmed'
  status               TEXT    NOT NULL DEFAULT 'scheduled',   -- 'scheduled' | 'sending' | 'sent' | 'failed'
  scheduled_at         INTEGER,                                -- null = sent immediately
  sent_at              INTEGER,
  recipient_count      INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- Newsletter subscribers (landing + blog email capture). Double opt-in per
-- Grtv. §6: subscribe inserts status='pending' and emails a confirm link;
-- the click flips to 'confirmed'. Unsubscribe keeps the row as a suppression
-- record instead of deleting it. Only the SHA-256 hash of the confirm/
-- unsubscribe token is stored (same rationale as auth/tokens.ts); the token
-- is re-minted on repeat subscribe attempts, token_created_at drives the
-- 7-day confirm-link TTL.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT    NOT NULL UNIQUE,
  locale           TEXT    NOT NULL DEFAULT 'hu',              -- 'hu' | 'en'
  status           TEXT    NOT NULL DEFAULT 'pending',         -- 'pending' | 'confirmed' | 'unsubscribed'
  token_hash       TEXT    UNIQUE,
  token_created_at INTEGER,
  source           TEXT,                                       -- 'landing' | 'blog:<slug>' | ...
  created_at       INTEGER NOT NULL,
  confirmed_at     INTEGER,
  unsubscribed_at  INTEGER
);

-- Listing photo gallery (beyond the single hero image). Claimed vendors
-- upload up to a capped number of portfolio photos; the public supplier
-- detail page surfaces them as gallery_urls (hero first). Files live under
-- uploads: listings/<listing_id>/gallery/<name>.<ext> via lib/storage.ts.
CREATE TABLE IF NOT EXISTS listing_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON listing_photos(listing_id);

-- Listing video reel (reference videos beside the photo gallery). Claimed
-- vendors embed up to a capped number of YouTube links; the public supplier
-- detail page renders them as a lazy click-to-play grid right after the
-- gallery. `provider`+`video_id` are the source of truth for the embed URL
-- (never the raw `url`, which is preserved only so the edit field round-trips
-- the vendor's paste). `position` is the 0-based drag order. Provider-agnostic
-- by design so Vimeo drops in without a schema change (see shared/listing_videos.ts).
CREATE TABLE IF NOT EXISTS listing_videos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT    NOT NULL,
  provider   TEXT    NOT NULL DEFAULT 'youtube',
  video_id   TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_videos_listing ON listing_videos(listing_id);

-- Listing packages (árajánlat / price offers). A claimed vendor publishes up to
-- MAX_LISTING_PACKAGES (shared/listing_packages.ts) named price tiers on their
-- listing; couples see them on the public supplier detail page. `price_text` is
-- free-text (vendors quote in many shapes), `pdf_url`/`pdf_name` are the
-- optional attached price-list PDF (public /uploads key, like photos). Ordered
-- by id ASC = creation order. Keyed by the string listing_id like photos/videos.
CREATE TABLE IF NOT EXISTS listing_packages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  price_text  TEXT,
  description TEXT,
  pdf_url     TEXT,
  pdf_name    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_packages_listing ON listing_packages(listing_id);

-- Admin-provisioned planner activations. An admin pre-registers a planner
-- (email + name + business name + category) with a 2-year free comp; the
-- planner receives an activation link and goes live by setting a password
-- and accepting the legal documents. Single-use (consumed_at), 30-day TTL,
-- only the SHA-256 hash of the token is stored (auth/tokens.ts).
CREATE TABLE IF NOT EXISTS planner_activation_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_activation_user ON planner_activation_tokens(user_id);

-- Google Calendar push-sync. One connection row per couple (the partner who
-- authorised owns the sync); Weddly creates a dedicated secondary calendar in
-- their Google account and one-way pushes dated tasks + the wedding day + the
-- day-of run sheet into it. OAuth tokens are stored AES-256-GCM-encrypted
-- (never plaintext). `sync_state='dirty'` marks a couple whose events changed
-- and need reconciling; the background worker flips it back to 'idle'.
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  couple_id         INTEGER PRIMARY KEY REFERENCES couples(id) ON DELETE CASCADE,
  connected_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email      TEXT    NOT NULL,
  calendar_id       TEXT,                                   -- Google secondary calendar id, set after creation
  time_zone         TEXT    NOT NULL DEFAULT 'Europe/Budapest',
  access_token_enc  TEXT,                                   -- AES-256-GCM(iv:tag:ct)
  refresh_token_enc TEXT,                                   -- AES-256-GCM(iv:tag:ct)
  token_expiry      INTEGER,                                -- unix ms; refresh before this
  sync_state        TEXT    NOT NULL DEFAULT 'dirty',       -- 'idle' | 'dirty'
  last_synced_at    INTEGER,
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Maps each synced Weddly source item to its Google event so the reconciler can
-- insert / patch / delete by diffing `content_hash`. PK is the stable source
-- key so a re-sync never duplicates events.
CREATE TABLE IF NOT EXISTS google_calendar_event_map (
  couple_id       INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  source_kind     TEXT    NOT NULL,                         -- 'task' | 'wedding_day' | 'schedule'
  source_id       TEXT    NOT NULL,                         -- planning_items.id / 'wedding' / schedule_events.id
  google_event_id TEXT    NOT NULL,
  content_hash    TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (couple_id, source_kind, source_id)
);

-- Vendor-side Google Calendar push-sync. A PARALLEL aggregate to the couple
-- tables above, not a widening of them: `google_calendar_connections.couple_id`
-- is both the primary key AND the foreign key, so there is no additive way to
-- give those tables a second owner type (the repo never DROPs or RENAMEs). Same
-- reason `vendor_subscriptions` sits beside the couples billing columns.
--
-- One connection per vendor ACCOUNT (not per user — vendor_accounts.owner_user_id
-- is UNIQUE, so they're 1:1 today, but the account is the thing that owns the
-- bookings and blocked dates). Weddly creates a dedicated secondary calendar in
-- the vendor's Google account and one-way pushes confirmed weddings, pending
-- inquiries, blocked days and task deadlines into it. Google is never read back:
-- nothing in the vendor's Google account can change Weddly availability.
CREATE TABLE IF NOT EXISTS vendor_google_calendar_connections (
  vendor_account_id INTEGER PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  connected_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email      TEXT    NOT NULL,
  calendar_id       TEXT,                                   -- Google secondary calendar id, set after creation
  time_zone         TEXT    NOT NULL DEFAULT 'Europe/Budapest',
  access_token_enc  TEXT,                                   -- AES-256-GCM(iv:tag:ct)
  refresh_token_enc TEXT,                                   -- AES-256-GCM(iv:tag:ct)
  token_expiry      INTEGER,                                -- unix ms; refresh before this
  sync_state        TEXT    NOT NULL DEFAULT 'dirty',       -- 'idle' | 'dirty'
  last_synced_at    INTEGER,
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Same insert/patch/delete diffing as the couple event map, keyed by vendor.
CREATE TABLE IF NOT EXISTS vendor_google_calendar_event_map (
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  source_kind       TEXT    NOT NULL,                       -- 'booking' | 'inquiry' | 'blocked' | 'task'
  source_id         TEXT    NOT NULL,                       -- supplier_bookings.id / blocked_date / vendor_tasks.id
  google_event_id   TEXT    NOT NULL,
  content_hash      TEXT    NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (vendor_account_id, source_kind, source_id)
);

-- Signups that haven't proved their email address yet. A password registration
-- lands HERE, not in `users` — the users row is only minted when the verify
-- link is clicked (see routes/email_verify.ts handleConsume).
--
-- Why: verification is a hard gate (an unverified account can never get a
-- session), so a users row for an unverified signup was pure dead weight — it
-- cluttered the admin list and, worse, held its address hostage against the
-- users.email UNIQUE constraint, permanently locking the rightful owner of a
-- typo'd address out with a 409.
--
-- Everything `handleRegister` used to do inline against a fresh user_id is
-- stashed here and replayed at verify-time: acquisition snapshot, the planner
-- invite to rebind, referrer attribution, and the GDPR consent evidence
-- (consent_ip / consent_user_agent are captured at REGISTER time — the moment
-- the box was actually ticked — and must not be re-read from the verify click,
-- which often arrives from a different device).
--
-- OAuth (Google/Apple) never touches this table: those signups are
-- provider-attested and go straight to `users` with verified_email = 1.
CREATE TABLE IF NOT EXISTS pending_signups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL UNIQUE,
  password_hash     TEXT    NOT NULL,
  full_name         TEXT    NOT NULL,
  locale            TEXT,
  token             TEXT    NOT NULL UNIQUE,                -- sha256 hash, never plaintext
  expires_at        INTEGER NOT NULL,
  -- Acquisition snapshot, replayed onto the users row at verify.
  signup_country    TEXT,
  device_type       TEXT,
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  utm_content       TEXT,
  utm_term          TEXT,
  -- Deferred side effects.
  referrer          TEXT,                                   -- allow-listed: 'rsvp' | 'site' | 'share'
  referer_header    TEXT,                                   -- legacy /rsvp/* attribution fallback
  planner_invite    TEXT,
  privacy_version   TEXT    NOT NULL,
  terms_version     TEXT    NOT NULL,
  -- The register request's ip + user-agent. Serves two masters: GDPR Art. 7(1)
  -- consent evidence (the request where the box was ticked) and growth-event
  -- attribution. Both want the REGISTER click, not the verify click — the latter
  -- often arrives from a different device hours later.
  signup_ip         TEXT,
  signup_user_agent TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at);

-- ── Vendor claim-invite campaign ────────────────────────────────────────────
--
-- Cold outreach to the UNCLAIMED half of the directory: listings that couples
-- (or our own curation) put on the site, whose owner has never taken over the
-- profile. One mail per business, carrying a pre-minted listing_claims token so
-- the CTA is a genuine one-click into the claim flow, no "enter your email and
-- wait for a second mail" hop.
--
-- Two tables because a campaign is a long-lived operator object (paced out over
-- days, pausable) while a send is per-recipient state. Sends are what the
-- reminder sweep and the funnel stats read.
CREATE TABLE IF NOT EXISTS vendor_claim_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                                   -- operator-facing handle, e.g. 'claim-invite-2026-07'
  status TEXT NOT NULL DEFAULT 'paused',                       -- 'paused' | 'running' | 'done'
  -- Rolling-24h send ceiling. Cold volume is a deliverability risk to the whole
  -- domain (verify + RSVP mail shares the reputation), so the worker paces
  -- rather than blasting. 0 would stall the campaign, so it is rejected on write.
  daily_cap INTEGER NOT NULL DEFAULT 50,
  country TEXT,                                                -- ISO alpha-2 segment filter; NULL = every country
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per recipient ADDRESS per campaign (not per listing): a vendor with
-- three listings in the directory gets one invite, not three. The winning
-- listing is whichever the target query picked first.
CREATE TABLE IF NOT EXISTS vendor_claim_campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES vendor_claim_campaigns(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,                                    -- targets listings.id; documented invariant, no FK (mirrors listing_claims)
  email TEXT NOT NULL,                                         -- lowercased contact_email as of send time
  locale TEXT NOT NULL,                                        -- 'hu' | 'en'; resolved from the listing's country
  country TEXT,                                                -- resolved at send time, for the admin breakdown
  category TEXT NOT NULL,                                      -- listing category as of send time (named in the copy)
  -- The listing_claims token this invite carries. Also the lookup key for the
  -- click-tracking redirect, so it stays stable even after the claim it points
  -- at expires and the redirect mints a fresh one.
  claim_token TEXT,
  status TEXT NOT NULL DEFAULT 'queued',                       -- 'queued' | 'sent' | 'failed' | 'skipped'
  error TEXT,                                                  -- failure reason when status='failed'
  sent_at INTEGER,
  opened_at INTEGER,                                           -- tracking pixel; unreliable upward (Apple MPP prefetch)
  clicked_at INTEGER,                                          -- redirect hit; the trustworthy engagement signal
  reminder_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vccs_campaign_email ON vendor_claim_campaign_sends(campaign_id, email);
CREATE INDEX IF NOT EXISTS idx_vccs_campaign_status ON vendor_claim_campaign_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_vccs_listing ON vendor_claim_campaign_sends(listing_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vccs_claim_token ON vendor_claim_campaign_sends(claim_token) WHERE claim_token IS NOT NULL;
-- Drives both the pacing query (sends in the last 24h) and the reminder sweep.
CREATE INDEX IF NOT EXISTS idx_vccs_sent_at ON vendor_claim_campaign_sends(sent_at);

-- Address-level suppression for mail we send to people who never signed up.
-- `email_preferences.lifecycle_opt_out` cannot serve this: it is keyed by
-- users.id, and the whole point of this cohort is that they have no users row.
-- Rows are permanent tombstones, never deleted, so a re-run of any campaign
-- cannot resurrect a suppressed address.
CREATE TABLE IF NOT EXISTS email_optouts (
  email TEXT PRIMARY KEY,                                      -- lowercased, trimmed
  reason TEXT NOT NULL,                                        -- 'vendor_claim_campaign' | 'vendor_review_campaign' | 'manual'
  created_at INTEGER NOT NULL
);

-- ── Vendor review-invite campaign ───────────────────────────────────────────
-- Sibling of the claim-invite campaign above, but the mirror image of it:
-- it writes to the CLAIMED half of the directory (vendors who already run a
-- Weddly account) to tell them supplier reviews are now open to anyone, and
-- hands each one their own public review link to forward to past clients. The
-- ask is "collect a few honest 5-star reviews", not "take over your profile".
--
-- Kept parallel rather than folded into vendor_claim_campaigns because the
-- audience inverts (claimed vs unclaimed, every recipient HAS a users row), the
-- conversion metric is "reviews landed" not "listing claimed", and the reminder
-- gate is stricter (not-clicked AND not-opened). Shares email_optouts for
-- suppression.
CREATE TABLE IF NOT EXISTS vendor_review_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                                   -- operator-facing handle, e.g. 'reviews-open-2026-07'
  status TEXT NOT NULL DEFAULT 'paused',                       -- 'paused' | 'running' | 'done'
  daily_cap INTEGER NOT NULL DEFAULT 50,                       -- rolling-24h send ceiling; paced by the worker
  country TEXT,                                                -- ISO alpha-2 segment filter; NULL = every country
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per recipient ADDRESS per campaign. `review_url` is the vendor's own
-- public page, stored so the tracked click-redirect knows where to land without
-- recomputing the slug. Unlike the claim campaign there is no bearer token in
-- the mail: the CTA carries a signed <sendId>.<hmac> that resolves back here.
CREATE TABLE IF NOT EXISTS vendor_review_campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES vendor_review_campaigns(id) ON DELETE CASCADE,
  vendor_account_id INTEGER NOT NULL,                          -- targets vendor_accounts.id; documented invariant, no FK
  listing_id TEXT NOT NULL,                                    -- the claimed listings.id ('v{account_id}')
  email TEXT NOT NULL,                                         -- lowercased account-owner email as of send time
  locale TEXT NOT NULL,                                        -- 'hu' | 'en'
  country TEXT,                                                -- resolved at send time, for the admin breakdown
  review_url TEXT NOT NULL,                                    -- the vendor's public page; the tracked CTA destination
  status TEXT NOT NULL DEFAULT 'queued',                       -- 'queued' | 'sent' | 'failed' | 'skipped'
  error TEXT,
  sent_at INTEGER,
  opened_at INTEGER,                                           -- tracking pixel; unreliable upward (Apple MPP prefetch)
  clicked_at INTEGER,                                          -- redirect hit; the trustworthy engagement signal
  reminder_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vrcs_campaign_email ON vendor_review_campaign_sends(campaign_id, email);
CREATE INDEX IF NOT EXISTS idx_vrcs_campaign_status ON vendor_review_campaign_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_vrcs_listing ON vendor_review_campaign_sends(listing_id);
-- Drives both the pacing query (sends in the last 24h) and the reminder sweep.
CREATE INDEX IF NOT EXISTS idx_vrcs_sent_at ON vendor_review_campaign_sends(sent_at);

-- ── Personal-invite campaign ────────────────────────────────────────────────
-- The founder's own contacts (CSV import), told about Weddly with a "you (or
-- someone you love) is getting married" note and a register CTA. Unlike the two
-- vendor campaigns this targets a FIXED imported list, not a live directory
-- query: one send row is seeded per contact at import (deduped against `users`
-- and `email_optouts`), and the paced sweep drains 'queued' rows up to the
-- rolling-24h daily_cap, re-checking users/optouts at send time so anyone who
-- registers or opts out between import and send is never mailed. Shares
-- email_optouts for suppression; conversion is attributed via a UTM on the CTA
-- plus a live join to `users`, so there is no click-tracking column here.
CREATE TABLE IF NOT EXISTS personal_invite_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                                   -- operator handle, e.g. 'friends-2026-07'
  status TEXT NOT NULL DEFAULT 'paused',                       -- 'paused' | 'running' | 'done'
  daily_cap INTEGER NOT NULL DEFAULT 50,                       -- rolling-24h send ceiling; paced by the worker
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);

-- One row per recipient ADDRESS per campaign, seeded 'queued' at import.
CREATE TABLE IF NOT EXISTS personal_invite_campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES personal_invite_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',                               -- for the greeting; may be empty
  email TEXT NOT NULL,                                         -- lowercased, trimmed
  locale TEXT NOT NULL DEFAULT 'hu',                           -- 'hu' | 'en', detected at import
  status TEXT NOT NULL DEFAULT 'queued',                       -- 'queued' | 'sent' | 'failed' | 'skipped'
  error TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pics_campaign_email ON personal_invite_campaign_sends(campaign_id, email);
CREATE INDEX IF NOT EXISTS idx_pics_campaign_status ON personal_invite_campaign_sends(campaign_id, status);
-- Drives the rolling-24h pacing query.
CREATE INDEX IF NOT EXISTS idx_pics_sent_at ON personal_invite_campaign_sends(sent_at);

-- Admin-run re-engagement blast to REGISTERED couple accounts that verified
-- their email but never onboarded (no workspace: users.couple_id IS NULL). This
-- is the manual counterpart to the automatic 24h + 1-week onboarding drip
-- (domain/emails/worker.ts): that drip fires once per user forever, so a stale
-- orphan cohort it already exhausted can only be re-nudged from here. Targets
-- are a LIVE query over `users` (not a CSV): the operator "syncs" the current
-- orphan segment into send rows, then the paced sweep drains 'queued' up to the
-- rolling-24h daily_cap, re-checking onboarded/opt-out at send time so anyone
-- who onboards or opts out between sync and send is never mailed. Conversion is
-- a live join (the targeted user now has a couple_id); one reminder wave is
-- gated on STILL-not-onboarded (not on opens/clicks, which are unreliable).
CREATE TABLE IF NOT EXISTS onboarding_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                                   -- operator handle, e.g. 'reengage-2026-07'
  status TEXT NOT NULL DEFAULT 'paused',                       -- 'paused' | 'running' | 'done'
  daily_cap INTEGER NOT NULL DEFAULT 50,                       -- rolling-24h send ceiling; paced by the worker
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);

-- One row per targeted USER per campaign, seeded 'queued' at sync.
CREATE TABLE IF NOT EXISTS onboarding_campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES onboarding_campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,      -- the targeted account; conversion joins on it
  name TEXT NOT NULL DEFAULT '',                               -- for the greeting; may be empty
  email TEXT NOT NULL,                                         -- lowercased, trimmed (snapshot at sync)
  locale TEXT NOT NULL DEFAULT 'hu',                           -- 'hu' | 'en', from users.locale at sync
  status TEXT NOT NULL DEFAULT 'queued',                       -- 'queued' | 'sent' | 'failed' | 'skipped'
  error TEXT,
  sent_at INTEGER,
  reminder_sent_at INTEGER,                                    -- one reminder wave, gated on still-not-onboarded
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oncs_campaign_email ON onboarding_campaign_sends(campaign_id, email);
CREATE INDEX IF NOT EXISTS idx_oncs_campaign_status ON onboarding_campaign_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_oncs_sent_at ON onboarding_campaign_sends(sent_at);
CREATE INDEX IF NOT EXISTS idx_oncs_user ON onboarding_campaign_sends(user_id);

-- ── Campaign schedules (the standing plan) ──────────────────────────────────
-- One row per campaign FAMILY, not per campaign: the recurring instruction
-- "every `interval_days`, build the next one of these and leave it ready to
-- run". The hourly worker prepares a due schedule's campaign PAUSED with its
-- targets resolved, so the operator's whole job is pressing Run (or flipping
-- `auto_start` and not even that).
--
-- Kept separate from the four campaign tables because it describes intent, not
-- an outbound batch: it survives every campaign it creates, holds no
-- recipients, and a family with no schedule row simply never auto-composes.
-- `kind` is UNIQUE — two competing plans for the same audience is exactly the
-- pile-up this table exists to prevent.
--
-- The cooldown window and the minimum audience are NOT columns: they are
-- deliberate per-family constants in shared/campaign_schedules.ts, because they
-- protect the sending domain's reputation rather than expressing a preference.
CREATE TABLE IF NOT EXISTS campaign_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL UNIQUE,                                   -- CampaignScheduleKind
  enabled INTEGER NOT NULL DEFAULT 1,                          -- the "repeat" switch
  interval_days INTEGER NOT NULL,                              -- repetition interval
  daily_cap INTEGER NOT NULL,                                  -- inherited by each campaign it builds
  auto_start INTEGER NOT NULL DEFAULT 0,                       -- 1 = launch it too, don't wait for a click
  last_prepared_at INTEGER,
  next_due_at INTEGER NOT NULL,                                -- when the next campaign gets built
  last_campaign_id INTEGER,                                    -- the campaign it last built (id in that family's table)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- The sweep asks one question every hour: what is due?
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_due
  ON campaign_schedules(enabled, next_due_at);

-- ── Weddly Points: the vendor tier currency ─────────────────────────────────
-- APPEND-ONLY ledger. The total, the tier and (from phase 2) quest progress are
-- all derived by replaying these rows; there is deliberately no mutable counter
-- anywhere, so a bug in the engine can be fixed and replayed rather than
-- leaving a drifted number nobody can audit. Points rules + amounts live in
-- shared/vendor_points.ts.
--
-- `dedupe_key` is what makes the engine safe to re-run: it is a stable
-- description of the thing that earned the points ("review:412",
-- "profile:75", "fast_reply:88"), so the retroactive backfill, a redelivered
-- outbox event and a manual replay all collapse onto the same row instead of
-- paying three times. Rows are never updated or deleted; an admin correction is
-- a NEW row with negative points.
CREATE TABLE IF NOT EXISTS vendor_points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                                    -- VendorPointsEvent
  points INTEGER NOT NULL,                                     -- may be negative (admin_adjustment)
  dedupe_key TEXT NOT NULL,                                    -- stable per earning occurrence
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_points_dedupe
  ON vendor_points_ledger(vendor_account_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_vendor_points_vendor
  ON vendor_points_ledger(vendor_account_id, created_at DESC);

-- Domain-event outbox: the "bus" for a single-service Bun app. Feature code
-- (reviews, bookings, listing edits) only ever INSERTs here; the points engine
-- worker is the sole consumer and the sole writer of the ledger. That is what
-- keeps points logic out of unrelated features — a route emits "this happened",
-- never "add 15 points".
--
-- Rows are kept after processing (processed_at set) as a replay log; the purge
-- sweep trims them by age. `attempts` + `last_error` make a poisonous event
-- visible instead of silently stalling the queue.
CREATE TABLE IF NOT EXISTS vendor_event_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                                    -- 'review.created' | 'booking.confirmed' | …
  payload_json TEXT,                                           -- small JSON: event-specific ids
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_vendor_outbox_pending
  ON vendor_event_outbox(processed_at, id) WHERE processed_at IS NULL;
