// Couple row → DTO mapper + the workspace helpers used by every protected route.

import {
  type CoupleBilling,
  computeEntitlement,
  type SubscriptionStatus,
  SUBSCRIPTION_STATUSES,
} from "@shared/billing";
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
  WeddingDateGoal,
  WeddingDateKind,
  WeddingSeason,
  WeddingStyleTag,
} from "@shared/types";
import { billingEnforcementOn, db } from "../db";
import { isAdminEmail } from "./users";

const VALID_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(SUBSCRIPTION_STATUSES);

/** True when any member of the couple is a beta tester. Beta workspaces get the
 *  platform free for as long as they are in beta, so they are never paywalled.
 *  Matches how the admin list derives the Beta badge (users.couple_id link). */
function coupleHasBetaMember(coupleId: number): boolean {
  return (
    db
      .prepare("SELECT 1 AS hit FROM users WHERE couple_id = ? AND is_beta_tester = 1 LIMIT 1")
      .get(coupleId) != null
  );
}

/** True when any member of the couple is an admin. Admins are never payment-
 *  obligated — their own workspace stays editable even after the paywall goes
 *  live. Sourced from the ADMIN_EMAILS allowlist (isAdminEmail), so it tracks
 *  env changes with no stored state. */
function coupleHasAdminMember(coupleId: number): boolean {
  const rows = db.prepare("SELECT email FROM users WHERE couple_id = ?").all(coupleId) as Array<{
    email: string;
  }>;
  return rows.some((r) => isAdminEmail(r.email));
}

/** Build the billing snapshot for a couple row, computing live entitlement.
 *  Demo couples are always entitled — billing never touches the throwaway
 *  demo workspaces. Exported so route guards can reuse the same verdict. */
export function toCoupleBilling(row: CoupleRow, nowMs: number = Date.now()): CoupleBilling {
  const status: SubscriptionStatus = VALID_SUBSCRIPTION_STATUSES.has(
    row.subscription_status as SubscriptionStatus,
  )
    ? (row.subscription_status as SubscriptionStatus)
    : "none";
  const verdict = row.is_demo
    ? ({ entitled: true, reason: "subscribed" } as const)
    : computeEntitlement(status, {
        trial_ends_at: row.trial_ends_at,
        founding_until: row.founding_until,
        nowMs,
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
  return {
    subscription_status: status,
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    is_founding_member: Boolean(row.is_founding_member),
    current_period_end: row.current_period_end,
    entitled,
    reason: verdict.reason,
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
  planning_count: number | null;
  frozen_categories_json: string;
  currency: string | null;
  rsvp_offers_accommodation: number;
  rsvp_collects_meal: number;
  is_demo: number;
  welcome_desk_active: number;
  /** Public wedding-website (/w/:slug) opt-in toggle. 0 = private (default),
   *  1 = couple has explicitly published. Public endpoint 404s when 0 so
   *  every existing couple stays private until they flip the toggle. */
  is_public: number;
  /** Free-text venue name shown on the public wedding site. Null when the
   *  couple hasn't set one — the site falls back to the lat/lng pin only. */
  venue_name: string | null;
  /** Couple-pasted http(s) URL for the hero image on the public site.
   *  No upload pipeline yet; this is BYO-URL with boundary validation. */
  cover_image_url: string | null;
  /** Pre-RSVP welcome block (Vendégoldal Phase 2). Visible at every tier
   *  of the public wedding endpoint — the couple authors it for "anyone
   *  with the link". Null when unset. */
  guest_page_intro: string | null;
  /** Post-RSVP unlocked content (Vendégoldal Phase 2). Server omits it
   *  from the public-wedding response unless the caller's tier is
   *  `confirmed` (valid household code + at least one RSVP yes). Null
   *  when unset. */
  post_rsvp_content: string | null;
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
  /** Subscription state machine — see shared/billing.ts. */
  subscription_status: string;
  trial_ends_at: number | null;
  founding_until: number | null;
  is_founding_member: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: number | null;
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
const VALID_CURRENCIES: ReadonlySet<Currency> = new Set(["HUF", "EUR", "USD"]);
function rowToCurrency(raw: string | null | undefined): Currency {
  return raw && VALID_CURRENCIES.has(raw as Currency) ? (raw as Currency) : "HUF";
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
    planning_count: row.planning_count,
    frozen_categories: parseFrozenCategoriesJson(row.frozen_categories_json ?? "[]"),
    currency: rowToCurrency(row.currency),
    rsvp_offers_accommodation: Boolean(row.rsvp_offers_accommodation),
    rsvp_collects_meal: Boolean(row.rsvp_collects_meal),
    is_demo: Boolean(row.is_demo),
    is_public: Boolean(row.is_public),
    welcome_desk_active: Boolean(row.welcome_desk_active),
    venue_name: row.venue_name,
    cover_image_url: row.cover_image_url,
    guest_page_intro: row.guest_page_intro,
    post_rsvp_content: row.post_rsvp_content,
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

export interface CoupleMembershipView {
  couple_id: number;
  display_name: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  status: CoupleStatus;
  role: CoupleMemberRole;
  joined_at: number;
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
              c.status, cm.role, cm.created_at AS joined_at
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
 *  fresh invite_code; every household gets a fresh 4-digit code. */
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
    // their FK. Each dst household gets a freshly minted 4-digit code so
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
      // Inline copy of domain/households.uniqueHouseholdCode — that helper
      // takes a different signature shape than what we need here and a
      // 50-attempt cap is plenty given the 9000-code namespace.
      for (let attempt = 0; attempt < 50; attempt++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
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
      // Mirrors domain/invite_codes.generateInviteCode + the uniqueness
      // loop in domain/guests.uniqueInviteCode. Inline so this helper has
      // no cross-domain imports.
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let attempt = 0; attempt < 50; attempt++) {
        let code = "";
        for (let i = 0; i < 8; i++) {
          code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
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
