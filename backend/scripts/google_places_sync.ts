// Refresh Google Places ratings on directory listings. The public browse
// teaser ranks each country's vendors by these ratings, so run this whenever
// the catalogue grows (or on a monthly cron) to keep the ordering honest.
//
// Usage:
//   GOOGLE_PLACES_API_KEY=... bun backend/scripts/google_places_sync.ts [limit]
//
// `limit` (default 200) caps how many listings one run resolves — the Places
// API bills per call, so the run is deliberately bounded and re-runnable: it
// always takes the never-synced and longest-stale rows first, and a listing is
// only re-checked once its rating is a month old.

import { syncPlaceRatings } from "../src/domain/google_places_sync";
import { placesConfigured } from "../src/lib/google_places";

if (!placesConfigured()) {
  console.error(
    "GOOGLE_PLACES_API_KEY is required. Run with: GOOGLE_PLACES_API_KEY=... bun backend/scripts/google_places_sync.ts",
  );
  process.exit(1);
}

const limit = Number.parseInt(process.argv[2] ?? "200", 10);
if (!Number.isInteger(limit) || limit < 1) {
  console.error(`Invalid limit "${process.argv[2]}" — pass a positive integer.`);
  process.exit(1);
}

console.log(`[google_places_sync] resolving up to ${limit} listing(s)…`);
const r = await syncPlaceRatings(limit);
console.log(
  `[google_places_sync] attempted ${r.attempted}, updated ${r.updated}, not found ${r.missed}.`,
);
if (r.attempted === 0) {
  console.log("[google_places_sync] nothing was stale — every listing is up to date.");
}
