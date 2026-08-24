// Supplier listing hero auto-fill + the hero_checked_at marker. A curated /
// community listing with a website but no vendor-uploaded hero is eligible; the
// per-row fetch stamps hero_checked_at on every attempt (hit or miss), and a
// miss is only re-tried once RECHECK_AFTER_MS has passed (the site may have
// grown real content since). We point the fetch at a blocked localhost URL so
// it exercises the soft-fail path with no real network.

import "../setup";

import { describe, expect, test } from "bun:test";
import { registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import {
  fetchAndStoreListingHero,
  isAcceptableHero,
  listListingsNeedingHeroBackfill,
  officialSupplierWebsite,
  promoteExistingGalleryHeroes,
} from "../../src/domain/listing_image_backfill";
import { imageDimensions } from "../../src/lib/image_dims";

/** Register + verify the ADMIN_EMAILS allowlist address (admin@test.test, pinned
 *  in setup.ts) and return its bearer. Caller wipes first. */
async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

function rowOf(id: string): { hero_image_url: string | null; hero_checked_at: number | null } {
  return db
    .prepare("SELECT hero_image_url, hero_checked_at FROM listings WHERE id = ?")
    .get(id) as { hero_image_url: string | null; hero_checked_at: number | null };
}

/** Insert a community listing row directly. source='community' so wipeAll
 *  removes it (it only keeps curated). Optional overrides let a test build the
 *  excluded shapes (hero already set, already checked, pending, no website). */
function insertListing(
  id: string,
  opts: {
    website?: string | null;
    hero?: string | null;
    checkedAt?: number | null;
    status?: string;
    vendorAccountId?: number | null;
  } = {},
): void {
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, website,
        hero_image_url, hero_checked_at, status, created_at, updated_at)
     VALUES (?, 'community', ?, 'venue', 'Test Venue', 'Budapest', ?, ?, ?, ?, 0, 0)`,
  ).run(
    id,
    opts.vendorAccountId ?? null,
    opts.website === undefined ? "http://127.0.0.1/blocked" : opts.website,
    opts.hero ?? null,
    opts.checkedAt ?? null,
    opts.status ?? "active",
  );
}

const idsIn = (limit: number) => listListingsNeedingHeroBackfill(limit).map((r) => r.id);

describe("listing hero backfill eligibility", () => {
  test("normalises first-party sites and rejects social/directory profile hosts", () => {
    expect(officialSupplierWebsite("venue.example/weddings")).toBe(
      "https://venue.example/weddings",
    );
    expect(officialSupplierWebsite("https://www.venue.example/")).toBe(
      "https://www.venue.example/",
    );
    expect(officialSupplierWebsite("https://www.moja-djelatnost.hr/vendor/123")).toBeNull();
    expect(officialSupplierWebsite("www.facebook.com/vendor")).toBeNull();
  });

  test("only active, vendor-less rows with a website and no hero are listed", () => {
    wipeAll();

    insertListing("c-hero-eligible");
    insertListing("c-hero-has-image", { hero: "/uploads/listings/x/hero.jpg" });
    insertListing("c-hero-recently-checked", { checkedAt: Date.now() });
    insertListing("c-hero-pending", { status: "pending" });
    insertListing("c-hero-no-website", { website: null });
    insertListing("c-hero-empty-website", { website: "   " });

    const pending = idsIn(500);
    expect(pending).toContain("c-hero-eligible");
    expect(pending).not.toContain("c-hero-has-image");
    expect(pending).not.toContain("c-hero-recently-checked");
    expect(pending).not.toContain("c-hero-pending");
    expect(pending).not.toContain("c-hero-no-website");
    expect(pending).not.toContain("c-hero-empty-website");
  });

  test("a miss older than the recheck window becomes eligible again, but a hit never does", () => {
    wipeAll();

    const staleMissCheckedAt = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    insertListing("c-hero-stale-miss", { checkedAt: staleMissCheckedAt });
    // Same age, but it DID resolve a hero — hero_image_url excludes it regardless
    // of how long ago it was checked, since there's nothing left to retry for.
    insertListing("c-hero-stale-hit", {
      checkedAt: staleMissCheckedAt,
      hero: "/uploads/listings/x/hero.jpg",
    });

    // A large limit: never-checked rows (the curated seed, thousands of them)
    // sort ahead of a stale recheck, so a small LIMIT would starve this row out
    // without the ordering actually being wrong.
    const pending = idsIn(5000);
    expect(pending).toContain("c-hero-stale-miss");
    expect(pending).not.toContain("c-hero-stale-hit");
  });
});

describe("listing hero backfill fetch", () => {
  test("promotes an existing local gallery photo when the hero is missing", () => {
    wipeAll();
    insertListing("c-gallery-promotion", { website: null });
    // A legacy remote seed may precede the successfully mirrored copy. The
    // promotion must choose the local upload it can safely publish, not merely
    // the first photo row.
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      "c-gallery-promotion",
      "https://third-party.example/legacy.jpg",
      0,
    );
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      "c-gallery-promotion",
      "/uploads/listings/c-gallery-promotion/gallery/official.jpg",
      1,
    );

    expect(promoteExistingGalleryHeroes()).toBeGreaterThanOrEqual(1);
    expect(rowOf("c-gallery-promotion").hero_image_url).toBe(
      "/uploads/listings/c-gallery-promotion/gallery/official.jpg",
    );
    expect(rowOf("c-gallery-promotion").hero_checked_at).not.toBeNull();
  });

  test("a blocked website stamps hero_checked_at, leaves hero null, and drops out of the set", async () => {
    wipeAll();
    insertListing("c-hero-fetch");

    expect(idsIn(500)).toContain("c-hero-fetch");

    const stored = await fetchAndStoreListingHero("c-hero-fetch", "http://127.0.0.1/blocked");
    expect(stored).toBe(false);

    const row = rowOf("c-hero-fetch");
    expect(row.hero_image_url).toBeNull();
    expect(row.hero_checked_at).not.toBeNull();
    expect(idsIn(500)).not.toContain("c-hero-fetch");
  });

  test("a freshly stamped row leaves the eligible set, so the sweep doesn't immediately re-hammer it", async () => {
    wipeAll();
    insertListing("c-hero-once");

    await fetchAndStoreListingHero("c-hero-once", "http://127.0.0.1/blocked");
    expect(rowOf("c-hero-once").hero_checked_at).not.toBeNull();

    // listListingsNeedingHeroBackfill is what runListingImageBackfill draws from,
    // so dropping out of it means the boot sweep won't attempt the row again
    // until RECHECK_AFTER_MS has passed (see the recheck-window test above).
    expect(idsIn(500)).not.toContain("c-hero-once");
  });
});

describe("hero image dimension parsing + quality gate", () => {
  test("reads PNG dimensions from the IHDR header", () => {
    // 8-byte signature, IHDR length+type, then width(1200) height(630) BE u32.
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // signature
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR length = 13
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0x00,
      0x00,
      0x04,
      0xb0, // width = 1200
      0x00,
      0x00,
      0x02,
      0x76, // height = 630
    ]);
    expect(imageDimensions(png)).toEqual({ width: 1200, height: 630 });
  });

  test("returns null for non-image bytes", () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  test("quality gate accepts real heroes, rejects tiny/skinny, passes unknown", () => {
    expect(isAcceptableHero(1200, 630)).toBe(true); // standard og:image
    expect(isAcceptableHero(600, 400)).toBe(true);
    expect(isAcceptableHero(100, 100)).toBe(false); // tiny logo
    expect(isAcceptableHero(300, 200)).toBe(false); // long edge below 400
    expect(isAcceptableHero(1500, 200)).toBe(false); // 7.5:1 banner strip
    expect(isAcceptableHero(null, null)).toBe(true); // unmeasured — don't block
  });
});

describe("admin re-fetch hero endpoint", () => {
  test("admin force-refetch on a blocked website returns ok:false and stamps the row", async () => {
    wipeAll();
    const token = await bootstrapAdmin();
    insertListing("c-admin-hero");

    const res = await req<{ ok: boolean; hero_image_url: string | null }>(
      "POST",
      "/api/admin/suppliers/c-admin-hero/refetch-hero",
      {},
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(false);
    expect(res.data.hero_image_url).toBeNull();
    expect(rowOf("c-admin-hero").hero_checked_at).not.toBeNull();
  });

  test("409 when the listing has no website, 404 for an unknown id", async () => {
    wipeAll();
    const token = await bootstrapAdmin();
    insertListing("c-admin-no-site", { website: null });

    const noSite = await req(
      "POST",
      "/api/admin/suppliers/c-admin-no-site/refetch-hero",
      {},
      { token },
    );
    expect(noSite.status).toBe(409);

    const missing = await req(
      "POST",
      "/api/admin/suppliers/does-not-exist/refetch-hero",
      {},
      { token },
    );
    expect(missing.status).toBe(404);
  });

  test("a non-admin caller is forbidden", async () => {
    wipeAll();
    const token = await bootstrapAdmin();
    insertListing("c-admin-guard");

    // No token at all — the route requires auth.
    const anon = await req("POST", "/api/admin/suppliers/c-admin-guard/refetch-hero", {});
    expect(anon.status).toBe(401);
    // Sanity: the admin token still works on the same row.
    const ok = await req("POST", "/api/admin/suppliers/c-admin-guard/refetch-hero", {}, { token });
    expect(ok.status).toBe(200);
  });
});
