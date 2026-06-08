// The household check-in code is an 8-char Crockford base32 value (letters +
// digits), NOT the legacy 4-digit numeric form. This guards the regression
// where the /rsvp check-in input capped at 4 chars and stripped letters — a
// guest with a real code like "A3K9TM2P" could never check in.
//
// Pairs with frontend/src/pages/RsvpCheckinPage.tsx (input accepts the full
// 8-char alphanumeric code) and domain/invite_codes.ts (generateHouseholdCode).

import "../setup";

import { describe, expect, test } from "bun:test";
import { HOUSEHOLD_CODE_ALPHABET, HOUSEHOLD_CODE_LENGTH } from "@shared/types";
import { db } from "../../src/db";
import { generateHouseholdCode } from "../../src/domain/invite_codes";
import { bootstrapCouple, req, wipeAll } from "../helpers";

describe("household check-in code — 8-char alphanumeric (not 4 digits)", () => {
  test("generateHouseholdCode emits HOUSEHOLD_CODE_LENGTH alphanumeric chars", () => {
    expect(HOUSEHOLD_CODE_LENGTH).toBe(8);
    for (let i = 0; i < 50; i++) {
      const code = generateHouseholdCode();
      expect(code).toHaveLength(HOUSEHOLD_CODE_LENGTH);
      for (const ch of code) expect(HOUSEHOLD_CODE_ALPHABET).toContain(ch);
    }
  });

  test("created household carries an 8-char code; check-in needs the full code", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("hh-checkin-code@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Smith family" },
      { token },
    );
    expect(hh.status).toBe(201);
    const code = hh.data.household.code;
    expect(code).toHaveLength(HOUSEHOLD_CODE_LENGTH);

    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as { slug: string }
    ).slug;
    const lookup = (c: string) =>
      req(
        "GET",
        `/api/rsvp/lookup?couple=${encodeURIComponent(slug)}&code=${encodeURIComponent(c)}`,
      );

    // Full 8-char code resolves.
    expect((await lookup(code)).status).toBe(200);
    // Case-insensitive: lowercase resolves too (codes normalize to uppercase),
    // which is why the input uppercases as you type.
    expect((await lookup(code.toLowerCase())).status).toBe(200);
    // A 4-char prefix — exactly what the old maxLength=4 / digits-only input
    // would have submitted — must NOT resolve.
    expect((await lookup(code.slice(0, 4))).status).not.toBe(200);
  });
});
