// A workspace seeded from another one mints the SAME credentials as a fresh
// one. `seedCoupleFromCouple` used to carry hand-written "inline copies" of
// both generators, and both had drifted away from the canonical helpers in
// exactly the direction that costs guest privacy:
//
//   * the household code came back as the LEGACY 4-digit form (9,000 values)
//     that generateHouseholdCode was bumped away from in May 2026 precisely
//     because it is enumerable, and
//   * both codes were drawn from `Math.random()`, which is not a CSPRNG. Its
//     internal state is recoverable from a handful of observed outputs, so a
//     guest holding one invite could predict the others in the same workspace.
//
// The household code is the credential on /w/:slug/:code, which serves that
// household's names, RSVP answers, meal choices, dietary notes and the day's
// schedule. So this is a data-exposure guard, not a cosmetic one.
//
// Pairs with domain/couples.ts (seedCoupleFromCouple) and
// domain/invite_codes.ts (generateHouseholdCode / generateInviteCode).

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  HOUSEHOLD_CODE_ALPHABET,
  HOUSEHOLD_CODE_LENGTH,
  HOUSEHOLD_CODE_LENGTH_LEGACY,
  INVITE_CODE_LENGTH,
} from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const TBD_GOAL = {
  kind: "tbd",
  exact_date: null,
  target_year: null,
  target_month: null,
  target_season: null,
} as const;

describe("a seeded workspace mints the same credentials as a fresh one", () => {
  test("seeded households and guests get canonical, CSPRNG-backed codes", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("seed-codes@weddly.test");

    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Kovács family" },
      { token },
    );
    expect(hh.status).toBe(201);
    const hhId = hh.data.household.id;

    const guestIds: number[] = [];
    for (const name of ["Aunt Klári", "Uncle Béla", "Cousin Dóra"]) {
      const g = await req<{ guest: { id: number } }>(
        "POST",
        "/api/guests",
        { full_name: name, rsvp_status: "yes", household_id: hhId },
        { token },
      );
      expect(g.status).toBe(201);
      guestIds.push(g.data.guest.id);
    }

    const create = await req<{
      couple: { id: number };
      seeded: { households_copied: number; guests_copied: number };
    }>(
      "POST",
      "/api/couples",
      {
        event_name: "Welcome dinner",
        wedding_date_goal: TBD_GOAL,
        seed_from_couple_id: alphaId,
        seed_guest_ids: guestIds,
      },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.seeded.guests_copied).toBe(3);
    const bravoId = create.data.couple.id;
    expect(bravoId).not.toBe(alphaId);

    // The household credential: full-length Crockford base32, never the
    // 4-digit legacy shape a brute-forcer can walk in an afternoon.
    const seededHouseholds = db
      .prepare("SELECT code FROM households WHERE couple_id = ?")
      .all(bravoId) as Array<{ code: string }>;
    expect(seededHouseholds.length).toBeGreaterThan(0);
    for (const { code } of seededHouseholds) {
      expect(code).toHaveLength(HOUSEHOLD_CODE_LENGTH);
      expect(code).not.toHaveLength(HOUSEHOLD_CODE_LENGTH_LEGACY);
      expect(/^\d+$/.test(code)).toBe(false);
      for (const ch of code) expect(HOUSEHOLD_CODE_ALPHABET).toContain(ch);
    }

    // The guest credential: canonical length, and drawn from the canonical
    // alphabet. The old inline copy emitted 8 chars from an alphabet that had
    // kept the `L` the real one drops, so a code read off a printed invitation
    // could be mistaken for a 1.
    const seededGuests = db
      .prepare("SELECT invite_code FROM guests WHERE couple_id = ?")
      .all(bravoId) as Array<{ invite_code: string }>;
    expect(seededGuests.length).toBeGreaterThan(0);
    for (const { invite_code } of seededGuests) {
      expect(invite_code).toHaveLength(INVITE_CODE_LENGTH);
      expect(invite_code).not.toContain("L");
      expect(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(invite_code)).toBe(true);
    }

    // Every credential in the new workspace is distinct from every other, and
    // none was carried over from the source workspace.
    const alphaCodes = new Set(
      (
        db.prepare("SELECT invite_code FROM guests WHERE couple_id = ?").all(alphaId) as Array<{
          invite_code: string;
        }>
      ).map((r) => r.invite_code),
    );
    const bravoCodes = seededGuests.map((g) => g.invite_code);
    expect(new Set(bravoCodes).size).toBe(bravoCodes.length);
    for (const c of bravoCodes) expect(alphaCodes.has(c)).toBe(false);
  });
});
