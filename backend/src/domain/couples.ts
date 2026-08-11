// Couple row → DTO mapper + the workspace helpers used by every protected route.

import {
  type BillingReason,
  type CoupleBilling,
  computeEntitlement,
  type SubscriptionStatus,
  SUBSCRIPTION_STATUSES,
  TRIAL_GRACE_MS,
} from "@shared/billing";
import { type CoupleDesign, type CoupleDesignInput, resolveDesign } from "@shared/design";
import { parseMealMenu } from "@shared/meals";
import { parseMenuCard } from "@shared/menu_card";
import {
  type NotifEmailCadence,
  type TimelineEmailEscalation,
  isNotifEmailCadence,
  isTimelineEmailEscalation,
  parseNotifFocus,
  serializeNotifFocus,
} from "@shared/notifications";
import type {
  BudgetCategory,
  BudgetGoal,
  BudgetKind,
  CeremonyKind,
  Couple,
  CoupleStatus,
  Currency,
  GuestCountGoal,
  GuestCountKind,
  MediaLinks,
  MediaSource,
  WeddingDateGoal,
  WeddingDateKind,
  WeddingSeason,
  WeddingStyleTag,
} from "@shared/types";
import { isCurrency } from "@shared/currency";
import { MAX_PHOTOGRAPHER_LINKS } from "@shared/types";
import { billingEnforcedAt, billingEnforcementOn, db, now } from "../db";
import { computeNameReview } from "./name_review";
import { generateHouseholdCode, generateInviteCode, generateOrganiserCode } from "./invite_codes";
import { isAdminEmail } from "./users";

const VALID_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(SUBSCRIPTION_STATUSES);

/** True when any member of the couple is a beta tester. Beta workspaces get the
 *  platform free for as long as they are in beta, so they are never paywalled.
 *  Membership is resolved through `couple_members` (canonical), NOT
 *  `users.couple_id` (the active-workspace pointer) — otherwise a multi-workspace
 *  beta member silently flips this couple's free pass on/off by switching which
 *  workspace they have selected. */
export function coupleHasBetaMember(coupleId: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS hit
           FROM couple_members cm
           JOIN users u ON u.id = cm.user_id
          WHERE cm.couple_id = ? AND u.is_beta_tester = 1 LIMIT 1`,
      )
      .get(coupleId) != null
  );
}

/** True when any member of the couple is an admin. Admins are never payment-
 *  obligated — their own workspace stays editable even after the paywall goes
 *  live. Sourced from the ADMIN_EMAILS allowlist (isAdminEmail), so it tracks
 *  env changes with no stored state. */
export function coupleHasAdminMember(coupleId: number): boolean {
  // Through `couple_members`, not `users.couple_id` — same active-pointer hazard
  // as coupleHasBetaMember above.
  const rows = db
    .prepare(
      `SELECT u.email AS email
         FROM couple_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.couple_id = ?`,
    )
    .all(coupleId) as Array<{ email: string }>;
  return rows.some((r) => isAdminEmail(r.email));
}

/** True when an active planner is managing this couple. A planner-managed
 *  couple is viewer-only by default once its own free window lapses; the
 *  planner does the editing. Drives the viewer-mode billing snapshot. */
export function coupleHasActivePlanner(coupleId: number): boolean {
  return (
    db
      .prepare("SELECT 1 FROM planner_clients WHERE couple_id = ? AND status = 'active' LIMIT 1")
      .get(coupleId) != null
  );
}

/** The user who owns/created this workspace: the `owner`-role couple_member
 *  (whoever onboarded it or spun it up as an additional event), falling back to
 *  `partner_a_id` for legacy rows that pre-date the membership table. Null only
 *  when neither can be resolved. Shared by the admin overview (which groups
 *  workspaces by owner) and the billing anchor below, so the two always agree
 *  on who "owns" a workspace. */
export function ownerUserIdOf(row: Pick<CoupleRow, "id" | "partner_a_id">): number | null {
  const m = db
    .prepare(
      `SELECT user_id FROM couple_members
        WHERE couple_id = ? AND role = 'owner'
        ORDER BY created_at ASC, user_id ASC LIMIT 1`,
    )
    .get(row.id) as { user_id: number } | undefined;
  return m?.user_id ?? row.partner_a_id ?? null;
}

/** The couple whose subscription verdict GOVERNS `row`. Additional event-
 *  workspaces a user spins up ride the SAME billing rules as the owner's FIRST
 *  workspace: "every workspace under one account follows the same rules as the
 *  first" — a second event can't mint its own fresh trial, nor stay editable
 *  once the primary lapses. Returns the owner's oldest non-deleting workspace;
 *  falls back to `row` itself when it already IS the oldest (the common single-
 *  workspace path, one indexed query, no behaviour change) or when the owner
 *  can't be resolved. The oldest workspace is always its own anchor, so there
 *  are no inheritance chains. Exported so the founding grant can target — and
 *  restrict itself to — the anchor (see activatePartnerFreeWindow). */
export function billingAnchorRow(row: CoupleRow): CoupleRow {
  const anchor = db
    .prepare(
      `SELECT anchor.couple_id AS id
         FROM couple_members anchor
         JOIN couples c ON c.id = anchor.couple_id AND c.status != 'deleting'
        WHERE anchor.user_id = COALESCE(
                (SELECT o.user_id FROM couple_members o
                  WHERE o.couple_id = ? AND o.role = 'owner'
                  ORDER BY o.created_at ASC, o.user_id ASC LIMIT 1),
                ?)
        ORDER BY anchor.created_at ASC, anchor.couple_id ASC
        LIMIT 1`,
    )
    .get(row.id, row.partner_a_id) as { id: number } | undefined;
  if (anchor == null || anchor.id === row.id) return row;
  return getCoupleById(anchor.id) ?? row;
}

/** True when `row` IS its owner's first (oldest) workspace — the billing
 *  anchor. Founding is a per-OWNER property earned once on the anchor, so this
 *  gates activatePartnerFreeWindow: a secondary event can never mint its own
 *  founding badge (which would consume a FOUNDING_CAP slot per event and break
 *  the inheritance invariant). A single-workspace couple is its own anchor. */
export function isBillingAnchor(row: CoupleRow): boolean {
  return billingAnchorRow(row).id === row.id;
}

/** Build the billing snapshot for a couple row, computing live entitlement.
 *  Demo couples are always entitled — billing never touches the throwaway
 *  demo workspaces. Exported so route guards can reuse the same verdict.
 *
 *  Additional event-workspaces inherit the owner's FIRST workspace's verdict
 *  (see billingAnchorRow): the status + trial/founding timestamps below come
 *  from that governing row so a secondary reads the same "free trial / founding
 *  / lapsed" state as the primary. `is_founding_member` stays the couple's OWN
 *  value, though — a secondary rides the primary's entitlement without itself
 *  consuming a founding slot, so the FOUNDING_CAP accounting can't be inflated. */
export function toCoupleBilling(row: CoupleRow, nowMs: number = Date.now()): CoupleBilling {
  const src = billingAnchorRow(row);
  const status: SubscriptionStatus = VALID_SUBSCRIPTION_STATUSES.has(
    src.subscription_status as SubscriptionStatus,
  )
    ? (src.subscription_status as SubscriptionStatus)
    : "none";
  const verdict = row.is_demo
    ? ({ entitled: true, reason: "subscribed" } as const)
    : computeEntitlement(status, {
        trial_ends_at: src.trial_ends_at,
        founding_until: src.founding_until,
        past_due_since: src.past_due_since,
        nowMs,
        // Couples, and ONLY couples, keep editing for a week past their trial
        // while the trial_ended mail's two routes are still open to them. The
        // vendor and planner funnels pass nothing here and keep a hard boundary.
        trialGraceMs: TRIAL_GRACE_MS,
        // ...counted from go-live when that is later than their trial end, so
        // the couples whose trials lapsed during the deferred-freeze period get
        // the same week of warning as everyone else instead of being frozen the
        // instant the switch is flipped.
        enforcementStartedAt: billingEnforcedAt(),
      });
  // Always-free / not-yet-enforced overrides. Only consulted when the plain
  // verdict would lock the couple out, so the common paths (entitled subs, and
  // the entire pre-launch period) pay no extra queries. Order is cheapest-first:
  // a single PK read for the global switch short-circuits before any per-couple
  // membership lookup, so while the freeze is deferred nothing else runs.
  let entitled = verdict.entitled;
  if (!entitled && !row.is_demo) {
    if (
      !billingEnforcementOn() || // deferred freeze: paywall not live yet
      coupleHasBetaMember(row.id) || // beta testers: free while in beta
      coupleHasAdminMember(row.id) // admins are never payment-obligated
    ) {
      entitled = true;
    }
  }
  const plannerManaged = row.is_demo ? false : coupleHasActivePlanner(row.id);
  // When a planner-managed couple's own free window has lapsed (and no override
  // grants it back), the couple member is a viewer, not locked out — surface
  // that as the reason so the UI shows the "your planner is editing" banner
  // instead of the generic "subscribe" wall. Mirrors entitlementBlock's return.
  const reason: BillingReason =
    !entitled && plannerManaged ? "planner_managed_viewer" : verdict.reason;
  return {
    subscription_status: status,
    trial_ends_at: src.trial_ends_at,
    founding_until: src.founding_until,
    is_founding_member: Boolean(row.is_founding_member),
    current_period_end: src.current_period_end,
    past_due_since: src.past_due_since,
    entitled,
    reason,
    planner_managed: plannerManaged,
    guest_page_prepaid: Boolean(row.guest_page_prepaid),
    guest_page_addon: Boolean(row.guest_page_addon),
  };
}

export interface CoupleRow {
  id: number;
  partner_a_id: number;
  partner_b_id: number | null;
  display_name: string;
  bride_name: string;
  groom_name: string;
  slug: string | null;
  organiser_code: string | null;
  wedding_date: string | null;
  wedding_date_kind: string | null;
  wedding_target_year: number | null;
  wedding_target_month: number | null;
  wedding_target_season: string | null;
  target_guest_count: number | null;
  guest_count_kind: string | null;
  target_guest_count_min: number | null;
  target_guest_count_max: number | null;
  budget_ceiling_huf: number | null;
  budget_kind: string | null;
  budget_ceiling_min_huf: number | null;
  budget_ceiling_max_huf: number | null;
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  country: string | null;
  style_tags_json: string;
  status: string;
  created_at: number;
  updated_at: number;
  onboarded_at: number | null;
  previous_wedding_date: string | null;
  ceremony_kind: string | null;
  archived_at: number | null;
  honeymoon_destination: string | null;
  honeymoon_start_date: string | null;
  honeymoon_end_date: string | null;
  honeymoon_origin_iata: string | null;
  honeymoon_cover_path: string | null;
  planning_count: number | null;
  frozen_categories_json: string;
  currency: string | null;
  rsvp_offers_accommodation: number;
  rsvp_collects_meal: number;
  meal_menu: string | null;
  menu_card: string | null;
  timeline_email_escalation: string | null;
  notif_email_cadence: string | null;
  notif_focus: string | null;
  /** When we first noticed the partner names are placeholders. NULL for
   *  everybody else: see `domain/name_review.ts`. */
  name_flagged_at: number | null;
  name_notice_sent_at: number | null;
  /** Seating canvas room size in millimetres. NULL = never set, resolved to the
   *  12x9 m default at read time. */
  seating_room_w_mm: number | null;
  seating_room_h_mm: number | null;
  is_demo: number;
  welcome_desk_active: number;
  /** Public wedding-website (/w/:slug) opt-in toggle. 0 = private (default),
   *  1 = couple has explicitly published. Public endpoint 404s when 0 so
   *  every existing couple stays private until they flip the toggle. */
  is_public: number;
  /** Gift-list publish toggle for the guest page. 0 = unpublished (default),
   *  1 = the couple flipped publish on the wishlist editor. The confirmed-tier
   *  guest-page embed is gated on this so an unpublished list never ships. */
  wishlist_published: number;
  /** Free-text venue name shown on the public wedding site. Null when the
   *  couple hasn't set one — the site falls back to the lat/lng pin only. */
  venue_name: string | null;
  /** Settlement (city/town) shown next to the venue name. Null when unset. */
  venue_city: string | null;
  /** Couple-entered venue + day-of contacts for the private Kulcsinfó panel. */
  venue_address: string | null;
  venue_phone: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  /** Couple-pasted http(s) URL for the hero image on the public site.
   *  No upload pipeline yet; this is BYO-URL with boundary validation. */
  cover_image_url: string | null;
  /** Cover-photo focal point (object-position %, 0..100, 50 = centred). */
  cover_position_x: number;
  cover_position_y: number;
  /** Cover-photo zoom (percent, 100 = fit, up to 300). */
  cover_scale: number;
  /** Optional fixed-slot photos on the public site (uploaded /uploads/... URLs,
   *  slot 1 after the welcome band, slot 2 before the RSVP ask). Null = slot
   *  empty, the band simply doesn't render. */
  site_image_1_url: string | null;
  site_image_2_url: string | null;
  /** Moodboard source: 'preset' (curated default board), 'pinterest' (own
   *  board link in moodboard_url) or 'upload' (rows in moodboard_images).
   *  Defaults to 'preset' so /app/moodboard is never blank. */
  moodboard_source: string;
  /** The couple's own Pinterest board link when moodboard_source='pinterest'.
   *  NULL otherwise. */
  moodboard_url: string | null;
  /** Pre-RSVP welcome block (Vendégoldal Phase 2). Visible at every tier
   *  of the public wedding endpoint — the couple authors it for "anyone
   *  with the link". Null when unset. */
  guest_page_intro: string | null;
  /** "Good to know" block (parking, getting there, accommodation, …). Same
   *  public visibility as guest_page_intro. Null when unset. */
  useful_info: string | null;
  /** Post-RSVP unlocked content (Vendégoldal Phase 2). Server omits it
   *  from the public-wedding response unless the caller's tier is
   *  `confirmed` (valid household code + at least one RSVP yes). Null
   *  when unset. */
  post_rsvp_content: string | null;
  /** Envelope-tip toggle for the pre-wedding info message. 1/0, but only
   *  meaningful once `envelope_tip_choice_at` is stamped — see db.ts. */
  envelope_tip_enabled: number | null;
  /** When the couple last used the on/off switch. NULL = never, which reads
   *  back as OFF regardless of the flag: the tip is opt-in. */
  envelope_tip_choice_at: number | null;
  /** Manual per-head amount (couple currency, minor units) overriding the
   *  budget-derived auto value. Null = auto. */
  envelope_tip_amount_override: number | null;
  /** JSON blob `{ guests, photographer, other }` of photo-share URLs for the
   *  Photos page. NULL / malformed parses to all-null. */
  media_links_json: string | null;
  /** JSON blob of curated visual-identity slugs + print toggles for the
   *  Design feature, e.g. `{ style, palette, fonts, print: {...} }`. NULL /
   *  malformed resolves to the Botanical Green default at read-time. */
  design_json: string | null;
  /** Unix-ms stamp of the last bride/groom rename via PATCH
   *  /api/couples/current. Drives the 7-day rename cooldown. NULL for
   *  couples that have never used the gated rename path. */
  names_last_changed_at: number | null;
  /** 0 = unlocked (default), 1 = the cost-planning headcount slider on
   *  /app/budget is pinned to the current `planning_count` and the slider
   *  collapses out of view. Per-row planned amounts still drag freely. */
  planning_count_locked: number;
  /** Timestamp the admin last clicked the "remind partner invite" mail
   *  icon on the admin workspace list. NULL = never reminded. Used to
   *  enforce a one-shot send so the lone partner isn't pestered. */
  invite_partner_reminded_at: number | null;
  /** How many founding-cohort pushes ('founding_partner_push') have gone out
   *  to this workspace, and when the last one did. Capped at
   *  FOUNDING_PUSH_MAX_SENDS by the email worker. */
  founding_push_count: number;
  founding_push_last_at: number | null;
  /** Subscription state machine — see shared/billing.ts. */
  subscription_status: string;
  trial_ends_at: number | null;
  founding_until: number | null;
  is_founding_member: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: number | null;
  past_due_since: number | null;
  /** Planner-managed guest-page edit add-on (see domain/billing.ts). */
  guest_page_prepaid: number;
  guest_page_addon: number;
}

const CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);

const DATE_KINDS: ReadonlySet<WeddingDateKind> = new Set([
  "exact",
  "month",
  "season",
  "year",
  "tbd",
]);
const SEASONS: ReadonlySet<WeddingSeason> = new Set(["spring", "summer", "fall", "winter"]);
const COUNT_KINDS: ReadonlySet<GuestCountKind> = new Set(["exact", "range", "tbd"]);
const BUDGET_KINDS: ReadonlySet<BudgetKind> = new Set(["exact", "range", "tbd"]);
function rowToCurrency(raw: string | null | undefined): Currency {
  return isCurrency(raw) ? raw : "HUF";
}

const VALID_BUDGET_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
]);

function parseFrozenCategoriesJson(raw: string): BudgetCategory[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: BudgetCategory[] = [];
    const seen = new Set<BudgetCategory>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const cat = v as BudgetCategory;
      if (!VALID_BUDGET_CATEGORIES.has(cat) || seen.has(cat)) continue;
      seen.add(cat);
      out.push(cat);
    }
    return out;
  } catch {
    return [];
  }
}

function rowToDateGoal(row: CoupleRow): WeddingDateGoal {
  const raw = (row.wedding_date_kind ?? "exact") as WeddingDateKind;
  const kind: WeddingDateKind = DATE_KINDS.has(raw) ? raw : "exact";
  const season =
    row.wedding_target_season && SEASONS.has(row.wedding_target_season as WeddingSeason)
      ? (row.wedding_target_season as WeddingSeason)
      : null;
  return {
    kind,
    exact_date: kind === "exact" ? row.wedding_date : null,
    target_year: row.wedding_target_year,
    target_month: row.wedding_target_month,
    target_season: season,
  };
}

function rowToGuestGoal(row: CoupleRow): GuestCountGoal {
  const raw = (row.guest_count_kind ?? "exact") as GuestCountKind;
  const kind: GuestCountKind = COUNT_KINDS.has(raw) ? raw : "exact";
  return {
    kind,
    exact: kind === "exact" ? row.target_guest_count : null,
    min: row.target_guest_count_min,
    max: row.target_guest_count_max,
  };
}

function rowToBudgetGoal(row: CoupleRow): BudgetGoal {
  const raw = (row.budget_kind ?? "exact") as BudgetKind;
  const kind: BudgetKind = BUDGET_KINDS.has(raw) ? raw : "exact";
  return {
    kind,
    exact_huf: kind === "exact" ? row.budget_ceiling_huf : null,
    min_huf: row.budget_ceiling_min_huf,
    max_huf: row.budget_ceiling_max_huf,
  };
}

/** The three fixed photo-share slots, in display order. */
export const MEDIA_SOURCES: readonly MediaSource[] = ["guests", "photographer", "other"];

/** Parse the `media_links_json` blob into a fully-populated {@link MediaLinks}.
 *  NULL, malformed JSON, or missing keys all degrade to null per slot, so the
 *  DTO always carries the three slots. Non-string values are dropped to null. */
export function parseMediaLinksJson(json: string | null): MediaLinks {
  const out: MediaLinks = { guests: null, photographer: [], other: null };
  if (!json) return out;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.guests === "string" && parsed.guests.trim()) out.guests = parsed.guests;
    if (typeof parsed.other === "string" && parsed.other.trim()) out.other = parsed.other;
    out.photographer = normalizePhotographerLinks(parsed.photographer);
  } catch {
    // Malformed JSON in the DB shouldn't crash the API; leave defaults.
  }
  return out;
}

/** Legacy rows stored `photographer` as a single string; new rows store an
 *  array. Normalise both to an array of up to MAX_PHOTOGRAPHER_LINKS non-empty
 *  strings so readers always get an array. */
function normalizePhotographerLinks(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && v.trim() && out.length < MAX_PHOTOGRAPHER_LINKS) out.push(v);
  }
  return out;
}

/** Parse the `design_json` blob into a {@link CoupleDesignInput}. NULL or
 *  malformed JSON degrades to `{}`; {@link resolveDesign} then fills every
 *  field from the default, so the DTO always carries a complete design. */
export function parseDesignJson(json: string | null): CoupleDesign {
  if (!json) return resolveDesign(null);
  try {
    return resolveDesign(JSON.parse(json) as CoupleDesignInput);
  } catch {
    // Malformed JSON in the DB shouldn't crash the API; fall back to default.
    return resolveDesign(null);
  }
}

/** Is the envelope tip on? OPT-IN: a couple who never touched the switch is
 *  off, whatever the column says. `envelope_tip_enabled` shipped
 *  `NOT NULL DEFAULT 1`, so the flag alone cannot tell an untouched row from a
 *  deliberate yes, and "here is what to put in the envelope" is not something to
 *  put in a couple's mail on their behalf. The stamp is the consent. */
export function envelopeTipEnabled(row: {
  envelope_tip_enabled: number | null;
  envelope_tip_choice_at: number | null;
}): boolean {
  if (row.envelope_tip_choice_at == null) return false;
  return Boolean(row.envelope_tip_enabled);
}

export function toCouple(row: CoupleRow): Couple {
  let styleTags: WeddingStyleTag[] = [];
  try {
    const parsed = JSON.parse(row.style_tags_json);
    if (Array.isArray(parsed)) styleTags = parsed as WeddingStyleTag[];
  } catch {
    // Malformed JSON in the DB shouldn't crash the API; just return [].
  }
  return {
    id: row.id,
    partner_a_id: row.partner_a_id,
    partner_b_id: row.partner_b_id,
    display_name: row.display_name,
    bride_name: row.bride_name,
    groom_name: row.groom_name,
    slug: row.slug,
    organiser_code: row.organiser_code,
    wedding_date_goal: rowToDateGoal(row),
    wedding_date: row.wedding_date,
    previous_wedding_date: row.previous_wedding_date,
    ceremony_kind:
      row.ceremony_kind && CEREMONY_KINDS.has(row.ceremony_kind as CeremonyKind)
        ? (row.ceremony_kind as CeremonyKind)
        : null,
    archived_at: row.archived_at,
    guest_count_goal: rowToGuestGoal(row),
    target_guest_count: row.target_guest_count,
    budget_goal: rowToBudgetGoal(row),
    budget_ceiling_huf: row.budget_ceiling_huf,
    location_lat: row.location_lat,
    location_lng: row.location_lng,
    location_radius_km: row.location_radius_km,
    // Country-level scope; 'HU' for every historical couple. Normalised to a
    // 2-letter uppercase code, falling back to 'HU' for null/legacy rows.
    country:
      row.country && row.country.trim().length === 2 ? row.country.trim().toUpperCase() : "HU",
    style_tags: styleTags,
    status: VALID_COUPLE_STATUSES.has(row.status as CoupleStatus)
      ? (row.status as CoupleStatus)
      : "active",
    honeymoon_destination: row.honeymoon_destination,
    honeymoon_start_date: row.honeymoon_start_date,
    honeymoon_end_date: row.honeymoon_end_date,
    honeymoon_origin_iata: row.honeymoon_origin_iata,
    honeymoon_cover_path: row.honeymoon_cover_path ?? null,
    planning_count: row.planning_count,
    frozen_categories: parseFrozenCategoriesJson(row.frozen_categories_json ?? "[]"),
    currency: rowToCurrency(row.currency),
    rsvp_offers_accommodation: Boolean(row.rsvp_offers_accommodation),
    rsvp_collects_meal: Boolean(row.rsvp_collects_meal),
    meal_menu: parseMealMenu(row.meal_menu),
    menu_card: parseMenuCard(row.menu_card),
    timeline_email_escalation: isTimelineEmailEscalation(row.timeline_email_escalation ?? "")
      ? (row.timeline_email_escalation as TimelineEmailEscalation)
      : "overdue",
    notif_email_cadence: isNotifEmailCadence(row.notif_email_cadence ?? "")
      ? (row.notif_email_cadence as NotifEmailCadence)
      : "1_weekly",
    notif_focus: serializeNotifFocus(parseNotifFocus(row.notif_focus)),
    name_review: computeNameReview(row),
    is_demo: Boolean(row.is_demo),
    is_public: Boolean(row.is_public),
    wishlist_published: Boolean(row.wishlist_published),
    welcome_desk_active: Boolean(row.welcome_desk_active),
    venue_name: row.venue_name,
    venue_city: row.venue_city,
    venue_address: row.venue_address,
    venue_phone: row.venue_phone,
    coordinator_name: row.coordinator_name,
    coordinator_phone: row.coordinator_phone,
    emergency_name: row.emergency_name,
    emergency_phone: row.emergency_phone,
    cover_image_url: row.cover_image_url,
    cover_position_x: row.cover_position_x ?? 50,
    cover_position_y: row.cover_position_y ?? 50,
    cover_scale: row.cover_scale ?? 100,
    site_image_1_url: row.site_image_1_url ?? null,
    site_image_2_url: row.site_image_2_url ?? null,
    guest_page_intro: row.guest_page_intro,
    useful_info: row.useful_info,
    post_rsvp_content: row.post_rsvp_content,
    envelope_tip_enabled: envelopeTipEnabled(row),
    envelope_tip_amount_override: row.envelope_tip_amount_override ?? null,
    media_links: parseMediaLinksJson(row.media_links_json),
    design: parseDesignJson(row.design_json),
    seating_room_w_mm: row.seating_room_w_mm ?? null,
    seating_room_h_mm: row.seating_room_h_mm ?? null,
    created_at: row.created_at,
    onboarded_at: row.onboarded_at,
    updated_at: row.updated_at,
    names_last_changed_at: row.names_last_changed_at,
    planning_count_locked: Boolean(row.planning_count_locked),
    billing: toCoupleBilling(row),
  };
}

const VALID_COUPLE_STATUSES: ReadonlySet<CoupleStatus> = new Set([
  "active",
  "paused",
  "deleting",
  "archived",
]);

export function getCoupleById(id: number): CoupleRow | null {
  return (
    (db.prepare("SELECT * FROM couples WHERE id = ?").get(id) as CoupleRow | undefined) ?? null
  );
}

/** Generates a globally-unique organiser reference code ("O" + 5 digits),
 *  retrying on the (vanishingly rare) collision and bailing loudly if the
 *  space ever saturates. Mirrors the household-code uniqueness pattern. */
export function uniqueOrganiserCode(): string {
  const stmt = db.prepare("SELECT 1 FROM couples WHERE organiser_code = ?");
  for (let attempt = 0; attempt < 64; attempt++) {
    const code = generateOrganiserCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("Could not generate a unique organiser code");
}

/** Assigns an organiser_code to a freshly-created couple. Idempotent: leaves
 *  an already-coded row untouched so re-runs / double calls are safe. */
export function assignOrganiserCode(coupleId: number, ts: number): string {
  const existing = db.prepare("SELECT organiser_code FROM couples WHERE id = ?").get(coupleId) as
    | { organiser_code: string | null }
    | undefined;
  if (existing?.organiser_code) return existing.organiser_code;
  const code = uniqueOrganiserCode();
  db.prepare("UPDATE couples SET organiser_code = ?, updated_at = ? WHERE id = ?").run(
    code,
    ts,
    coupleId,
  );
  return code;
}

/** The workspace a user is currently viewing — same semantics as before.
 *  `users.couple_id` continues to be the "active workspace" pointer; the
 *  full membership set lives in `couple_members` (see helpers below). */
export function getCoupleForUser(userId: number): CoupleRow | null {
  const row = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as
    | { couple_id: number | null }
    | undefined;
  if (!row?.couple_id) return null;
  return getCoupleById(row.couple_id);
}

/** Membership role on a specific workspace. Mirrors users.role but scoped
 *  per couple — a user might be owner on Alpha and partner on Bravo. */
export type CoupleMemberRole = "owner" | "partner";

/** Add a (couple, user) membership row. Idempotent — re-inserting with the
 *  same pair is a no-op. Call after every flow that links a user to a
 *  couple: onboard, accept_invite, accept_invite_merge, and the new
 *  POST /api/couples ("create a second event") endpoint. */
export function addCoupleMember(coupleId: number, userId: number, role: CoupleMemberRole): void {
  db.prepare(
    `INSERT OR IGNORE INTO couple_members (couple_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(coupleId, userId, role, Date.now());
}

/** Drop a (couple, user) membership row. Idempotent. Called from the
 *  "leave couple" flow and indirectly via ON DELETE CASCADE when a couple
 *  is purged. */
export function removeCoupleMember(coupleId: number, userId: number): void {
  db.prepare("DELETE FROM couple_members WHERE couple_id = ? AND user_id = ?").run(
    coupleId,
    userId,
  );
}

/** True when the user has a membership row on this couple — protects the
 *  switch-active and create-event endpoints from cross-couple access. */
export function isCoupleMember(coupleId: number, userId: number): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM couple_members WHERE couple_id = ? AND user_id = ? LIMIT 1")
    .get(coupleId, userId) as { ok: number } | undefined;
  return !!row;
}

/** Mirror a couple's invited partner onto ALL of the owner's other event-
 *  workspaces. Once a co-user has joined ANY workspace an owner has, they are
 *  the same two people planning every event, so partner B should be a member of
 *  each of the owner's non-deleting workspaces — that is what "if one workspace
 *  has a co-user, the pair is auto-assigned to the others too" means.
 *
 *  Contract (deliberately narrow so it is safe to call from every write path):
 *   - MEMBERSHIP-ONLY. It writes `couple_members` rows and fills a NULL
 *     `partner_b_id`; it NEVER touches billing. Founding stays a per-OWNER grant
 *     earned once on the anchor (see activatePartnerFreeWindow) — mirroring the
 *     partner here must not mint a founding badge on a secondary event or it
 *     would consume a FOUNDING_CAP slot per event.
 *   - Never moves `users.couple_id` (the active-workspace pointer stays put).
 *   - Idempotent: `addCoupleMember` is INSERT OR IGNORE and partner_b_id is only
 *     filled when NULL, so re-runs are no-ops.
 *   - Leaves a workspace that already records a DIFFERENT second person alone —
 *     never clobbers a genuinely distinct relationship. The canonical partner is
 *     the earliest-joined partner across the owner's workspaces. */
export function propagatePartnerToOwnerWorkspaces(ownerUserId: number, ts: number = now()): void {
  const owned = db
    .prepare(
      `SELECT cm.couple_id AS id, c.partner_b_id AS partner_b_id
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id
        WHERE cm.user_id = ? AND cm.role = 'owner' AND c.status != 'deleting'
        ORDER BY cm.created_at ASC, cm.couple_id ASC`,
    )
    .all(ownerUserId) as { id: number; partner_b_id: number | null }[];
  if (owned.length < 2) return; // one workspace → nothing to mirror across

  const placeholders = owned.map(() => "?").join(",");
  const partner = db
    .prepare(
      `SELECT cm.user_id AS id
         FROM couple_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.couple_id IN (${placeholders})
          AND cm.role = 'partner'
          AND cm.user_id != ?
          AND u.status = 'active'
        ORDER BY cm.created_at ASC, cm.couple_id ASC
        LIMIT 1`,
    )
    .get(...owned.map((o) => o.id), ownerUserId) as { id: number } | undefined;
  if (!partner) return; // no partner has joined any of the workspaces yet

  for (const w of owned) {
    // A workspace already holding a different second person keeps it — that is a
    // separate relationship, not this couple. Skip it entirely (no membership,
    // no partner_b write).
    if (w.partner_b_id != null && w.partner_b_id !== partner.id) continue;
    addCoupleMember(w.id, partner.id, "partner");
    if (w.partner_b_id == null) {
      db.prepare(
        "UPDATE couples SET partner_b_id = ?, updated_at = ? WHERE id = ? AND partner_b_id IS NULL",
      ).run(partner.id, ts, w.id);
    }
  }
}

/** One-time boot reconciliation: apply propagatePartnerToOwnerWorkspaces to
 *  every owner who has more than one workspace, so existing couples whose
 *  partner only ever joined their first event get mirrored onto the rest.
 *  Idempotent and billing-neutral (see the helper's contract), so it is safe on
 *  every reboot. Returns the number of owners reconciled for the boot log. */
export function backfillPartnerPropagation(ts: number = now()): number {
  const owners = db
    .prepare(
      `SELECT cm.user_id AS id
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id AND c.status != 'deleting'
        WHERE cm.role = 'owner'
        GROUP BY cm.user_id
       HAVING COUNT(*) > 1`,
    )
    .all() as { id: number }[];
  for (const o of owners) propagatePartnerToOwnerWorkspaces(o.id, ts);
  return owners.length;
}

/** Collapse the gift list's two switches onto the one the server enforces.
 *
 *  The list had a publish toggle on /app/wishlist (`couples.wishlist_published`,
 *  which is what actually decides whether the payload carries the entries) and
 *  a section switch on /app/design (the `"wishlist"` slug in
 *  `design.web.hiddenSections`, a render-time hide). Two switches for one idea
 *  drift: published-but-hidden showed the couple a gift block in the design
 *  preview that no guest could ever see, and hidden-but-published did the
 *  reverse. The design side is retired, so any stored slug has to go somewhere.
 *
 *  It converges DOWN: a couple who hid the section sees nothing on the guest
 *  page today, and they keep seeing nothing (`wishlist_published = 0`).
 *  Converging up would publish a gift list to confirmed guests on the strength
 *  of a toggle the couple used to hide it.
 *
 *  Idempotent — only rows still carrying the slug are touched, and the write
 *  removes it. Returns the number of couples reconciled, for the boot log. */
export function reconcileWishlistSectionFlag(): number {
  const rows = db
    .prepare(
      `SELECT id, design_json FROM couples
        WHERE design_json IS NOT NULL AND design_json LIKE '%"wishlist"%'`,
    )
    .all() as { id: number; design_json: string }[];
  let changed = 0;
  for (const row of rows) {
    let parsed: { web?: { hiddenSections?: unknown } };
    try {
      parsed = JSON.parse(row.design_json) as { web?: { hiddenSections?: unknown } };
    } catch {
      continue; // unparseable blob: resolveDesign already treats it as defaults
    }
    const web = parsed?.web;
    const hidden = web?.hiddenSections;
    if (!web || !Array.isArray(hidden) || !hidden.includes("wishlist")) continue;
    web.hiddenSections = hidden.filter((s) => s !== "wishlist");
    db.prepare("UPDATE couples SET design_json = ?, wishlist_published = 0 WHERE id = ?").run(
      JSON.stringify(parsed),
      row.id,
    );
    changed++;
  }
  return changed;
}

export interface CoupleMembershipView {
  couple_id: number;
  display_name: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  status: CoupleStatus;
  role: CoupleMemberRole;
  joined_at: number;
  has_partner: boolean;
}

/** Every workspace this user belongs to. Used by the header switcher and
 *  the profile's "Esemény-munkaterületek" panel. Ordered oldest-first so
 *  Alpha (the user's original workspace) reads as the natural anchor.
 *  Tombstoned (`status='deleting'`) workspaces are filtered out — the
 *  purgeOneCouple sweep keeps the row around for audit retention but the
 *  user-facing list shouldn't surface a "Purged workspace" entry. */
export function listCouplesForUser(userId: number): CoupleMembershipView[] {
  const rows = db
    .prepare(
      `SELECT cm.couple_id, c.display_name, c.bride_name, c.groom_name, c.wedding_date,
              c.status, cm.role, cm.created_at AS joined_at,
              (c.partner_b_id IS NOT NULL) AS has_partner
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id
        WHERE cm.user_id = ?
          AND c.status != 'deleting'
        ORDER BY cm.created_at ASC, cm.couple_id ASC`,
    )
    .all(userId) as {
    couple_id: number;
    display_name: string;
    bride_name: string;
    groom_name: string;
    wedding_date: string | null;
    status: string;
    role: string;
    joined_at: number;
    has_partner: number;
  }[];
  return rows.map((r) => ({
    couple_id: r.couple_id,
    display_name: r.display_name,
    bride_name: r.bride_name,
    groom_name: r.groom_name,
    wedding_date: r.wedding_date,
    status: VALID_COUPLE_STATUSES.has(r.status as CoupleStatus)
      ? (r.status as CoupleStatus)
      : "active",
    role: r.role === "owner" ? "owner" : "partner",
    joined_at: r.joined_at,
    has_partner: r.has_partner === 1,
  }));
}

interface GuestSeedRow {
  id: number;
  household_id: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: string;
  kind: string;
  plus_one_name: string | null;
  plus_one_meal: string | null;
  dietary: string | null;
  notes: string | null;
  accommodation_needed: number;
  song_request: string | null;
}

interface HouseholdSeedRow {
  id: number;
  label: string;
  notes: string | null;
  group_tag: string;
}

/** Copy a subset of guests (and the households they belong to) from one
 *  couple workspace into another. Used by `POST /api/couples` so the user
 *  can spin up Bravo / Charlie seeded with whoever from Alpha is also
 *  coming to the second event. Caller must validate the user is a member
 *  of both couples before calling this. Returns the count of new rows.
 *
 *  Reset on copy: rsvp_status flips back to 'pending', invited_at /
 *  invitation_delivered_at clear, partner_role clears (the bride/groom on
 *  Alpha are not auto-partners on Bravo — the new workspace will spawn
 *  its own host guest rows via `ensurePartnerGuests`). Every guest gets a
 *  fresh invite_code; every household gets a fresh 8-character code. */
export function seedCoupleFromCouple(
  srcCoupleId: number,
  dstCoupleId: number,
  guestIds: readonly number[],
): { households_copied: number; guests_copied: number } {
  if (guestIds.length === 0) return { households_copied: 0, guests_copied: 0 };

  // Defence-in-depth: the route already verifies both memberships, but
  // refusing same-couple copies here protects against an accidental
  // self-seed via a typoed src_couple_id.
  if (srcCoupleId === dstCoupleId) {
    throw new Error("seedCoupleFromCouple: src and dst must differ");
  }

  // Pull every requested guest in one round-trip, scoped to src. Anything
  // missing from the result was either deleted or never belonged to src —
  // we silently ignore it rather than 404 the whole copy so partial
  // failure (e.g. a stale checkbox) doesn't kill the operation.
  const placeholders = guestIds.map(() => "?").join(",");
  const guests = db
    .prepare(
      `SELECT id, household_id, full_name, email, phone, group_tag, kind,
              plus_one_name, plus_one_meal, dietary, notes,
              accommodation_needed, song_request
         FROM guests
        WHERE couple_id = ? AND id IN (${placeholders})
          AND partner_role IS NULL`,
    )
    .all(srcCoupleId, ...guestIds) as GuestSeedRow[];

  if (guests.length === 0) return { households_copied: 0, guests_copied: 0 };

  // Unique src household ids referenced by the selected guests. Guests
  // with no household end up household-less in dst too (the
  // ensurePartnerGuests pass in the route will give them a home later if
  // the caller didn't pre-create one).
  const srcHouseholdIds = Array.from(
    new Set(guests.map((g) => g.household_id).filter((v): v is number => v !== null)),
  );
  let households: HouseholdSeedRow[] = [];
  if (srcHouseholdIds.length > 0) {
    const hhPlaceholders = srcHouseholdIds.map(() => "?").join(",");
    households = db
      .prepare(
        `SELECT id, label, notes, group_tag
           FROM households
          WHERE couple_id = ? AND id IN (${hhPlaceholders})`,
      )
      .all(srcCoupleId, ...srcHouseholdIds) as HouseholdSeedRow[];
  }

  const ts = Date.now();
  const tx = db.transaction(() => {
    // Map old household id → new household id so guest INSERTs can resolve
    // their FK. Each dst household gets a freshly minted 8-character code so
    // the public RSVP credential stays per-workspace.
    const hhIdMap = new Map<number, number>();
    const insertHousehold = db.prepare(
      `INSERT INTO households (couple_id, code, label, notes, group_tag, auto_created, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const codeCheck = db.prepare(
      "SELECT 1 FROM households WHERE couple_id = ? AND code = ? LIMIT 1",
    );
    function uniqueHouseholdCode(): string {
      // `generateHouseholdCode` is the ONLY generator, exactly as it is in
      // domain/households.uniqueHouseholdCode. Only the uniqueness loop is
      // local, because it reuses this transaction's prepared statement.
      //
      // What used to be here was a hand-written "inline copy" that had drifted
      // into the two things the canonical helper exists to prevent: it minted
      // the LEGACY 4-digit form (9,000 codes) that the May 2026 bump removed
      // for being enumerable, and it drew from `Math.random()`, which is not a
      // CSPRNG and whose internal state is recoverable from a handful of
      // outputs. This code is the credential on /w/:slug/:code, so a guessed
      // one hands over that household's names, RSVP answers, meal choices,
      // dietary notes and the schedule. The comment above it claimed
      // "8-character code" the whole time, which is how it went unnoticed.
      for (let attempt = 0; attempt < 50; attempt++) {
        const code = generateHouseholdCode();
        if (!codeCheck.get(dstCoupleId, code)) return code;
      }
      throw new Error(`Could not generate a unique household code for couple ${dstCoupleId}`);
    }
    for (const hh of households) {
      const code = uniqueHouseholdCode();
      const r = insertHousehold.run(
        dstCoupleId,
        code,
        hh.label,
        hh.notes,
        hh.group_tag ?? "other",
        ts,
        ts,
      );
      hhIdMap.set(hh.id, Number(r.lastInsertRowid));
    }

    const inviteCheck = db.prepare("SELECT 1 FROM guests WHERE invite_code = ? LIMIT 1");
    function uniqueInviteCode(): string {
      // Same rule as the household code above: `generateInviteCode` is the
      // generator, only the uniqueness loop is local to this transaction. The
      // copy that was here re-implemented it from `Math.random()` and got the
      // alphabet wrong in the bargain, keeping the `L` the canonical one drops
      // so a code read off a printed invitation cannot be confused with a 1.
      for (let attempt = 0; attempt < 50; attempt++) {
        const code = generateInviteCode();
        if (!inviteCheck.get(code)) return code;
      }
      throw new Error("Could not generate a unique guest invite_code");
    }

    const insertGuest = db.prepare(
      `INSERT INTO guests
         (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
          meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
          song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
          household_id, partner_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending',
               NULL, ?, ?, ?, ?,
               ?, ?, NULL, NULL, NULL,
               ?, NULL, ?, ?)`,
    );
    for (const g of guests) {
      const mappedHhId = g.household_id !== null ? (hhIdMap.get(g.household_id) ?? null) : null;
      insertGuest.run(
        dstCoupleId,
        g.full_name,
        g.email,
        g.phone,
        g.group_tag,
        uniqueInviteCode(),
        g.kind,
        g.dietary,
        g.plus_one_name,
        g.plus_one_meal,
        g.accommodation_needed,
        g.song_request,
        g.notes,
        mappedHhId,
        ts,
        ts,
      );
    }
  });
  tx();

  return { households_copied: households.length, guests_copied: guests.length };
}
