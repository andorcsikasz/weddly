// Backfill map coordinates onto DB-backed listings (community submissions and
// registered vendors' own cards) from the address the submitter typed.
//
// The directory map can only draw a listing that has lat/lng. Curated entries
// get theirs from `suppliers_data.ts` (hand-pinned VENUE_COORDS + the generated
// GEOCODED_COORDS block), but nothing ever filled them in for the rows that
// live in the `listings` table, so a community or vendor card was invisible on
// the Map tab no matter how complete its address was.
//
// Deliberately NOT a worker and NOT on any request path: the upstream is a
// public fair-use geocoder (Photon/OSM, the same one the address autocomplete
// uses), so the calls are throttled and driven by
// `bun backend/scripts/geocode_listings.ts`. `geo_synced_at` records the last
// attempt: including misses: so repeated runs walk forward instead of
// hammering the same unresolvable address.

import { suggestAddresses } from "../lib/address_suggest";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { CITY_COORDS } from "./suppliers_data";

/** Photon asks for fair use; one request per second with a little headroom. */
const THROTTLE_MS = 1_100;
/** A hit further than this from the town we expect is a same-named street in
 *  another country, not this business. */
const MAX_KM_FROM_TOWN = 40;

interface GeocodeCandidate {
  id: string;
  name: string;
  city: string;
  address: string | null;
}

export interface GeocodeResult {
  /** Listings we asked the geocoder about. */
  attempted: number;
  /** Listings whose lat/lng we wrote. */
  placed: number;
  /** Lookups with no usable answer: stamped and retried on a later run. */
  missed: number;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Strips the ", XX" country suffix curated cities carry. */
function bareCity(city: string): string {
  return city.replace(/,\s*[A-Z]{2}$/, "").trim();
}

/** Geocode up to `limit` un-placed listings. Never touches a row that already
 *  has coordinates, and only accepts a hit that lands in the town the listing
 *  claims: a wrong pin is worse than no pin, so an unverifiable answer leaves
 *  the row alone (it just keeps missing from the map). */
export async function geocodeListings(limit: number): Promise<GeocodeResult> {
  const candidates = db
    .prepare(
      `SELECT id, name, city, address
         FROM listings
        WHERE status = 'active'
          AND source != 'curated'
          AND (lat IS NULL OR lng IS NULL)
          AND address IS NOT NULL AND TRIM(address) != ''
          AND geo_synced_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ?`,
    )
    .all(limit) as GeocodeCandidate[];

  const write = db.prepare(
    "UPDATE listings SET lat = ?, lng = ?, geo_synced_at = ?, updated_at = ? WHERE id = ?",
  );
  const stamp = db.prepare("UPDATE listings SET geo_synced_at = ? WHERE id = ?");

  let placed = 0;
  let missed = 0;
  for (const [i, c] of candidates.entries()) {
    if (i > 0) await Bun.sleep(THROTTLE_MS);
    const town = bareCity(c.city);
    const hits = await suggestAddresses([c.address, town].filter(Boolean).join(", "), "en");
    if (hits === null) {
      // Upstream failure, not a bad address: leave geo_synced_at NULL so the
      // next run retries this row.
      log.warn("listing_geocode: upstream failure", { id: c.id });
      missed++;
      continue;
    }
    const anchor = CITY_COORDS[c.city] ?? CITY_COORDS[town] ?? null;
    const hit = hits.find((h) => {
      if (h.lat == null || h.lng == null) return false;
      if (anchor) return haversineKm(anchor.lat, anchor.lng, h.lat, h.lng) <= MAX_KM_FROM_TOWN;
      // A postcode-level hit carries no `city`, so the label is the fallback
      // check: it always spells the settlement out.
      return normalize(h.city ?? h.label).includes(normalize(town));
    });
    const ts = now();
    if (!hit || hit.lat == null || hit.lng == null) {
      stamp.run(ts, c.id);
      missed++;
      continue;
    }
    write.run(hit.lat, hit.lng, ts, ts, c.id);
    placed++;
  }
  return { attempted: candidates.length, placed, missed };
}
