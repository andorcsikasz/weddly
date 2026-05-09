// Couple row → DTO mapper + the workspace helpers used by every protected route.

import type { Couple, CoupleStatus, WeddingStyleTag } from "@shared/types";
import { db } from "../db";

export interface CoupleRow {
  id: number;
  partner_a_id: number;
  partner_b_id: number | null;
  display_name: string;
  wedding_date: string | null;
  target_guest_count: number | null;
  budget_ceiling_huf: number | null;
  location_lat: number | null;
  location_lng: number | null;
  location_radius_km: number | null;
  style_tags_json: string;
  status: string;
  created_at: number;
  updated_at: number;
  onboarded_at: number | null;
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
    wedding_date: row.wedding_date,
    target_guest_count: row.target_guest_count,
    budget_ceiling_huf: row.budget_ceiling_huf,
    location_lat: row.location_lat,
    location_lng: row.location_lng,
    location_radius_km: row.location_radius_km,
    style_tags: styleTags,
    status: row.status as CoupleStatus,
    created_at: row.created_at,
    onboarded_at: row.onboarded_at,
  };
}

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
