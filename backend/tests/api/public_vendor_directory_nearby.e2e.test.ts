// The public directory's "thin town" rescue: `GET /api/public/vendors` with a
// category AND a city filter that comes back with almost nothing widens to
// the same category within an hour's drive, distance-stamped. Same idea as
// the showcase teaser's nearby fallback (public_vendor_showcase.e2e.test.ts's
// "nearby fallback" suite), scoped to one active category instead of every
// category in town; see the NEARBY_TRIGGER comment in routes/suppliers.ts.
//
// Unlike the showcase teaser, `assembleDirectoryBase` pulls curated rows from
// the static in-memory DIRECTORY array (matched by id), never from ad-hoc
// rows in the `listings` table, so wiping the table doesn't touch them.
// These fixtures ride the CLAIMED path instead (a real vendor_account_id,
// read straight off `listings`), and every test uses fictional city names
// that can't collide with a real curated/claimed row already seeded in the
// directory, while still carrying the real coordinates of Győr /
// Mosonmagyaróvár / Pápa / Budapest so the distance maths stays realistic.

import "../setup";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PublicDirectoryPage } from "@shared/suppliers";
import { db, now } from "../../src/db";
import { req, wipeAll } from "../helpers";

let seq = 0;
let ownerAccountId: number | null = null;
function vendorAccountId(): number {
  if (ownerAccountId !== null) return ownerAccountId;
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
         VALUES ('directory-nearby-owner@weddly.test', 'x', 'Owner', 'active', 'vendor', 1, ?, ?)`,
      )
      .run(now(), now()).lastInsertRowid,
  );
  ownerAccountId = Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, contact_email, country, created_at, updated_at)
         VALUES (?, 'Directory Nearby Owner', 'directory-nearby-owner@weddly.test', 'HU', ?, ?)`,
      )
      .run(userId, now(), now()).lastInsertRowid,
  );
  return ownerAccountId;
}

function insertListing(opts: {
  id?: string;
  category: string;
  name: string;
  city: string;
  hero?: string | null;
  status?: string;
}): string {
  const id = opts.id ?? `dn${++seq}`;
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, 'claimed', ?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    vendorAccountId(),
    opts.category,
    opts.name,
    opts.city,
    opts.status ?? "active",
    opts.hero === undefined ? "https://img.example/x.jpg" : opts.hero,
    now(),
    now(),
  );
  return id;
}

// Fictional city names (so nothing here can collide with a real curated row
// already seeded in the directory) carrying the real coordinates of four
// Hungarian towns, so the radius/distance maths still runs against real
// geography. Distances from the anchor: NEAR ~35 km, MID ~42 km (both inside
// the 70 km radius), FAR ~106 km (outside it), same figures the showcase
// teaser's nearby-fallback suite pins.
const ANCHOR_CITY = "Nearbytest Anchor";
const NEAR_CITY = "Nearbytest Near";
const MID_CITY = "Nearbytest Mid";
const FAR_CITY = "Nearbytest Far";
const ANCHOR_AT = { lat: 47.6875, lng: 17.6504 }; // Győr
const NEAR_AT = { lat: 47.8676, lng: 17.2716 }; // Mosonmagyaróvár, ~35 km
const MID_AT = { lat: 47.3297, lng: 17.4678 }; // Pápa, ~42 km
const FAR_AT = { lat: 47.4979, lng: 19.0402 }; // Budapest, ~106 km

function insertPlaced(opts: {
  id?: string;
  category: string;
  name: string;
  city: string;
  at: { lat: number; lng: number };
}): string {
  const id = insertListing(opts);
  db.prepare("UPDATE listings SET lat = ?, lng = ? WHERE id = ?").run(opts.at.lat, opts.at.lng, id);
  return id;
}

function getDirectory(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return req<PublicDirectoryPage>("GET", `/api/public/vendors?${qs}`);
}

beforeEach(() => {
  wipeAll();
  // wipeAll drops users (and cascades vendor_accounts), so the cached owner id
  // from a previous test no longer resolves, so mint a fresh one on next use.
  ownerAccountId = null;
  seq = 0;
});

afterAll(() => {
  // Claimed listings ride on the vendor account this suite mints; clean up
  // its rows so no fictional "Nearbytest" city leaks into later suites in
  // Bun's shared backend test process (wipeAll() already handles this per
  // test, this is only for whatever the last test left behind).
  db.exec("DELETE FROM listings WHERE id LIKE 'dn%'");
});

describe("public directory: nearby fallback", () => {
  test("a thin category+city combo widens to the same category nearby, nearest first, with distances", async () => {
    insertPlaced({
      id: "dn-anchor-photo",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });
    // Mid (~42 km) inserted before Near (~35 km), so nearest-first ordering
    // can't be an artefact of insertion order.
    insertPlaced({
      id: "dn-mid-photo",
      category: "photography",
      name: "Mid Photo",
      city: MID_CITY,
      at: MID_AT,
    });
    insertPlaced({
      id: "dn-near-photo",
      category: "photography",
      name: "Near Photo",
      city: NEAR_CITY,
      at: NEAR_AT,
    });

    const r = await getDirectory({ category: "photography", city: ANCHOR_CITY, limit: "48" });
    expect(r.status).toBe(200);
    // The town's own result is untouched and stays the headline.
    expect(r.data.vendors.map((v) => v.id)).toEqual(["dn-anchor-photo"]);
    expect(r.data.total).toBe(1);

    expect(r.data.nearby.map((v) => v.id)).toEqual(["dn-near-photo", "dn-mid-photo"]);
    expect(r.data.nearby_origin).toBe(ANCHOR_CITY);
    // Whole kilometres, matching the real ~35 km Győr → Mosonmagyaróvár hop.
    const near = r.data.nearby.find((v) => v.id === "dn-near-photo");
    expect(near?.distance_km).toBeGreaterThan(25);
    expect(near?.distance_km).toBeLessThan(45);
    expect(Number.isInteger(near?.distance_km)).toBe(true);
  });

  test("beyond the radius is a different region, not a nearby vendor", async () => {
    insertPlaced({
      id: "dn-anchor-photo2",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });
    insertPlaced({
      id: "dn-far-photo",
      category: "photography",
      name: "Far Photo",
      city: FAR_CITY,
      at: FAR_AT,
    });

    const r = await getDirectory({ category: "photography", city: ANCHOR_CITY, limit: "48" });
    expect(r.data.nearby).toEqual([]);
    expect(r.data.nearby_origin).toBeNull();
  });

  test("a town well stocked in the category gets no nearby block", async () => {
    for (let i = 0; i < 4; i++) {
      insertPlaced({
        id: `dn-anchor-full-${i}`,
        category: "photography",
        name: `Anchor Photo ${i}`,
        city: ANCHOR_CITY,
        at: ANCHOR_AT,
      });
    }
    insertPlaced({
      id: "dn-near-photo2",
      category: "photography",
      name: "Near Photo",
      city: NEAR_CITY,
      at: NEAR_AT,
    });

    const r = await getDirectory({ category: "photography", city: ANCHOR_CITY, limit: "48" });
    expect(r.data.total).toBe(4);
    expect(r.data.nearby).toEqual([]);
  });

  test("no city filter means no nearby block, however thin the category", async () => {
    insertPlaced({
      id: "dn-anchor-photo3",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });

    const r = await getDirectory({ category: "photography", limit: "48" });
    expect(r.data.nearby).toEqual([]);
    expect(r.data.nearby_origin).toBeNull();
  });

  test("no category filter means no nearby block, however thin the town", async () => {
    insertPlaced({
      id: "dn-anchor-photo4",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });

    const r = await getDirectory({ city: ANCHOR_CITY, limit: "48" });
    expect(r.data.nearby).toEqual([]);
    expect(r.data.nearby_origin).toBeNull();
  });

  test("a category with nothing in town still gets nearby, anchored off the town's other listings", async () => {
    // Nothing tagged "venue" in the anchor town, but a photographer is (and
    // geocoded), enough to anchor the origin, unlike the showcase teaser
    // which needs a non-empty in-town total to fire at all.
    insertPlaced({
      id: "dn-anchor-photo5",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });
    insertPlaced({
      id: "dn-near-venue",
      category: "venue",
      name: "Near Venue",
      city: NEAR_CITY,
      at: NEAR_AT,
    });

    const r = await getDirectory({ category: "venue", city: ANCHOR_CITY, limit: "48" });
    expect(r.data.vendors).toEqual([]);
    expect(r.data.total).toBe(0);
    expect(r.data.nearby.map((v) => v.id)).toEqual(["dn-near-venue"]);
    expect(r.data.nearby_origin).toBe(ANCHOR_CITY);
  });

  test("an ungeocoded town gets no block rather than distances from the wrong place", async () => {
    // The only listing in town has no coordinates, so there is no origin.
    insertListing({
      id: "dn-anchor-nocoord",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
    });
    insertPlaced({
      id: "dn-near-photo3",
      category: "photography",
      name: "Near Photo",
      city: NEAR_CITY,
      at: NEAR_AT,
    });

    const r = await getDirectory({ category: "photography", city: ANCHOR_CITY, limit: "48" });
    expect(r.data.total).toBe(1);
    expect(r.data.nearby).toEqual([]);
  });

  test("a nearby card never repeats an in-town result", async () => {
    insertPlaced({
      id: "dn-anchor-photo6",
      category: "photography",
      name: "Anchor Photo",
      city: ANCHOR_CITY,
      at: ANCHOR_AT,
    });
    insertPlaced({
      id: "dn-near-photo4",
      category: "photography",
      name: "Near Photo",
      city: NEAR_CITY,
      at: NEAR_AT,
    });

    const r = await getDirectory({ category: "photography", city: ANCHOR_CITY, limit: "48" });
    expect(r.data.nearby.map((v) => v.id)).toEqual(["dn-near-photo4"]);
  });
});
