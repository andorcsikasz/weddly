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
import { generateHouseholdCode, generateInviteCode } from "./invite_codes";

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
  is_supplier: number;
  is_plus_one: number;
  plus_one_of: number | null;
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
  accommodation_id: number | null;
  transfer_id: number | null;
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
    is_supplier: Boolean(row.is_supplier),
    is_plus_one: Boolean(row.is_plus_one),
    plus_one_of: row.plus_one_of,
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
    accommodation_id: row.accommodation_id,
    transfer_id: row.transfer_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Idempotently materialize the bride + groom as real guest rows inside ONE
 *  shared, dedicated 2-person household. Couples asked for the host card to
 *  read as a single "Sári & Andor" entry at the top of /app/guests, separate
 *  from any household where their names might otherwise have been mixed in
 *  with family members.
 *
 *  The function is responsible for three things, in order:
 *
 *  (1) Find-or-create the canonical host household. "Canonical" = a household
 *      that contains AT LEAST ONE partner_role guest AND ZERO non-partner
 *      guests. The pure-host check is what makes this idempotent in the face
 *      of legacy state where a partner's name was adopted in place inside a
 *      mixed household — we don't pick that household as the home, we make a
 *      fresh dedicated one and force-relocate the partner row out.
 *
 *  (2) For each role (bride, groom): ensure exactly one guest row exists with
 *      `partner_role = role`, lives inside the canonical host household, and
 *      carries the canonical name. Three sub-cases:
 *        a. A `partner_role = role` guest already exists. If it's outside the
 *           host household, move it in. If its old household becomes empty,
 *           delete the old household (so we don't strand "Sári"-only HH ghosts
 *           from yesterday's split-HH commit).
 *        b. No `partner_role` guest exists but a same-named guest does
 *           (case-insensitive, trimmed). Adopt it by stamping `partner_role`
 *           AND relocate it into the host household, with the same empty-HH
 *           cleanup as (a).
 *        c. No matching guest at all. Insert a fresh row directly inside the
 *           host household (rsvp=yes, kind=adult, group_tag splits by family
 *           side so the dashboard pie still bisects the couple's two clans).
 *
 *  (3) If the host household was freshly created OR its label still matches a
 *      single partner's name (a leftover from the split-HH era), relabel to
 *      "{bride} & {groom}". Otherwise leave the label alone — users may have
 *      hand-edited it.
 *
 *  Returns the number of rows touched (created / adopted / relocated) so
 *  callers can log "seeded N host guest rows" without re-querying. */
export function ensurePartnerGuests(input: {
  coupleId: number;
  brideName: string;
  groomName: string;
}): number {
  const { coupleId } = input;
  const bride = input.brideName.trim();
  const groom = input.groomName.trim();
  const targets: { name: string; role: PartnerRole; groupTag: string }[] = [];
  if (bride) targets.push({ name: bride, role: "bride", groupTag: "her_family" });
  if (groom) targets.push({ name: groom, role: "groom", groupTag: "his_family" });
  if (targets.length === 0) return 0;

  const joinedLabel = bride && groom ? `${bride} & ${groom}` : bride || groom;

  // (1) Find or create the canonical host household. Pure-host = has at least
  // one partner_role member, zero non-partner members.
  const selectPureHostHh = db.prepare(
    `SELECT h.id AS id, h.label AS label
       FROM households h
      WHERE h.couple_id = ?
        AND EXISTS (
              SELECT 1 FROM guests g
               WHERE g.household_id = h.id AND g.partner_role IS NOT NULL
            )
        AND NOT EXISTS (
              SELECT 1 FROM guests g
               WHERE g.household_id = h.id AND g.partner_role IS NULL
            )
      ORDER BY h.created_at ASC
      LIMIT 1`,
  );
  // rsvp_collects_meal is set explicitly to 0 (meal collection is opt-in) so
  // older DBs whose column was created with the legacy DEFAULT 1 still start
  // new households with the menu row OFF.
  const insertHh = db.prepare(
    "INSERT INTO households (couple_id, code, label, notes, rsvp_collects_meal, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)",
  );
  const updateHhLabel = db.prepare("UPDATE households SET label = ?, updated_at = ? WHERE id = ?");
  const countMembers = db.prepare("SELECT COUNT(*) AS n FROM guests WHERE household_id = ?");
  const deleteHh = db.prepare("DELETE FROM households WHERE id = ?");

  const ts = now();
  let hostHhId: number;
  let hostHhLabelWasAutoNamed: boolean; // true when label = just one partner's name OR fresh insert
  {
    const existing = selectPureHostHh.get(coupleId) as { id: number; label: string } | undefined;
    if (existing) {
      hostHhId = existing.id;
      hostHhLabelWasAutoNamed =
        existing.label === bride || existing.label === groom || existing.label === joinedLabel;
    } else {
      const code = uniqueHouseholdCode(coupleId);
      const r = insertHh.run(coupleId, code, joinedLabel, ts, ts);
      hostHhId = Number(r.lastInsertRowid);
      hostHhLabelWasAutoNamed = true;
    }
  }

  const selectByRole = db.prepare(
    "SELECT id, household_id FROM guests WHERE couple_id = ? AND partner_role = ? LIMIT 1",
  );
  const selectByName = db.prepare(
    "SELECT id, household_id FROM guests WHERE couple_id = ? AND lower(trim(full_name)) = lower(trim(?)) AND partner_role IS NULL LIMIT 1",
  );
  const adoptAndMove = db.prepare(
    "UPDATE guests SET partner_role = ?, household_id = ?, updated_at = ? WHERE id = ?",
  );
  const moveOnly = db.prepare("UPDATE guests SET household_id = ?, updated_at = ? WHERE id = ?");
  const insertGuest = db.prepare(
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

  const cleanupIfEmpty = (hhId: number | null) => {
    if (hhId == null || hhId === hostHhId) return;
    const row = countMembers.get(hhId) as { n: number };
    if (row.n === 0) deleteHh.run(hhId);
  };

  let touched = 0;
  for (const t of targets) {
    const existing = selectByRole.get(coupleId, t.role) as
      | { id: number; household_id: number | null }
      | undefined;
    if (existing) {
      if (existing.household_id !== hostHhId) {
        const oldHhId = existing.household_id;
        moveOnly.run(hostHhId, ts, existing.id);
        cleanupIfEmpty(oldHhId);
        touched++;
      }
      continue;
    }
    const match = selectByName.get(coupleId, t.name) as
      | { id: number; household_id: number | null }
      | undefined;
    if (match) {
      const oldHhId = match.household_id;
      adoptAndMove.run(t.role, hostHhId, ts, match.id);
      cleanupIfEmpty(oldHhId);
      touched++;
      continue;
    }
    insertGuest.run(coupleId, t.name, t.groupTag, uniqueInviteCode(), ts, ts, hostHhId, t.role);
    touched++;
  }

  // (3) Sync the host household label to "{bride} & {groom}" when it was
  // auto-named (fresh insert OR leftover single-partner label from the
  // split-HH era). Skip if the user has hand-edited it to something else.
  if (hostHhLabelWasAutoNamed) {
    const current = db.prepare("SELECT label FROM households WHERE id = ?").get(hostHhId) as
      | { label: string }
      | undefined;
    if (current && current.label !== joinedLabel) {
      updateHhLabel.run(joinedLabel, ts, hostHhId);
    }
  }

  return touched;
}

/** Local copy of the household-code uniqueness probe — `households.ts`
 *  imports from this module (for `GuestRow` + the guest mapper), so calling
 *  back into `households.ts` for its own helper would close a circular
 *  import. The probe is small enough to live here. */
function uniqueHouseholdCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 32; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`Could not generate a unique household code for couple ${coupleId}`);
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

/** Couple-wide RSVP progress for the "% responded so far" line in couple
 *  notification emails. Denominator is every guest row for the couple (no
 *  supplier/kind filter) so the number matches what /app/guests shows.
 *  "Responded" = anyone off the pending pile (yes / no / maybe). */
export interface CoupleRsvpProgress {
  total: number;
  responded: number;
  /** responded / total, rounded to a whole percent. 0 when there are no guests. */
  pct: number;
}
export function getCoupleRsvpProgress(coupleId: number): CoupleRsvpProgress {
  const row = db
    .prepare(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN rsvp_status IN ('yes','no','maybe') THEN 1 ELSE 0 END) AS responded
         FROM guests
        WHERE couple_id = ?`,
    )
    .get(coupleId) as { total: number; responded: number | null };
  const total = row.total ?? 0;
  const responded = row.responded ?? 0;
  const pct = total > 0 ? Math.round((responded / total) * 100) : 0;
  return { total, responded, pct };
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
