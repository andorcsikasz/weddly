// Couple row → DTO mapper + the workspace helpers used by every protected route.

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
import { db } from "../db";

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
  planning_count: number | null;
  frozen_categories_json: string;
  currency: string | null;
  rsvp_offers_accommodation: number;
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
    style_tags: styleTags,
    status: VALID_COUPLE_STATUSES.has(row.status as CoupleStatus)
      ? (row.status as CoupleStatus)
      : "active",
    honeymoon_destination: row.honeymoon_destination,
    honeymoon_start_date: row.honeymoon_start_date,
    honeymoon_end_date: row.honeymoon_end_date,
    planning_count: row.planning_count,
    frozen_categories: parseFrozenCategoriesJson(row.frozen_categories_json ?? "[]"),
    currency: rowToCurrency(row.currency),
    rsvp_offers_accommodation: Boolean(row.rsvp_offers_accommodation),
    created_at: row.created_at,
    onboarded_at: row.onboarded_at,
    updated_at: row.updated_at,
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
  status: CoupleStatus;
  role: CoupleMemberRole;
  joined_at: number;
}

/** Every workspace this user belongs to. Used by the header switcher and
 *  the profile's "Esemény-munkaterületek" panel. Ordered oldest-first so
 *  Alpha (the user's original workspace) reads as the natural anchor. */
export function listCouplesForUser(userId: number): CoupleMembershipView[] {
  const rows = db
    .prepare(
      `SELECT cm.couple_id, c.display_name, c.bride_name, c.groom_name, c.status,
              cm.role, cm.created_at AS joined_at
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id
        WHERE cm.user_id = ?
        ORDER BY cm.created_at ASC, cm.couple_id ASC`,
    )
    .all(userId) as {
    couple_id: number;
    display_name: string;
    bride_name: string;
    groom_name: string;
    status: string;
    role: string;
    joined_at: number;
  }[];
  return rows.map((r) => ({
    couple_id: r.couple_id,
    display_name: r.display_name,
    bride_name: r.bride_name,
    groom_name: r.groom_name,
    status: VALID_COUPLE_STATUSES.has(r.status as CoupleStatus)
      ? (r.status as CoupleStatus)
      : "active",
    role: r.role === "owner" ? "owner" : "partner",
    joined_at: r.joined_at,
  }));
}
