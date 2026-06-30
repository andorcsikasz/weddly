// Supplier listing hero auto-fill + the hero_checked_at marker. A curated /
// community listing with a website but no vendor-uploaded hero is eligible; the
// per-row fetch stamps hero_checked_at on every attempt (hit or miss) so a site
// without a usable og:image is tried exactly once. We point the fetch at a
// blocked localhost URL so it exercises the soft-fail path with no real network.

import "../setup";

import { describe, expect, test } from "bun:test";
import { wipeAll } from "../helpers";
import { db } from "../../src/db";
import {
  fetchAndStoreListingHero,
  listListingsNeedingHeroBackfill,
} from "../../src/domain/listing_image_backfill";

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
