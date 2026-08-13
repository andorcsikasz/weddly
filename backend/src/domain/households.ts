// Household = a party that RSVPs together. One row per group; many guests
// belong to it via guests.household_id. The 4-digit `code` is unique per
// couple and pairs with `couples.slug` to form the public check-in credential.

import type {
  GuestGroupTag,
  Household,
  HouseholdMember,
  MealSlotKey,
  RsvpStatus,
} from "@shared/types";
import { db, now } from "../db";
import { type GuestRow, isGuestGroupTag, isMealSlotKey, isRsvpStatus, toGuest } from "./guests";
import { generateHouseholdCode, normalizeHouseholdCode } from "./invite_codes";

export interface HouseholdRow {
  id: number;
  couple_id: number;
  code: string;
  label: string;
  notes: string | null;
  group_tag: string;
  /** Per-household opt-in for the public RSVP "needs accommodation?"
   *  question. Stored 0/1; mapped to boolean in `toHousehold`. Migrated off
   *  the couple-level column in May 2026 so each household carries its own
   *  decision. */
  rsvp_offers_accommodation: number;
  /** Per-household opt-out for the meal-choice icon row on the public RSVP
   *  form. Default 1 (collect). */
  rsvp_collects_meal: number;
  /** Free text the GUEST left on the public RSVP, addressed to the couple.
   *  Distinct from `notes`, which the couple writes about this household. */
  guest_message: string | null;
  /** 1 when this row was spawned implicitly by `guests.create` (no
   *  `household_id` and no `new_household_label` on the request body), 0
   *  when the user deliberately created it via the households route or
   *  with an explicit `new_household_label`. */
  auto_created: number;
  /** 1 for the single per-couple household that collects suppliers (DJ,
   *  photographer, …). Guests flagged is_supplier are auto-routed here. */
  is_supplier_household: number;
  /** Unix ms the household's first digital invite was sent, or null. The
   *  mass-send dedup key — see the column comment in db.ts. */
  invited_at: number | null;
  /** Manual display order on /app/guests. Default 0 for every never-dragged
   *  household; `listHouseholdsByCouple` orders by it (ties → created_at) so a
   *  fresh workspace keeps the historic creation order. Set by reorderHouseholds. */
  sort_index: number;
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
  // Crockford codes are case-insensitive. Stored values are uppercased on
  // write (see uniqueHouseholdCode), so an uppercase lookup catches both
  // legacy 4-digit codes (digits have no case) and post-bump 8-char codes.
  const normalized = normalizeHouseholdCode(code);
  return (
    (db
      .prepare("SELECT * FROM households WHERE couple_id = ? AND code = ?")
      .get(coupleId, normalized) as HouseholdRow | undefined) ?? null
  );
}

export function listHouseholdsByCouple(
  coupleId: number,
  opts: { excludeAutoSingletons?: boolean } = {},
): HouseholdRow[] {
  // Host household (the bride + groom's own dedicated 2-person home) always
  // sorts to the top of /app/guests. Everything else honors the couple's
  // manual drag order (`sort_index`), falling back to creation order for
  // never-dragged rows (all share the default 0) so existing arrangements stay
  // stable until a card is actually moved.
  //
  // `excludeAutoSingletons` hides households that were spawned implicitly
  // (`auto_created = 1`) and still contain a single member — the typical
  // "user typed a guest name, a stub household tagged along" case. We keep
  // the row visible the moment a second guest joins, since at that point it
  // represents a real party, just one that was bootstrapped from a name.
  const filter = opts.excludeAutoSingletons
    ? `AND NOT (
         h.auto_created = 1
         AND (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id) <= 1
       )`
    : "";
  return db
    .prepare(
      `SELECT h.*
         FROM households h
        WHERE h.couple_id = ?
        ${filter}
        ORDER BY (
          CASE WHEN EXISTS (
            SELECT 1 FROM guests g
             WHERE g.household_id = h.id AND g.partner_role IS NOT NULL
          ) THEN 0 ELSE 1 END
        ) ASC, h.sort_index ASC, h.created_at ASC`,
    )
    .all(coupleId) as HouseholdRow[];
}

/** Persist the couple's manual household order. `orderedIds` is the desired
 *  top-to-bottom sequence; each gets its array position as `sort_index` so the
 *  next `listHouseholdsByCouple` returns them in that order (host household
 *  stays pinned on top via the partner-role CASE, regardless of its index).
 *  Ids not belonging to the couple are ignored by the WHERE clause. Runs in a
 *  single transaction so a partial write can't leave a scrambled order. */
export function reorderHouseholds(coupleId: number, orderedIds: number[]): void {
  const ts = now();
  const stmt = db.prepare(
    "UPDATE households SET sort_index = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  );
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => stmt.run(i, ts, id, coupleId));
  });
  tx(orderedIds);
}

export function listMembers(householdId: number): GuestRow[] {
  return db
    .prepare("SELECT * FROM guests WHERE household_id = ? ORDER BY created_at ASC")
    .all(householdId) as GuestRow[];
}

/** Generate a Crockford base32 code (8 chars) that's unused for this couple.
 *  Retries on the (vanishingly rare) collision — the 32^8 keyspace is large
 *  enough that even after thousands of households the probability of a clash
 *  is well below 1e-8 — then bails loudly so we never silently re-issue a
 *  duplicate. The stored value is the generator's uppercase form; lookups go
 *  through `normalizeHouseholdCode` so a guest typing the code in mixed case
 *  still resolves. */
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
  group_tag?: GuestGroupTag;
  /** Caller's intent indicator. `guests.create` passes true when spawning
   *  an implicit household-of-one for a name-only guest entry; the
   *  households CRUD route + explicit `new_household_label` paths pass
   *  false (or omit, defaulting false). */
  auto_created?: boolean;
  /** Initial value for the household's `rsvp_offers_accommodation` flag.
   *  Couples can opt-in at creation time from the AddGuestDrawer; absent
   *  (or false) preserves the schema default of OFF. */
  rsvp_offers_accommodation?: boolean;
  /** Initial value for the household's `rsvp_collects_meal` flag. Meal
   *  collection is opt-in, so absent (or false) keeps it OFF. Set explicitly
   *  here (not left to the column default) so older DBs whose column was
   *  created with the legacy DEFAULT 1 still start new households OFF. */
  rsvp_collects_meal?: boolean;
  /** Marks the per-couple supplier household. See `getOrCreateSupplierHousehold`. */
  is_supplier_household?: boolean;
}): HouseholdRow {
  const ts = now();
  const code = uniqueHouseholdCode(input.couple_id);
  const groupTag: GuestGroupTag = input.group_tag ?? "other";
  const result = db
    .prepare(
      "INSERT INTO households (couple_id, code, label, notes, group_tag, auto_created, rsvp_offers_accommodation, rsvp_collects_meal, is_supplier_household, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.couple_id,
      code,
      input.label,
      input.notes ?? null,
      groupTag,
      input.auto_created ? 1 : 0,
      input.rsvp_offers_accommodation ? 1 : 0,
      input.rsvp_collects_meal ? 1 : 0,
      input.is_supplier_household ? 1 : 0,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  const row = getHouseholdById(id, input.couple_id);
  if (!row) throw new Error("createHousehold: insert succeeded but row missing");
  return row;
}

/** Return the couple's single supplier household, creating it on first use.
 *  Suppliers (DJ, photographer, …) are grouped here instead of in a normal
 *  guest party. The label follows the couple's country so it reads naturally
 *  in their locale. */
export function getOrCreateSupplierHousehold(coupleId: number, country: string): HouseholdRow {
  const existing = db
    .prepare(
      "SELECT * FROM households WHERE couple_id = ? AND is_supplier_household = 1 ORDER BY id LIMIT 1",
    )
    .get(coupleId) as HouseholdRow | undefined;
  if (existing) return existing;
  return createHousehold({
    couple_id: coupleId,
    label: country === "HU" ? "Szolgáltatók" : "Suppliers",
    group_tag: "other",
    is_supplier_household: true,
  });
}

/** Set the household's group_tag and propagate to every NON-partner member
 *  guest so the whole party stays in lock-step. Partner-role rows (bride /
 *  groom) keep their existing group_tag (her_family / his_family) — that pair
 *  is what bisects the dashboard "who's coming" pie into the two clans, and
 *  forcing them into a single bucket would erase that. Caller is responsible
 *  for the audit log. */
export function setHouseholdGroupTag(
  householdId: number,
  coupleId: number,
  groupTag: GuestGroupTag,
): void {
  const ts = now();
  db.prepare(
    "UPDATE households SET group_tag = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(groupTag, ts, householdId, coupleId);
  db.prepare(
    `UPDATE guests
        SET group_tag = ?, updated_at = ?
      WHERE household_id = ? AND couple_id = ? AND partner_role IS NULL`,
  ).run(groupTag, ts, householdId, coupleId);
}

/** The single address a household's invite is sent to. We send ONE email per
 *  household (the check-in code is shared), so pick the lowest-id member that
 *  actually carries an address. Suppliers are skipped — booked vendors aren't
 *  RSVP invitees. Returns null when nobody in the household has an email, which
 *  the mass-send reports as "skipped, no address" rather than silently. */
export function householdContactMember(members: GuestRow[]): GuestRow | null {
  const candidate = members
    .filter((m) => m.is_supplier !== 1 && typeof m.email === "string" && m.email.trim().length > 0)
    .sort((a, b) => a.id - b.id)[0];
  return candidate ?? null;
}

/** Stamp the household as invited and propagate to its members' `invited_at`
 *  (only where still null) so the per-guest 3-state chip on /app/guests reflects
 *  the digital send. Idempotent: a re-send keeps the original member stamps. */
export function markHouseholdInvited(householdId: number, coupleId: number, ts: number): void {
  db.prepare(
    "UPDATE households SET invited_at = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(ts, ts, householdId, coupleId);
  db.prepare(
    "UPDATE guests SET invited_at = ?, updated_at = ? WHERE household_id = ? AND couple_id = ? AND invited_at IS NULL",
  ).run(ts, ts, householdId, coupleId);
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

export function toHousehold(
  row: HouseholdRow,
  members: GuestRow[],
  // The `opts` arg is retained for callers that pass the couple's split names
  // — we no longer read it because `is_couple_household` is now derived
  // strictly from the explicit `partner_role` column on members. Each host
  // lives in their own dedicated household, so the flag fires per-partner
  // (and the GuestsPage "hide RSVP share link" affordance stays intact for
  // both cards individually).
  _opts: { brideName?: string | null; groomName?: string | null } = {},
): Household {
  const isCouple = members.some((m) => m.partner_role !== null && m.partner_role !== undefined);
  return {
    id: row.id,
    couple_id: row.couple_id,
    code: row.code,
    label: row.label,
    notes: row.notes,
    member_ids: members.map((m) => m.id),
    group_tag: isGuestGroupTag(row.group_tag) ? row.group_tag : "other",
    is_couple_household: isCouple,
    is_supplier_household: row.is_supplier_household === 1,
    rsvp_offers_accommodation: row.rsvp_offers_accommodation === 1,
    rsvp_collects_meal: row.rsvp_collects_meal === 1,
    guest_message: row.guest_message ?? null,
    auto_created: row.auto_created === 1,
    invited_at: row.invited_at ?? null,
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
    accommodation_id: g.accommodation_id,
    song_request: g.song_request,
    email: g.email,
    is_plus_one: g.is_plus_one,
    plus_one_of: g.plus_one_of,
  };
}

/** Apply a member's RSVP submission. Pure DB write — caller handles audit log
 *  + email side-effects. */
export function applyMemberCheckin(
  guestId: number,
  householdId: number,
  patch: {
    rsvp_status: RsvpStatus;
    meal_choice: MealSlotKey | null;
    dietary: string | null;
    accommodation_needed: boolean;
    /** The lodging the guest picked, already validated by the caller as one
     *  this couple offers. `null` means they picked none, which deliberately
     *  CLEARS any previous pick: on a form that offers options, "no place
     *  selected" is an answer. */
    accommodation_id: number | null;
    song_request: string | null;
    /** Guest-supplied contact email. Always sent by the current form (seeded
     *  from what the server already had), so this is a normal overwrite —
     *  same round-trip contract as `song_request` above. */
    email: string | null;
  },
): void {
  const ts = now();
  db.prepare(
    `UPDATE guests SET
        rsvp_status = ?, meal_choice = ?, dietary = ?,
        accommodation_needed = ?, accommodation_id = ?, song_request = ?, email = ?,
        rsvp_responded_at = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
  ).run(
    patch.rsvp_status,
    patch.meal_choice,
    patch.dietary,
    patch.accommodation_needed ? 1 : 0,
    patch.accommodation_id,
    patch.song_request,
    patch.email,
    ts,
    ts,
    guestId,
    householdId,
  );
}

/** Store the guest's message to the couple. Called from the public RSVP submit
 *  only, and only when the form actually carried the key: an absent key means
 *  "this client didn't ask about it" and must leave an existing message alone,
 *  while an emptied box is a deliberate `null`. Pure DB write. */
export function setHouseholdGuestMessage(
  householdId: number,
  coupleId: number,
  message: string | null,
): void {
  db.prepare(
    "UPDATE households SET guest_message = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(message, now(), householdId, coupleId);
}

/** Type guards re-exported for callers parsing public payloads. */
export const guards = { isMealSlotKey, isRsvpStatus };
