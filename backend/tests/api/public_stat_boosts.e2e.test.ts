// The admin display offset on the public landing counters.
//
//   GET   /api/admin/public-stats
//   PATCH /api/admin/public-stats
//   GET   /api/public/stats  (the surface the offset actually moves)
//
// The invariants under test:
//  - The offset is ADDITIVE and stored on its own. Nothing overwrites a
//    measured count, so zeroing every offset restores the counted numbers
//    exactly. That is the property that keeps the admin table trustworthy.
//  - The admin read always carries `real` beside `shown`. Once the landing
//    stops answering "how big is Weddly", this route is the only one that
//    still does.
//  - The PATCH is PARTIAL: a body about one counter leaves the other three
//    alone, so a form can never blank what it wasn't editing.
//  - A negative offset is a 400. Subtracting from a measured count would hide
//    real signups from our own dashboard, which is a different thing from
//    padding a marketing page.
//  - A write busts the 60s public cache. Without that an operator saves a
//    number, reloads the landing, sees the old one and concludes the save
//    failed.
//  - Only an admin can read or write it.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminPublicStatsView, PublicStats } from "@shared/public_stats";
import { db } from "../../src/db";
import { registerAndVerify, req } from "../helpers";

const ADMIN_EMAIL = "admin@test.test";
const ADMIN_PASSWORD = "supersafe123";

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  return login.data.token;
}

function rowFor(view: AdminPublicStatsView, key: string) {
  const row = view.items.find((item) => item.key === key);
  if (!row) throw new Error(`no row for ${key}`);
  return row;
}

describe("public stat boosts", () => {
  beforeEach(() => {
    // Start every test from "no offset set anywhere", without wiping users —
    // re-registering the admin costs an argon2 hash per test.
    db.prepare("DELETE FROM public_stat_boosts").run();
  });

  test("the admin read shows the measured number beside the shown one", async () => {
    const token = await adminToken();
    const view = await req<AdminPublicStatsView>("GET", "/api/admin/public-stats", undefined, {
      token,
    });
    expect(view.status).toBe(200);
    expect(view.data.items.map((i) => i.key)).toEqual(["couples", "rsvps", "vendors", "listings"]);
    for (const row of view.data.items) {
      expect(row.boost).toBe(0);
      expect(row.shown).toBe(row.real);
      expect(row.updated_at).toBeNull();
    }
  });

  test("an offset is added to the public payload and taken back off when cleared", async () => {
    const token = await adminToken();
    const before = await req<AdminPublicStatsView>("GET", "/api/admin/public-stats", undefined, {
      token,
    });
    const realCouples = rowFor(before.data, "couples").real;
    const realRsvps = rowFor(before.data, "rsvps").real;

    const patched = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { couples: 175, rsvps: 431 },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(rowFor(patched.data, "couples").shown).toBe(realCouples + 175);
    expect(rowFor(patched.data, "rsvps").shown).toBe(realRsvps + 431);
    // The measured half is untouched — that is what makes the reset exact.
    expect(rowFor(patched.data, "couples").real).toBe(realCouples);

    // The public payload is the boosted number, immediately: the write busts
    // the 60s cache rather than making the operator wait it out.
    const pub = await req<PublicStats>("GET", "/api/public/stats");
    expect(pub.status).toBe(200);
    expect(pub.data.couples).toBe(realCouples + 175);
    expect(pub.data.rsvps).toBe(realRsvps + 431);

    const cleared = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { couples: 0, rsvps: 0 },
      { token },
    );
    expect(rowFor(cleared.data, "couples").shown).toBe(realCouples);
    const pubAfter = await req<PublicStats>("GET", "/api/public/stats");
    expect(pubAfter.data.couples).toBe(realCouples);
    expect(pubAfter.data.rsvps).toBe(realRsvps);
  });

  test("a body about one counter leaves the other three alone", async () => {
    const token = await adminToken();
    await req("PATCH", "/api/admin/public-stats", { couples: 40, vendors: 90 }, { token });
    const only = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { rsvps: 12 },
      { token },
    );
    expect(only.status).toBe(200);
    expect(rowFor(only.data, "couples").boost).toBe(40);
    expect(rowFor(only.data, "vendors").boost).toBe(90);
    expect(rowFor(only.data, "rsvps").boost).toBe(12);
    expect(rowFor(only.data, "listings").boost).toBe(0);
  });

  test("the vendor and listing counters ride the same offset", async () => {
    const token = await adminToken();
    const before = await req<PublicStats>("GET", "/api/public/stats");
    const realVendors = before.data.vendors;
    const realListings = before.data.listings;

    await req("PATCH", "/api/admin/public-stats", { vendors: 300, listings: 25 }, { token });
    const pub = await req<PublicStats>("GET", "/api/public/stats");
    expect(pub.data.vendors).toBe(realVendors + 300);
    expect(pub.data.listings).toBe(realListings + 25);
  });

  test("a negative or absurd offset is refused, and nothing is written", async () => {
    const token = await adminToken();
    const negative = await req("PATCH", "/api/admin/public-stats", { couples: -5 }, { token });
    expect(negative.status).toBe(400);
    const huge = await req("PATCH", "/api/admin/public-stats", { couples: 9_999_999 }, { token });
    expect(huge.status).toBe(400);
    const notANumber = await req("PATCH", "/api/admin/public-stats", { couples: "40" }, { token });
    expect(notANumber.status).toBe(400);
    const empty = await req("PATCH", "/api/admin/public-stats", {}, { token });
    expect(empty.status).toBe(400);

    const view = await req<AdminPublicStatsView>("GET", "/api/admin/public-stats", undefined, {
      token,
    });
    expect(rowFor(view.data, "couples").boost).toBe(0);
  });

  test("a non-admin can neither read nor write the offsets", async () => {
    const outsider = await registerAndVerify({
      email: "not-admin-stats@example.com",
      password: "supersafe123",
      full_name: "Kata Kis",
    });
    const token = outsider.data.token;
    const read = await req("GET", "/api/admin/public-stats", undefined, { token });
    expect(read.status).toBe(403);
    const write = await req("PATCH", "/api/admin/public-stats", { couples: 500 }, { token });
    expect(write.status).toBe(403);
    const anon = await req("GET", "/api/admin/public-stats");
    expect(anon.status).toBe(401);
  });

  test("the public counters payload carries all four numbers", async () => {
    const r = await req<PublicStats>("GET", "/api/public/stats");
    expect(r.status).toBe(200);
    for (const key of ["couples", "rsvps", "vendors", "listings"] as const) {
      expect(typeof r.data[key]).toBe("number");
      expect(r.data[key]).toBeGreaterThanOrEqual(0);
    }
    expect(typeof r.data.ts).toBe("number");
  });
});
