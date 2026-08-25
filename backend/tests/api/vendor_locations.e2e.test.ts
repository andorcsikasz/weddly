import "../setup";

import { afterAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { syncListingFromCommunityId } from "../../src/domain/listings";
import {
  _resetCategoryCityCache,
  listComboListings,
  listIndexableCategoryCityCombos,
  resolveCategoryCityCombo,
} from "../../src/domain/vendor_locations";
import { renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";
import { locationPagePath, MIN_LISTINGS_FOR_LOCATION_PAGE } from "../../../shared/vendor_locations";

// Combos are derived from `assembleDirectoryBase` (curated + community +
// claimed, photos-only). Curated is static in-code and its city/category
// can't be overridden from a test; the DB-backed `listings` overlay only
// carries hero_image_url/claim state, not city/category. A COMMUNITY
// supplier is the only base row a test can fully control, so the fixture
// goes through the real submit → mirror-into-listings → add-photo path
// (`syncListingFromCommunityId`, the same function a live submission calls)
// rather than hand-rolling a `listings` row that `assembleDirectoryBase`
// would never actually assemble.
const FIXTURE_CITY = "Fixtúraváros"; // distinctive on purpose: never collides with real curated/community data
const FIXTURE_CATEGORY = "photography";
const FIXTURE_COUNT = MIN_LISTINGS_FOR_LOCATION_PAGE; // exactly at the floor

function fixtureSubmitterUserId(): number {
  const email = "vendor-locations-fixture@test.weddly";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, verified_email, created_at, updated_at)
       VALUES (?, 'x', 'Fixture Submitter', 1, ?, ?)`,
    )
    .run(email, ts, ts);
  return Number(info.lastInsertRowid);
}

function insertFixtureListing(idx: number): string {
  const submitterUserId = fixtureSubmitterUserId();
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO community_suppliers
         (submitter_user_id, submitter_type, category, name, city, website, blurb, price_band, status, created_at, updated_at)
       VALUES (?, 'user', ?, ?, ?, 'https://example.com', 'Fixture blurb.', 1, 'active', ?, ?)`,
    )
    .run(submitterUserId, FIXTURE_CATEGORY, `Fixture Photographer ${idx}`, FIXTURE_CITY, ts, ts);
  const communityId = Number(info.lastInsertRowid);
  syncListingFromCommunityId(communityId); // mirrors into `listings`, same as a live submission
  const listingId = `c${communityId}`;
  db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
    "https://img.example/fixture.jpg",
    listingId,
  );
  return listingId;
}

const fixtureListingIds = Array.from({ length: FIXTURE_COUNT }, (_, i) => insertFixtureListing(i));
_resetCategoryCityCache();

// `bun test` runs every file in one process against one shared DB — leaving
// these rows behind would keep "Fixtúraváros" resolvable (and inflate
// `listings` row counts) for every test file that runs after this one.
afterAll(() => {
  const placeholders = fixtureListingIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM listings WHERE id IN (${placeholders})`).run(...fixtureListingIds);
  db.prepare("DELETE FROM community_suppliers WHERE city = ?").run(FIXTURE_CITY);
  db.prepare("DELETE FROM users WHERE email = ?").run("vendor-locations-fixture@test.weddly");
  _resetCategoryCityCache();
});

const TEMPLATE = `<!doctype html>
<html lang="hu" data-default-locale="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body>
  <div id="root">
    <div class="seo-prerender">
      <!-- SEO_BODY_START -->
      <h1>landing</h1>
      <!-- SEO_BODY_END -->
    </div>
  </div>
</body>
</html>`;

describe("vendor locations: combo aggregation", () => {
  test("the fixture city clears the listing floor as a combo", () => {
    const combo = resolveCategoryCityCombo("fotosok", "fixturavaros");
    expect(combo).not.toBeNull();
    expect(combo?.category).toBe("photography");
    expect(combo?.cityDisplay).toBe(FIXTURE_CITY);
    expect(combo?.count).toBe(FIXTURE_COUNT);
  });

  test("every listed combo clears the listing-count floor", () => {
    for (const combo of listIndexableCategoryCityCombos()) {
      expect(combo.count).toBeGreaterThanOrEqual(MIN_LISTINGS_FOR_LOCATION_PAGE);
    }
  });

  test("resolves via both its HU and EN category slug", () => {
    const viaHu = resolveCategoryCityCombo("fotosok", "fixturavaros");
    const viaEn = resolveCategoryCityCombo("photographers", "fixturavaros");
    expect(viaHu?.cityDisplay).toBe(FIXTURE_CITY);
    expect(viaEn?.cityDisplay).toBe(FIXTURE_CITY);
    expect(viaHu?.category).toBe(viaEn?.category);
  });

  test("an unknown category slug does not resolve", () => {
    expect(resolveCategoryCityCombo("not-a-real-category", "fixturavaros")).toBeNull();
  });

  test("a real category with a nonexistent city does not resolve", () => {
    expect(resolveCategoryCityCombo("fotosok", "nowhereville-xyz")).toBeNull();
  });

  test("one fewer than the floor does not clear it", () => {
    db.prepare("DELETE FROM listings WHERE id = ?").run(fixtureListingIds[0]!);
    _resetCategoryCityCache();
    try {
      expect(resolveCategoryCityCombo("fotosok", "fixturavaros")).toBeNull();
    } finally {
      // Restore for the rest of this file's tests: re-add the photo the
      // delete above removed (the community_suppliers row itself is untouched).
      db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
        "https://img.example/fixture.jpg",
        fixtureListingIds[0]!,
      );
      syncListingFromCommunityId(Number(fixtureListingIds[0]!.slice(1)));
      db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
        "https://img.example/fixture.jpg",
        fixtureListingIds[0]!,
      );
      _resetCategoryCityCache();
    }
  });

  test("listComboListings returns the fixture names", () => {
    const combo = resolveCategoryCityCombo("fotosok", "fixturavaros");
    if (!combo) throw new Error("fixture combo did not resolve");
    const listings = listComboListings(combo, 60);
    expect(listings.length).toBe(FIXTURE_COUNT);
    expect(listings.map((l) => l.name)).toContain("Fixture Photographer 0");
  });
});

describe("vendor locations: SSR meta + body", () => {
  test("the HU path renders the fixture combo's HU title/h1/lang", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: "/eskuvoi-szolgaltatok/fotosok/fixturavaros",
      isRsvp: false,
    });
    expect(html).toContain('<html lang="hu"');
    expect(html).toContain(`Esküvői fotó · ${FIXTURE_CITY}`);
    expect(html).toContain('<meta name="robots" content="index,follow" />');
  });

  test("the EN path renders EN lang for the same combo", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: "/wedding-vendors/photographers/fixturavaros",
      isRsvp: false,
    });
    expect(html).toContain('<html lang="en"');
    expect(html).toContain(`Wedding photography · ${FIXTURE_CITY}`);
  });

  test("the SSR body links to the fixture vendor pages", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: "/eskuvoi-szolgaltatok/fotosok/fixturavaros",
      isRsvp: false,
    });
    expect(html).toContain("Fixture Photographer 0");
    expect(html).toContain("/suppliers/");
  });

  test("HU and EN paths hreflang-pair each other", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: "/eskuvoi-szolgaltatok/fotosok/fixturavaros",
      isRsvp: false,
    });
    expect(html).toContain(
      `<link rel="alternate" hreflang="en" href="https://tryweddly.com/wedding-vendors/photographers/fixturavaros" />`,
    );
    expect(html).toContain(
      `<link rel="canonical" href="https://tryweddly.com/eskuvoi-szolgaltatok/fotosok/fixturavaros" />`,
    );
  });

  test("an unknown combo path falls back to the landing meta and stays noindex", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: "/eskuvoi-szolgaltatok/fotosok/nowhereville-xyz-town",
      isRsvp: false,
    });
    expect(html).toContain('<meta name="robots" content="noindex,follow" />');
    // No location-page title/body was built for it — the generic landing
    // title stands in, the same fallback any unrecognised path gets.
    expect(html).not.toContain("Esküvői fotó ·");
    expect(html).toContain("<h1>landing</h1>");
  });
});

describe("vendor locations: sitemap", () => {
  test("includes both locale URLs for the fixture combo", () => {
    const xml = renderSitemapXml("tryweddly.com");
    const combo = resolveCategoryCityCombo("fotosok", "fixturavaros");
    if (!combo) throw new Error("fixture combo did not resolve");
    expect(xml).toContain(`<loc>https://tryweddly.com${locationPagePath(combo, "hu")}</loc>`);
    expect(xml).toContain(`<loc>https://tryweddly.com${locationPagePath(combo, "en")}</loc>`);
  });
});
