// Public typeahead behind the landing-page directory search. Covers GET
// /api/public/vendor-search: no auth, name + town matching (accent-blind),
// the three-suggestion cap, the category census the client scores in its own
// language, and the `?city=` filter on the showcase that a town pick lands on.

import "../setup";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PublicVendorSearchResult, PublicVendorShowcase } from "@shared/suppliers";
import { db, now } from "../../src/db";
import { backfillListings } from "../../src/domain/listings";
import { req, wipeAll } from "../helpers";

let seq = 0;
function insertListing(opts: {
  id?: string;
  source?: string;
  category: string;
  name: string;
  hero?: string | null;
  status?: string;
  city?: string;
}): string {
  const id = opts.id ?? `v${++seq}`;
  db.prepare(
    `INSERT INTO listings
       (id, source, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    opts.source ?? "curated",
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

function search(q: string) {
  return req<PublicVendorSearchResult>(
    "GET",
    `/api/public/vendor-search?q=${encodeURIComponent(q)}`,
  );
}

beforeEach(() => {
  wipeAll();
  // Same reason as the showcase suite: wipeAll keeps curated listings, and a
  // leaked fixture would answer these queries instead of the ones inserted here.
  db.exec("DELETE FROM listings");
  seq = 0;
});

// Emptying `listings` is a whole-table delete, curated rows included, and the
// suites that run after this one (alphabetically: suppliers_*) assume the boot
// backfill is still materialised. Put it back rather than leaving a landmine.
afterAll(() => {
  db.exec("DELETE FROM listings");
  backfillListings();
});

describe("public vendor search", () => {
  test("matches a business name without auth", async () => {
    insertListing({ id: "s1", category: "photography", name: "Kovács Fotó", city: "Szeged" });
    insertListing({ id: "s2", category: "dj", name: "Party DJ" });

    const r = await search("kovacs");
    expect(r.status).toBe(200);
    expect(r.data.suggestions.map((s) => s.id)).toEqual(["s1"]);
    const hit = r.data.suggestions[0]!;
    expect(hit.kind).toBe("vendor");
    expect(hit.label).toBe("Kovács Fotó");
    // The context line the dropdown renders under the name.
    expect(hit.city).toBe("Szeged");
    expect(hit.category).toBe("photography");
  });

  test("matches a town, counts it, and strips the curated country suffix", async () => {
    insertListing({ category: "venue", name: "Alpine Hall", city: "Wien, AT" });
    insertListing({ category: "catering", name: "Alpine Food", city: "Wien, AT" });
    insertListing({ category: "venue", name: "Pest Hall", city: "Budapest" });

    const r = await search("wien");
    const city = r.data.suggestions.find((s) => s.kind === "city");
    expect(city?.label).toBe("Wien");
    expect(city?.count).toBe(2);
  });

  test("a query short enough to match everything returns nothing", async () => {
    insertListing({ category: "venue", name: "Anna Hall" });

    const r = await search("a");
    expect(r.data.suggestions).toEqual([]);
    // The census still comes back — the client needs it the moment the second
    // character lands.
    expect(r.data.categories.length).toBeGreaterThan(0);
  });

  test("never returns more than three suggestions", async () => {
    for (let i = 0; i < 8; i++) insertListing({ category: "florist", name: `Rose Studio ${i}` });

    const r = await search("rose");
    expect(r.data.suggestions.length).toBe(3);
  });

  test("an exact name beats a partial one", async () => {
    insertListing({ id: "exact", category: "dj", name: "Echo" });
    insertListing({ id: "partial", category: "dj", name: "Echo Chamber Sound" });

    const r = await search("echo");
    expect(r.data.suggestions[0]?.id).toBe("exact");
  });

  test("a registered vendor outranks a curated listing on an equal match", async () => {
    insertListing({ id: "cur", source: "curated", category: "dj", name: "Sound House" });
    insertListing({ id: "v42", source: "claimed", category: "dj", name: "Sound House" });

    const r = await search("sound house");
    expect(r.data.suggestions[0]?.id).toBe("v42");
  });

  test("the category census counts only photographed listings", async () => {
    insertListing({ category: "venue", name: "Shown Venue" });
    insertListing({ category: "venue", name: "Photoless Venue", hero: null });
    insertListing({ category: "dj", name: "Photoless DJ", hero: null });

    const r = await search("venue");
    const census = new Map(r.data.categories.map((c) => [c.category, c.count]));
    expect(census.get("venue")).toBe(1);
    // A category with nothing browsable behind it is never offered.
    expect(census.has("dj")).toBe(false);
  });

  test("a photoless listing is still findable by name", async () => {
    // Its public profile reads fine without a cover, so hiding it from search
    // would just make a business un-findable by its own name.
    insertListing({ id: "np", category: "venue", name: "Quiet Barn", hero: null });

    const r = await search("quiet barn");
    expect(r.data.suggestions.map((s) => s.id)).toEqual(["np"]);
  });

  test("excludes non-active and tombstoned listings", async () => {
    insertListing({ id: "pending", category: "venue", name: "Ghost Hall", status: "pending" });
    insertListing({ id: "hidden-hall", category: "venue", name: "Ghost Hall Two" });
    db.prepare(
      "INSERT INTO curated_supplier_overrides (supplier_id, status, created_at, updated_at) VALUES ('hidden-hall', 'hidden', ?, ?)",
    ).run(now(), now());

    const r = await search("ghost hall");
    expect(r.data.suggestions).toEqual([]);
  });
});

describe("showcase ?city= filter", () => {
  test("scopes the sample to one town, accent- and suffix-blind", async () => {
    insertListing({ id: "gyor-1", category: "venue", name: "Győr Hall", city: "Győr" });
    insertListing({ id: "bp-1", category: "venue", name: "Pest Hall", city: "Budapest" });

    // Folded on both sides, so an un-accented URL still finds the town.
    const r = await req<PublicVendorShowcase>("GET", "/api/public/vendor-showcase?city=gyor");
    expect(r.status).toBe(200);
    const venues = r.data.categories.find((c) => c.category === "venue")?.vendors ?? [];
    expect(venues.map((v) => v.id)).toEqual(["gyor-1"]);
  });

  test("a town nobody is listed in returns an empty page, not everything", async () => {
    insertListing({ category: "venue", name: "Pest Hall", city: "Budapest" });

    const r = await req<PublicVendorShowcase>("GET", "/api/public/vendor-showcase?city=Atlantis");
    expect(r.data.total).toBe(0);
  });

  test("combines with ?country=", async () => {
    insertListing({ id: "at-1", category: "venue", name: "Wien Hall", city: "Wien, AT" });
    insertListing({ id: "hu-1", category: "venue", name: "Pest Hall", city: "Budapest" });

    const r = await req<PublicVendorShowcase>(
      "GET",
      "/api/public/vendor-showcase?country=AT&city=Wien",
    );
    const venues = r.data.categories.find((c) => c.category === "venue")?.vendors ?? [];
    expect(venues.map((v) => v.id)).toEqual(["at-1"]);
  });
});
