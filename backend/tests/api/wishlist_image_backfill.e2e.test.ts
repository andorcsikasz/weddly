// Wishlist og:image backfill + the image_checked_at marker. New/edited rows
// are stamped at write time so the boot sweep only ever touches legacy rows
// (a link but no thumbnail, never attempted), exactly once each. The sweep
// runs against a blocked localhost URL here so it exercises the soft-fail path
// without any real network.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import type { WishlistItem } from "@shared/wishlist";
import {
  listWishlistRowsNeedingImageBackfill,
  applyBackfilledImage,
} from "../../src/domain/wishlist";
import { runWishlistImageBackfill } from "../../src/domain/wishlist_image_backfill";

function rowOf(id: number): {
  url: string | null;
  image_url: string | null;
  image_checked_at: number | null;
} {
  return db
    .prepare("SELECT url, image_url, image_checked_at FROM wishlist_items WHERE id = ?")
    .get(id) as { url: string | null; image_url: string | null; image_checked_at: number | null };
}

/** Insert a pre-feature row directly: a link, no image, never attempted — the
 *  exact shape the backfill exists to fix. The route layer would stamp
 *  image_checked_at, so we bypass it. */
function insertLegacyRow(coupleId: number, url: string | null): number {
  const r = db
    .prepare(
      `INSERT INTO wishlist_items
         (couple_id, title, kind, url, image_url, image_checked_at, sort_order, created_at, updated_at)
       VALUES (?, 'legacy', 'item', ?, NULL, NULL, 0, 0, 0)`,
    )
    .run(coupleId, url);
  return Number(r.lastInsertRowid);
}

describe("wishlist image_checked_at marker", () => {
  test("create with failed image leaves image_checked_at null (backfill-eligible); no link leaves it null too", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-stamp@weddly.test");

    const withLink = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Espresso", url: "http://127.0.0.1/blocked" },
      { token },
    );
    expect(withLink.status).toBe(201);
    // Blocked host -> soft null image; NOT stamped so the boot backfill can retry.
    expect(rowOf(withLink.data.item.id).image_url).toBeNull();
    expect(rowOf(withLink.data.item.id).image_checked_at).toBeNull();
    expect(listWishlistRowsNeedingImageBackfill(100).map((r) => r.id)).toContain(
      withLink.data.item.id,
    );

    const noLink = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Cash fund" },
      { token },
    );
    expect(noLink.status).toBe(201);
    expect(rowOf(noLink.data.item.id).image_checked_at).toBeNull();
  });
});

describe("wishlist image backfill sweep", () => {
  test("legacy rows are listed, swept once, then never re-swept", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-backfill@weddly.test");

    const legacyWithLink = insertLegacyRow(coupleId, "http://127.0.0.1/blocked");
    const legacyNoLink = insertLegacyRow(coupleId, null);

    // Only the linked, never-attempted row is in the backfill set.
    const pending = listWishlistRowsNeedingImageBackfill(100);
    const pendingIds = pending.map((r) => r.id);
    expect(pendingIds).toContain(legacyWithLink);
    expect(pendingIds).not.toContain(legacyNoLink);

    // Sweep. The blocked host yields a soft null image, but the row gets
    // stamped so it leaves the set.
    await runWishlistImageBackfill();

    expect(rowOf(legacyWithLink).image_checked_at).not.toBeNull();
    expect(rowOf(legacyWithLink).image_url).toBeNull();
    expect(listWishlistRowsNeedingImageBackfill(100).map((r) => r.id)).not.toContain(
      legacyWithLink,
    );

    // Re-running is a no-op on the stamped row (idempotent across deploys).
    const stampBefore = rowOf(legacyWithLink).image_checked_at;
    await runWishlistImageBackfill();
    expect(rowOf(legacyWithLink).image_checked_at).toBe(stampBefore);
  });

  test("applyBackfilledImage persists a resolved image and stamps the attempt", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-apply@weddly.test");
    const id = insertLegacyRow(coupleId, "https://shop.example/x");

    applyBackfilledImage(id, "https://cdn.example/x.jpg");
    const row = rowOf(id);
    expect(row.image_url).toBe("https://cdn.example/x.jpg");
    expect(row.image_checked_at).not.toBeNull();
    expect(listWishlistRowsNeedingImageBackfill(100).map((r) => r.id)).not.toContain(id);
  });
});

describe("wishlist re-save recovery", () => {
  test("editing an image-less item re-attempts the og:image without changing the link", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("wishlist-recovery@weddly.test");

    // Legacy row: link present, no image, unstamped.
    const id = insertLegacyRow(coupleId, "http://127.0.0.1/blocked");
    const before = rowOf(id);
    expect(before.image_url).toBeNull();

    // Patch only the title (link unchanged). The handler re-resolves because
    // the image is missing; the blocked host keeps it null but the attempt is
    // now stamped — the code path ran without erroring.
    const patched = await req<{ item: WishlistItem }>(
      "PATCH",
      `/api/wishlist/${id}`,
      { title: "Espresso (renamed)" },
      { token, headers: { "If-Match": "0" } },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.item.title).toBe("Espresso (renamed)");
    expect(rowOf(id).image_checked_at).not.toBeNull();
  });
});
