// One contract, two sides. Backend mappers convert *Row → DTO; frontend
// consumes via typed wrappers. Money is integer Forint (HUF has no sub-unit).

export type UnixMs = number;
/** Integer Forint. Treat as a whole-number currency unit. */
export type Huf = number;

// ─── Auth ────────────────────────────────────────────────────────────────────

export type UserStatus = "active" | "suspended";
export type UserRole = "owner" | "partner" | "guest_admin" | "admin";

export interface User {
  id: number;
  email: string;
  full_name: string;
  status: UserStatus;
  role: UserRole;
  /** Couple this user belongs to. `null` only on signup before onboarding. */
  couple_id: number | null;
  verified_email: boolean;
  created_at: UnixMs;
}

export interface AuthSession {
  token: string; // {id}.{sig}
  user: User;
}

// ─── Couples (the workspace) ─────────────────────────────────────────────────

export type CoupleStatus = "active" | "paused" | "deleting";

export type WeddingStyleTag =
  | "classic"
  | "modern"
  | "rustic"
  | "garden"
  | "bohemian"
  | "minimalist"
  | "vintage"
  | "destination";

/**
 * Wedding planning starts months or years out, when most things aren't locked
 * yet. Each "goal" field is paired with a `kind` that says how certain the
 * couple is — the UI renders accordingly.
 */
export type WeddingDateKind = "exact" | "month" | "season" | "year" | "tbd";
export type WeddingSeason = "spring" | "summer" | "fall" | "winter";
export type GuestCountKind = "exact" | "range" | "tbd";
export type BudgetKind = "exact" | "range" | "tbd";

export interface WeddingDateGoal {
  kind: WeddingDateKind;
  /** Filled for kind='exact'. ISO YYYY-MM-DD. */
  exact_date: string | null;
  /** Filled for kind in {'exact','month','season','year'}. */
  target_year: number | null;
  /** 1..12. Filled for kind='month'. */
  target_month: number | null;
  /** Filled for kind='season'. */
  target_season: WeddingSeason | null;
}

export interface GuestCountGoal {
  kind: GuestCountKind;
  /** Filled for kind='exact'. */
  exact: number | null;
  /** Filled for kind='range'. */
  min: number | null;
  /** Filled for kind='range'. */
  max: number | null;
}

export interface BudgetGoal {
  kind: BudgetKind;
  /** Filled for kind='exact'. */
  exact_huf: Huf | null;
  /** Filled for kind='range'. */
  min_huf: Huf | null;
  /** Filled for kind='range'. */
  max_huf: Huf | null;
}

export interface Couple {
  id: number;
  partner_a_id: number;
  partner_b_id: number | null;
  display_name: string; // derived "{bride_name} & {groom_name}"
  bride_name: string;
  groom_name: string;
  /** Structured wedding-date goal — handles "Summer 2027" / "TBD" / exact dates. */
  wedding_date_goal: WeddingDateGoal;
  /** Back-compat shortcut. Equal to wedding_date_goal.exact_date. */
  wedding_date: string | null;
  /** Structured guest-count goal — handles ranges and "don't know yet". */
  guest_count_goal: GuestCountGoal;
  /** Back-compat shortcut. Equal to guest_count_goal.exact. */
  target_guest_count: number | null;
  /** Structured budget goal — handles ranges and "don't know yet". */
  budget_goal: BudgetGoal;
  /** Back-compat shortcut. Equal to budget_goal.exact_huf. */
  budget_ceiling_huf: Huf | null;
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  style_tags: WeddingStyleTag[];
  status: CoupleStatus;
  created_at: UnixMs;
  onboarded_at: UnixMs | null;
}

export interface CoupleInvite {
  id: number;
  couple_id: number;
  /** Token shipped in the invite link. Single-use, 7-day TTL. */
  token: string;
  invited_email: string | null;
  invited_by_user_id: number;
  consumed_at: UnixMs | null;
  expires_at: UnixMs;
  created_at: UnixMs;
}

// ─── Budget ─────────────────────────────────────────────────────────────────

export type BudgetCategory =
  | "venue"
  | "catering"
  | "drinks"
  | "attire"
  | "decor_floral"
  | "photo_video"
  | "music_dj"
  | "cake_dessert"
  | "hair_makeup"
  | "transport"
  | "honeymoon"
  | "stationery"
  | "favours"
  | "rings"
  | "other";

export interface BudgetLine {
  id: number;
  couple_id: number;
  category: BudgetCategory;
  label: string;
  planned_huf: Huf;
  actual_huf: Huf;
  /** Future: links to a `suppliers` row when v2 lands. */
  supplier_id: number | null;
  notes: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface BudgetSnapshot {
  id: number;
  couple_id: number;
  name: string;
  /** JSON-encoded array of `BudgetLine` shape (without ids). */
  payload_json: string;
  created_at: UnixMs;
}

// ─── Guests & RSVP ───────────────────────────────────────────────────────────

export type RsvpStatus = "pending" | "yes" | "no" | "maybe";

export type GuestGroupTag =
  | "his_family"
  | "her_family"
  | "his_friends"
  | "her_friends"
  | "shared_friends"
  | "work"
  | "other";

export type MealChoice = "meat" | "fish" | "vegetarian" | "vegan" | "child" | "none";

export interface Guest {
  id: number;
  couple_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: GuestGroupTag;
  invite_code: string; // short, public, used in /rsvp/<code>
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  plus_one_name: string | null;
  plus_one_meal: MealChoice | null;
  accommodation_needed: boolean;
  song_request: string | null;
  notes: string | null;
  rsvp_responded_at: UnixMs | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** Public-facing — what the RSVP page sees. No couple PII or admin notes. */
export interface PublicRsvpView {
  full_name: string;
  couple_display_name: string;
  wedding_date: string | null;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  plus_one_name: string | null;
  plus_one_meal: MealChoice | null;
  accommodation_needed: boolean;
  song_request: string | null;
}

// ─── Seating ────────────────────────────────────────────────────────────────

export type TableShape = "round" | "long" | "square";

export interface SeatingTable {
  id: number;
  couple_id: number;
  label: string;
  shape: TableShape;
  seats: number;
  /** Position on the canvas, in millimetres (ties into the PDF print pipeline). */
  x_mm: number;
  y_mm: number;
  created_at: UnixMs;
}

export interface SeatAssignment {
  id: number;
  table_id: number;
  seat_index: number; // 0-based
  guest_id: number;
}

export type ConflictKind = "split" | "avoid";

export interface SeatingConflict {
  id: number;
  couple_id: number;
  guest_a_id: number;
  guest_b_id: number;
  kind: ConflictKind;
  note: string | null;
  created_at: UnixMs;
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  actor_user_id: number | null;
  couple_id: number | null;
  action: string;
  target_kind: string;
  target_id: number | null;
  before_json: string | null;
  after_json: string | null;
  note: string | null;
  created_at: UnixMs;
}

// ─── Couple pause / breakup flow ─────────────────────────────────────────────

export type PauseRequestStatus = "pending" | "cancelled" | "completed";

export interface CouplePauseRequest {
  id: number;
  couple_id: number;
  requested_by_user_id: number;
  scheduled_delete_at: UnixMs;
  status: PauseRequestStatus;
  reason: string | null;
  created_at: UnixMs;
  completed_at: UnixMs | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Couple invite TTL. */
export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Pause-to-delete window. */
export const PAUSE_DELETE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

/** Length of guest invite codes (e.g. "A4F2K9"). */
export const INVITE_CODE_LENGTH = 6;

/** v2 marketplace fee (deferred). Lives here so v1 budget UI can hint at "what suppliers cost". */
export const PLATFORM_FEE_RATE = 0.1;

/** Default suggested budget split as percentages of `budget_ceiling_huf`. Used by the
 *  onboarding wizard to seed the first batch of `budget_lines`. Edit these to
 *  reshape what a fresh couple sees on day 1. */
export const DEFAULT_BUDGET_SPLIT: Record<BudgetCategory, number> = {
  venue: 0.25,
  catering: 0.2,
  drinks: 0.06,
  attire: 0.08,
  decor_floral: 0.06,
  photo_video: 0.1,
  music_dj: 0.05,
  cake_dessert: 0.03,
  hair_makeup: 0.03,
  transport: 0.03,
  honeymoon: 0.06,
  stationery: 0.02,
  favours: 0.01,
  rings: 0.02,
  other: 0.0,
};
