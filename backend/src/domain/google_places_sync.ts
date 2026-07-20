// Backfill Google Places ratings onto directory listings. Ratings are a
// ranking input for the public browse teaser (`/api/public/vendor-showcase`):
// the visitor's country leads, registered Weddly vendors next, and inside those
// tiers a better-rated business comes first.
//
// Deliberately NOT a worker and NOT on any request path — the Places API bills
// per call. `bun backend/scripts/google_places_sync.ts` is the only caller, and
// it re-checks a listing at most every REFRESH_AFTER_MS.

import { db, now } from "../db";
import { lookupPlaceRating, placesConfigured } from "../lib/google_places";
import { log } from "../lib/logger";
import { curatedCountry } from "./suppliers_data";

/** How stale a rating may get before the next run refreshes it. Ratings move
 *  slowly and every refresh costs money, so a month is plenty. */
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

interface SyncCandidate {
  id: string;
  name: string;
  city: string;
  source: string;
  owner_country: string | null;
}

export interface PlacesSyncResult {
  /** Listings we asked Google about. */
  attempted: number;
  /** Listings whose rating columns we wrote. */
  updated: number;
  /** Lookups that found nothing (or failed) — left untouched, retried later. */
  missed: number;
  /** True when no key is configured, in which case nothing ran. */
  skipped: boolean;
}

/** Resolve + store ratings for up to `limit` listings that have never been
 *  synced or whose rating is older than REFRESH_AFTER_MS. Oldest first, so
 *  repeated runs walk the whole catalogue instead of re-doing the same rows. */
export async function syncPlaceRatings(limit: number): Promise<PlacesSyncResult> {
  if (!placesConfigured()) {
    log.info("google_places: no GOOGLE_PLACES_API_KEY, sync skipped");
    return { attempted: 0, updated: 0, missed: 0, skipped: true };
  }
  const cutoff = now() - REFRESH_AFTER_MS;
  const candidates = db
    .prepare(
      `SELECT l.id, l.name, l.city, l.source, va.country AS owner_country
         FROM listings l
         LEFT JOIN vendor_accounts va ON va.id = l.vendor_account_id
        WHERE l.status = 'active'
          AND (l.google_synced_at IS NULL OR l.google_synced_at < ?)
        ORDER BY l.google_synced_at IS NOT NULL, l.google_synced_at ASC
        LIMIT ?`,
    )
    .all(cutoff, limit) as SyncCandidate[];

  const write = db.prepare(
    `UPDATE listings
        SET google_place_id = ?, google_rating = ?, google_ratings_count = ?, google_synced_at = ?
      WHERE id = ?`,
  );
  // A miss still stamps the timestamp, otherwise an unfindable business would
  // be retried on every single run and quietly burn the quota.
  const stampMiss = db.prepare("UPDATE listings SET google_synced_at = ? WHERE id = ?");

  let updated = 0;
  let missed = 0;
  for (const c of candidates) {
    const country =
      c.source === "claimed" && c.owner_country
        ? c.owner_country.toUpperCase()
        : curatedCountry(c.id, c.city);
    const found = await lookupPlaceRating({ name: c.name, city: c.city, country });
    if (!found) {
      stampMiss.run(now(), c.id);
      missed++;
      continue;
    }
    write.run(found.place_id, found.rating, found.ratings_count, now(), c.id);
    updated++;
  }
  log.info("google_places: sync finished", { attempted: candidates.length, updated, missed });
  return { attempted: candidates.length, updated, missed, skipped: false };
}
