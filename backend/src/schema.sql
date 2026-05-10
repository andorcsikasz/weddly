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
