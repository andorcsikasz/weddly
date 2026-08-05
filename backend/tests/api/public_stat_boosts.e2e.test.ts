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
//  - HIDING a counter is not the same as zeroing its offset. A hidden counter
//    leaves the server as `null` — withheld, never rendered as 0 — while its
//    offset waits untouched for the day it goes back on. The admin read still
//    carries both numbers, because that is the surface that has to stay honest.
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

/** A counter that should be published right now. Fails loudly rather than
 *  coercing, so a test can never quietly compare against a withheld null. */
function shown(value: number | null): number {
  if (value === null) throw new Error("counter is withheld, expected a number");
  return value;
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
    const realVendors = shown(before.data.vendors);
    const realListings = shown(before.data.listings);

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
      expect(shown(r.data[key])).toBeGreaterThanOrEqual(0);
    }
    expect(typeof r.data.ts).toBe("number");
  });

  test("a hidden counter leaves the server as null, and comes back unchanged", async () => {
    const token = await adminToken();
    const start = await req<PublicStats>("GET", "/api/public/stats");
    const realCouples = shown(start.data.couples);

    const hidden = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { couples: 120, hidden: { couples: true } },
      { token },
    );
    expect(hidden.status).toBe(200);
    // The admin table still answers "how big is Weddly" while the public
    // surface does not — both numbers stay on the row.
    expect(rowFor(hidden.data, "couples").hidden).toBe(true);
    expect(rowFor(hidden.data, "couples").real).toBe(realCouples);
    expect(rowFor(hidden.data, "couples").shown).toBe(realCouples + 120);

    // Withheld, never zeroed: a consumer that renders `0` for a missing
    // counter would be advertising an empty product.
    const pub = await req<PublicStats>("GET", "/api/public/stats");
    expect(pub.data.couples).toBeNull();
    expect(pub.data.rsvps).not.toBeNull();

    // Showing it again restores the offset that was waiting underneath.
    const back = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { hidden: { couples: false } },
      { token },
    );
    expect(rowFor(back.data, "couples").hidden).toBe(false);
    expect(rowFor(back.data, "couples").boost).toBe(120);
    const pubBack = await req<PublicStats>("GET", "/api/public/stats");
    expect(pubBack.data.couples).toBe(realCouples + 120);
  });

  test("a body silent about visibility leaves a hidden counter hidden", async () => {
    const token = await adminToken();
    await req("PATCH", "/api/admin/public-stats", { hidden: { rsvps: true } }, { token });

    // An offset edit that names no visibility must not put the counter back on
    // the public page — the same partial contract the offsets themselves have.
    const patched = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { couples: 5, rsvps: 7 },
      { token },
    );
    expect(rowFor(patched.data, "rsvps").hidden).toBe(true);
    expect(rowFor(patched.data, "rsvps").boost).toBe(7);
    expect(rowFor(patched.data, "couples").hidden).toBe(false);

    // ...and a visibility map about one counter leaves the others alone.
    const one = await req<AdminPublicStatsView>(
      "PATCH",
      "/api/admin/public-stats",
      { hidden: { vendors: true } },
      { token },
    );
    expect(rowFor(one.data, "rsvps").hidden).toBe(true);
    expect(rowFor(one.data, "vendors").hidden).toBe(true);
    expect(rowFor(one.data, "listings").hidden).toBe(false);

    const pub = await req<PublicStats>("GET", "/api/public/stats");
    expect(pub.data.rsvps).toBeNull();
    expect(pub.data.vendors).toBeNull();
    expect(pub.data.listings).not.toBeNull();
  });

  test("a malformed visibility map is refused, and nothing is written", async () => {
    const token = await adminToken();
    const notAMap = await req(
      "PATCH",
      "/api/admin/public-stats",
      { hidden: "everything" },
      { token },
    );
    expect(notAMap.status).toBe(400);
    const notABoolean = await req(
      "PATCH",
      "/api/admin/public-stats",
      { hidden: { couples: "yes" } },
      { token },
    );
    expect(notABoolean.status).toBe(400);
    const unknownCounter = await req(
      "PATCH",
      "/api/admin/public-stats",
      { hidden: { weddings: true } },
      { token },
    );
    expect(unknownCounter.status).toBe(400);

    const view = await req<AdminPublicStatsView>("GET", "/api/admin/public-stats", undefined, {
      token,
    });
    for (const row of view.data.items) expect(row.hidden).toBe(false);
  });
});
