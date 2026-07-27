// Free-text address autocomplete over the public Photon geocoder
// (photon.komoot.io: OSM data, no API key, fair-use rate limits). Same
// infra contract as lib/company_lookup/client.ts: upstream timeout + error
// normalisation, a small in-memory TTL cache so per-keystroke repeats never
// re-hit the upstream, and an ADDRESS_SUGGEST_FAKE=1 escape hatch that runs
// the mapper against deterministic fixtures in the E2E suite. The route
// layer owns rate limiting and parameter validation; this module is
// app-agnostic.

import type { AddressSuggestion } from "@shared/geo";
import { log as logger } from "./logger";

const PHOTON_BASE = "https://photon.komoot.io/api";
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // addresses don't move
const CACHE_MAX_ENTRIES = 2_000;

export const MAX_SUGGESTIONS = 5;

// ── Photon GeoJSON shapes (only the parts the mapper reads) ────────────────

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    /** County / region. Only read in city mode, where it is what tells two
     *  same-named towns apart. */
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

/** Photon only localises names for a handful of languages; "hu" is not one
 *  of them, and the default (local names) is exactly what a Hungarian vendor
 *  expects for Hungarian streets, so only "en" is ever passed upstream. */
export type SuggestLang = "en" | "hu";

/** What the caller is picking. "address" is the original street-level typeahead
 *  (vendor signup, listing editor). "city" asks the geocoder for populated
 *  places only, so a form that stores a bare city name gets one canonical
 *  spelling per town instead of whatever the vendor typed — the values are what
 *  couples later filter the directory by. */
export type SuggestKind = "address" | "city";

/** Photon tags that mean "a place people live in". Anything smaller (hamlet,
 *  suburb, quarter) is deliberately out: a vendor picking "Zugló" instead of
 *  "Budapest" would fragment the very filter this mode exists to keep clean. */
const CITY_OSM_TAGS = ["place:city", "place:town", "place:village"] as const;

function toSuggestion(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties ?? {};
  const street = p.street ?? p.name ?? null;
  const address = street ? [street, p.housenumber].filter(Boolean).join(" ") : null;
  const cityLine = [p.postcode, p.city].filter(Boolean).join(" ");
  const label = [address, cityLine || null, p.country ?? null].filter(Boolean).join(", ");
  if (!label) return null;
  const [lng, lat] = f.geometry?.coordinates ?? [];
  return {
    label,
    address,
    city: p.city ?? null,
    postal_code: p.postcode ?? null,
    country: p.countrycode ? p.countrycode.toUpperCase() : null,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
  };
}

/** City mode: the feature IS the place, so its `name` is the value we want in
 *  the form and `city` is usually absent. Street/postcode fields are dropped
 *  rather than guessed at — this suggestion fills a city field, nothing else. */
function toCitySuggestion(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties ?? {};
  const name = p.city ?? p.name ?? null;
  if (!name) return null;
  const [lng, lat] = f.geometry?.coordinates ?? [];
  return {
    label: [name, p.state ?? null, p.country ?? null].filter(Boolean).join(", "),
    address: null,
    city: name,
    postal_code: null,
    country: p.countrycode ? p.countrycode.toUpperCase() : null,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
  };
}

// ── Deterministic fixtures for the E2E suite (ADDRESS_SUGGEST_FAKE=1) ──────
// Raw Photon payloads, so the mapping code above runs unmodified in tests.
// Queries containing "nomatch" return the upstream's empty answer.

const FAKE_FEATURES: PhotonFeature[] = [
  {
    geometry: { coordinates: [19.0653, 47.5063] },
    properties: {
      street: "Andrássy út",
      housenumber: "60",
      postcode: "1062",
      city: "Budapest",
      country: "Hungary",
      countrycode: "HU",
    },
  },
  {
    geometry: { coordinates: [19.0514, 47.4925] },
    properties: {
      street: "Váci utca",
      housenumber: "10",
      postcode: "1052",
      city: "Budapest",
      country: "Hungary",
      countrycode: "HU",
    },
  },
  {
    // POI-style hit: no street, only a name; exercises the name fallback.
    geometry: { coordinates: [4.8357, 45.764] },
    properties: {
      name: "Place Bellecour",
      postcode: "69002",
      city: "Lyon",
      country: "France",
      countrycode: "FR",
    },
  },
];

/** City-mode fixtures: place features as Photon returns them (a `name`, no
 *  street, no postcode), plus a duplicate row so the dedup is exercised. */
const FAKE_CITY_FEATURES: PhotonFeature[] = [
  {
    geometry: { coordinates: [19.0402, 47.4979] },
    properties: {
      name: "Budapest",
      state: "Central Hungary",
      country: "Hungary",
      countrycode: "HU",
    },
  },
  {
    // Same place from a second OSM extract — must collapse into the row above.
    geometry: { coordinates: [19.0403, 47.498] },
    properties: { name: "Budapest", country: "Hungary", countrycode: "HU" },
  },
  {
    geometry: { coordinates: [20.1414, 46.253] },
    properties: {
      name: "Szeged",
      state: "Csongrád-Csanád",
      country: "Hungary",
      countrycode: "HU",
    },
  },
];

function fakePhotonResponse(q: string, kind: SuggestKind): PhotonResponse {
  if (q.toLowerCase().includes("nomatch")) return { features: [] };
  return { features: kind === "city" ? FAKE_CITY_FEATURES : FAKE_FEATURES };
}

// ── Upstream fetch with TTL cache ──────────────────────────────────────────

const cache = new Map<string, { at: number; suggestions: AddressSuggestion[] }>();

/** Top suggestions for a free-text query. `null` = upstream failure (the
 *  route maps it to 502); `[]` = the geocoder answered with no match. */
export async function suggestAddresses(
  q: string,
  lang: SuggestLang,
  kind: SuggestKind = "address",
): Promise<AddressSuggestion[] | null> {
  // Kind is part of the cache key: the same query returns streets in one mode
  // and towns in the other.
  const key = `${kind} ${lang} ${q}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.suggestions;

  let body: PhotonResponse | null;
  if (process.env.ADDRESS_SUGGEST_FAKE === "1") {
    body = fakePhotonResponse(q, kind);
  } else {
    body = await fetchPhoton(q, lang, kind);
  }
  if (body === null) return null;

  const seen = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  for (const feature of body.features ?? []) {
    const s = kind === "city" ? toCitySuggestion(feature) : toSuggestion(feature);
    // City rows dedup on the value that lands in the form (name + country), not
    // on the label: two OSM extracts of one town differ only in the region line.
    const dedupKey = kind === "city" ? `${s?.city ?? ""}|${s?.country ?? ""}` : (s?.label ?? "");
    if (!s || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    suggestions.push(s);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), suggestions });
  return suggestions;
}

async function fetchPhoton(
  q: string,
  lang: SuggestLang,
  kind: SuggestKind,
): Promise<PhotonResponse | null> {
  // Ask for a few more than we show: the dedup above collapses rows that
  // differ only in OSM metadata (same street from two extracts).
  const tags = kind === "city" ? CITY_OSM_TAGS.map((t) => `&osm_tag=${t}`).join("") : "";
  const url = `${PHOTON_BASE}?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS * 2}${
    lang === "en" ? "&lang=en" : ""
  }${tags}`;
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      logger.warn("address_suggest.upstream_status", { status: r.status });
      return null;
    }
    return (await r.json().catch(() => null)) as PhotonResponse | null;
  } catch (e) {
    logger.warn("address_suggest.upstream_throw", { error: String(e) });
    return null;
  }
}
