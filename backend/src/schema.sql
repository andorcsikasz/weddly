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
  display_name TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS seating_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  shape TEXT NOT NULL DEFAULT 'round',                         -- 'round' | 'long' | 'square'
  seats INTEGER NOT NULL DEFAULT 8,
  x_mm INTEGER NOT NULL DEFAULT 0,
  y_mm INTEGER NOT NULL DEFAULT 0,
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
