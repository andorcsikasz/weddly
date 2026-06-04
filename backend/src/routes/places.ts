// Place-name autocomplete via OpenStreetMap Nominatim. Powers the "Hova"
// destination field on /app/honeymoon. We proxy through the backend so we
// can honour Nominatim's User-Agent requirement and rate-limit per user
// (the policy is 1 req/sec globally — we give each user 1 query/sec with
// a small burst).

import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const USER_AGENT = "weddly-places-autocomplete/0.1 (admin@weddly.hu)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  importance?: number;
  address?: {
    country?: string;
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

export interface PlaceSuggestion {
  /** Headline label — e.g. "Bali" or "Tuscany" (place mode) or the POI name
   *  like "Sári Csárda" (venue mode). */
  primary: string;
  /** Subtitle — full address / region. */
  secondary: string;
  /** Settlement the result sits in (city/town/village), when available. */
  locality: string | null;
  lat: number | null;
  lng: number | null;
  /** ISO country code if Nominatim provided one. */
  country_code: string | null;
}

/** "place" → destination picker (the settlement is the headline, e.g. "Bali").
 *  "venue" → venue-name picker (the POI name is the headline, e.g. "Sári
 *  Csárda" — the settlement it sits in is demoted to `locality`). */
type SearchKind = "place" | "venue";

function localityOf(r: NominatimResult): string | null {
  const a = r.address;
  return a?.city ?? a?.town ?? a?.village ?? null;
}

/** display_name's first comma-separated segment — usually the POI/street name. */
function headline(r: NominatimResult): string {
  if (r.name && r.name.trim()) return r.name.trim();
  const first = r.display_name?.split(",")[0]?.trim();
  return first || r.display_name?.trim() || "";
}

function primaryLabel(r: NominatimResult, kind: SearchKind): string {
  if (kind === "venue") {
    // The venue's own name leads; the settlement rides along as `locality`.
    return headline(r) || localityOf(r) || "";
  }
  // Destination picker: the settlement IS the headline.
  return localityOf(r) || headline(r);
}

function toSuggestion(r: NominatimResult, kind: SearchKind): PlaceSuggestion | null {
  const primary = primaryLabel(r, kind);
  if (!primary) return null;
  const secondary = r.display_name?.trim() ?? "";
  const lat = r.lat !== undefined ? Number(r.lat) : null;
  const lng = r.lon !== undefined ? Number(r.lon) : null;
  return {
    primary,
    secondary,
    locality: localityOf(r),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    country_code: r.address?.country_code?.toUpperCase() ?? null,
  };
}

async function handleSearch(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  // Per-user cap that respects Nominatim's 1 req/sec policy. 6-burst gives a
  // typist some headroom while debouncing on the client keeps the steady
  // state well below 1 query/sec.
  rateLimit(`user:${userId}`, "places_search", { capacity: 6, refillRate: 1 });

  const params = new URL(ctx.req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (q.length < 2) return json({ places: [] });
  if (q.length > 100) throw new HttpError(400, "query too long");

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "hu,en");
  // Optional country bias — when the caller scopes the search to a country
  // (e.g. the venue-name field passing the couple's country) we restrict
  // Nominatim to that country so a HU couple isn't offered cross-border places.
  // Honeymoon destination search omits this on purpose (it's meant to roam).
  const country = params.get("country")?.trim().toLowerCase() ?? "";
  if (/^[a-z]{2}$/.test(country)) url.searchParams.set("countrycodes", country);
  // "venue" mode keeps the POI name as the headline (e.g. "Sári Csárda")
  // instead of collapsing it to the settlement. Default stays "place".
  const kind: SearchKind = params.get("kind") === "venue" ? "venue" : "place";

  let raw: unknown;
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return json({ places: [] });
    raw = await res.json();
  } catch {
    // Nominatim unreachable — return empty rather than 5xx so the user can
    // still type a destination by hand.
    return json({ places: [] });
  }

  if (!Array.isArray(raw)) return json({ places: [] });
  const places = raw
    .map((r) => toSuggestion(r as NominatimResult, kind))
    .filter((p): p is PlaceSuggestion => p !== null)
    .slice(0, 5);
  return json({ places });
}

export function registerPlacesRoutes(router: Router) {
  router.get("/api/places/search", handleSearch, true);
}
