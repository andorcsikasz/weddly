// Phase 3 of the Vendégoldal merger: per-household share UI on
// /app/guest-page (the new GuestPageEditorPage) lets the couple rotate a
// household's code straight from the share section. The endpoint is
// `PATCH /api/households/:id/rotate-code` — same effect as the legacy
// POST /regenerate-code, but per-couple rate-limited so a misbehaving
// script can't grind through all of a couple's codes in a tight loop.
//
// This file covers:
//  - Happy path: the new code is 8 Crockford base32 chars and resolves on
//    the public /api/rsvp/lookup endpoint.
//  - Invalidation: the OLD code stops resolving the moment the rotate
//    succeeds — the UNIQUE(couple_id, code) constraint guarantees it.
//  - Cross-couple isolation: couple A cannot rotate couple B's household.
//  - Rate-limit: the (capacity 10, refill 1/min) bucket is per-couple, so
//    rapid-fire calls eventually 429 even from different IPs.
//  - Audit-log entry: rotating writes a `household.code_rotate` row.

import "../setup";

import { describe, expect, test } from "bun:test";
import { HOUSEHOLD_CODE_ALPHABET, HOUSEHOLD_CODE_LENGTH } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

/** Whole-string regex for the post-bump Crockford alphabet. Built from the
 *  shared constant so the test stays in lockstep with the generator. */
const CROCKFORD_RE = new RegExp(`^[${HOUSEHOLD_CODE_ALPHABET}]{${HOUSEHOLD_CODE_LENGTH}}$`);

/** Bootstrap a second couple alongside the default one so cross-couple
 *  isolation cases have something to point at. Returns the token + the
 *  couple slug (needed for the public lookup path). */
async function bootstrapSecondCouple(
  email: string,
): Promise<{ token: string; coupleId: number; slug: string }> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Other",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const ob = await req<{ couple: { id: number; slug: string | null } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Other Couple",
      wedding_date: "2027-04-04",
      target_guest_count: 50,
      budget_ceiling_huf: 3_000_000,
      style_tags: [],
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return {
    token: reg.data.token,
    coupleId: ob.data.couple.id,
    slug: ob.data.couple.slug ?? "",
  };
}

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

describe("households: PATCH /:id/rotate-code", () => {
  test("rotate returns an 8-char Crockford code distinct from the old one", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rotate-happy@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    expect(hh.status).toBe(201);
    const oldCode = hh.data.household.code;
    // The post-bump generator already produces a Crockford code on create.
    expect(oldCode).toMatch(CROCKFORD_RE);

    const r = await req<{ household: { id: number; code: string } }>(
      "PATCH",
      `/api/households/${hh.data.household.id}/rotate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.household.id).toBe(hh.data.household.id);
    expect(r.data.household.code).toMatch(CROCKFORD_RE);
    expect(r.data.household.code).not.toBe(oldCode);
  });

  test("after rotate the OLD code stops resolving on /api/rsvp/lookup", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rotate-invalid@weddly.test");
    const slug = await getSlug(token);
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    const oldCode = hh.data.household.code;

    // Sanity: the freshly-created code resolves on the public lookup.
    const before = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${oldCode}`);
    expect(before.status).toBe(200);

    const r = await req<{ household: { code: string } }>(
      "PATCH",
      `/api/households/${hh.data.household.id}/rotate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    const newCode = r.data.household.code;

    // OLD code 404s — the UNIQUE constraint guarantees the row only carries
    // the new code.
    const oldAfter = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${oldCode}`);
    expect(oldAfter.status).toBe(404);

    // NEW code resolves.
    const newAfter = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${newCode}`);
    expect(newAfter.status).toBe(200);
  });

  test("/api/rsvp/lookup with a lowercased new code resolves (case-insensitive)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rotate-case@weddly.test");
    const slug = await getSlug(token);
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    const r = await req<{ household: { code: string } }>(
      "PATCH",
      `/api/households/${hh.data.household.id}/rotate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    const lower = r.data.household.code.toLowerCase();
    // Crockford codes mix digits + letters, so we need at least one letter
    // in the new code for this to actually exercise case-insensitivity.
    // Across an 8-char draw from a 32-char alphabet (22 letters / 32 chars),
    // the probability of zero letters is (10/32)^8 ≈ 9e-5, so this assertion
    // is effectively guaranteed; if it ever flakes, that's a regression in
    // the alphabet, not in this test.
    expect(/[A-Z]/.test(r.data.household.code)).toBe(true);
    const resolved = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${lower}`);
    expect(resolved.status).toBe(200);
  });

  test("couple A cannot rotate couple B's household (returns 404)", async () => {
    wipeAll();
    const a = await bootstrapCouple("rotate-A@weddly.test");
    const b = await bootstrapSecondCouple("rotate-B@weddly.test");
    const bHh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "B-Family" },
      { token: b.token },
    );
    expect(bHh.status).toBe(201);
    const r = await req(
      "PATCH",
      `/api/households/${bHh.data.household.id}/rotate-code`,
      {},
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("rotate writes a household.code_rotate audit-log entry", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rotate-audit@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "Audit" },
      { token },
    );
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.code_rotate'",
      )
      .get(coupleId) as { n: number };
    const r = await req(
      "PATCH",
      `/api/households/${hh.data.household.id}/rotate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.code_rotate'",
      )
      .get(coupleId) as { n: number };
    expect(after.n).toBe(before.n + 1);
  });

  test("per-couple rate-limit eventually 429s a burst of rotate calls", async () => {
    wipeAll();
    // The rotate bucket is { capacity: 10, refillRate: 1/60 } per couple. We
    // create a single household and hammer the rotate endpoint until the
    // bucket empties. 11+ calls must surface a 429.
    const { token } = await bootstrapCouple("rotate-rl@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "RL" },
      { token },
    );
    let saw429 = false;
    for (let i = 0; i < 15; i++) {
      const r = await req(
        "PATCH",
        `/api/households/${hh.data.household.id}/rotate-code`,
        {},
        { token },
      );
      if (r.status === 429) {
        saw429 = true;
        break;
      }
      expect(r.status).toBe(200);
    }
    expect(saw429).toBe(true);
  });
});

// ─── household-portal: newly-generated codes match the Crockford alphabet ───
//
// This is the assertion the spec calls out separately. It lives in this file
// (not under guests_rsvp.e2e) because it's tightly coupled to the Phase 3
// rotate flow and only really makes sense alongside the rotate cases.

describe("household codes: post-bump generation shape", () => {
  test("POST /api/households produces an 8-char Crockford code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-shape-create@weddly.test");
    const r = await req<{ household: { code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.household.code).toMatch(CROCKFORD_RE);
    expect(r.data.household.code.length).toBe(8);
  });

  test("auto-spawned household-of-one via POST /api/guests also gets a Crockford code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-shape-auto@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna Solo" }, { token });
    const list = await req<{ households: { code: string }[] }>(
      "GET",
      "/api/households",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    expect(list.data.households.length).toBeGreaterThanOrEqual(1);
    for (const hh of list.data.households) {
      expect(hh.code).toMatch(CROCKFORD_RE);
    }
  });

  test("POST /api/households/:id/regenerate-code also returns a Crockford code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-shape-regen@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    const old = hh.data.household.code;
    const r = await req<{ household: { code: string } }>(
      "POST",
      `/api/households/${hh.data.household.id}/regenerate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.household.code).toMatch(CROCKFORD_RE);
    expect(r.data.household.code).not.toBe(old);
  });
});
