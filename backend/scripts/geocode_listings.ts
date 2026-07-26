// Put DB-backed listings (community submissions + registered vendors' own
// cards) on the directory map by geocoding the address their submitter typed.
// Curated entries are NOT touched here — their coords ship in
// `suppliers_data.ts` (regenerate those with `scripts/geocode_directory.ts`).
//
// Usage:
//   bun backend/scripts/geocode_listings.ts [limit]      # default 100
//
// Bounded and re-runnable: every attempt stamps `geo_synced_at`, so a second
// run picks up the rows that have appeared since instead of re-asking about an
// address the geocoder already failed to place. Upstream is the public Photon
// instance, so the run is throttled to ~1 request/second and a few hundred rows
// take a few minutes.

import { geocodeListings } from "../src/domain/listing_geocode";

const limit = Number.parseInt(process.argv[2] ?? "100", 10);
if (!Number.isInteger(limit) || limit < 1) {
  console.error(`Invalid limit "${process.argv[2]}" — pass a positive integer.`);
  process.exit(1);
}

console.log(`[geocode_listings] resolving up to ${limit} listing(s)…`);
const r = await geocodeListings(limit);
console.log(
  `[geocode_listings] attempted ${r.attempted}, placed ${r.placed}, no usable hit ${r.missed}.`,
);
if (r.attempted === 0) {
  console.log("[geocode_listings] nothing to do — every listing with an address is placed.");
}
process.exit(0);
