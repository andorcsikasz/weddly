// Auto-fill a supplier listing's hero image from its own website. Most curated
// venues (suppliers_data.ts) ship with no photo, so their card falls back to a
// category-icon placeholder. This resolves the website's og:image, downloads
// the bytes, stores them under the same `listings/<id>/hero.<ext>` key a vendor
// upload uses, and writes the public URL into `listings.hero_image_url` — which
// is the authoritative field the supplier card reads (routes/suppliers.ts
// overlays it onto both the list and detail views).
//
// Design mirrors domain/wishlist_image_backfill:
//  - Non-blocking: server.ts fires the sweep AFTER Bun.serve() is listening and
//    never awaits it, so a slow venue site can't delay readiness.
//  - One attempt per row: every attempt stamps `hero_checked_at` (hit or miss),
//    so a site without a usable og:image is tried exactly once and never
//    re-hammered on the next deploy.
//  - Vendor-owned listings are skipped (vendor_account_id set) — a paying vendor
//    manages their own hero via vendor_listing.ts, which always wins.
//  - Bounded fan-out: a small worker pool keeps a burst of legacy rows from
//    opening dozens of simultaneous outbound fetches.

import { db, now } from "../db";
import { fetchLinkPreview } from "../lib/link_preview";
import { fetchRemoteImage } from "../lib/remote_image";
import { log } from "../lib/logger";
import { storage } from "../lib/storage";

// Curated directory is ~hundreds of rows; the cap just stops a pathological DB
// from spinning the worker forever.
const MAX_ROWS = 2000;
// fetchLinkPreview + fetchRemoteImage each time out within a few seconds, so a
// handful in flight keeps the sweep quick without a thundering herd.
const CONCURRENCY = 4;

// Quality gate. A homepage og:image is often a tiny logo or a skinny
// promo-banner, neither of which makes a good card hero. We reject what we can
// measure as too small or too elongated; when the dimensions are unknown
// (unparseable header) we DON'T block, so a good image is never dropped just
// because we couldn't read its size. og:image best practice is 1200x630, so
// these thresholds clear every real photo while filtering the obvious junk.
const MIN_SHORT_EDGE = 200;
const MIN_LONG_EDGE = 400;
const MAX_ASPECT_RATIO = 4;

/** True when an image is good enough to use as a card hero. Unmeasured images
 *  (width/height null) pass — the gate only rejects what it can prove is junk. */
export function isAcceptableHero(width: number | null, height: number | null): boolean {
  if (!width || !height) return true; // unknown size — don't block
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_SHORT_EDGE || long < MIN_LONG_EDGE) return false;
  if (long / short > MAX_ASPECT_RATIO) return false;
  return true;
}

const markCheckedStmt = db.prepare("UPDATE listings SET hero_checked_at = ? WHERE id = ?");
// Note: deliberately does NOT bump `updated_at` — a hero backfill isn't a
// content edit, and listings.updated_at feeds the content-hash sync.
const applyHeroStmt = db.prepare(
  "UPDATE listings SET hero_image_url = ?, hero_checked_at = ? WHERE id = ?",
);

interface BackfillRow {
  id: string;
  website: string;
}

/** Rows eligible for an auto hero: active, not vendor-owned, with a website but
 *  no hero and never previously attempted. Exported for tests. */
export function listListingsNeedingHeroBackfill(limit: number): BackfillRow[] {
  return db
    .prepare(
      `SELECT id, website FROM listings
         WHERE vendor_account_id IS NULL
           AND hero_image_url IS NULL
           AND hero_checked_at IS NULL
           AND status = 'active'
           AND website IS NOT NULL
           AND TRIM(website) != ''
         ORDER BY id ASC
         LIMIT ?`,
    )
    .all(limit) as BackfillRow[];
}

/** Resolve a listing's website → og:image → download bytes → store under
 *  `listings/<id>/hero.<ext>` and persist the public URL. Stamps
 *  `hero_checked_at` on every attempt (hit or miss) so a site without a usable
 *  image drops out of the backfill set permanently. Returns true only when an
 *  image was actually stored. Never throws.
 *
 *  Also the per-row entry point reused at community-submission time so a freshly
 *  submitted supplier gets a hero alongside its text enrichment.
 *
 *  `skipQualityGate` lets an admin manual re-fetch accept an image the size gate
 *  would otherwise reject (their explicit override beats the heuristic). */
export async function fetchAndStoreListingHero(
  id: string,
  website: string,
  opts: { skipQualityGate?: boolean } = {},
): Promise<boolean> {
  let img: Awaited<ReturnType<typeof fetchRemoteImage>> = null;
  try {
    const preview = await fetchLinkPreview(website);
    img = preview.image_url ? await fetchRemoteImage(preview.image_url) : null;
  } catch {
    // fetchLinkPreview / fetchRemoteImage are soft by contract; belt-and-braces.
    img = null;
  }

  if (img && !opts.skipQualityGate && !isAcceptableHero(img.width, img.height)) {
    // Measurably too small / too elongated to be a real hero (likely a logo or
    // banner). Stamp it checked so the sweep doesn't retry the same junk.
    log.info("listing.hero_backfill.rejected_quality", {
      id,
      width: img.width,
      height: img.height,
    });
    img = null;
  }

  if (!img) {
    markCheckedStmt.run(now(), id);
    return false;
  }

  try {
    const key = `listings/${id}/hero.${img.ext}`;
    await storage.write(key, img.bytes);
    const ts = now();
    applyHeroStmt.run(`/uploads/${key}?v=${ts}`, ts, id);
    return true;
  } catch (err) {
    // A storage/DB failure is our-side and likely transient — do NOT stamp, so
    // the next boot retries the row rather than abandoning it.
    log.warn("listing.hero_backfill.store_failed", { id, error: String(err) });
    return false;
  }
}

/** Sweep listings missing a hero and resolve each once. Safe to call on every
 *  boot: once stamped, rows never re-enter the set. */
export async function runListingImageBackfill(): Promise<void> {
  const rows = listListingsNeedingHeroBackfill(MAX_ROWS);
  if (rows.length === 0) return;

  log.info("listing.hero_backfill.start", { count: rows.length });
  let resolved = 0;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row?.website) continue;
      if (await fetchAndStoreListingHero(row.id, row.website)) resolved++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  log.info("listing.hero_backfill.done", { attempted: rows.length, resolved });
}

/** Fire-and-forget entry point for boot. Swallows any error so a backfill
 *  hiccup never takes down the server. */
export function startListingImageBackfill(): void {
  void runListingImageBackfill().catch((err) => {
    log.warn("listing.hero_backfill.failed", { error: String(err) });
  });
}
