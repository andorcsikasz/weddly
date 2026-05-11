// Place-name autocomplete via OpenStreetMap Nominatim. Powers the "Hova"
// destination field on /app/honeymoon. We proxy through the backend so we
// can honour Nominatim's User-Agent requirement and rate-limit per user
// (the policy is 1 req/sec globally — we give each user 1 query/sec with
// a small burst).

import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const USER_AGENT = "weddly-places-autocomplete/0.1 (admin@weddly.xyz)";
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
  /** Headline label — e.g. "Bali" or "Tuscany". */
  primary: string;
  /** Subtitle — full address / region. */
  secondary: string;
  lat: number | null;
  lng: number | null;
  /** ISO country code if Nominatim provided one. */
  country_code: string | null;
}

function primaryLabel(r: NominatimResult): string {
  const a = r.address;
  if (a?.city) return a.city;
  if (a?.town) return a.town;
  if (a?.village) return a.village;
  if (r.name && r.name.trim()) return r.name.trim();
  // display_name's first comma-separated segment is usually the headline.
  const first = r.display_name?.split(",")[0]?.trim();
  return first || r.display_name?.trim() || "";
}

function toSuggestion(r: NominatimResult): PlaceSuggestion | null {
  const primary = primaryLabel(r);
  if (!primary) return null;
  const secondary = r.display_name?.trim() ?? "";
  const lat = r.lat !== undefined ? Number(r.lat) : null;
  const lng = r.lon !== undefined ? Number(r.lon) : null;
  return {
    primary,
    secondary,
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

  const q = new URL(ctx.req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return json({ places: [] });
  if (q.length > 100) throw new HttpError(400, "query too long");

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "hu,en");

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
    .map((r) => toSuggestion(r as NominatimResult))
    .filter((p): p is PlaceSuggestion => p !== null)
    .slice(0, 5);
  return json({ places });
}

export function registerPlacesRoutes(router: Router) {
  router.get("/api/places/search", handleSearch, true);
}
