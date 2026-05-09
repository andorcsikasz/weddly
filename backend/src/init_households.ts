// One-shot, idempotent backfill that retro-fits the household model onto any
// rows that pre-date the schema bump:
//
//   1. Couples missing `slug` get one derived from bride/groom names.
//   2. Guests missing `household_id` get a fresh household-of-one each.
//   3. Existing `plus_one_name` strings get materialized as a sibling guest
//      record in the same household, then nulled out so we don't double-count
//      them on the next boot.
//
// Safe to run on every server start — each step queries for the missing-state
// before touching anything.

import { db, now } from "./db";
import { deriveSlugBase, uniqueCoupleSlug } from "./domain/slug";
import { generateInviteCode, generateHouseholdCode } from "./domain/invite_codes";

interface CoupleStub {
  id: number;
  bride_name: string;
  groom_name: string;
  display_name: string;
}

interface GuestStub {
  id: number;
  couple_id: number;
  full_name: string;
  plus_one_name: string | null;
  plus_one_meal: string | null;
}

function backfillCoupleSlugs() {
  const rows = db
    .prepare(
      "SELECT id, bride_name, groom_name, display_name FROM couples WHERE slug IS NULL OR slug = ''",
    )
    .all() as CoupleStub[];
  if (rows.length === 0) return;
  for (const c of rows) {
    const slug = uniqueCoupleSlug(deriveSlugBase(c.bride_name, c.groom_name, c.display_name), c.id);
    db.prepare("UPDATE couples SET slug = ? WHERE id = ?").run(slug, c.id);
  }
  console.log(`[init_households] backfilled slug on ${rows.length} couple(s)`);
}

function freshInviteCode(): string {
  const stmt = db.prepare("SELECT 1 FROM guests WHERE invite_code = ?");
  for (let i = 0; i < 24; i++) {
    const code = generateInviteCode();
    if (!stmt.get(code)) return code;
  }
  throw new Error("init_households: could not allocate a unique invite_code");
}

function freshHouseholdCode(coupleId: number): string {
  const stmt = db.prepare("SELECT 1 FROM households WHERE couple_id = ? AND code = ?");
  for (let i = 0; i < 32; i++) {
    const code = generateHouseholdCode();
    if (!stmt.get(coupleId, code)) return code;
  }
  throw new Error(`init_households: could not allocate a unique household code for ${coupleId}`);
}

function backfillHouseholdsForGuests() {
  const guests = db
    .prepare(
      "SELECT id, couple_id, full_name, plus_one_name, plus_one_meal FROM guests WHERE household_id IS NULL",
    )
    .all() as GuestStub[];
  if (guests.length === 0) return;

  const ts = now();
  const insertHh = db.prepare(
    "INSERT INTO households (couple_id, code, label, notes, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
  );
  const setGuestHh = db.prepare("UPDATE guests SET household_id = ? WHERE id = ?");
  const insertSibling = db.prepare(
    `INSERT INTO guests
       (couple_id, full_name, email, phone, group_tag, invite_code, rsvp_status,
        meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
        song_request, notes, rsvp_responded_at, created_at, updated_at, household_id)
     VALUES (?, ?, NULL, NULL, 'other', ?, 'pending', ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, ?)`,
  );
  const clearPlusOne = db.prepare(
    "UPDATE guests SET plus_one_name = NULL, plus_one_meal = NULL, updated_at = ? WHERE id = ?",
  );

  let createdHouseholds = 0;
  let materializedSiblings = 0;
  const tx = db.transaction(() => {
    for (const g of guests) {
      const plusName = g.plus_one_name?.trim() ?? "";
      const code = freshHouseholdCode(g.couple_id);
      const label = plusName ? `${g.full_name} + ${plusName}` : g.full_name;
      const result = insertHh.run(g.couple_id, code, label, ts, ts);
      const hhId = Number(result.lastInsertRowid);
      setGuestHh.run(hhId, g.id);
      createdHouseholds++;

      if (plusName) {
        insertSibling.run(g.couple_id, plusName, freshInviteCode(), g.plus_one_meal, ts, ts, hhId);
        clearPlusOne.run(ts, g.id);
        materializedSiblings++;
      }
    }
  });
  tx();
  console.log(
    `[init_households] created ${createdHouseholds} household(s); materialized ${materializedSiblings} plus-one sibling(s)`,
  );
}

export function runHouseholdBackfill() {
  backfillCoupleSlugs();
  backfillHouseholdsForGuests();
}

runHouseholdBackfill();
