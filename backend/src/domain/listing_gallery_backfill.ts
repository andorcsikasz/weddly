// Re-host a curated venue's portfolio gallery locally. Most curated venues
// (suppliers_data.ts) ship a `gallery_urls` array that hotlinks the venue's own
// website (e.g. https://herdadedoperu.com/wp-content/uploads/…). The supplier
// detail page renders those directly as <img src>, but our CSP `img-src`
// allow-list only permits `'self'` plus a handful of fixed hosts — so an
// arbitrary vendor-website URL is BLOCKED by the browser and paints a broken
// thumbnail. This sweep downloads each seed image once and re-hosts it under the
// same `listings/<id>/gallery/…` key a vendor upload uses, inserting a
// `listing_photos` row. routes/suppliers.ts then serves those local (CSP-safe)
// URLs as the detail-page thumbnail strip.
//
// Design mirrors domain/listing_image_backfill (the hero sweep):
//  - Non-blocking: server.ts fires it AFTER Bun.serve() is listening and never
//    awaits it, so a slow venue site can't delay readiness.
//  - One attempt per row: every attempt stamps `gallery_checked_at` (hit or
//    miss), so a venue whose images 404 is tried exactly once and never
//    re-hammered on the next deploy.
//  - Vendor-owned listings are skipped (vendor_account_id set) and any listing
//    that already has uploaded photos is left alone — a paying vendor manages
//    their own gallery via vendor_listing.ts, which always wins.
//  - The seed's first image is the hero (DIRECTORY sets `hero_image_url =
//    gallery_urls[0]`), so the gallery strip is seed[1..]; when a venue never
//    got a hero, seed[0] is promoted+cached as one so the detail page still
//    opens on a real photo instead of the placeholder.

import { db, now } from "../db";
import { addListingPhoto, countListingPhotos } from "./listings";
import { DIRECTORY } from "./suppliers_data";
import { fetchRemoteImage } from "../lib/remote_image";
import { log } from "../lib/logger";
import { storage } from "../lib/storage";

// Curated directory is a few thousand rows at most; the cap just stops a
// pathological DB from spinning the worker forever.
const MAX_ROWS = 5000;
// fetchRemoteImage times out within a few seconds, so a handful in flight keeps
// the sweep quick without a thundering herd of outbound fetches.
const CONCURRENCY = 4;
// Cap on portfolio thumbnails re-hosted per venue (beyond the hero). Bounds the
// per-boot download volume and matches the "a handful of photos" gallery the
// detail page is designed around; well under the vendor upload cap so a claimed
// vendor still has room to add their own.
export const GALLERY_BACKFILL_CAP = 7;

// Seed gallery keyed by listing id, built once. Only ids with a non-empty seed
// gallery are ever candidates.
const SEED_GALLERY_BY_ID: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const s of DIRECTORY) {
    if (s.gallery_urls && s.gallery_urls.length > 0) m.set(s.id, s.gallery_urls);
  }
  return m;
})();

const markCheckedStmt = db.prepare("UPDATE listings SET gallery_checked_at = ? WHERE id = ?");
// Promote seed[0] to the hero for a venue that never resolved one. Also stamps
// hero_checked_at so the hero sweep treats the row as settled. Deliberately does
// NOT bump updated_at — a backfill isn't a content edit.
const applyHeroStmt = db.prepare(
  "UPDATE listings SET hero_image_url = ?, hero_checked_at = ? WHERE id = ?",
);

interface GalleryBackfillRow {
  id: string;
  urls: string[];
  hasHero: boolean;
}

/** Rows eligible for a gallery backfill: active, not vendor-owned, never
 *  attempted, with a non-empty seed gallery and no existing uploaded photos.
 *  Exported for tests. */
export function listListingsNeedingGalleryBackfill(limit: number): GalleryBackfillRow[] {
  const rows = db
    .prepare(
      `SELECT id, hero_image_url FROM listings
         WHERE vendor_account_id IS NULL
           AND gallery_checked_at IS NULL
           AND status = 'active'
         ORDER BY id ASC`,
    )
    .all() as { id: string; hero_image_url: string | null }[];
  const out: GalleryBackfillRow[] = [];
  for (const r of rows) {
    const urls = SEED_GALLERY_BY_ID.get(r.id);
    if (!urls || urls.length === 0) continue;
    // Never clobber a gallery a vendor is already curating.
    if (countListingPhotos(r.id) > 0) continue;
    out.push({ id: r.id, urls, hasHero: r.hero_image_url !== null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Download a curated venue's seed gallery → re-host each under
 *  `listings/<id>/gallery/…` and insert a `listing_photos` row. seed[0] is the
 *  hero image: skipped from the strip when the venue already has a hero, or
 *  promoted+stored as the hero when it has none. Stamps `gallery_checked_at` on
 *  every attempt (hit or miss) so the row drops out of the set permanently.
 *  Returns the number of thumbnails stored. Never throws.
 *
 *  `urls`/`hasHero` are read from the seed by the caller; passing them in keeps
 *  the per-row entry point reusable at community-submission time. */
export async function fetchAndStoreListingGallery(
  id: string,
  urls: string[],
  hasHero: boolean,
): Promise<number> {
  let heroResolved = hasHero;

  // No hero yet? Try to promote seed[0] so the detail page opens on a real
  // photo. On success it becomes the hero (not a thumbnail); on failure we fall
  // through and seed[0] simply stays out of the strip.
  if (!heroResolved && urls[0]) {
    const heroImg = await safeFetch(urls[0]);
    if (heroImg) {
      try {
        const key = `listings/${id}/hero.${heroImg.ext}`;
        await storage.write(key, heroImg.bytes);
        const ts = now();
        applyHeroStmt.run(`/uploads/${key}?v=${ts}`, ts, id);
        heroResolved = true;
      } catch (err) {
        log.warn("listing.gallery_backfill.hero_store_failed", { id, error: String(err) });
      }
    }
  }

  // The strip is every seed image after the hero shot (index 0), capped.
  const thumbs = urls.slice(1, 1 + GALLERY_BACKFILL_CAP);
  let stored = 0;
  for (const url of thumbs) {
    const img = await safeFetch(url);
    if (!img) continue;
    try {
      const key = `listings/${id}/gallery/seed-${stored + 1}.${img.ext}`;
      await storage.write(key, img.bytes);
      addListingPhoto(id, `/uploads/${key}`);
      stored++;
    } catch (err) {
      log.warn("listing.gallery_backfill.store_failed", { id, error: String(err) });
    }
  }

  markCheckedStmt.run(now(), id);
  return stored;
}

/** fetchRemoteImage is soft by contract (returns null, never throws), but
 *  belt-and-braces so one bad URL can't abort a venue's whole strip. */
async function safeFetch(url: string): Promise<Awaited<ReturnType<typeof fetchRemoteImage>>> {
  try {
    return await fetchRemoteImage(url);
  } catch {
    return null;
  }
}

/** Sweep curated listings missing a re-hosted gallery and resolve each once.
 *  Safe to call on every boot: once stamped, rows never re-enter the set. */
export async function runListingGalleryBackfill(): Promise<void> {
  const rows = listListingsNeedingGalleryBackfill(MAX_ROWS);
  if (rows.length === 0) return;

  log.info("listing.gallery_backfill.start", { count: rows.length });
  let resolved = 0;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row) continue;
      resolved += await fetchAndStoreListingGallery(row.id, row.urls, row.hasHero);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  log.info("listing.gallery_backfill.done", { attempted: rows.length, photos: resolved });
}

/** Fire-and-forget entry point for boot. Swallows any error so a backfill
 *  hiccup never takes down the server. */
export function startListingGalleryBackfill(): void {
  void runListingGalleryBackfill().catch((err) => {
    log.warn("listing.gallery_backfill.failed", { error: String(err) });
  });
}
