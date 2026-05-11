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
  /** Derived from ADMIN_EMAILS env match — orthogonal to `role`. Drives the
   *  /app/admin/* routes (community-supplier moderation today; more later). */
  is_admin: boolean;
  /** Couple this user belongs to. `null` only on signup before onboarding. */
  couple_id: number | null;
  verified_email: boolean;
  created_at: UnixMs;
}

export interface AuthSession {
  token: string; // {id}.{sig}
  user: User;
}

// ─── Admin dashboard (users + couples directory) ─────────────────────────────

export interface AdminUserView {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  is_admin: boolean;
  verified_email: boolean;
  couple_id: number | null;
  created_at: UnixMs;
}

export interface AdminCoupleView {
  id: number;
  display_name: string | null;
  bride_name: string | null;
  groom_name: string | null;
  status: CoupleStatus;
  partners: { id: number; full_name: string; email: string }[];
  created_at: UnixMs;
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
  /** Public, uppercase couple identifier — `ANDORSARI`. Pairs with
   *  `households.code` to form the airport-style RSVP credential. May be
   *  null briefly between onboarding and the slug backfill. */
  slug: string | null;
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

/** Guest "kind" — orthogonal to `meal_choice`. Drives high-chair / kid-meal
 *  affordances on the seating + catering side and lets the public check-in
 *  form show the right icon/copy for babies vs. children vs. adults. */
export type GuestKind = "adult" | "child" | "baby";

export interface Guest {
  id: number;
  couple_id: number;
  /** Every guest belongs to a household; solo guests get a household-of-one.
   *  May be null briefly during a backfill — the public RSVP flow ignores
   *  unparented rows. */
  household_id: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: GuestGroupTag;
  /** Legacy per-guest 6-char code. Still resolvable for old `/rsvp/<code>`
   *  links — the new check-in flow uses `couples.slug + households.code`. */
  invite_code: string;
  /** Adult / child / baby. Defaults to "adult". */
  kind: GuestKind;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  /** @deprecated since the household refactor — kept for back-compat. New
   *  flows materialize the plus-one as a sibling guest in the same household. */
  plus_one_name: string | null;
  /** @deprecated — see `plus_one_name`. */
  plus_one_meal: MealChoice | null;
  accommodation_needed: boolean;
  song_request: string | null;
  notes: string | null;
  rsvp_responded_at: UnixMs | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** A party that RSVPs together. Couple-scoped 4-digit `code`. */
export interface Household {
  id: number;
  couple_id: number;
  code: string;
  label: string;
  notes: string | null;
  member_ids: number[];
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** Per-member subset shown on the public check-in page (no notes / no group_tag). */
export interface HouseholdMember {
  id: number;
  full_name: string;
  kind: GuestKind;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  accommodation_needed: boolean;
  song_request: string | null;
}

/** Public-facing — what the /rsvp check-in page sees. No couple PII / admin notes. */
export interface PublicCheckinView {
  couple_slug: string;
  couple_display_name: string;
  wedding_date: string | null;
  household_code: string;
  household_label: string;
  members: HouseholdMember[];
}

/** Submit shape for the household check-in. The credential pair (slug+code)
 *  is re-validated server-side; existing member ids must all belong to the
 *  household, and `added_members` (a +1, a baby, etc.) get materialized as
 *  fresh guest rows parented into the same household. */
export interface CheckinSubmitBody {
  couple_slug: string;
  household_code: string;
  members: CheckinMemberSubmit[];
  /** Optional new members the guest is bringing — partner, child, baby.
   *  Server creates them in the household with the supplied kind + RSVP. */
  added_members?: CheckinAddedMember[];
}

export interface CheckinMemberSubmit {
  guest_id: number;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  accommodation_needed: boolean;
  song_request: string | null;
}

export interface CheckinAddedMember {
  full_name: string;
  kind: GuestKind;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
}

/** @deprecated — single-guest view kept for legacy `/rsvp/<6char>` URLs.
 *  New code uses `PublicCheckinView`. */
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

export type TableShape = "round" | "long" | "square" | "head";

export interface SeatingTable {
  id: number;
  couple_id: number;
  label: string;
  shape: TableShape;
  seats: number;
  /** Position on the canvas, in millimetres (ties into the PDF print pipeline). */
  x_mm: number;
  y_mm: number;
  /** Diameter for round, side for square, shorter side for long. Millimetres. */
  width_mm: number;
  /** Equal to width_mm for round/square; longer side for long. Millimetres. */
  length_mm: number;
  /** Rotation around the table centre, in degrees clockwise. 0 = axis-aligned;
   *  editor cycles in 45° steps. The canvas + PDF apply this rotation to the
   *  whole table (body, chairs, label) about (x_mm, y_mm). */
  rotation_deg: number;
  /** Seat indices (0-based) the couple has X'd out — e.g. the empty
   *  end-cap of a long table when they don't want anyone seated there for
   *  design reasons. The canvas renders them muted; the seat-assignment
   *  grid skips them. seats stays the same — only the *usable* count
   *  drops. Filtered to valid indices server-side. */
  disabled_seats: number[];
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

// ─── Saved download archive ─────────────────────────────────────────────────

export type ExportKind = "json" | "seating_pdf" | "place_cards_pdf" | "guest_csv";

/** Listed on the Profile page. The `body` is fetched separately via the
 *  download endpoint to keep the list response small. */
export interface DataExportSummary {
  id: number;
  kind: ExportKind;
  /** "a4" | "a3" for `seating_pdf`, null for the rest. */
  format: string | null;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: UnixMs;
}

/** Cap per couple — older rows auto-purged on every new insert. */
export const DATA_EXPORT_CAP_PER_COUPLE = 10;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Couple invite TTL. */
export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Pause-to-delete window. */
export const PAUSE_DELETE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

/** Length of guest invite codes (e.g. "A4F2K9"). */
export const INVITE_CODE_LENGTH = 6;

/** Length of household check-in codes (always 4 digits, no leading zero). */
export const HOUSEHOLD_CODE_LENGTH = 4;

/** Slug constraints. Couple-level identifier, uppercase A-Z + digits. */
export const COUPLE_SLUG_MIN_LENGTH = 3;
export const COUPLE_SLUG_MAX_LENGTH = 24;

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
