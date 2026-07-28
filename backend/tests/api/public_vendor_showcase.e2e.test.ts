// Public "browse teaser" — the unauthenticated, photos-only directory sample
// behind /vendors/browse. Covers GET /api/public/vendor-showcase: no auth, only
// listings with a hero photo, capped at 6 per category, hidden/deleted curated
// slugs excluded, claimed Weddly vendors surfaced ahead of curated ones.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { PublicVendorShowcase } from "@shared/suppliers";
import { db, now } from "../../src/db";
import { req, wipeAll } from "../helpers";

let seq = 0;
/** Lazily-minted owner for the claimed fixtures. "Verified" is derived from
 *  OWNERSHIP, not from `source`, so a claimed row with no vendor account is not
 *  a state the product can produce by signing up — it's what a vendor→planner
 *  conversion leaves behind, and that orphan is deliberately NOT verified. */
let ownerAccountId: number | null = null;
function vendorAccountId(): number {
  if (ownerAccountId !== null) return ownerAccountId;
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
         VALUES ('showcase-owner@weddly.test', 'x', 'Owner', 'active', 'vendor', 1, ?, ?)`,
      )
      .run(now(), now()).lastInsertRowid,
  );
  ownerAccountId = Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, contact_email, country, created_at, updated_at)
         VALUES (?, 'Showcase Owner', 'showcase-owner@weddly.test', 'HU', ?, ?)`,
      )
      .run(userId, now(), now()).lastInsertRowid,
  );
  return ownerAccountId;
}

function insertListing(opts: {
  id?: string;
  source?: string;
  category: string;
  name: string;
  hero?: string | null;
  status?: string;
  /** Curated country comes off a ", XX" suffix on the city, exactly as the
   *  foreign curated batches carry it. Default Budapest → HU. */
  city?: string;
}): string {
  const id = opts.id ?? `v${++seq}`;
  const source = opts.source ?? "claimed";
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    source,
    source === "claimed" ? vendorAccountId() : null,
    opts.category,
    opts.name,
    opts.city ?? "Budapest",
    opts.status ?? "active",
    opts.hero === undefined ? "https://img.example/x.jpg" : opts.hero,
    now(),
    now(),
  );
  return id;
}

function getShowcase(country?: string) {
  return req<PublicVendorShowcase>(
    "GET",
    country ? `/api/public/vendor-showcase?country=${country}` : "/api/public/vendor-showcase",
  );
}

beforeEach(() => {
  wipeAll();
  // wipeAll intentionally preserves curated listings (re-materialised on boot).
  // The showcase reads every source, so leaked curated fixtures from earlier
  // suites would inflate these counts — start each showcase test from a truly
  // empty listings table and let it insert exactly what it asserts on.
  db.exec("DELETE FROM listings");
  seq = 0;
  // wipeAll drops users (and cascades vendor_accounts), so the cached id from
  // the previous test no longer resolves — mint a fresh one on next use.
  ownerAccountId = null;
});

describe("public vendor showcase", () => {
  test("returns without auth and only includes vendors that have a photo", async () => {
    insertListing({ category: "photography", name: "With Photo" });
    insertListing({ category: "photography", name: "No Photo", hero: null });

    const r = await getShowcase();
    expect(r.status).toBe(200);
    const photo = r.data.categories.find((c) => c.category === "photography");
    expect(photo?.vendors.map((v) => v.name)).toEqual(["With Photo"]);
    // Every returned vendor carries a non-empty hero image.
    for (const c of r.data.categories) {
      for (const v of c.vendors) expect(v.hero_image_url.length).toBeGreaterThan(0);
    }
  });

  test("caps each category at 6", async () => {
    for (let i = 0; i < 9; i++) insertListing({ category: "catering", name: `Caterer ${i}` });

    const r = await getShowcase();
    const catering = r.data.categories.find((c) => c.category === "catering");
    expect(catering?.vendors.length).toBe(6);
    expect(r.data.total).toBe(6);
  });

  test("excludes hidden/deleted curated slugs", async () => {
    insertListing({
      id: "hidden-venue",
      source: "curated",
      category: "venue",
      name: "Hidden Venue",
    });
    insertListing({ id: "shown-venue", source: "curated", category: "venue", name: "Shown Venue" });
    db.prepare(
      "INSERT INTO curated_supplier_overrides (supplier_id, status, created_at, updated_at) VALUES ('hidden-venue', 'hidden', ?, ?)",
    ).run(now(), now());

    const r = await getShowcase();
    const venue = r.data.categories.find((c) => c.category === "venue");
    expect(venue?.vendors.map((v) => v.id)).toEqual(["shown-venue"]);
  });

  test("surfaces claimed Weddly vendors ahead of curated ones", async () => {
    // Two curated (older) + one claimed (newest) in the same category; the cap is
    // high enough to include all, but claimed must sort first.
    insertListing({ id: "cur-1", source: "curated", category: "dj", name: "Curated DJ 1" });
    insertListing({ id: "cur-2", source: "curated", category: "dj", name: "Curated DJ 2" });
    insertListing({ id: "v99", source: "claimed", category: "dj", name: "Weddly DJ" });

    const r = await getShowcase();
    const music = r.data.categories.find((c) => c.category === "dj");
    expect(music?.vendors[0]?.id).toBe("v99");
  });

  test("flags claimed vendors as verified and carries each vendor's country", async () => {
    insertListing({ id: "v50", source: "claimed", category: "florist", name: "Weddly Florist" });
    insertListing({
      id: "cur-florist",
      source: "curated",
      category: "florist",
      name: "Curated Florist",
      city: "Lake Como, IT",
    });

    const r = await getShowcase();
    const florists = r.data.categories.find((c) => c.category === "florist")?.vendors ?? [];
    const claimed = florists.find((v) => v.id === "v50");
    const curated = florists.find((v) => v.id === "cur-florist");
    expect(claimed?.verified).toBe(true);
    expect(claimed?.country).toBe("HU");
    // Curated entries are never "verified" — nobody from the business signed up.
    expect(curated?.verified).toBe(false);
    expect(curated?.country).toBe("IT");
  });

  // The other half of "verified means owned": a vendor→planner conversion
  // releases the directory card (`vendor_account_id = NULL`) but leaves
  // source='claimed' behind. That orphan kept its blue check and its
  // verified-first ranking for as long as the flag read `source`.
  test("a released listing with no owner is not verified", async () => {
    const id = insertListing({ source: "claimed", category: "nails", name: "Ex Vendor" });
    db.prepare("UPDATE listings SET vendor_account_id = NULL WHERE id = ?").run(id);

    const r = await getShowcase();
    const card = r.data.categories.flatMap((c) => c.vendors).find((v) => v.id === id);
    expect(card).toBeDefined();
    expect(card?.verified).toBe(false);
  });

  test("reports every country in the sample with its count", async () => {
    insertListing({ category: "venue", name: "HU Venue" });
    insertListing({
      id: "it-1",
      source: "curated",
      category: "venue",
      name: "IT Venue 1",
      city: "Lake Como, IT",
    });
    insertListing({
      id: "it-2",
      source: "curated",
      category: "venue",
      name: "IT Venue 2",
      city: "Lake Como, IT",
    });

    const r = await getShowcase();
    // Busiest country first.
    expect(r.data.countries).toEqual([
      { code: "IT", count: 2 },
      { code: "HU", count: 1 },
    ]);
  });

  test("?country= scopes the sample but leaves the chip counts whole", async () => {
    insertListing({ category: "venue", name: "HU Venue" });
    insertListing({
      id: "it-1",
      source: "curated",
      category: "venue",
      name: "IT Venue",
      city: "Lake Como, IT",
    });

    const r = await getShowcase("IT");
    const venues = r.data.categories.find((c) => c.category === "venue")?.vendors ?? [];
    expect(venues.map((v) => v.id)).toEqual(["it-1"]);
    expect(r.data.total).toBe(1);
    // The chips still offer the way back to Hungary.
    expect(r.data.countries.map((c) => c.code).sort()).toEqual(["HU", "IT"]);
  });

  test("ignores a malformed country param instead of emptying the page", async () => {
    insertListing({ category: "venue", name: "HU Venue" });

    const r = await getShowcase("nonsense");
    expect(r.status).toBe(200);
    expect(r.data.total).toBe(1);
  });

  test("orders by Google rating inside a tier, unrated last", async () => {
    // Same source and same category, so the rating is the only thing left to
    // sort on. Inserted worst-first to prove the order isn't just insertion.
    insertListing({ id: "cur-a", source: "curated", category: "nails", name: "Three Star" });
    insertListing({ id: "cur-b", source: "curated", category: "nails", name: "Unrated" });
    insertListing({ id: "cur-c", source: "curated", category: "nails", name: "Four Nine" });
    db.prepare("UPDATE listings SET google_rating = 3.0 WHERE id = 'cur-a'").run();
    db.prepare("UPDATE listings SET google_rating = 4.9 WHERE id = 'cur-c'").run();

    const r = await getShowcase();
    const nails = r.data.categories.find((c) => c.category === "nails")?.vendors ?? [];
    expect(nails.map((v) => v.id)).toEqual(["cur-c", "cur-a", "cur-b"]);
  });

  test("a registered vendor outranks a better-rated curated entry", async () => {
    // Rating breaks ties WITHIN a tier; it never promotes a curated listing
    // above a business that actually signed up.
    insertListing({ id: "cur-top", source: "curated", category: "lighting", name: "Curated 5.0" });
    insertListing({ id: "v77", source: "claimed", category: "lighting", name: "Weddly Lighting" });
    db.prepare("UPDATE listings SET google_rating = 5.0 WHERE id = 'cur-top'").run();
    db.prepare("UPDATE listings SET google_rating = 3.1 WHERE id = 'v77'").run();

    const r = await getShowcase();
    const lighting = r.data.categories.find((c) => c.category === "lighting")?.vendors ?? [];
    expect(lighting.map((v) => v.id)).toEqual(["v77", "cur-top"]);
  });

  test("viewer_country is null when IP geo is unavailable", async () => {
    insertListing({ category: "venue", name: "HU Venue" });

    const r = await getShowcase();
    // No MaxMind DB in the test environment, so the ranking hint degrades to
    // null and the ordering falls back to claimed-first.
    expect(r.data.viewer_country).toBeNull();
  });
});

// ─── The "nearly empty town" rescue ─────────────────────────────────────────
// Filtering to a small town used to leave a single card on the page, which
// reads as "Weddly has nothing here". Below NEARBY_TRIGGER the response carries
// a `nearby` block: the same shape as `categories`, drawn from the surrounding
// region, with a straight-line `distance_km` on every card.

/** Real coordinates, so the radius maths is exercised against real geography
 *  rather than numbers picked to pass. Distances from Győr: Mosonmagyaróvár
 *  ~35 km, Pápa ~42 km, Budapest ~106 km (outside the 70 km radius). */
const GYOR = { lat: 47.6875, lng: 17.6504 };
const MOSONMAGYAROVAR = { lat: 47.8676, lng: 17.2716 };
const PAPA = { lat: 47.3297, lng: 17.4678 };
const BUDAPEST = { lat: 47.4979, lng: 19.0402 };

function insertPlaced(opts: {
  id?: string;
  category: string;
  name: string;
  city: string;
  at: { lat: number; lng: number };
  source?: string;
}): string {
  const id = insertListing({
    id: opts.id,
    source: opts.source ?? "curated",
    category: opts.category,
    name: opts.name,
    city: opts.city,
  });
  db.prepare("UPDATE listings SET lat = ?, lng = ? WHERE id = ?").run(opts.at.lat, opts.at.lng, id);
  return id;
}

function getCityShowcase(city: string) {
  return req<PublicVendorShowcase>(
    "GET",
    `/api/public/vendor-showcase?city=${encodeURIComponent(city)}`,
  );
}

describe("public vendor showcase: nearby fallback", () => {
  test("a one-result town gets the region appended, nearest first, with distances", async () => {
    insertPlaced({
      id: "gy-1",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
      at: GYOR,
    });
    insertPlaced({
      id: "mo-1",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });
    insertPlaced({ id: "pa-1", category: "venue", name: "Pápa Venue", city: "Pápa", at: PAPA });

    const r = await getCityShowcase("Győr");
    expect(r.status).toBe(200);
    // The town's own result is untouched and stays the headline.
    expect(r.data.categories.flatMap((c) => c.vendors.map((v) => v.id))).toEqual(["gy-1"]);

    // Grouped by category in the same order as the main block, so the two read
    // as one page. Distance decides WHICH vendors make the cut and how they sit
    // inside a rail, not the order of the rails themselves.
    expect(r.data.nearby.map((c) => c.category)).toEqual(["venue", "photography"]);
    const near = r.data.nearby.flatMap((c) => c.vendors);
    expect(near.map((v) => v.id).sort()).toEqual(["mo-1", "pa-1"]);
    expect(r.data.nearby_origin).toBe("Győr");
    // Whole kilometres, matching the real ~35 km Győr → Mosonmagyaróvár hop.
    const ovar = near.find((v) => v.id === "mo-1");
    expect(ovar?.distance_km).toBeGreaterThan(25);
    expect(ovar?.distance_km).toBeLessThan(45);
    expect(Number.isInteger(ovar?.distance_km)).toBe(true);
    // In-town cards carry no distance: their distance from themselves is noise.
    expect(r.data.categories[0]?.vendors[0]?.distance_km).toBeUndefined();
  });

  test("inside one category the nearest vendor comes first", async () => {
    insertPlaced({
      id: "gy-near",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
      at: GYOR,
    });
    // Pápa (~42 km) inserted BEFORE Mosonmagyaróvár (~35 km), so passing this
    // can't be an artefact of insertion order.
    insertPlaced({
      id: "pa-far",
      category: "photography",
      name: "Pápa Photo",
      city: "Pápa",
      at: PAPA,
    });
    insertPlaced({
      id: "mo-close",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });

    const r = await getCityShowcase("Győr");
    const photo = r.data.nearby.find((c) => c.category === "photography")?.vendors ?? [];
    expect(photo.map((v) => v.id)).toEqual(["mo-close", "pa-far"]);
  });

  test("beyond the radius is a different region, not a nearby vendor", async () => {
    insertPlaced({
      id: "gy-2",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
      at: GYOR,
    });
    insertPlaced({
      id: "bp-1",
      category: "photography",
      name: "Budapest Photo",
      city: "Budapest",
      at: BUDAPEST,
    });

    const r = await getCityShowcase("Győr");
    expect(r.data.nearby).toEqual([]);
    expect(r.data.nearby_origin).toBeNull();
  });

  test("a town that stands on its own gets no nearby block", async () => {
    for (let i = 0; i < 4; i++) {
      insertPlaced({
        id: `gy-full-${i}`,
        category: "photography",
        name: `Győr Photo ${i}`,
        city: "Győr",
        at: GYOR,
      });
    }
    insertPlaced({
      id: "mo-2",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });

    const r = await getCityShowcase("Győr");
    expect(r.data.total).toBe(4);
    expect(r.data.nearby).toEqual([]);
  });

  test("no city filter means no nearby block, however thin the sample", async () => {
    insertPlaced({
      id: "gy-3",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
      at: GYOR,
    });
    insertPlaced({
      id: "mo-3",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });

    const r = await getShowcase();
    // Both show up as ordinary results; there is no origin to measure from.
    expect(r.data.total).toBe(2);
    expect(r.data.nearby).toEqual([]);
    expect(r.data.nearby_origin).toBeNull();
  });

  test("an ungeocoded town gets no block rather than distances from the wrong place", async () => {
    // The only listing in town has no coordinates, so there is no origin.
    insertListing({
      id: "gy-nocoord",
      source: "curated",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
    });
    insertPlaced({
      id: "mo-4",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });

    const r = await getCityShowcase("Győr");
    expect(r.data.total).toBe(1);
    expect(r.data.nearby).toEqual([]);
  });

  test("a nearby card never repeats an in-town result", async () => {
    // Same coordinates as the town itself: distance 0, and still excluded,
    // because it is already on the page above.
    insertPlaced({
      id: "gy-4",
      category: "photography",
      name: "Győr Photo",
      city: "Győr",
      at: GYOR,
    });
    insertPlaced({ id: "gy-5", category: "venue", name: "Győr Venue", city: "Győr", at: GYOR });
    insertPlaced({
      id: "mo-5",
      category: "photography",
      name: "Óvár Photo",
      city: "Mosonmagyaróvár",
      at: MOSONMAGYAROVAR,
    });

    const r = await getCityShowcase("Győr");
    const nearIds = r.data.nearby.flatMap((c) => c.vendors.map((v) => v.id));
    expect(nearIds).toEqual(["mo-5"]);
  });
});
