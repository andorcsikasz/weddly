// One contract, two sides. Backend mappers convert *Row → DTO; frontend
// consumes via typed wrappers. Money is integer Forint (HUF has no sub-unit).

import type { CoupleBilling } from "./billing";
import type { CoupleDesign } from "./design";
import type { ListingPackage } from "./listing_packages";
import type { TimelineEmailEscalation } from "./notifications";

export type UnixMs = number;
/** Integer Forint. Treat as a whole-number currency unit. */
export type Huf = number;

// ─── Auth ────────────────────────────────────────────────────────────────────

export type UserStatus = "active" | "suspended";
export type UserRole = "owner" | "partner" | "guest_admin" | "admin" | "vendor";

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
  /** Per-user UI locale captured at signup. Null until the user signs up
   *  through a client that sends `locale` in the register body — the
   *  frontend then prefers `user.locale` over its own navigator detection. */
  locale: "hu" | "en" | null;
  /** True when the user has a real local password (i.e. can sign in via the
   *  email/password form). False for Google-only signups whose stored hash is
   *  a synthetic placeholder. Drives the SessionExpiredDialog's choice of
   *  re-auth method. */
  password_set: boolean;
  /** True when the user has a linked Google account (`users.google_sub` set).
   *  Drives the SessionExpiredDialog's choice of re-auth method. */
  has_google: boolean;
  /** True when the user has a linked Apple account (`users.apple_sub` set).
   *  Drives the SessionExpiredDialog's choice of re-auth method. */
  has_apple: boolean;
  /** 'couple' (default) or 'planner'. Drives post-login routing — planners
   *  land on /app/planner, couples on /app. */
  user_type: "couple" | "planner";
  /** When the "share Weddly" prompt was auto-shown to this user, stamped once
   *  and never cleared. Null means it has never fired. Server-side so the
   *  one-shot survives a new device / cleared storage; the frontend keeps a
   *  localStorage mirror for when the write can't land. Only gates the
   *  AUTOMATIC popup — the profile-menu entry is always available. */
  share_prompt_seen_at: UnixMs | null;
  created_at: UnixMs;
}

export interface AuthSession {
  token: string; // {id}.{sig}
  user: User;
}

export interface PlannerClientView {
  couple_id: number;
  status: string;
  display_name: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  couple_status: string;
  confirmed_guests: number;
  linked_at: UnixMs;
  notes: string | null;
  primary_email: string | null;
  task_summary: { total: number; done: number; overdue: number };
}

export interface PlannerClientCrm {
  couple_id: number;
  display_name: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  primary_email: string | null;
  confirmed_guests: number;
  task_summary: { total: number; done: number; overdue: number };
  notes: string | null;
  client_phone: string | null;
  client_alt_email: string | null;
  lead_source: string | null;
  contract_value: number | null;
  deposit_paid: number | null;
  stage: string;
  /** Guest-page (vendégoldal) add-on state for this client. `guest_page_prepaid`
   *  = the couple paid their 30% share, so the planner may switch editing on;
   *  `guest_page_addon` = it is switched on. Read-only here, toggled via
   *  plannerApi.setGuestPageAccess. */
  guest_page_prepaid: boolean;
  guest_page_addon: boolean;
}

/** One timestamped entry in the planner's private comment-feed on a client
 *  (CRM page). Separate from PlannerClientCrm.notes, the roster quick-note. */
export interface PlannerClientNote {
  id: number;
  body: string;
  created_at: UnixMs;
}

/** Kanban lane of a task on the planner board. Kept in lockstep with `done`
 *  by the backend (done ⇔ 'done'); rows created before the board derive
 *  'todo' / 'done' from `done`. */
export type PlannerBoardStatus = "todo" | "doing" | "done";

export interface PlannerTaskRow {
  task_id: number;
  couple_id: number;
  display_name: string;
  title: string;
  due_date: string;
  priority: number;
  done: boolean;
  board_status: PlannerBoardStatus;
}

export interface PlannerThreadPreview {
  couple_id: number;
  display_name: string;
  last_subject: string;
  last_at: UnixMs;
  message_count: number;
}

export interface PlannerMessage {
  id: number;
  direction: "out" | "in";
  subject: string;
  body_text: string;
  recipient_email: string;
  status: string;
  created_at: UnixMs;
}

export interface PlannerWaitlistPrefill {
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  website: string | null;
  weddings_per_year: number | null;
  km_radius: number | null;
  styles: string[];
  reference_links: string | null;
  bio: string | null; // from the waitlist free-text message
  selected_plan: "basic" | "pro" | "unlimited" | null;
  mapped_plan: PlannerPlan; // selected_plan resolved to the planner-account enum
}

export interface PlannerPortfolioItem {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  sort_order: number;
  created_at: number;
}

export interface PlannerProfile {
  full_name: string;
  email: string;
  business_name: string | null;
  planner_bio: string | null;
  planner_city: string | null;
  planner_website: string | null;
  planner_phone: string | null;
  /** ISO 3166-1 alpha-2 (shared/country_list.ts). Gates the company lookup. */
  planner_country: string | null;
  /** Official business identity, auto-filled by the company lookup or typed
   *  manually. Always editable; sources in backend/src/lib/company_lookup. */
  planner_registry_number: string | null;
  planner_vat_number: string | null;
  planner_legal_form: string | null;
  planner_address: string | null;
  planner_weddings_per_year: number | null;
  planner_km_radius: number | null;
  planner_styles: string[] | null;
  planner_plan: PlannerPlan;
  planner_avatar_url: string | null;
  /** Free-text availability shown to couples in the directory (e.g. "2027 Q3"). */
  planner_availability: string | null;
  portfolio: PlannerPortfolioItem[];
  /** Published price offers (árajánlat), max MAX_LISTING_PACKAGES. */
  packages: ListingPackage[];
  waitlist_prefill: PlannerWaitlistPrefill | null;
}

/** The planner's own blocked-dates view (settings editor). Mirrors the vendor
 *  VendorAvailabilityView but whole-day only. Every mutation returns the full
 *  refreshed view so the UI re-renders from the server's truth. */
export interface PlannerAvailabilityView {
  /** Sorted ascending 'YYYY-MM-DD' days the planner has blocked (fully booked). */
  blocked_dates: string[];
  /** Earliest free date from today, or null when the 1-year window is full. */
  next_available: string | null;
}

export interface LinkedPlannerView {
  planner_user_id: number;
  full_name: string;
  email: string;
  business_name: string | null;
  planner_city: string | null;
  planner_bio: string | null;
  status: "active" | "pending";
  /** Who created the link. 'planner' + status 'pending' = the planner requested
   *  access and the couple must accept; 'couple' + 'pending' = the couple
   *  invited the planner and is waiting on them. */
  initiated_by: "couple" | "planner";
  linked_at: number;
}

export interface PlannerInviteView {
  couple_id: number;
  display_name: string;
  wedding_date: string | null;
  status: "pending";
  created_at: number;
}

/** One row of the couple-facing planner directory (the "wedding planners"
 *  rail on /app/vendors). Only live, verified planner accounts with a
 *  minimally complete profile (business name + city) are listed. The email
 *  is deliberately absent so the directory can't be scraped for addresses;
 *  connecting goes by user id instead. */
export interface PlannerDirectoryEntry {
  planner_user_id: number;
  business_name: string;
  full_name: string;
  city: string;
  country: string | null;
  bio: string | null;
  website: string | null;
  styles: string[] | null;
  km_radius: number | null;
  weddings_per_year: number | null;
  avatar_url: string | null;
  /** Admin-granted trust badge. True → the card + detail render a "verified"
   *  badge. Editorial signal, never derived automatically. */
  verified: boolean;
  /** Link state relative to the requesting couple: 'invited' = this couple
   *  already invited them (pending on the planner side); 'requested' = the
   *  planner asked this couple for access (pending on the couple side);
   *  'active' = linked. */
  link_status: "none" | "invited" | "requested" | "active";
}

/** The single-planner detail behind a directory card (opened from the name).
 *  Everything in the list entry plus the richer profile a couple sees before
 *  deciding to send a "Felkérés": free-text availability, external reference
 *  links (from the planner's application), and the public portfolio gallery. */
export interface PlannerDirectoryDetail extends PlannerDirectoryEntry {
  /** Planner-set free-text availability, e.g. "2027 Q3-ra van szabad dátumom". */
  availability: string | null;
  /** External reference links captured on the planner's application (read-only). */
  reference_links: string[] | null;
  /** Public portfolio gallery the planner uploaded. */
  portfolio: PlannerPortfolioItem[];
  /** Contact details surfaced on the detail page (the page is auth-gated to the
   *  requesting couple, so — unlike the scrapeable list — the address is safe to
   *  show). Any may be null when the planner hasn't filled them in. */
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Published price offers (árajánlat) — same shape as vendor packages. */
  packages: ListingPackage[];
  /** Whole-day blocked dates ('YYYY-MM-DD'), shown as booked on the busy
   *  calendar. Empty when the planner keeps no calendar. */
  unavailable_dates: string[];
  /** Earliest free date the planner has, or null. */
  next_available: string | null;
  /** The requesting couple's wedding date, so the busy calendar can open on the
   *  relevant month. Null when the couple hasn't set one. */
  wedding_date: string | null;
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
  /** Derived account class for the admin list, so a vendor/planner (which
   *  legitimately never gets a `couples` workspace) is visually distinct from
   *  a couple user who simply hasn't onboarded yet. 'vendor' when role='vendor',
   *  else 'planner' when user_type='planner', else 'couple'. A couple with a
   *  null couple_id is a genuine registered-but-not-onboarded signup. */
  account_type: "couple" | "vendor" | "planner";
  /** True for a demo account (landing-page "try the demo" seed). Demo
   *  vendors/planners carry no `couples` row, so demo-ness is derived from
   *  the `@demo.weddly.local` email suffix — the same canonical marker the
   *  purge sweeps and analytics use. Drives the admin "Demo" bucketing:
   *  these are kept out of the real orphan list + the new-signups digest. */
  is_demo: boolean;
  created_at: UnixMs;
  /** Last successful bearer-token verify, throttled to once per 5 minutes
   *  in `verifySessionToken`. Null if the user hasn't loaded the app since
   *  the column was added. */
  last_seen_at: UnixMs | null;
  /** The user's open moderation flag, if any. Null when no flag exists or
   *  the latest flag has been resolved. Drives the flag badge + countdown
   *  on AdminUsersPage. */
  active_flag: UserFlag | null;
  /** Admin-marked beta tester (one of the team's own test accounts). Drives
   *  the sage "Beta" badge + the FlaskConical toggle, and buckets the
   *  account's workspace into the admin "Beta testers" group. Non-destructive
   *  label, separate from `active_flag` moderation. */
  is_beta_tester: boolean;
  /** Compact activity counters surfaced on the admin row so the moderator
   *  can see at a glance which users are actually contributing vs. dormant.
   *  Counters include resolved/hidden rows — the admin cares about total
   *  engagement, not just live-listing volume. `*_last_at` is the unix-ms
   *  of the most recent entry; null when the count is 0. */
  activity: AdminUserActivity;
}

/** One row from email_log as surfaced in the admin UI. Enough to diagnose
 *  delivery failures (bounced account_flagged, resend needed) without
 *  exposing full HTML body. */
export interface AdminEmailLogEntry {
  id: number;
  kind: string;
  category: string;
  to_email: string;
  subject: string;
  status: "sent" | "failed" | "skipped_opt_out" | "skipped_no_provider";
  error: string | null;
  created_at: number;
}

export interface AdminUserActivity {
  /** Community supplier tips this user has submitted. Includes hidden +
   *  deleted rows so the count stays a stable engagement signal even
   *  after admin moderation. */
  supplier_tip_count: number;
  supplier_tip_last_at: UnixMs | null;
  /** Free-form feedback the user has filed via the in-app dialog or the
   *  landing-page form (matched by user_id, not by from_email — anon
   *  feedback is not attributed). */
  feedback_count: number;
  feedback_last_at: UnixMs | null;
  /** Historical moderation flags closed before this point — surfaces a
   *  faded counter so the admin knows this user has been flagged before
   *  even if there's no live flag right now. */
  prior_flag_count: number;
}

/** Unread-style counts the admin sidebar shows as a small red index next
 *  to each section. Polled every ~30s by AppShell while an admin is
 *  signed in. Each value is the count of rows that need attention in
 *  that section — see `handleSidebarBadges` for the exact predicate. */
export interface AdminSidebarBadges {
  suppliers: number;
  users: number;
  vendor_waitlist: number;
  planner_waitlist: number;
  feedback: number;
}

/** Source type for collected admin email entries. */
export type AdminEmailSourceType =
  | "user"
  | "guest"
  | "vendor"
  | "vendor_waitlist"
  | "planner_waitlist";

/** One row in the admin email collection list. Emails come from every source
 *  (registered users, wedding guests, vendor waitlist, planner waitlist, active
 *  vendor accounts) and are read-only -- no delete is exposed. */
export interface AdminEmailEntry {
  email: string;
  source_type: AdminEmailSourceType;
  /** Display name or business name; null when not available. */
  name: string | null;
  /** Unix ms when the email was first added to this source table. */
  added_at: number;
  /** Extra context: couple slug for guests, category for waitlist entries. */
  meta: string | null;
}

/** Paginated response for the admin email list endpoint. */
export interface AdminEmailListResponse {
  entries: AdminEmailEntry[];
  total: number;
}

/** Admin-side projection of `user_flags`. Internal columns
 *  (resolved_by_user_id, resolution_note, …) stay on the server. */
export interface UserFlag {
  id: number;
  user_id: number;
  reason: string;
  /** Unix ms of the auto-purge deadline. Compare to Date.now() for the
   *  "Xd left" countdown. */
  scheduled_delete_at: UnixMs;
  created_at: UnixMs;
}

export interface AdminCoupleView {
  id: number;
  /** Human-readable workspace identifier (e.g. "MIALUCAS"). Falls back to
   *  null on legacy rows that pre-date the slug column; the admin UI shows
   *  `#${id}` in that case. */
  slug: string | null;
  display_name: string | null;
  bride_name: string | null;
  groom_name: string | null;
  status: CoupleStatus;
  partners: { id: number; full_name: string; email: string }[];
  /** The user who owns/created this workspace: the `owner`-role member (whoever
   *  onboarded it or spun it up as an additional event), falling back to
   *  `partner_a_id` for legacy rows. The admin overview groups every workspace
   *  by this id so one person appears exactly ONCE — their first workspace is
   *  the card, any additional events band underneath it with an "×N" pill.
   *  Null only when the owner can't be resolved (no members + no partner_a). */
  owner_user_id: number | null;
  created_at: UnixMs;
  /** MAX(last_seen_at) across the workspace's members. Null when nobody on
   *  the workspace has been seen since the column was added. */
  last_seen_at: UnixMs | null;
  /** Mirrors `couples.is_demo`. Demo workspaces are seeded by the landing
   *  page's "try Shrek & Fiona" flow and are grouped into their own admin
   *  section so the real-user list stays scannable. */
  is_demo: boolean;
  /** True when at least one member is an admin-marked beta tester. Pulls the
   *  whole workspace into the admin "Beta testers" group so the team's own
   *  test workspaces don't pollute the real-signup list. */
  is_beta_tester: boolean;
  /** Per-feature event counts on the demo workspace's audit_log, keyed by
   *  the feature prefix (`"guest"`, `"budget"`, …). Populated only when
   *  `is_demo` is true — real couples have a richer engagement surface
   *  and this map would be noisy there. Empty object = demo that exists
   *  but no actions have been taken yet (just the `demo.start` event). */
  demo_feature_counts: Record<string, number> | null;
  /** Total audit-log events for the demo workspace. Sum of the values in
   *  `demo_feature_counts`. Null for non-demo couples. */
  demo_total_events: number | null;
  /** Timestamp the admin last clicked "remind partner invite" on this
   *  workspace's solo member. Null = never reminded. Drives the disabled
   *  sage Mail+Check state on the workspace row so a refresh doesn't
   *  re-arm the button. */
  invite_partner_reminded_at: UnixMs | null;
  /** Subscription / billing snapshot — lets the admin see who's free
   *  (founding / trial) vs paying vs lapsed, and act on it. */
  billing: CoupleBilling;
  /** ISO date string (YYYY-MM-DD) of the wedding day, or null when not set. */
  wedding_date: string | null;
}

// ─── Couples (the workspace) ─────────────────────────────────────────────────

export type CoupleStatus = "active" | "paused" | "deleting" | "archived";

/** Optional ceremony kind — drives dashboard copy and future budget
 *  suggestions. NULL means the couple hasn't decided yet. */
export type CeremonyKind = "civil" | "religious" | "both";

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
// The currency model moved to shared/currency.ts when it grew past the three
// original codes. Re-exported here so the many `from "@shared/types"` imports
// keep working — new code can import from either path.
import type { Currency } from "./currency";
export type { Currency } from "./currency";
export { CURRENCIES } from "./currency";

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

/** The three fixed photo-share sources on the Photos page. */
export type MediaSource = "guests" | "photographer" | "other";

/** Max links the "Pro Gallery" (photographer) slot accepts. */
export const MAX_PHOTOGRAPHER_LINKS = 3;

/** Photo-share URLs on the Photos page. `guests` / `other` are single links;
 *  `photographer` (the "Pro Gallery") holds up to {@link MAX_PHOTOGRAPHER_LINKS}
 *  external gallery links (Pixieset, Drive, Dropbox, own site…). Stored
 *  couple-side as a single JSON blob (`media_links_json`); legacy rows that
 *  saved `photographer` as one string are normalised to a 1-element array on
 *  read. */
export interface MediaLinks {
  guests: string | null;
  photographer: string[];
  other: string | null;
}

/** Guest photo collection album owned by a couple. */
export type FilmAesthetic = "natural" | "vintage" | "bw" | "cinematic" | "warm";

export const FILM_AESTHETICS: FilmAesthetic[] = ["natural", "vintage", "bw", "cinematic", "warm"];

/** CSS filter values applied client-side for each aesthetic. */
export const FILM_FILTERS: Record<FilmAesthetic, string> = {
  natural: "none",
  vintage: "sepia(0.4) contrast(1.1) brightness(0.9) saturate(0.8)",
  bw: "grayscale(1) contrast(1.2)",
  cinematic: "contrast(1.15) saturate(1.2) brightness(0.92) hue-rotate(-5deg)",
  warm: "sepia(0.15) saturate(1.3) brightness(1.05)",
};

export type FilmStripeTier = "free" | "ten" | "twentyfive" | "fifty" | "hundred" | "twohundred";

export const FILM_TIER_CAPS: Record<FilmStripeTier, number> = {
  free: 15,
  ten: 10,
  twentyfive: 25,
  fifty: 50,
  hundred: 100,
  twohundred: 200,
};

/** Price in EUR cents for each paid tier (free = 0). */
export const FILM_TIER_PRICE_EUR_CENTS: Record<FilmStripeTier, number> = {
  free: 0,
  ten: 990,
  twentyfive: 1990,
  fifty: 3990,
  hundred: 6990,
  twohundred: 9990,
};

export interface PhotoAlbum {
  id: number;
  uploadToken: string;
  /** Custom guest-link slug (#17); null = link uses the upload token only. */
  slug: string | null;
  title: string | null;
  shotsPerGuest: number | null;
  revealAt: number | null;
  eventEndsAt: number | null;
  isUploadEnabled: boolean;
  allowGuestViewing: boolean;
  filmAesthetic: FilmAesthetic;
  coverImageUrl: string | null;
  guestCap: number;
  stripeTier: FilmStripeTier | null;
  paidAt: number | null;
  photoCount: number;
  participantCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Subset of album info shown on the public guest-camera page. */
export interface PhotoAlbumPublic {
  displayName: string;
  weddingDate: string | null;
  /** Custom guest-link slug (#17); null = link uses the upload token only. */
  slug: string | null;
  title: string | null;
  shotsPerGuest: number | null;
  isUploadEnabled: boolean;
  eventEndsAt: number | null;
  revealAt: number | null;
  filmAesthetic: FilmAesthetic;
  coverImageUrl: string | null;
}

export interface FilmDevice {
  deviceId: string;
  guestName: string | null;
  joinedAt: number;
  shotCount: number;
  /** Soft-remove timestamp (#6); null = active participant. */
  removedAt: number | null;
}

/** A single guest/couple photo as returned to the gallery. */
export interface FilmUpload {
  id: number;
  guestName: string | null;
  fileUrl: string;
  mimeType: string;
  fileSize?: number;
  filterApplied: string | null;
  uploadedAt: number;
  /** Whether the couple or a guest contributed this shot (#11). */
  source: "guest" | "couple";
}

export interface FilmAccessCheck {
  free: boolean;
  /** 'loyal_couple' = 5+ months old account with both partners joined. */
  reason: "loyal_couple" | "paid" | null;
  /** Price in EUR cents if not free. */
  priceEurCents: number;
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
  /** Public organiser reference code — "O" + 5 digits (e.g. `O48217`). Stable
   *  per couple, globally unique, shown in support / admin contexts. Null on
   *  legacy rows that pre-date the column until the one-time boot backfill. */
  organiser_code: string | null;
  /** Structured wedding-date goal — handles "Summer 2027" / "TBD" / exact dates. */
  wedding_date_goal: WeddingDateGoal;
  /** Back-compat shortcut. Equal to wedding_date_goal.exact_date. */
  wedding_date: string | null;
  /** Prior `wedding_date` value remembered when the couple edited the date.
   *  Used by the "wedding-date-changed" guest notification so the email can
   *  show "moved from X → Y". `null` when the date has never changed. */
  previous_wedding_date: string | null;
  /** Civil / religious / both — NULL when undecided. */
  ceremony_kind: CeremonyKind | null;
  /** Stamped the first time the couple flips the workspace to `archived`. */
  archived_at: UnixMs | null;
  /** Structured guest-count goal — handles ranges and "don't know yet". */
  guest_count_goal: GuestCountGoal;
  /** Back-compat shortcut. Equal to guest_count_goal.exact. */
  target_guest_count: number | null;
  /** Structured budget goal — handles ranges and "don't know yet". */
  budget_goal: BudgetGoal;
  /** Back-compat shortcut. Equal to budget_goal.exact_huf. */
  budget_ceiling_huf: Huf | null;
  /** Display currency for every money field on this couple. Storage stays
   *  as integer units of the picked currency — `budget_ceiling_huf` /
   *  `budget_lines.planned_huf` etc. keep their historic column names but
   *  semantically hold whatever currency is set here. */
  currency: Currency;
  /** Scenario count for the cost-planning slider. Shared across both partners
   *  and all devices — distinct from `target_guest_count` (the onboarding goal)
   *  so a couple can model "what if we go to 130?" without rewriting the goal. */
  planning_count: number | null;
  /** Categories the couple has "frozen" on the cost-planning panel. A frozen
   *  category's planned amount is read-only everywhere (slider on /app and
   *  /app/budget, planned input in the budget table) and is exempt from the
   *  headcount slider's per-guest rescaling — the user has locked in a real
   *  quote and doesn't want it scaling with hypotheticals. */
  frozen_categories: BudgetCategory[];
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  /** ISO 3166-1 alpha-2 country the wedding is in — a collective, country-LEVEL
   *  scope, NOT the precise `location_lat`/`location_lng` venue. Drives
   *  country-scoped assists (e.g. the venue-name autocomplete) so a couple isn't
   *  offered cross-border places. Defaults to 'HU' for every historical couple
   *  (the product launched Hungary-only); always uppercase. */
  country: string;
  style_tags: WeddingStyleTag[];
  status: CoupleStatus;
  /** Free-text honeymoon destination — "Bali" / "Toscana, Italy". `null` until
   *  the couple fills it in on /app/honeymoon. */
  honeymoon_destination: string | null;
  /** ISO YYYY-MM-DD. Pair with `honeymoon_end_date` to compute the night count. */
  honeymoon_start_date: string | null;
  honeymoon_end_date: string | null;
  /** Departure airport IATA code (e.g. "BUD", "VIE") for the Amadeus flight
   *  estimate. `null` falls back to a locale-aware default at read-time
   *  (HU → BUD, EN → VIE) so most couples never need to set it. */
  honeymoon_origin_iata: string | null;
  /** Custom cover photo uploaded by the couple for the honeymoon destination
   *  widget. When set, takes priority over the auto-generated Wikipedia photo. */
  honeymoon_cover_path: string | null;
  /** Opt-in toggle for the "needs accommodation?" question on the RSVP flow.
   *  Default `false` — when off, neither the public household RSVP form nor
   *  the in-app GuestDrawer renders the question. Flipping it on from the
   *  Profile page surfaces a checkbox on both surfaces; existing per-guest
   *  `Guest.accommodation_needed` values stay in the DB either way. */
  rsvp_offers_accommodation: boolean;
  /** Opt-out toggle for the meal-choice icon row on the public RSVP form.
   *  Default `true` — most weddings serve a plated menu. Buffet/no-menu
   *  couples flip it off from the Profile page and the meal row vanishes on
   *  the public form. Per-member `meal_choice` values are preserved server
   *  side, so flipping it back on re-surfaces them. */
  rsvp_collects_meal: boolean;
  /** Per-couple customisation of the six meal slots: a custom label and an
   *  offered/hidden flag each, the slot keys staying the `MealChoice` enum.
   *  Always six items in `MEAL_ORDER`; defaults to all-enabled, no overrides.
   *  Lets couples show their real dishes ("Marhasült") on the RSVP form. */
  meal_menu: MealMenu;
  /** Per-couple trigger for the proactive-timeline EMAIL escalation. The in-app
   *  bell is always on; this only governs the email push. Defaults to 'overdue'
   *  (push only when a task is genuinely late). See `TimelineEmailEscalation`. */
  timeline_email_escalation: TimelineEmailEscalation;
  /** How often to send email digests. "never" = email opt-out. */
  notif_email_cadence: import("@shared/notifications").NotifEmailCadence;
  /** Comma-separated focus areas for email notifications. Empty = all. */
  notif_focus: string;
  /** True for ephemeral demo couples created via `POST /api/demo/start`.
   *  The /app UI uses this to render the persistent "Demo wedding" banner
   *  and fire the conversion popup after a few minutes. Demo couples are
   *  auto-purged by the demo route's housekeeping sweep. */
  is_demo: boolean;
  /** Wedding-day "Welcome Desk" mode — true when the couple has flipped the
   *  Settings → Workspace toggle to indicate a kiosk tablet is set up at the
   *  entrance. Persistent so the status pill survives reloads + cross-device
   *  views (no in-memory query-string state). */
  welcome_desk_active: boolean;
  /** Couple has opted in to the public wedding website at `/w/:slug`.
   *  Defaults to false — couples publish explicitly via the Profile
   *  toggle; the public endpoint 404s when this is false. */
  is_public: boolean;
  /** Couple published their gift list to the guest page. Default false;
   *  the wishlist editor flips this. When false the confirmed-tier guest
   *  page omits the gift/request decks entirely (server-side). */
  wishlist_published: boolean;
  /** Free-text venue name shown on the public wedding site. Null when
   *  the couple hasn't set one. */
  venue_name: string | null;
  /** Settlement (city/town) shown next to the venue name, e.g. "Dunakiliti".
   *  Auto-filled from the place picker; null when unset. */
  venue_city: string | null;
  /** Couple-entered venue + day-of contact details for the private "Kulcsinfó"
   *  dashboard panel (not the public site). All null until the couple fills
   *  them in; `venue_address` doubles as the Maps search query, the phones
   *  power one-tap tel: buttons. */
  venue_address: string | null;
  venue_phone: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  /** Couple-pasted http(s) URL for the wedding site's hero image. */
  cover_image_url: string | null;
  /** Cover-photo focal point as object-position percentages (0..100, 50 =
   *  centred). The couple drags the photo in the editor to pick which part of
   *  the image stays in frame when the hero crops it to a wide band. Optional
   *  (defaults to 50/50 at the render site) so legacy/fixture literals omit it. */
  cover_position_x?: number;
  cover_position_y?: number;
  /** Optional fixed-slot photos on the public wedding site — slot 1 renders
   *  after the welcome band, slot 2 before the RSVP ask. Uploaded via
   *  POST /api/couples/current/site-photo/:slot. Optional (server always
   *  populates; absent in legacy test fixtures) — absent and null both mean
   *  "slot empty". */
  site_image_1_url?: string | null;
  site_image_2_url?: string | null;
  /** Pre-RSVP welcome block on the merged Vendégoldal (`/w/:slug`).
   *  Visible at every tier of the public endpoint. Null when unset. */
  guest_page_intro: string | null;
  /** "Good to know" block — parking, getting there, accommodation, … (markdown).
   *  Same public visibility as guest_page_intro. Null when unset. */
  useful_info: string | null;
  /** Post-RSVP unlocked block. Server omits from the public-wedding
   *  endpoint unless the caller's tier is `confirmed`. Null when unset. */
  post_rsvp_content: string | null;
  /** Whether the "what to put in the envelope" per-head cost tip is included in
   *  the pre-wedding info message. Couple-controllable on the invites page.
   *  Defaults to true. */
  envelope_tip_enabled: boolean;
  /** Manual per-head amount (integer minor units, couple currency) the couple
   *  pinned for the envelope tip. `null` = derive automatically from the budget
   *  total ÷ confirmed guest count. */
  envelope_tip_amount_override: number | null;
  /** Couple-pasted photo-share links for the Photos page — one Google Drive
   *  (or any http(s)) URL per source. Always present; each slot is null until
   *  the couple pastes a link. Shared across both partners. */
  media_links: MediaLinks;
  /** Curated wedding visual identity (style / palette / font slugs + print
   *  toggles). Always fully resolved — NULL/legacy `design_json` rows read
   *  back as the Botanical Green default. Drives the guest page + printable
   *  cards; the app-shell accent is unaffected. */
  design: CoupleDesign;
  created_at: UnixMs;
  onboarded_at: UnixMs | null;
  /** Server timestamp of the last write — clients use this as the `If-Match`
   *  value for optimistic concurrency on `PATCH /api/couples/current`. */
  updated_at: UnixMs;
  /** Unix-ms timestamp of the most recent bride/groom rename. Null when the
   *  couple has never been renamed via the gated endpoint (legacy /
   *  onboarding writes don't stamp it). Drives the 7-day rename cooldown on
   *  the workspace hero card. */
  names_last_changed_at: UnixMs | null;
  /** Cost-planning headcount slider lock. False = unlocked (default), true =
   *  the slider on /app/budget is pinned to the current `planning_count`
   *  and the slider rail collapses out of view. Per-row planned amounts
   *  still drag freely; only the global per-guest rescale factor is pinned. */
  planning_count_locked: boolean;
  /** Subscription / billing snapshot incl. computed edit entitlement.
   *  See shared/billing.ts. */
  billing: CoupleBilling;
}

/** One Nominatim hit reshaped into the honeymoon destination autocomplete.
 *  `primary` is the headline (city / village / landmark name); `secondary` is
 *  the full address/region used as the dropdown subtitle. */
export interface PlaceSuggestion {
  primary: string;
  secondary: string;
  /** Settlement the result sits in (city/town/village), when Nominatim
   *  provides one. The venue-name picker composes "{primary}, {locality}"
   *  so a POI like "Sári Csárda" keeps its town ("Dunakiliti") as context. */
  locality: string | null;
  lat: number | null;
  lng: number | null;
  country_code: string | null;
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

/** Lifecycle states for the OTHER partner, as seen from the calling user.
 *  Mapped on the Profile page to a colour-coded pill so each partner can
 *  see at a glance whether the other has joined / is online. */
export type CouplePartnerStatus =
  /** Active, unconsumed invite exists. No partner_b account yet. */
  | "invited"
  /** Partner account exists but has no unexpired session right now. */
  | "joined"
  /** Partner has an unexpired session — they're signed in somewhere. */
  | "active";

export interface CouplePartnerView {
  /** Null when status is "invited" — they don't have a name in our system yet. */
  full_name: string | null;
  /** For "invited" we fall back to the invited_email on the pending invite. */
  email: string | null;
  status: CouplePartnerStatus;
}

/** A single recent-activity entry for the couple's audit-log surface on the
 *  Profile page. Drives the dark "what happened" panel so each partner can
 *  see what the other has done. The server hides anything older than
 *  {@link COUPLE_ACTIVITY_RETENTION_DAYS} at query time — the raw
 *  `audit_log` rows themselves stay append-only for legal retention. */
export interface CoupleActivityEntry {
  id: number;
  /** `null` for system actions (e.g. scheduled purge). */
  actor_id: number | null;
  /** Resolved server-side; `null` when actor_id is null OR the user row was
   *  purged. Frontend renders `t("profile.activity_actor_unknown")`. */
  actor_full_name: string | null;
  /** Raw event key — e.g. "guest.create". The UI looks up a localised label
   *  via `t(\`profile.activity_action_${action.replace(".", "_")}\`)`. */
  action: string;
  target_kind: string;
  target_id: number | null;
  /** Optional human note attached at audit time. */
  note: string | null;
  /** Raw JSON payloads from the underlying `audit_log` row. The frontend
   *  parses and renders these to show before/after diffs in the activity
   *  feed — backend doesn't try to format them. `null` for actions that
   *  didn't capture a payload (e.g. legacy entries pre-Loop-C₁). */
  before_json: string | null;
  after_json: string | null;
  created_at: UnixMs;
}

/** Window the Profile page exposes for activity. Older rows stay in
 *  `audit_log` (append-only) but are filtered out of the user-facing view. */
export const COUPLE_ACTIVITY_RETENTION_DAYS = 14;

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
  /** How much of this line has been settled so far, integer Forint (0 = nothing
   *  paid). Hand-editable on plain lines; derived from paid supplier
   *  installments on DIY-supplier-mirrored lines. Always clamped to
   *  `[0, actual_huf]` server-side. */
  paid_huf: Huf;
  /** Future: links to a `suppliers` row when v2 lands. */
  supplier_id: number | null;
  /** When set, this line was auto-created from a DIY supplier entry on
   *  /app/suppliers and is locked — editing happens on the supplier card. */
  couple_supplier_id: string | null;
  /** Honeymoon preset chip that created this line (e.g. "stay", "travel").
   *  Null for custom rows. Cleared server-side whenever the label is renamed. */
  preset_key?: string | null;
  notes: string | null;
  /** Custom rows opt in. When `true`, the planned amount rescales with the
   *  headcount slider just like built-in per-guest categories. Built-in
   *  categories ignore this column — their per-guest behaviour is driven by
   *  `PER_GUEST_CATEGORIES`. */
  per_guest: boolean;
  /** Lucide icon slug for custom rows (e.g. "Sparkles"). Null on built-in
   *  category lines — those use `CATEGORY_ICONS[category]`. */
  icon: string | null;
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

/** An uploaded invoice / receipt attached to a budget row. `scope` anchors the
 *  document to what the user sees in the table: `cat:<category>` for an
 *  aggregated category row, or `line:<id>` for a custom line. Kept separate
 *  from `paid_huf` — the paid amount is the source of truth, documents are
 *  supplementary proof the user can attach via the bill icon in the PAID cell. */
export interface BudgetDocument {
  id: number;
  couple_id: number;
  /** `cat:<BudgetCategory>` or `line:<budget_line_id>`. */
  scope: string;
  /** Public URL, e.g. `/uploads/couples/12/budget-docs/3.pdf?v=...`. */
  file_path: string;
  /** Original filename, shown in the documents list. */
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: UnixMs;
}

/** One recorded payment against a budget row, with a timestamp. The cumulative
 *  total lives on `budget_lines.paid_huf`; these rows are the additive history
 *  behind it, anchored by the same `scope` as the PAID column. */
export interface BudgetPayment {
  id: number;
  couple_id: number;
  /** `cat:<BudgetCategory>` or `line:<budget_line_id>`. */
  scope: string;
  /** Integer minor units in the couple's currency. */
  amount_huf: number;
  /** When the payment was made — defaults to now, editable by the user. */
  paid_at: UnixMs;
  /** Optional free-text note. */
  note: string | null;
  /** Internal reference to an attached PDF invoice/receipt
   *  (`/uploads/couples/<id>/budget-payments/<pid>.pdf?v=…`), or null. Served
   *  ONLY via the gated /api/budget/payments/:id/download route — never public.
   *  The frontend fetches it as an authed blob; the raw string is not a usable
   *  public URL. */
  pdf_url: string | null;
  /** Original (sanitised) filename of the attached PDF, for display. */
  pdf_name: string | null;
  created_at: UnixMs;
}

/** Money that came in (cash gifts, contributions). A standalone ledger used
 *  for the post-wedding "recovered vs spent" report — not tied to a supplier
 *  or budget line. */
export interface CoupleIncome {
  id: number;
  couple_id: number;
  label: string;
  /** Integer minor units of the couple's currency. */
  amount_huf: Huf;
  /** ISO YYYY-MM-DD. Null = undated. */
  received_on: string | null;
  notes: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface CreateCoupleIncomeInput {
  label: string;
  amount_huf: number;
  received_on?: string | null;
  notes?: string | null;
}

export interface UpdateCoupleIncomeInput {
  label?: string;
  amount_huf?: number;
  received_on?: string | null;
  notes?: string | null;
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

/** Per-couple customisation of one fixed meal slot. The `choice` key stays the
 *  canonical `MealChoice` enum (so stats / place cards / allergen logic never
 *  change); the couple only overrides the visible `label` and whether the slot
 *  is `enabled` (offered) on the public RSVP form. `label: null` means "use the
 *  localised default". See `shared/meals.ts` for the resolve/validate helpers. */
export interface MealMenuItem {
  choice: MealChoice;
  label: string | null;
  enabled: boolean;
}

/** A couple's full meal menu: always the six slots in `MEAL_ORDER`. */
export type MealMenu = MealMenuItem[];

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
  /** Marks a supplier (DJ, photographer, ...) who's on the guest list so they
   *  can be counted on a reduced "supplier menu" and seated apart. Orthogonal
   *  to `kind` and `group_tag`. Defaults to false. */
  is_supplier: boolean;
  /** True when this guest was auto-created from another guest's "+1" field.
   *  Drives the "+1" badge in the guest list. */
  is_plus_one: boolean;
  /** Guest id of the host this +1 hangs off — the person who brought them and
   *  fills in their RSVP on their behalf. `null` on every primary guest. The
   *  guest list nests the +1 directly under this host with a connecting line. */
  plus_one_of: number | null;
  /** Set on the two host guest rows that mirror `couples.bride_name` /
   *  `couples.groom_name`. `null` on every other guest. Server-derived only —
   *  PATCH/POST `/api/guests` ignores this field. The seating page reads it to
   *  pin the couple's own slots at the top of the unassigned panel; the
   *  guest list shows a Crown next to matching rows. */
  partner_role: "bride" | "groom" | null;
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
  /** Set when the couple marks the guest "invited" (paper/email/etc. sent).
   *  Drives the per-guest checkbox + the x/n indicator on the household
   *  header. `null` = not yet invited. */
  invited_at: UnixMs | null;
  /** Set when the printed invitation has been physically handed over to the
   *  guest. Strictly stronger than `invited_at` — the 3-state chip cycles
   *  not-invited → invited → delivered. `null` = not delivered yet. */
  invitation_delivered_at: UnixMs | null;
  /** Set the first time the guest_invite email tracking pixel loads (email client
   *  fetched the pixel image). Best-effort: Apple MPP and image-blocking clients
   *  may never fire it. `null` = not yet opened or pixel blocked. */
  invitation_opened_at: UnixMs | null;
  /** Explicit "online invite sent" stamp — set when the couple emails the
   *  invitation (or marks the online channel on the invites page). Independent
   *  of `invited_physical_at`; the derived channel is none/online/physical/both.
   *  Sending also stamps the legacy `invited_at` so the guest-list chip stays in
   *  sync. `null` = no online invite. */
  invited_online_at: UnixMs | null;
  /** Explicit "physically handed over / in person" stamp. Kept in sync with the
   *  legacy `invitation_delivered_at`. `null` = not handed over in person. */
  invited_physical_at: UnixMs | null;
  /** Logistics: lodging this guest is assigned to. Null = not yet assigned.
   *  Edited via the /app/logistics drag-and-drop board. When the guest is
   *  dropped onto a specific room, this stays in sync with the room's parent
   *  accommodation so exports / queries that only read the accommodation keep
   *  working. */
  accommodation_id: number | null;
  /** Logistics: the specific room (within `accommodation_id`) this guest is in.
   *  Null = assigned to a room-less accommodation, or not assigned at all. */
  accommodation_room_id: number | null;
  /** Logistics: transfer trip this guest is on. Null = not yet assigned. */
  transfer_id: number | null;
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
  /** Single group classification (his family, work, etc.) shared by every
   *  member. The household header on /app/guests renders it as a clickable
   *  chip; changing it propagates to all members' `Guest.group_tag` so the
   *  household card and the dashboard "who's coming" pie stay consistent. */
  group_tag: GuestGroupTag;
  /** True when this household holds the bride and/or groom (any member with
   *  `partner_role` set). The /app/guests UI sorts this card to the top and
   *  hides the slug / code / share-link metadata — the hosts don't need to
   *  check themselves in. */
  is_couple_household: boolean;
  /** True for the couple's single "Suppliers" (Szolgáltatók) household — the
   *  group that holds booked vendors (DJ, photographer, …). Members added here
   *  are auto-flagged as suppliers and default to RSVP "yes" (they're booked,
   *  not invitees waiting to reply). The /app/guests UI uses this to drive that
   *  default in the add-member drawer. */
  is_supplier_household: boolean;
  /** Per-household opt-in for the "needs accommodation?" question on the
   *  public RSVP form. Default `false`. Replaces the older couple-level
   *  toggle so each party can carry its own decision (e.g. the venue-block
   *  guests get the question, the locals don't). The legacy
   *  `Couple.rsvp_offers_accommodation` column still exists but no longer
   *  drives the public form. */
  rsvp_offers_accommodation: boolean;
  /** Per-household opt-out for the meal-choice icon row on the public RSVP
   *  form. Default `true`. Per-member `meal_choice` values are preserved
   *  server side, so flipping off → on re-surfaces them. */
  rsvp_collects_meal: boolean;
  /** True when `guests.create` spawned this household implicitly (no
   *  `household_id` and no `new_household_label` on the request body).
   *  Lets the household tab optionally hide stub singletons via
   *  `GET /api/households?exclude_auto_singletons=1`. */
  auto_created: boolean;
  /** Set the first time a digital invite is sent to this household (mass-send
   *  on /app/guests). `null` = not yet invited. The mass-send only targets
   *  households where this is null, so nobody gets invited twice. */
  invited_at: UnixMs | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

// ─── Guest communication (invites page) ──────────────────────────────────────

/** Which of the three reusable templates a broadcast uses.
 *  - `invite`           — the invitation + RSVP link (the `guest_invite` email).
 *  - `major_update`     — free-form "something important changed" announcement.
 *  - `pre_wedding_info` — the final info summary (schedule / logistics) with the
 *    optional "what to put in the envelope" per-head cost tip. */
export type GuestMessageTemplate = "invite" | "major_update" | "pre_wedding_info";

/** Who a broadcast targets. `all` = every non-supplier guest with an email;
 *  `pending` = guests who haven't RSVP'd yet; `confirmed` = guests who replied yes. */
export type GuestMessageAudience = "all" | "pending" | "confirmed";

/** Lifecycle of a broadcast. `scheduled` rows are picked up by the hourly email
 *  worker once `scheduled_at` passes; immediate sends jump straight to `sent`. */
export type GuestMessageStatus = "scheduled" | "sending" | "sent" | "failed";

/** One guest-facing broadcast the couple composed on the invites page. */
export interface GuestMessage {
  id: number;
  couple_id: number;
  template: GuestMessageTemplate;
  /** Couple-authored subject. `null` falls back to the template default. */
  subject: string | null;
  /** Couple-authored body (markdown-ish, same `**bold**` support as emails).
   *  `null`/empty for the plain invite template. */
  body: string | null;
  /** Snapshot of whether the envelope tip was included (pre_wedding_info only). */
  include_envelope_tip: boolean;
  /** Snapshot of the per-head amount (couple currency, minor units) baked into
   *  the message at send time. `null` when the tip was off. */
  envelope_amount: number | null;
  audience: GuestMessageAudience;
  status: GuestMessageStatus;
  /** `null` = sent immediately; otherwise the future send time (Unix-ms). */
  scheduled_at: UnixMs | null;
  sent_at: UnixMs | null;
  /** How many guests the broadcast went (or will go) to. */
  recipient_count: number;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** The computed "what to put in the envelope" per-head figure shown in the
 *  composer. `effective` is what a send would use: `override ?? auto`. */
export interface EnvelopeTip {
  /** Auto value = budget total ÷ confirmed guest count (couple currency, minor
   *  units). `null` when there's no budget or no confirmed guests yet. */
  auto: number | null;
  /** Couple's pinned manual amount, or `null` to use `auto`. */
  override: number | null;
  /** `override ?? auto` — the amount a send would actually use (may be `null`). */
  effective: number | null;
  /** Whether the tip block is turned on for the pre-wedding info template. */
  enabled: boolean;
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
  /** True when this member is themselves a +1 brought by another member. The
   *  check-in form hides the "+1" chip on these rows so a +1 can't carry its
   *  own +1. */
  is_plus_one: boolean;
  /** Guest id of the member this +1 was assigned to (null on primary guests).
   *  The check-in form also hides the "+1?" question on a host that already
   *  carries an assigned +1, so the couple's explicit pairing isn't asked
   *  again. */
  plus_one_of: number | null;
}

/** Public-facing — what the /rsvp check-in page sees. No couple PII / admin notes. */
export interface PublicCheckinView {
  couple_slug: string;
  couple_display_name: string;
  wedding_date: string | null;
  household_code: string;
  household_label: string;
  members: HouseholdMember[];
  /** Mirrors `Household.rsvp_offers_accommodation` (per-household since the
   *  toggle moved off `couples`). When false, the form hides the "needs
   *  accommodation?" checkbox for this specific household. */
  rsvp_offers_accommodation: boolean;
  /** Mirrors `Household.rsvp_collects_meal`. When false, the meal-icon row
   *  (meat/fish/veg/vegan/child/none) is hidden on the public form for this
   *  household — useful for buffet weddings or households whose menu is
   *  fixed. Dietary chips below stay visible either way. */
  rsvp_collects_meal: boolean;
  /** The couple's six meal slots with their custom labels + offered flags
   *  (couple-level, same for every household). The form renders only the
   *  `enabled` ones and uses each `label` (falling back to its own localised
   *  default when null). */
  meal_menu: MealMenu;
  /** Mirrors `couples.is_public`. Lets the success card hide the
   *  "Open wedding page" CTA when the /w/:slug page would 404 — clicking
   *  through to a "not found" page after a successful RSVP read as broken
   *  more than helpful. */
  wedding_site_published: boolean;
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
  /** Set when this addition is a "+1" — flags the new row as a plus-one and
   *  nests it under `parent_member_id`. Babies/children leave this false. */
  is_plus_one?: boolean;
  /** Existing household member id this addition hangs off (the +1's host).
   *  Server validates it belongs to the same household before linking. */
  parent_member_id?: number | null;
}

/** Catering-side aggregate over the guest list. Surfaced on the day-of
 *  dashboard so the venue can answer "how many veggies? GF?" minutes before
 *  the ceremony. Only counts guests whose `rsvp_status` is `yes` or `maybe`
 *  — `no` / `pending` are excluded.
 *
 *  `allergies` is a heuristic scan of the free-text `dietary` field for
 *  gluten / lactose / nut keywords; any non-empty `dietary` that doesn't
 *  hit one of those buckets contributes to `other_text_count` so the
 *  caterer knows there's an unspecified note to read. */
export interface DietarySummary {
  meal: {
    meat: number;
    fish: number;
    vegetarian: number;
    vegan: number;
    child: number;
    none: number;
    /** rsvp=yes/maybe guests with `meal_choice` null. */
    unspecified: number;
  };
  allergies: {
    gluten: number;
    lactose: number;
    milk_protein: number;
    nut: number;
    egg: number;
    fish_shellfish: number;
    /** Guests with a non-empty `dietary` field that didn't match any keyword. */
    other_text_count: number;
  };
  /** Total guests folded into the aggregate (rsvp_status in {yes, maybe}). */
  counted_guests: number;
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
  /** Optional flag for a "kids' table". Surfaces a badge in the editor today;
   *  later iterations may drive auto-seating of children together. */
  is_kids_table: boolean;
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
  /** Seat indices (0-based) that need a baby high-chair. Drives a small
   *  baby icon on the chair in both the canvas preview and the seat-
   *  assignment grid. Server filters to disjoint with disabled_seats
   *  (disabled wins). */
  baby_seats: number[];
  created_at: UnixMs;
  /** Used by the frontend as the `If-Match` value for optimistic-concurrency
   *  guarding on PATCH. Server-set on every write. */
  updated_at: UnixMs;
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

// ─── Logistics: accommodation + transfer ────────────────────────────────────

/** One bookable lodging unit (a hotel room, apartment, "Mama háza"). Guests
 *  link via `Guest.accommodation_id`. `capacity` is advisory — the UI surfaces
 *  overflow as a warning but doesn't block assignment. `price_huf` is the
 *  total for the unit, not per-guest. */
export interface Accommodation {
  id: number;
  couple_id: number;
  name: string;
  address: string | null;
  capacity: number;
  price_huf: Huf | null;
  link: string | null;
  contact: string | null;
  notes: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface UpsertAccommodationInput {
  name: string;
  address?: string | null;
  capacity?: number;
  price_huf?: Huf | null;
  link?: string | null;
  contact?: string | null;
  notes?: string | null;
}

/** A single room within an `Accommodation` (e.g. "Hálószoba", "Tetőtér").
 *  Rooms are optional — an accommodation with no rooms behaves as one flat
 *  unit (drop guests straight onto it). Once it has rooms, guests are placed
 *  into a specific room and `capacity` is enforced per room. */
export interface AccommodationRoom {
  id: number;
  couple_id: number;
  accommodation_id: number;
  name: string;
  capacity: number;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface UpsertAccommodationRoomInput {
  /** Required only on create — names the room and pins its parent. */
  accommodation_id?: number;
  name: string;
  capacity?: number;
}

/** One transfer trip. v1 is "basic": label + free-form direction +
 *  optional local-time departure + advisory capacity. */
export interface Transfer {
  id: number;
  couple_id: number;
  label: string;
  direction: string | null;
  /** ISO local "YYYY-MM-DDTHH:MM" (no timezone — wedding-local). */
  depart_at: string | null;
  capacity: number | null;
  notes: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface UpsertTransferInput {
  label: string;
  direction?: string | null;
  depart_at?: string | null;
  capacity?: number | null;
  notes?: string | null;
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

export type ExportKind =
  | "json"
  | "seating_pdf"
  | "place_cards_pdf"
  | "table_numbers_pdf"
  | "menu_pdf"
  | "invitation_pdf"
  | "thank_you_pdf"
  | "schedule_pdf"
  | "guest_csv";

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

/** Legacy length of household check-in codes (4 digits). Kept for reference —
 *  rows generated before May 2026 still carry this shape and continue to
 *  resolve. New rows use the 8-char Crockford form below. */
export const HOUSEHOLD_CODE_LENGTH_LEGACY = 4;

/** Length of household check-in codes (Crockford base32, 8 chars).
 *  ~40 bits of entropy, enough to make blind enumeration impractical without
 *  ballooning the share URL. Case-insensitive on lookup. */
export const HOUSEHOLD_CODE_LENGTH = 8;

/** Crockford base32 alphabet — digits 0-9 plus A-Z minus I, L, O, U so the
 *  glyphs stay readable when typed off a card. Case-insensitive on lookup. */
export const HOUSEHOLD_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

// ─── Planning items (Tervezés page: Feladatok / Ötletek / Programterv) ──────

/** Sub-kind of a planning_items row. Drives which fields are surfaced in the
 *  UI and which tab a row lives under on /app/planning. Adding a new kind
 *  means: extend this union, add `is*Kind` guard + i18n keys + a tab on the
 *  PlanningPage. */
/** One image extracted from a Pinterest board's public RSS feed. Used by
 *  /api/moodboard/preview — the backend proxies the feed (CORS-blocked from
 *  the browser) and returns a normalised pin list for the moodboard page. */
export interface MoodboardPin {
  /** Full image URL on i.pinimg.com. The backend upgrades the size segment
   *  (`/236x/`) to `/736x/` for nicer rendering in the moodboard grid. */
  image_url: string;
  /** Permalink to the pin on pinterest.com — used as the click-through. */
  link_url: string;
  /** Pin title from the feed `<title>` tag; often empty, hence nullable. */
  title: string | null;
}

/** Where a couple's moodboard content comes from. `preset` is the default for
 *  every couple — a curated Pinterest board scraped server-side so the page is
 *  never blank. `pinterest` is the couple's own linked board. `upload` is
 *  their own images uploaded from-device (rows in `moodboard_images`). */
export type MoodboardSource = "preset" | "pinterest" | "upload";

/** One image the couple uploaded to their moodboard (source = "upload"). */
export interface MoodboardImage {
  id: number;
  /** Public URL served by the `/uploads/*` static handler. */
  image_url: string;
  sort_order: number;
}

/** Persisted moodboard state for the current couple — returned by
 *  GET /api/moodboard so the page renders the same board for both partners
 *  across devices (the choice lives on the couple row, not in localStorage). */
export interface MoodboardState {
  source: MoodboardSource;
  /** The couple's own Pinterest board link when source = "pinterest". */
  url: string | null;
  /** The curated default board, rendered when source = "preset". */
  preset_url: string;
  /** Uploaded images, ordered by `sort_order` then id, when source = "upload". */
  images: MoodboardImage[];
}

export type PlanningKind = "task" | "idea" | "schedule";

/** Sub-topic a planning item belongs to. Drives which surface shows it —
 *  the planning page shows everything (with a "Nászút" group on the wand);
 *  the honeymoon page only shows tasks tagged "honeymoon". `null` is
 *  treated as "wedding" by every reader for backward compatibility with
 *  rows that pre-date the column. */
export type PlanningTopic = "wedding" | "honeymoon";

/** Lifecycle of a "Döntések" decision-prompt (a planning task carrying a
 *  `seed_key`). Orthogonal to `done`:
 *   - `open`        the prompt is unanswered (default at generation);
 *   - `decided`     the couple resolved it (the answer lives in `resolution`);
 *   - `not_relevant` dismissed — hidden from the deck, recoverable via "show all";
 *   - `promoted`    converted into a dated task (gets a due_date + assignee) and
 *                   now appears on the normal Tasks list / Gantt instead.
 *  `null` on every non-prompt row (normal tasks, ideas, schedule entries). */
export type DecisionStatus = "open" | "decided" | "not_relevant" | "promoted";

/** Triage state of an "ötlet" (idea) row. Orthogonal to `done` — an idea is
 *  not a checklist item, it's a maybe-pile the couple sorts into:
 *   - `doing` ("Megcsináljuk")     committed; keep it;
 *   - `maybe` ("Még nem tudjuk")   undecided, parked;
 *   - `skip`  ("Kihagyjuk")        dropped, kept for the record.
 *  `null` on rows that pre-date the column or on non-idea kinds. */
export type IdeaStatus = "doing" | "maybe" | "skip";

/** Loose category tag on an idea, driving the colour chip / filter on the
 *  ideas board: programme idea, decor, surprise, keepsake, guest experience.
 *  `null` when untagged or on non-idea kinds. */
export type IdeaTag = "program" | "decor" | "surprise" | "keepsake" | "experience";

export interface PlanningItem {
  id: number;
  couple_id: number;
  kind: PlanningKind;
  /** Sub-topic — see `PlanningTopic`. `null` means the row pre-dates the
   *  column; readers treat it as "wedding". */
  topic: PlanningTopic | null;
  /** Short headline. Required. */
  title: string;
  /** Free-form longer text. Used by "ideas" mostly; tasks/schedule entries can
   *  still attach notes here. Trimmed to `null` when empty. */
  body: string | null;
  /** Tasks only — `true` once the couple ticks the checkbox. */
  done: boolean;
  /** Tasks only — optional YYYY-MM-DD deadline. */
  due_date: string | null;
  /** Schedule entries only — optional HH:MM local-time slot ("14:30"). */
  scheduled_time: string | null;
  /** Tasks only — free-text owner ("Anna", "Apa", "Tanú1"). The frontend
   *  offers the union of existing assignees as a datalist so re-typing stays
   *  minimal. */
  assignee: string | null;
  /** Tasks only — ISO YYYY-MM-DD. Pair with `due_date` for a Gantt-range view. */
  start_date: string | null;
  /** Tasks only — public supplier id (matches `couple_picks.supplier_id`).
   *  Free reference; we don't enforce that the supplier is still picked. */
  supplier_id: string | null;
  /** Tasks only — SOS / important flag. 0 = no flag, 1 = "!" (important),
   *  2 = "!!" (SOS). Drives the red exclamation badge + the filter pills
   *  above the task list. Stored as a plain integer because the cycle goes
   *  0 → 1 → 2 → 0 on a single button click. */
  priority: 0 | 1 | 2;
  /** Ideas only — id of the partner who logged the idea. Auto-stamped at
   *  create time. NULL only for legacy rows or items whose author was deleted. */
  suggested_by_user_id: number | null;
  /** Resolved server-side via JOIN on users.full_name for display. Mirrors
   *  `suggested_by_user_id` 1:1 unless the user was deleted (then null). */
  suggested_by_name: string | null;
  /** Manual ordering within a tab. Lower = earlier in the list. */
  position: number;
  /** "Döntések" layer - stable identifier matching a `PROMPT_SEEDS` entry in
   *  shared/planning_prompts.ts. `null` on normal tasks/ideas/schedule rows; set
   *  only on generated decision-prompts. The immutable seed metadata
   *  (prompt_kind, target, supplier category, hint, group) is looked up from the
   *  master by this key on the frontend rather than stored per row. */
  seed_key: string | null;
  /** "Döntések" layer - see `DecisionStatus`. `null` on non-prompt rows. */
  decision_status: DecisionStatus | null;
  /** "Döntések" layer - the resolved decision / supplier answer, free text.
   *  `null` until the prompt is decided. */
  resolution: string | null;
  /** Ideas only — triage state ("doing" | "maybe" | "skip"). See `IdeaStatus`.
   *  `null` on non-idea rows and untriaged ideas. */
  idea_status: IdeaStatus | null;
  /** Ideas only — loose category tag. See `IdeaTag`. `null` when untagged. */
  idea_tag: IdeaTag | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** State of the Timeline -> Google Calendar push-sync connection, surfaced by
 *  `GET /api/google-calendar/status`. `configured` gates the whole UI: false =
 *  the operator hasn't wired the Google OAuth secret, so the frontend hides the
 *  "Connect Google Calendar" affordance entirely. */
export interface GoogleCalendarStatus {
  /** The integration is wired server-side (OAuth client + secret present). */
  configured: boolean;
  /** This couple has an active connection. */
  connected: boolean;
  /** The Google account the calendar lives in. `null` when not connected. */
  email: string | null;
  /** Id of the dedicated Google calendar. `null` until the first sync creates it. */
  calendarId: string | null;
  /** Last successful reconcile (unix ms), or `null` if never synced. */
  lastSyncedAt: UnixMs | null;
  /** 'dirty' = a re-sync is pending. `null` when not connected. */
  syncState: "idle" | "dirty" | null;
  /** Most recent sync failure message, or `null` when the last sync was clean. */
  lastError: string | null;
}

/** A single segment within a flight offer's outbound itinerary. */
export interface FlightSegment {
  /** Operating carrier IATA on this segment (e.g. "LH"). */
  carrier: string;
  /** Carrier display name from SerpApi (e.g. "Lufthansa"). */
  airline_name: string;
  /** Marketing flight number ("LH 1234"). Empty when SerpApi didn't surface
   *  a parseable value. */
  flight_number: string;
  depart_iata: string;
  depart_name: string;
  depart_iso: string;
  arrival_iata: string;
  arrival_name: string;
  arrival_iso: string;
  /** Segment duration in minutes (gate-to-gate). */
  duration_min: number;
  /** Aircraft type if SerpApi included it (e.g. "Airbus A320"). */
  airplane: string;
  /** Cabin class if known ("Economy" / "Business" / …). */
  travel_class: string;
}

/** Layover between two FlightSegments. */
export interface FlightLayover {
  iata: string;
  airport_name: string;
  duration_min: number;
  /** True when SerpApi flags this as an overnight transfer. */
  overnight: boolean;
}

/** A single flight option in the FlightEstimate.offers list. Pricing is for
 *  the full party (adults * leg fare) round-trip, in `currency` whole units. */
export interface FlightOffer {
  /** Whole-unit price in the estimate's currency (HUF: forints, no cents). */
  price: number;
  /** ISO 4217 — echoed per-offer so the UI doesn't have to look up the
   *  parent estimate when rendering a row. */
  currency: string;
  /** Operating IATA carrier code on the outbound first segment (e.g. "LH"). */
  carrier: string;
  /** ISO timestamps for the outbound leg — the card uses them to render
   *  "Mon 10:15 → 14:40" without re-parsing on every render. */
  depart_iso: string;
  arrival_iso: string;
  /** Total outbound duration in minutes. */
  duration_min: number;
  /** Outbound stops (0 = direct). */
  stops: number;
  /** Per-segment breakdown for the expandable row. Always at least one
   *  entry; legacy cached rows that pre-date this field deserialise to []. */
  segments: FlightSegment[];
  /** Layovers between segments; `segments.length - 1` entries on healthy
   *  payloads. Empty array on direct flights. */
  layovers: FlightLayover[];
  /** Google Flights search-URL deeplink to view full details + book.
   *  Constructed server-side from the route + dates so the frontend doesn't
   *  need to know the URL format. */
  booking_url: string;
}

/** Round-trip flight cost estimate shown on /app/honeymoon. Figures are
 *  *suggestions* sourced from Amadeus's flight-offers feed, not bookable
 *  quotes. Cached server-side for 12 h. `null` rather than this shape when
 *  destination/dates are incomplete, no offer was found, or the Amadeus
 *  credentials aren't configured. */
export interface FlightEstimate {
  /** Origin IATA airport code (e.g. "BUD"). */
  origin: string;
  /** Free-text destination the couple typed. Echoed back so the UI can show
   *  "Bali → BUD" etc. without re-reading the couple state. */
  destination_text: string;
  /** Resolved destination IATA code, or `null` if Amadeus's location lookup
   *  didn't find a match (then `offers` is empty). */
  destination_iata: string | null;
  depart_date: string;
  return_date: string;
  adults: number;
  /** ISO 4217 (e.g. "HUF") — the currency the offers were quoted in. */
  currency: string;
  /** Up to 3 cheapest offers (deduped by carrier when possible), sorted
   *  cheapest-first. Empty array when no offer came back; the card hides
   *  in that case. */
  offers: FlightOffer[];
  /** Server-side cache timestamp — let the frontend show "frissítve: …". */
  fetched_at: UnixMs;
}

export type PlannerPlan = "starter" | "pro" | "premium";
export const PLANNER_PLAN_LIMITS: Record<PlannerPlan, number> = {
  starter: 4,
  pro: 7,
  premium: 10,
};

/** Admin management row for a planner. A planner is a `users` row with
 *  `user_type='planner'`; there is no separate table. Surfaced in the admin
 *  Szervezők management list with plan tier, client cap and how many couples
 *  are actively linked. Suspension rides the shared `users.status`. */
/** Rich profile a planner submitted through the public `/planners` waitlist
 *  form. Matched to a live account by email (so the admin Szervezők card can
 *  show it in a collapsible section) and carried inline on a pending
 *  (accepted-but-not-yet-registered) applicant. All fields optional-ish
 *  because the form only requires name + email. */
export interface AdminPlannerWaitlistDetail {
  company_name: string | null;
  city: string | null;
  km_radius: number | null;
  weddings_per_year: number | null;
  /** Chosen wedding styles in form order; empty when none were given. */
  wedding_styles: string[];
  other_style: string | null;
  website: string | null;
  reference_links: string | null;
  early_bird: boolean;
  message: string | null;
}

// ─── Planner directory analytics ────────────────────────────────────────────

/** Couple-side telemetry the admin planner list aggregates. Mirrors the
 *  supplier model: "was the card seen" (impression), "did they open the
 *  profile" (profile_click), "did they hit Felkérés" (connect_click), "did
 *  they click through to the website" (website_click). */
export type PlannerEventType = "impression" | "profile_click" | "connect_click" | "website_click";

export interface PlannerEventInput {
  planner_user_id: number;
  type: PlannerEventType;
}

/** Per-planner counters surfaced on the admin Szervezők card. `views_total` is
 *  card impressions; `clicks_total` folds every click type together; the
 *  30-day windows give a recency read, and `connect_clicks_total` isolates the
 *  Felkérés conversions. */
export interface PlannerAnalytics {
  views_total: number;
  views_30d: number;
  clicks_total: number;
  clicks_30d: number;
  connect_clicks_total: number;
  last_event_at: UnixMs | null;
}

/** A live planner account — a `users` row with user_type='planner'. */
export interface AdminPlannerAccount {
  state: "active";
  user_id: number;
  full_name: string;
  email: string;
  status: UserStatus;
  planner_plan: PlannerPlan;
  planner_max_clients: number;
  planner_city: string | null;
  planner_onboarding_done: boolean;
  /** Admin-granted trust badge (users.planner_verified). Toggled from this
   *  same admin list; surfaced to couples in the planner directory. */
  verified: boolean;
  /** Count of active `planner_clients` links (approved couples). */
  client_count: number;
  created_at: UnixMs;
  business_name: string | null;
  /** Free-text business category typed by the admin at provisioning. */
  planner_category: string | null;
  /** True while an admin-provisioned planner has an unconsumed activation
   *  token, i.e. they received the activation email but haven't gone live. */
  pending_activation: boolean;
  /** End of the free window (planner_subscriptions.founding_until) when the
   *  planner is on a founding/comp grant; null on trial or paid statuses. */
  founding_until: UnixMs | null;
  /** The planner's waitlist submission matched by email, or null when the
   *  account never came through the waitlist (e.g. admin-provisioned). Feeds
   *  the collapsible detail section on the admin card. */
  waitlist: AdminPlannerWaitlistDetail | null;
  /** Couple-facing directory reach (impressions + click-throughs). Attached by
   *  the admin list route; optional so `listAdminPlanners` need not compute it
   *  for callers that don't care. Absent → treat as all-zero. */
  analytics?: PlannerAnalytics;
}

/** An accepted planner-waitlist applicant who does NOT yet have a planner
 *  account (no `users` row matches their email — they applied but haven't
 *  registered / been granted). Surfaced in the admin Szervezők list so
 *  accepted applicants are visible before sign-up, mirroring the vendor
 *  "pending" onboarding rows. */
export interface AdminPlannerPending {
  state: "pending";
  /** planner_waitlist.id — the identity for a pending row (no planner yet). */
  waitlist_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: UnixMs;
  /** True when a NON-planner account already exists for this email (the
   *  mis-route / orphan case). Drives the admin action copy: approving CONVERTS
   *  an existing account vs PROVISIONS a fresh one. */
  has_account: boolean;
  waitlist: AdminPlannerWaitlistDetail;
}

/** Row in the admin Szervezők list: either a live account or an accepted
 *  waitlist applicant with no account yet. Discriminated by `state`. */
export type AdminPlannerView = AdminPlannerAccount | AdminPlannerPending;

/** Input for the admin "register a planner" form. The provisioned planner
 *  gets a 2-year free comp and an emailed activation link. */
export interface AdminProvisionPlannerInput {
  email: string;
  full_name: string;
  business_name: string;
  category: string;
}

/** Public view of a planner activation token, shown on the activation landing
 *  page so the invitee sees what was registered in their name before going
 *  live. Resolved by the secret token, so surfacing the email is safe. */
export interface PlannerActivationView {
  email: string;
  full_name: string;
  business_name: string | null;
  planner_category: string | null;
  /** End of the granted free window (2 years from provisioning). */
  free_until: UnixMs;
  expires_at: UnixMs;
}

/** An email invitation a planner sent to a not-yet-onboarded client. Once the
 *  invitee signs up + onboards, a pending planner_clients link is created
 *  (which the couple must still approve). status: pending until they onboard,
 *  accepted once linked, revoked if the planner cancelled it. */
export interface PlannerInvitation {
  id: number;
  email: string;
  status: "pending" | "accepted" | "revoked";
  accepted_at: UnixMs | null;
  expires_at: UnixMs | null;
  created_at: UnixMs;
}

/** Public lookup of a planner invitation by token — surfaced on the signup
 *  page so the invitee sees who invited them before creating an account. */
export interface PlannerInvitePublic {
  planner_label: string;
  email: string;
}

/** A planner-created calendar event. `couple_id` ties it to a specific client
 *  workspace when set, or is null for a standalone (personal) event. */
export interface PlannerEvent {
  id: number;
  couple_id: number | null;
  title: string;
  /** ISO YYYY-MM-DD. */
  event_date: string;
  /** HH:MM, or null for an all-day event. */
  start_time: string | null;
  /** HH:MM, or null for an open-ended / all-day event. Requires start_time. */
  end_time: string | null;
  notes: string | null;
  created_at: UnixMs;
}

export interface PlannerStatsPerClient {
  couple_id: number;
  display_name: string;
  wedding_date: string | null;
  task_total: number;
  task_done: number;
  task_overdue: number;
  due_this_week: number;
}

export interface PlannerStats {
  active_clients: number;
  pending_invites: number;
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  due_this_week: number;
  upcoming_weddings_30d: number;
  per_client: PlannerStatsPerClient[];
  plan: PlannerPlan;
  max_clients: number;
  onboarding_done: boolean;
}
