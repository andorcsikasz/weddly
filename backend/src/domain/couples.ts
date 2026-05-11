// Couple row → DTO mapper + the workspace helpers used by every protected route.

import type {
  BudgetGoal,
  BudgetKind,
  CeremonyKind,
  Couple,
  CoupleStatus,
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

/** The workspace a user belongs to. Returns null until they finish onboarding
 *  (or accept a partner-B invite). */
export function getCoupleForUser(userId: number): CoupleRow | null {
  const row = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as
    | { couple_id: number | null }
    | undefined;
  if (!row?.couple_id) return null;
  return getCoupleById(row.couple_id);
}
