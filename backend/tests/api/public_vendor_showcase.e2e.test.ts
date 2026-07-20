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
  db.prepare(
    `INSERT INTO listings
       (id, source, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    opts.source ?? "claimed",
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
