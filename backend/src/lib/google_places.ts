// Google Places (New) ratings for directory listings. The public browse teaser
// ranks a country's vendors by how well the outside world rates them, and this
// is where that number comes from.
//
// Gated by GOOGLE_PLACES_API_KEY — the same "configured?" pattern as
// Stripe / DeepL / GEMI. Unset means every lookup returns null, listings keep a
// null rating, and the showcase ranking treats that as "unrated" (sorted after
// rated ones) rather than "bad". Nothing else changes, so the feature can ship
// before the key exists.
//
// GOOGLE_PLACES_FAKE=1 answers from a deterministic stub so the E2E suite never
// touches the network or the billing account (mirrors DEEPL_FAKE /
// COMPANY_LOOKUP_FAKE in tests/setup.ts).
//
// Calls are BILLED per request, which is why nothing here runs on a request
// path or a boot worker: the only caller is `bun backend/scripts/
// google_places_sync.ts`, an operator-run backfill that skips anything synced
// recently.
//
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

import { log } from "./logger";

const TIMEOUT_MS = 8_000;
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// Only the three fields we store — the field mask is what Google bills on, so
// asking for less is literally cheaper.
const FIELD_MASK = "places.id,places.rating,places.userRatingCount";

export interface PlaceRating {
  place_id: string;
  /** 1.0..5.0, or null when the place exists but nobody has rated it. */
  rating: number | null;
  /** How many ratings back the average. Null when unrated. */
  ratings_count: number | null;
}

function apiKey(): string | null {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  return k && k.length > 0 ? k : null;
}

function fakeMode(): boolean {
  return process.env.GOOGLE_PLACES_FAKE === "1";
}

/** True when a Places key is configured. The sync script refuses to run
 *  without it rather than silently writing nulls over existing ratings. */
export function placesConfigured(): boolean {
  return apiKey() !== null;
}

/** Resolve one business to its Google place + rating. Returns null when the
 *  lookup is unconfigured, times out, errors, or finds nothing — every caller
 *  treats null as "leave what we already had alone".
 *
 *  `country` is passed as `regionCode` so "Villa Erba, Lake Como" biases to
 *  Italy instead of matching a same-named place elsewhere. */
export async function lookupPlaceRating(q: {
  name: string;
  city: string;
  country: string;
}): Promise<PlaceRating | null> {
  if (fakeMode()) return fakeRating(q.name);
  const key = apiKey();
  if (!key) return null;

  // Strip the ", XX" country suffix the curated batches carry on `city` — it's
  // our own bookkeeping, not part of the address Google knows.
  const city = q.city.replace(/,\s*[A-Z]{2}$/, "").trim();
  const textQuery = city ? `${q.name}, ${city}` : q.name;

  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        regionCode: q.country.toUpperCase(),
        maxResultCount: 1,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      log.warn("google_places: lookup failed", { status: r.status, textQuery });
      return null;
    }
    const body = (await r.json()) as {
      places?: { id?: string; rating?: number; userRatingCount?: number }[];
    };
    const first = body.places?.[0];
    if (!first?.id) return null;
    return {
      place_id: first.id,
      rating: typeof first.rating === "number" ? first.rating : null,
      ratings_count: typeof first.userRatingCount === "number" ? first.userRatingCount : null,
    };
  } catch (err) {
    log.warn("google_places: lookup threw", { textQuery, err: String(err) });
    return null;
  }
}

/** Deterministic stub: a stable pseudo-rating derived from the name, so tests
 *  can assert on ordering without pinning magic numbers to real businesses. */
function fakeRating(name: string): PlaceRating {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return {
    place_id: `fake-${h}`,
    // 3.0 .. 5.0 in 0.1 steps.
    rating: Math.round((3 + (h % 21) / 10) * 10) / 10,
    ratings_count: 10 + (h % 90),
  };
}
