// Supplier listing hero auto-fill + the hero_checked_at marker. A curated /
// community listing with a website but no vendor-uploaded hero is eligible; the
// per-row fetch stamps hero_checked_at on every attempt (hit or miss) so a site
// without a usable og:image is tried exactly once. We point the fetch at a
// blocked localhost URL so it exercises the soft-fail path with no real network.

import "../setup";

import { describe, expect, test } from "bun:test";
import { registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import {
  fetchAndStoreListingHero,
  isAcceptableHero,
  listListingsNeedingHeroBackfill,
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
  test("only active, vendor-less rows with a website and no hero/checked are listed", () => {
    wipeAll();

    insertListing("c-hero-eligible");
    insertListing("c-hero-has-image", { hero: "/uploads/listings/x/hero.jpg" });
    insertListing("c-hero-already-checked", { checkedAt: 123 });
    insertListing("c-hero-pending", { status: "pending" });
    insertListing("c-hero-no-website", { website: null });
    insertListing("c-hero-empty-website", { website: "   " });

    const pending = idsIn(500);
    expect(pending).toContain("c-hero-eligible");
    expect(pending).not.toContain("c-hero-has-image");
    expect(pending).not.toContain("c-hero-already-checked");
    expect(pending).not.toContain("c-hero-pending");
    expect(pending).not.toContain("c-hero-no-website");
    expect(pending).not.toContain("c-hero-empty-website");
  });
});

describe("listing hero backfill fetch", () => {
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

  test("a stamped row leaves the eligible set, so the sweep never re-hammers it", async () => {
    wipeAll();
    insertListing("c-hero-once");

    await fetchAndStoreListingHero("c-hero-once", "http://127.0.0.1/blocked");
    expect(rowOf("c-hero-once").hero_checked_at).not.toBeNull();

    // listListingsNeedingHeroBackfill is what runListingImageBackfill draws from,
    // so dropping out of it means the boot sweep won't attempt the row again.
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
