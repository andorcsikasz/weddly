// "My location" usage on the /app/suppliers map. The browser hands the couple's
// coordinate to the page; the page posts it here once, and what we KEEP is the
// town and the district the coordinate falls in, never the coordinate itself.
// That is the promise the pre-permission dialog makes, and it is also all the
// admin question ("is the button used, and where from?") needs.
//
// Reverse geocoding goes to Nominatim at zoom 14 (suburb level), the same free
// OSM service maps_resolver already uses. Its fair-use policy is 1 req/s, so
// lookups are cached on a ~1 km grid and the route rate-limits per caller.

import { db } from "../db";
import { log } from "../lib/logger";

const USER_AGENT = "weddly-map-locate/0.1 (hello@tryweddly.com)";
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 2_000;
/** A repeat tap from the same person in the same place inside this window is
 *  one use, not several: the button is often pressed twice while it pulses. */
export const MAP_LOCATE_DEDUPE_MS = 30 * 60 * 1000;

export interface MapLocateArea {
  country: string | null;
  city: string | null;
  district: string | null;
}

interface NominatimArea {
  address?: {
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    city_district?: string;
    district?: string;
    borough?: string;
    suburb?: string;
    quarter?: string;
  };
}

const EMPTY: MapLocateArea = { country: null, city: null, district: null };

function clean(s: string | undefined): string | null {
  const v = s?.trim();
  return v ? v.slice(0, 120) : null;
}

export function areaFromNominatim(data: NominatimArea): MapLocateArea {
  const a = data.address ?? {};
  const city = clean(a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet);
  // Budapest answers "VII. kerület" in city_district and "Erzsébetváros" in
  // suburb; the numbered district is what people there say, so it wins.
  const district = clean(a.city_district ?? a.district ?? a.borough ?? a.suburb ?? a.quarter);
  return {
    country: a.country_code ? a.country_code.toUpperCase().slice(0, 2) : null,
    city,
    // A village whose "suburb" is itself adds nothing.
    district: district && district !== city ? district : null,
  };
}

/** Deterministic answers for the E2E suite (ADDRESS_SUGGEST_FAKE=1): Budapest
 *  with a district, anywhere else a town with none. */
function fakeArea(lat: number): MapLocateArea {
  if (lat > 47 && lat < 48) {
    return areaFromNominatim({
      address: {
        country_code: "hu",
        city: "Budapest",
        city_district: "VII. kerület",
        suburb: "Erzsébetváros",
      },
    });
  }
  return areaFromNominatim({ address: { country_code: "hu", town: "Szeged", suburb: "Szeged" } });
}

const cache = new Map<string, { at: number; area: MapLocateArea }>();

export async function reverseGeocodeArea(lat: number, lng: number): Promise<MapLocateArea> {
  if (process.env.ADDRESS_SUGGEST_FAKE === "1") return fakeArea(lat);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.area;

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`;
  let area = EMPTY;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("map_locate.upstream_status", { status: res.status });
      return EMPTY;
    }
    area = areaFromNominatim((await res.json()) as NominatimArea);
  } catch (e) {
    log.warn("map_locate.upstream_throw", { error: String(e) });
    return EMPTY;
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), area });
  return area;
}

/** Records one use. A lookup that found nothing is still a use of the button,
 *  so it is stored with null place fields rather than dropped. */
export function recordMapLocate(userId: number, area: MapLocateArea, now = Date.now()): boolean {
  const recent = db
    .prepare(
      `SELECT 1 FROM map_locate_events
        WHERE user_id = ? AND created_at > ?
          AND city IS ? AND district IS ?
        LIMIT 1`,
    )
    .get(userId, now - MAP_LOCATE_DEDUPE_MS, area.city, area.district);
  if (recent) return false;
  db.prepare(
    `INSERT INTO map_locate_events (user_id, country, city, district, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, area.country, area.city, area.district, now);
  return true;
}
