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
}): string {
  const id = opts.id ?? `v${++seq}`;
  db.prepare(
    `INSERT INTO listings
       (id, source, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Budapest', ?, ?, '', ?, ?)`,
  ).run(
    id,
    opts.source ?? "claimed",
    opts.category,
    opts.name,
    opts.status ?? "active",
    opts.hero === undefined ? "https://img.example/x.jpg" : opts.hero,
    now(),
    now(),
  );
  return id;
}

function getShowcase() {
  return req<PublicVendorShowcase>("GET", "/api/public/vendor-showcase");
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
});
