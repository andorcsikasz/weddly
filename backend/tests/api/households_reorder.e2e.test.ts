// Drag-to-reorder for the /app/guests household list. The endpoint is
// `PATCH /api/households/reorder` with body `{ ordered_ids: number[] }`. It
// stamps each id's array position into `households.sort_index`, and
// `listHouseholdsByCouple` orders by it (host household pinned first, ties
// broken by created_at).
//
// This file covers:
//  - Happy path: the GET list comes back in the posted order (and persists).
//  - Default stability: never calling reorder preserves creation order.
//  - Cross-couple isolation: foreign ids are ignored (couple A can't shuffle
//    couple B's households), and the response 200s with A's own order.
//  - Validation: a non-array / non-numeric body 400s.
//  - Audit-log entry: a reorder writes a `household.reorder` row.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

interface HouseholdLite {
  id: number;
  label: string;
  is_couple_household: boolean;
}

async function listHouseholds(token: string): Promise<HouseholdLite[]> {
  const r = await req<{ households: HouseholdLite[] }>("GET", "/api/households", undefined, {
    token,
  });
  expect(r.status).toBe(200);
  return r.data.households;
}

async function createHousehold(token: string, label: string): Promise<number> {
  const r = await req<{ household: { id: number } }>(
    "POST",
    "/api/households",
    { label },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.household.id;
}

/** Second couple so cross-tenant cases have a foreign household to point at. */
async function bootstrapSecondCouple(email: string): Promise<{ token: string }> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Other",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const ob = await req(
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
  return { token: reg.data.token };
}

describe("households: PATCH /reorder", () => {
  test("the GET list returns in the posted order", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("reorder-happy@weddly.test");
    const a = await createHousehold(token, "Alpha");
    const b = await createHousehold(token, "Bravo");
    const c = await createHousehold(token, "Charlie");

    // Default (creation) order before any reorder.
    const before = (await listHouseholds(token)).filter((h) => !h.is_couple_household);
    expect(before.map((h) => h.id)).toEqual([a, b, c]);

    const r = await req<{ households: HouseholdLite[] }>(
      "PATCH",
      "/api/households/reorder",
      { ordered_ids: [c, a, b] },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.households.filter((h) => !h.is_couple_household).map((h) => h.id)).toEqual([
      c,
      a,
      b,
    ]);

    // Re-fetch confirms the order is persisted, not just echoed.
    const after = (await listHouseholds(token)).filter((h) => !h.is_couple_household);
    expect(after.map((h) => h.id)).toEqual([c, a, b]);
  });

  test("a never-reordered workspace keeps creation order (default stability)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("reorder-default@weddly.test");
    const a = await createHousehold(token, "Alpha");
    const b = await createHousehold(token, "Bravo");
    const c = await createHousehold(token, "Charlie");
    // No reorder call: sort_index defaults to 0 for all, so the tie-break is
    // created_at — the historic order.
    const list = (await listHouseholds(token)).filter((h) => !h.is_couple_household);
    expect(list.map((h) => h.id)).toEqual([a, b, c]);
  });

  test("foreign ids are ignored — couple A can't reshuffle couple B", async () => {
    wipeAll();
    const a = await bootstrapCouple("reorder-A@weddly.test");
    const b = await bootstrapSecondCouple("reorder-B@weddly.test");
    const a1 = await createHousehold(a.token, "A-One");
    const a2 = await createHousehold(a.token, "A-Two");
    const bForeign = await createHousehold(b.token, "B-Foreign");

    // A posts B's id mixed in — it must be dropped, A's own order applied.
    const r = await req<{ households: HouseholdLite[] }>(
      "PATCH",
      "/api/households/reorder",
      { ordered_ids: [a2, bForeign, a1] },
      { token: a.token },
    );
    expect(r.status).toBe(200);
    const aOrder = r.data.households.filter((h) => !h.is_couple_household).map((h) => h.id);
    expect(aOrder).toEqual([a2, a1]);
    expect(aOrder).not.toContain(bForeign);

    // B's own order is untouched.
    const bList = (await listHouseholds(b.token)).filter((h) => !h.is_couple_household);
    expect(bList.map((h) => h.id)).toEqual([bForeign]);
  });

  test("a non-array body 400s", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("reorder-bad-array@weddly.test");
    const r = await req("PATCH", "/api/households/reorder", { ordered_ids: "nope" }, { token });
    expect(r.status).toBe(400);
  });

  test("a non-numeric entry 400s", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("reorder-bad-num@weddly.test");
    const id = await createHousehold(token, "Alpha");
    const r = await req("PATCH", "/api/households/reorder", { ordered_ids: [id, "x"] }, { token });
    expect(r.status).toBe(400);
  });

  test("reorder writes a household.reorder audit-log entry", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("reorder-audit@weddly.test");
    const a = await createHousehold(token, "Alpha");
    const b = await createHousehold(token, "Bravo");
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.reorder'",
      )
      .get(coupleId) as { n: number };
    const r = await req("PATCH", "/api/households/reorder", { ordered_ids: [b, a] }, { token });
    expect(r.status).toBe(200);
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.reorder'",
      )
      .get(coupleId) as { n: number };
    expect(after.n).toBe(before.n + 1);
  });
});
