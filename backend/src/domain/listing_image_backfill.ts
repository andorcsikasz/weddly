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
//  - Every attempt stamps `hero_checked_at` (hit or miss). A MISS is retried
//    after RECHECK_AFTER_MS, not abandoned forever — same idiom as
//    domain/google_places_sync's `REFRESH_AFTER_MS`, and for the same reason:
//    a site that had nothing usable in June can easily have a real gallery by
//    September (measured directly — zichypark-hotel.hu's homepage had no
//    og:image and no candidate the first time it was checked; a later check
//    against the same code found a passable photo on the first body-image
//    candidate, because the site itself had changed in between).
//  - Vendor-owned listings are skipped (vendor_account_id set) — a paying vendor
//    manages their own hero via vendor_listing.ts, which always wins.
//  - Bounded fan-out: a small worker pool keeps a burst of legacy rows from
//    opening dozens of simultaneous outbound fetches.

import { db, now } from "../db";
import { seededGalleryIds } from "./listing_gallery_backfill";
import {
  fetchLinkPreview,
  fetchPageImageCandidates,
  withGalleryFullSizeCandidates,
} from "../lib/link_preview";
import { fetchRemoteImage } from "../lib/remote_image";
import { log } from "../lib/logger";
import { storage } from "../lib/storage";

// Curated directory is ~hundreds of rows; the cap just stops a pathological DB
// from spinning the worker forever.
const MAX_ROWS = 2000;
// fetchLinkPreview + fetchRemoteImage each time out within a few seconds, so a
// handful in flight keeps the sweep quick without a thundering herd.
const CONCURRENCY = 4;
// A miss is retried after a month, mirroring google_places_sync's own
// REFRESH_AFTER_MS — long enough that a dead domain isn't re-crawled on every
// deploy, short enough that a venue site rebuilt over a season gets picked up.
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// Quality gate. A homepage og:image is often a tiny logo or a skinny
// promo-banner, neither of which makes a good card hero. We reject what we can
// measure as too small or too elongated; when the dimensions are unknown
// (unparseable header) we DON'T block, so a good image is never dropped just
// because we couldn't read its size. og:image best practice is 1200x630, so
// these thresholds clear every real photo while filtering the obvious junk.
const MIN_SHORT_EDGE = 200;
const MIN_LONG_EDGE = 400;
const MAX_ASPECT_RATIO = 4;
// How many body-image candidates to download before giving up on a site.
// Measured against real misses: a header logo, a flag-icon row, or a run of
// gallery-plugin thumbnails routinely fills the first 4-8 slots before the
// first real photo (karolyi.org.hu's actual hero was candidate #5). Ten stays
// well under fetchPageImageCandidates's own 12-candidate cap while covering
// that run, without turning one listing into a crawl of the whole homepage.
const BODY_IMAGE_ATTEMPTS = 10;

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
 *  no hero — either never attempted, or last attempted far enough back
 *  (RECHECK_AFTER_MS) that the site has plausibly changed since.
 *
 *  A listing that ships a CURATED gallery seed is held back until the gallery
 *  sweep has had its turn (`gallery_checked_at` stamped). Both sweeps start
 *  unawaited at boot and race, and this one used to win — so a hand-picked
 *  seed[0] lost the hero slot to whatever the site happens to serve as its
 *  og:image. In practice that meant a "my three careers" collage for one
 *  photographer and a conference-stage photo for a wedding MC: accurate to the
 *  homepage, wrong for the card. The seed is the stronger signal, so it goes
 *  first. If the gallery sweep comes back empty, `gallery_checked_at` is
 *  stamped anyway and the next boot lets og:image fill in — the hold-back
 *  delays this sweep, it never cancels it.
 *
 *  Never-checked rows sort first, then oldest-checked — the rows that have
 *  had the longest to grow a real website win a re-check before a row that
 *  missed last week.
 *
 *  Exported for tests. */
export function listListingsNeedingHeroBackfill(limit: number): BackfillRow[] {
  const seeded = seededGalleryIds();
  const holdBack =
    seeded.length > 0
      ? `AND (gallery_checked_at IS NOT NULL OR id NOT IN (${seeded.map(() => "?").join(",")}))`
      : "";
  return db
    .prepare(
      `SELECT id, website FROM listings
         WHERE vendor_account_id IS NULL
           AND hero_image_url IS NULL
           AND (hero_checked_at IS NULL OR hero_checked_at < ?)
           AND status = 'active'
           AND website IS NOT NULL
           AND TRIM(website) != ''
           ${holdBack}
         ORDER BY hero_checked_at IS NOT NULL, hero_checked_at ASC, id ASC
         LIMIT ?`,
    )
    .all(now() - RECHECK_AFTER_MS, ...seeded, limit) as BackfillRow[];
}

/** Resolve a listing's website → og:image → download bytes → store under
 *  `listings/<id>/hero.<ext>` and persist the public URL. Stamps
 *  `hero_checked_at` on every attempt (hit or miss); a miss just leaves the row
 *  eligible again after RECHECK_AFTER_MS rather than dropping it forever.
 *  Returns true only when an image was actually stored. Never throws.
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
  const gate = (candidate: NonNullable<Awaited<ReturnType<typeof fetchRemoteImage>>>): boolean => {
    if (opts.skipQualityGate) return true;
    if (isAcceptableHero(candidate.width, candidate.height)) return true;
    // Measurably too small / too elongated to be a real hero (likely a logo or
    // banner). Rejected candidates fall through to the next one, and if none
    // survives the row is stamped checked so the sweep never retries the junk.
    log.info("listing.hero_backfill.rejected_quality", {
      id,
      width: candidate.width,
      height: candidate.height,
    });
    return false;
  };

  let img: Awaited<ReturnType<typeof fetchRemoteImage>> = null;
  try {
    const preview = await fetchLinkPreview(website);
    if (preview.image_url) {
      const candidate = await fetchRemoteImage(preview.image_url);
      if (candidate && gate(candidate)) img = candidate;
    }
  } catch {
    // fetchLinkPreview / fetchRemoteImage are soft by contract; belt-and-braces.
    img = null;
  }

  // No usable og:image. Most small venue sites don't have one at all, so fall
  // back to the photos in the page body — the slider and the gallery strip are
  // where these businesses actually put their pictures. Candidates are tried in
  // document order (the hero image of a site is near the top far more often
  // than not), expanded with each gallery-plugin thumbnail's full-size sibling,
  // and each still has to clear the quality gate, which is what keeps a stray
  // logo out. Capped, because a page can list dozens.
  if (!img) {
    try {
      const candidates = withGalleryFullSizeCandidates(await fetchPageImageCandidates(website));
      for (const url of candidates.slice(0, BODY_IMAGE_ATTEMPTS)) {
        const candidate = await fetchRemoteImage(url);
        if (candidate && gate(candidate)) {
          img = candidate;
          log.info("listing.hero_backfill.body_image", { id, url });
          break;
        }
      }
    } catch {
      img = null;
    }
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
