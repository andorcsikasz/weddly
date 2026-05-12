// Guest row → DTO mapper + helpers.

import type {
  Guest,
  GuestGroupTag,
  GuestKind,
  MealChoice,
  PublicRsvpView,
  RsvpStatus,
} from "@shared/types";
import { db, now } from "../db";
import { generateInviteCode } from "./invite_codes";

export interface GuestRow {
  id: number;
  couple_id: number;
  household_id: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: string;
  invite_code: string;
  kind: string;
  rsvp_status: string;
  meal_choice: string | null;
  dietary: string | null;
  plus_one_name: string | null;
  plus_one_meal: string | null;
  accommodation_needed: number;
  song_request: string | null;
  notes: string | null;
  rsvp_responded_at: number | null;
  invited_at: number | null;
  invitation_delivered_at: number | null;
  /** "bride" | "groom" | null — server-derived; mirrors `couples.bride_name` /
   *  `couples.groom_name` onto the matching guest rows. */
  partner_role: string | null;
  created_at: number;
  updated_at: number;
}

export type PartnerRole = "bride" | "groom";
const VALID_PARTNER_ROLE: ReadonlySet<PartnerRole> = new Set(["bride", "groom"]);
function normPartnerRole(raw: string | null | undefined): PartnerRole | null {
  if (raw && VALID_PARTNER_ROLE.has(raw as PartnerRole)) return raw as PartnerRole;
  return null;
}

const VALID_GROUPS: ReadonlySet<GuestGroupTag> = new Set([
  "his_family",
  "her_family",
  "his_friends",
  "her_friends",
  "shared_friends",
  "work",
  "other",
]);

const VALID_RSVP: ReadonlySet<RsvpStatus> = new Set(["pending", "yes", "no", "maybe"]);
const VALID_MEAL: ReadonlySet<MealChoice> = new Set([
  "meat",
  "fish",
  "vegetarian",
  "vegan",
  "child",
  "none",
]);
const VALID_KIND: ReadonlySet<GuestKind> = new Set(["adult", "child", "baby"]);

export function isGuestKind(s: string): s is GuestKind {
  return VALID_KIND.has(s as GuestKind);
}

export function isGuestGroupTag(s: string): s is GuestGroupTag {
  return VALID_GROUPS.has(s as GuestGroupTag);
}

export function isRsvpStatus(s: string): s is RsvpStatus {
  return VALID_RSVP.has(s as RsvpStatus);
}

export function isMealChoice(s: string): s is MealChoice {
  return VALID_MEAL.has(s as MealChoice);
}

export function toGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    couple_id: row.couple_id,
    household_id: row.household_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    group_tag: (isGuestGroupTag(row.group_tag) ? row.group_tag : "other") as GuestGroupTag,
    invite_code: row.invite_code,
    kind: (isGuestKind(row.kind) ? row.kind : "adult") as GuestKind,
    rsvp_status: (isRsvpStatus(row.rsvp_status) ? row.rsvp_status : "pending") as RsvpStatus,
    meal_choice: row.meal_choice && isMealChoice(row.meal_choice) ? row.meal_choice : null,
    dietary: row.dietary,
    plus_one_name: row.plus_one_name,
    plus_one_meal: row.plus_one_meal && isMealChoice(row.plus_one_meal) ? row.plus_one_meal : null,
    accommodation_needed: Boolean(row.accommodation_needed),
    song_request: row.song_request,
    notes: row.notes,
    rsvp_responded_at: row.rsvp_responded_at,
    invited_at: row.invited_at,
    invitation_delivered_at: row.invitation_delivered_at,
    partner_role: normPartnerRole(row.partner_role),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Idempotently materialize the bride + groom as real guest rows inside the
 *  couple's own household. Shared by the onboarding handler (fresh couple)
 *  and the boot-time backfill (pre-existing couples).
 *
 *  Behaviour per role:
 *   1. If a `partner_role = role` guest already exists for this couple,
 *      leave it alone. Renames are owned by the live PATCH path.
 *   2. Otherwise, if a same-named guest already exists (case-insensitive,
 *      trimmed), adopt it by stamping `partner_role` — no duplicate row.
 *   3. Otherwise, insert a fresh row in `householdId`. rsvp=yes, kind=adult,
 *      group_tag splits by family side so the dashboard pie chart looks sane.
 *
 *  Returns the number of rows touched (created OR adopted) so callers can
 *  log "seeded N host guest rows" without re-querying. */
export function ensurePartnerGuests(input: {
  coupleId: number;
  householdId: number;
  brideName: string;
  groomName: string;
}): number {
  const { coupleId, householdId } = input;
  const bride = input.brideName.trim();
  const groom = input.groomName.trim();
  const targets: { name: string; role: PartnerRole; groupTag: string }[] = [];
  if (bride) targets.push({ name: bride, role: "bride", groupTag: "her_family" });
  if (groom) targets.push({ name: groom, role: "groom", groupTag: "his_family" });
  if (targets.length === 0) return 0;

  const selectByRole = db.prepare(
    "SELECT id FROM guests WHERE couple_id = ? AND partner_role = ? LIMIT 1",
  );
  const selectByName = db.prepare(
    "SELECT id, household_id FROM guests WHERE couple_id = ? AND lower(trim(full_name)) = lower(trim(?)) AND partner_role IS NULL LIMIT 1",
  );
  const adopt = db.prepare("UPDATE guests SET partner_role = ?, updated_at = ? WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO guests
       (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
        meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
        song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
        created_at, updated_at, household_id, partner_role)
     VALUES (?, ?, NULL, NULL, ?, ?, 'adult', 'yes',
             NULL, NULL, NULL, NULL, 0,
             NULL, NULL, NULL, NULL, NULL,
             ?, ?, ?, ?)`,
  );

  let touched = 0;
  const ts = now();
  for (const t of targets) {
    const existing = selectByRole.get(coupleId, t.role) as { id: number } | undefined;
    if (existing) continue;
    const match = selectByName.get(coupleId, t.name) as { id: number } | undefined;
    if (match) {
      adopt.run(t.role, ts, match.id);
      touched++;
      continue;
    }
    insert.run(coupleId, t.name, t.groupTag, uniqueInviteCode(), ts, ts, householdId, t.role);
    touched++;
  }
  return touched;
}

/** Rename the partner-role guest row when bride_name / groom_name changes. */
export function renamePartnerGuest(coupleId: number, role: PartnerRole, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) return;
  db.prepare(
    "UPDATE guests SET full_name = ?, updated_at = ? WHERE couple_id = ? AND partner_role = ?",
  ).run(trimmed, now(), coupleId, role);
}

/** Generate a unique invite code, retrying on the (rare) collision. */
export function uniqueInviteCode(): string {
  for (let i = 0; i < 12; i++) {
    const code = generateInviteCode();
    const hit = db.prepare("SELECT 1 FROM guests WHERE invite_code = ?").get(code);
    if (!hit) return code;
  }
  // Astronomically unlikely; bail loud rather than silently corrupting state.
  throw new Error("Could not generate a unique invite code after 12 tries");
}

export function listGuestsByCouple(coupleId: number): Guest[] {
  const rows = db
    .prepare("SELECT * FROM guests WHERE couple_id = ? ORDER BY created_at ASC")
    .all(coupleId) as GuestRow[];
  return rows.map(toGuest);
}

export function getGuestByInviteCode(code: string): GuestRow | null {
  return (
    (db.prepare("SELECT * FROM guests WHERE invite_code = ?").get(code) as GuestRow | undefined) ??
    null
  );
}

export function getGuestByIdScoped(id: number, coupleId: number): GuestRow | null {
  return (
    (db.prepare("SELECT * FROM guests WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | GuestRow
      | undefined) ?? null
  );
}

/** RSVP page sees a heavily filtered subset — no notes, no other guests' data. */
export function toPublicRsvpView(
  guest: GuestRow,
  coupleDisplayName: string,
  weddingDate: string | null,
): PublicRsvpView {
  const g = toGuest(guest);
  return {
    full_name: g.full_name,
    couple_display_name: coupleDisplayName,
    wedding_date: weddingDate,
    rsvp_status: g.rsvp_status,
    meal_choice: g.meal_choice,
    dietary: g.dietary,
    plus_one_name: g.plus_one_name,
    plus_one_meal: g.plus_one_meal,
    accommodation_needed: g.accommodation_needed,
    song_request: g.song_request,
  };
}

export function touchGuestUpdated(id: number) {
  db.prepare("UPDATE guests SET updated_at = ? WHERE id = ?").run(now(), id);
}
