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

function fakePhotonResponse(q: string): PhotonResponse {
  if (q.toLowerCase().includes("nomatch")) return { features: [] };
  return { features: FAKE_FEATURES };
}

// ── Upstream fetch with TTL cache ──────────────────────────────────────────

const cache = new Map<string, { at: number; suggestions: AddressSuggestion[] }>();

/** Top suggestions for a free-text query. `null` = upstream failure (the
 *  route maps it to 502); `[]` = the geocoder answered with no match. */
export async function suggestAddresses(
  q: string,
  lang: SuggestLang,
): Promise<AddressSuggestion[] | null> {
  const key = `${lang} ${q}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.suggestions;

  let body: PhotonResponse | null;
  if (process.env.ADDRESS_SUGGEST_FAKE === "1") {
    body = fakePhotonResponse(q);
  } else {
    body = await fetchPhoton(q, lang);
  }
  if (body === null) return null;

  const seen = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  for (const feature of body.features ?? []) {
    const s = toSuggestion(feature);
    if (!s || seen.has(s.label)) continue;
    seen.add(s.label);
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

async function fetchPhoton(q: string, lang: SuggestLang): Promise<PhotonResponse | null> {
  // Ask for a few more than we show: the dedup above collapses rows that
  // differ only in OSM metadata (same street from two extracts).
  const url = `${PHOTON_BASE}?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS * 2}${
    lang === "en" ? "&lang=en" : ""
  }`;
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
