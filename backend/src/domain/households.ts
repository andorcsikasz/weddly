// Household = a party that RSVPs together. One row per group; many guests
// belong to it via guests.household_id. The 4-digit `code` is unique per
// couple and pairs with `couples.slug` to form the public check-in credential.

import type { Household, HouseholdMember, MealChoice, RsvpStatus } from "@shared/types";
import { db, now } from "../db";
import { type GuestRow, isMealChoice, isRsvpStatus, toGuest } from "./guests";
import { generateHouseholdCode } from "./invite_codes";

export interface HouseholdRow {
  id: number;
  couple_id: number;
  code: string;
  label: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function getHouseholdById(id: number, coupleId: number): HouseholdRow | null {
  return (
    (db.prepare("SELECT * FROM households WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | HouseholdRow
      | undefined) ?? null
  );
}

export function getHouseholdByCoupleAndCode(coupleId: number, code: string): HouseholdRow | null {
  return (
    (db.prepare("SELECT * FROM households WHERE couple_id = ? AND code = ?").get(coupleId, code) as
      | HouseholdRow
      | undefined) ?? null
  );
}

export function listHouseholdsByCouple(coupleId: number): HouseholdRow[] {
  return db
    .prepare("SELECT * FROM households WHERE couple_id = ? ORDER BY created_at ASC")
    .all(coupleId) as HouseholdRow[];
}

export function listMembers(householdId: number): GuestRow[] {
  return db
    .prepare("SELECT * FROM guests WHERE household_id = ? ORDER BY created_at ASC")
    .all(householdId) as GuestRow[];
}

/** Generate a 4-digit code that's unused for this couple. Retries on the
 *  (rare) collision, then bails loudly. */
export function uniqueHouseholdCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 32; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`Could not generate a unique household code for couple ${coupleId}`);
}

export function createHousehold(input: {
  couple_id: number;
  label: string;
  notes?: string | null;
}): HouseholdRow {
  const ts = now();
  const code = uniqueHouseholdCode(input.couple_id);
  const result = db
    .prepare(
      "INSERT INTO households (couple_id, code, label, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(input.couple_id, code, input.label, input.notes ?? null, ts, ts);
  const id = Number(result.lastInsertRowid);
  const row = getHouseholdById(id, input.couple_id);
  if (!row) throw new Error("createHousehold: insert succeeded but row missing");
  return row;
}

export function regenerateHouseholdCode(householdId: number, coupleId: number): string {
  const code = uniqueHouseholdCode(coupleId);
  db.prepare("UPDATE households SET code = ?, updated_at = ? WHERE id = ? AND couple_id = ?").run(
    code,
    now(),
    householdId,
    coupleId,
  );
  return code;
}

export function toHousehold(row: HouseholdRow, members: GuestRow[]): Household {
  return {
    id: row.id,
    couple_id: row.couple_id,
    code: row.code,
    label: row.label,
    notes: row.notes,
    member_ids: members.map((m) => m.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toHouseholdMember(row: GuestRow): HouseholdMember {
  const g = toGuest(row);
  return {
    id: g.id,
    full_name: g.full_name,
    kind: g.kind,
    rsvp_status: g.rsvp_status,
    meal_choice: g.meal_choice,
    dietary: g.dietary,
    accommodation_needed: g.accommodation_needed,
    song_request: g.song_request,
  };
}

/** Apply a member's RSVP submission. Pure DB write — caller handles audit log
 *  + email side-effects. */
export function applyMemberCheckin(
  guestId: number,
  householdId: number,
  patch: {
    rsvp_status: RsvpStatus;
    meal_choice: MealChoice | null;
    dietary: string | null;
    accommodation_needed: boolean;
    song_request: string | null;
  },
): void {
  const ts = now();
  db.prepare(
    `UPDATE guests SET
        rsvp_status = ?, meal_choice = ?, dietary = ?,
        accommodation_needed = ?, song_request = ?,
        rsvp_responded_at = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
  ).run(
    patch.rsvp_status,
    patch.meal_choice,
    patch.dietary,
    patch.accommodation_needed ? 1 : 0,
    patch.song_request,
    ts,
    ts,
    guestId,
    householdId,
  );
}

/** Type guards re-exported for callers parsing public payloads. */
export const guards = { isMealChoice, isRsvpStatus };
