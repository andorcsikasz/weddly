// One-shot, idempotent backfill that retro-fits the household model onto any
// rows that pre-date the schema bump:
//
//   1. Couples missing `slug` get one derived from bride/groom names.
//   2. Guests missing `household_id` get a fresh household-of-one each.
//   3. Existing `plus_one_name` strings get materialized as a sibling guest
//      record in the same household, then nulled out so we don't double-count
//      them on the next boot.
//   4. Couples that finished onboarding before the bride+groom seed shipped
//      get their two host guest rows materialized so they appear as the
//      first household on /app/guests — see backfillCoupleHostGuests().
//
// Safe to run on every server start — each step queries for the missing-state
// before touching anything.

import { db, now } from "./db";
import { ensurePartnerGuests } from "./domain/guests";
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

/** Step 4: surface the bride + groom as guests inside their own household.
 *
 *  Couples onboarded before commit e277f67 (bride+groom-as-guests seed) have
 *  the auto-household but no host guest rows, so /app/guests opens with an
 *  empty card and the catering / seating totals miss two heads. This pass
 *  fills that gap.
 *
 *  Two sub-steps:
 *    (a) If `bride_name` / `groom_name` are empty but `display_name` cleanly
 *        splits on " & ", populate the structured columns from the legacy
 *        display name. Lets the existing onboarding seed logic work on rows
 *        that came through the display_name-only path.
 *    (b) For every couple with non-empty bride/groom names: pick the first
 *        household by created_at (or create one), then insert a guest row
 *        for each partner that doesn't already exist. Idempotent — re-runs
 *        skip partners that already match an existing guest's full_name.
 */
function backfillCoupleHostGuests() {
  // Sub-step (a): split display_name into bride/groom when the structured
  // columns are empty and the display name looks like "X & Y".
  const splitCandidates = db
    .prepare(
      `SELECT id, display_name FROM couples
        WHERE (bride_name IS NULL OR bride_name = '')
          AND (groom_name IS NULL OR groom_name = '')
          AND display_name LIKE '% & %'`,
    )
    .all() as { id: number; display_name: string }[];
  let nameSplits = 0;
  for (const c of splitCandidates) {
    const [left, right] = c.display_name.split(" & ");
    const bride = left?.trim() ?? "";
    const groom = right?.trim() ?? "";
    if (!bride || !groom) continue;
    db.prepare("UPDATE couples SET bride_name = ?, groom_name = ? WHERE id = ?").run(
      bride,
      groom,
      c.id,
    );
    nameSplits++;
  }

  // Sub-step (b): materialize the host guest rows.
  const couples = db
    .prepare(
      `SELECT id, bride_name, groom_name, display_name FROM couples
        WHERE bride_name != '' AND groom_name != ''`,
    )
    .all() as CoupleStub[];
  if (couples.length === 0) {
    if (nameSplits > 0) {
      console.log(
        `[init_households] split display_name into bride/groom for ${nameSplits} couple(s)`,
      );
    }
    return;
  }

  let seededGuests = 0;
  // Run each couple's host-seed in its own transaction so a hiccup on one
  // couple's invite-code collision doesn't roll back the whole batch.
  // The helper finds-or-creates the shared bride+groom household, force-
  // relocates any partner_role guests already stamped on legacy rows into
  // it, and cleans up any now-empty single-partner households left over
  // from the brief "split host households" era. So no pre-step needed.
  for (const c of couples) {
    seededGuests += ensurePartnerGuests({
      coupleId: c.id,
      brideName: c.bride_name,
      groomName: c.groom_name,
    });
  }

  if (nameSplits > 0 || seededGuests > 0) {
    console.log(
      `[init_households] host backfill — name splits: ${nameSplits}, seeded host guests: ${seededGuests}`,
    );
  }
}

export function runHouseholdBackfill() {
  backfillCoupleSlugs();
  backfillHouseholdsForGuests();
  backfillCoupleHostGuests();
}

runHouseholdBackfill();
