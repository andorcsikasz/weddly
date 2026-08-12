// Curated venue gallery re-hosting + the gallery_checked_at marker, plus the
// CSP-safety guarantee it protects: the supplier detail payload must only ever
// emit local `/uploads/…` gallery URLs, never a raw vendor-website URL from the
// static seed (which the browser's CSP img-src blocks → broken thumbnails).
//
// The fetch path is exercised against a blocked localhost URL so it hits the
// soft-fail branch with no real network — the boot sweep itself never runs in
// tests (server.ts guards it behind NODE_ENV !== "test").

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db, now } from "../../src/db";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { addListingPhoto } from "../../src/domain/listings";
import {
  fetchAndStoreListingGallery,
  listListingsNeedingGalleryBackfill,
} from "../../src/domain/listing_gallery_backfill";

/** A curated listing that ships a multi-image seed gallery — the whole reason
 *  the backfill exists. Read from the live seed so the test tracks real data. */
function curatedWithGallery(): { id: string; urls: string[] } {
  const s = DIRECTORY.find((d) => d.gallery_urls && d.gallery_urls.length > 1);
  if (!s || !s.gallery_urls) throw new Error("no curated entry with a seed gallery");
  return { id: s.id, urls: s.gallery_urls };
}

function galleryRow(id: string): {
  hero_image_url: string | null;
  gallery_checked_at: number | null;
} {
  return db
    .prepare("SELECT hero_image_url, gallery_checked_at FROM listings WHERE id = ?")
    .get(id) as { hero_image_url: string | null; gallery_checked_at: number | null };
}

const eligibleIds = (limit: number) => listListingsNeedingGalleryBackfill(limit).map((r) => r.id);

// wipeAll keeps curated `listings` rows as-is and never touches `listing_photos`,
// so mutations to the shared curated row (stamping gallery_checked_at, adding a
// photo, claiming) would leak between tests. Reset the one target row to a clean,
// deterministic baseline before each test.
const TARGET = curatedWithGallery();
beforeEach(() => {
  wipeAll();
  db.prepare("DELETE FROM listing_photos WHERE listing_id = ?").run(TARGET.id);
  db.prepare(
    "UPDATE listings SET gallery_checked_at = NULL, hero_image_url = NULL, vendor_account_id = NULL, status = 'active' WHERE id = ?",
  ).run(TARGET.id);
});

describe("listing gallery backfill eligibility", () => {
  test("a curated listing with a seed gallery is eligible", () => {
    const { id } = curatedWithGallery();
    expect(eligibleIds(5000)).toContain(id);
  });

  test("a stamped row drops out of the set", () => {
    const { id } = curatedWithGallery();
    db.prepare("UPDATE listings SET gallery_checked_at = ? WHERE id = ?").run(now(), id);
    expect(eligibleIds(5000)).not.toContain(id);
  });

  test("a listing that already has an uploaded photo is excluded", () => {
    const { id } = curatedWithGallery();
    addListingPhoto(id, "/uploads/listings/x/gallery/existing.jpg");
    expect(eligibleIds(5000)).not.toContain(id);
  });

  test("a vendor-claimed listing is excluded", async () => {
    const { id } = TARGET;
    // vendor_account_id is a real FK, so mint an account (user + row) to claim it.
    const reg = await registerAndVerify({
      email: "vendor-owner@test.test",
      password: "supersafe123",
      full_name: "Vendor",
    });
    const ts = now();
    const va = db
      .prepare(
        "INSERT INTO vendor_accounts (owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(reg.data.user.id, "Vendor Co", ts, ts);
    db.prepare("UPDATE listings SET vendor_account_id = ? WHERE id = ?").run(
      Number(va.lastInsertRowid),
      id,
    );
    expect(eligibleIds(5000)).not.toContain(id);
  });
});

describe("listing gallery backfill fetch", () => {
  test("blocked URLs stamp gallery_checked_at, store nothing, and drop the row out", async () => {
    const { id } = curatedWithGallery();
    expect(eligibleIds(5000)).toContain(id);

    const stored = await fetchAndStoreListingGallery(
      id,
      ["http://127.0.0.1/blocked-0", "http://127.0.0.1/blocked-1"],
      true, // hasHero — skip the promote path
    );
    expect(stored).toBe(0);

    expect(galleryRow(id).gallery_checked_at).not.toBeNull();
    expect(eligibleIds(5000)).not.toContain(id);
  });

  test("with no hero, a blocked seed[0] leaves the hero null (no half-written promotion)", async () => {
    const { id } = curatedWithGallery();
    db.prepare("UPDATE listings SET hero_image_url = NULL WHERE id = ?").run(id);

    const stored = await fetchAndStoreListingGallery(id, ["http://127.0.0.1/blocked"], false);
    expect(stored).toBe(0);

    const row = galleryRow(id);
    expect(row.hero_image_url).toBeNull();
    expect(row.gallery_checked_at).not.toBeNull();
  });
});

describe("supplier detail gallery is CSP-safe", () => {
  test("a curated listing with no re-hosted photos emits no external gallery URLs", async () => {
    const { id } = curatedWithGallery();
    // Strip the hero so the strip would collapse to the raw seed URLs under the
    // OLD behaviour; the new code must instead emit an empty/hero-only list.
    db.prepare("UPDATE listings SET hero_image_url = NULL WHERE id = ?").run(id);
    const { token } = await bootstrapCouple("couple-gallery-a@test.test");

    const res = await req<{ gallery_urls: string[] | null }>(
      "GET",
      `/api/suppliers/${id}`,
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    const urls = res.data.gallery_urls ?? [];
    // The seed's raw vendor-website URLs must never reach the client.
    expect(urls.every((u) => u.startsWith("/uploads/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("http"))).toBe(false);
  });

  test("unclaimed re-hosted photos stay private until a vendor owns the listing", async () => {
    const { id } = curatedWithGallery();
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      "/uploads/listings/x/hero.jpg",
      id,
    );
    addListingPhoto(id, "/uploads/listings/x/gallery/seed-1.jpg");
    addListingPhoto(id, "/uploads/listings/x/gallery/seed-2.jpg");
    const { token } = await bootstrapCouple("couple-gallery-b@test.test");

    const res = await req<{ gallery_urls: string[] | null }>(
      "GET",
      `/api/suppliers/${id}`,
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    const urls = res.data.gallery_urls ?? [];
    // A crawler-created/unclaimed record does not establish a publication
    // licence. Stored objects become public only after the vendor claims the
    // listing and explicitly manages its media.
    expect(urls).toEqual([]);
    expect(urls.some((u) => u.startsWith("http"))).toBe(false);
  });
});
