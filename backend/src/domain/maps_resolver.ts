// Resolves a Google Maps URL → structured place data. Best-effort: handles
// short links (maps.app.goo.gl, goo.gl/maps) by following the redirect, then
// extracts lat/lng + place slug from the long URL. Reverse-geocodes lat/lng
// via OpenStreetMap Nominatim (free, no API key) to fetch a clean address +
// optional `extratags` like `phone` and `website` when OSM has them.
//
// Limitations
// - Many newer or smaller venues have no OSM record → no phone/website auto-
//   fill. Address still works because lat/lng resolves to a geocoded address.
// - The Google `data=...` blob is opaque (encoded protobuf-ish). We don't
//   decode it; we rely on `@lat,lng` and the `/place/<slug>/` segment.
// - Nominatim has a strict 1 req/sec usage policy; the route this is called
//   from rate-limits per user.

export interface ResolvedPlace {
  name: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
}

const SHORT_URL_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

const LONG_URL_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.hu",
  "google.hu",
  "maps.google.hu",
]);

const USER_AGENT = "weddly-maps-resolver/0.1 (admin@weddly.hu)";

/** Identifies whether the input string looks like a Google Maps URL — used by
 *  callers to decide whether to fire the resolver vs treat input as plain
 *  text. Tolerates the user pasting with/without protocol. */
export function isGoogleMapsUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return false;
  }
  if (SHORT_URL_HOSTS.has(url.hostname)) return true;
  if (LONG_URL_HOSTS.has(url.hostname) && url.pathname.includes("/maps")) return true;
  return false;
}

/** Resolve a short URL by hitting it with redirects DISABLED and reading the
 *  Location header. Avoids following the chain ourselves to keep the call
 *  predictable. Returns the long URL or null if it didn't redirect. */
async function resolveShortLink(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status >= 300 && res.status < 400) {
      return res.headers.get("location");
    }
  } catch {
    // Network blip — caller falls back to "we couldn't resolve".
  }
  return null;
}

/** Extracts the `(lat, lng)` pair from a long Google Maps URL. Looks at the
 *  `@lat,lng,zoom` segment in the path and falls back to a `?q=lat,lng`
 *  query param. Returns null when nothing parseable is found. */
function extractLatLng(url: URL): { lat: number; lng: number } | null {
  // /@47.5048,18.9667,15z or /@47.5048,18.9667
  const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  // ?q=47.5048,18.9667 — older share format.
  const q = url.searchParams.get("q");
  if (q) {
    const m = q.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

/** Pulls a human-readable place name from `/place/<slug>/...`. The slug is
 *  URL-encoded with `+` for spaces (Google's convention), so we swap them
 *  back before decoding. */
function extractPlaceName(url: URL): string | null {
  const m = url.pathname.match(/\/place\/([^/]+)/);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return null;
  }
}

interface NominatimResponse {
  display_name?: string;
  extratags?: {
    phone?: string;
    "contact:phone"?: string;
    website?: string;
    "contact:website"?: string;
    url?: string;
  };
  // `addressdetails=1` returns a structured object. The locality lives under
  // one of several keys depending on settlement size — in HU `village` is
  // common (Verseg, Tinnye, etc.) and the larger settlements use `town` or
  // `city`. `municipality`/`hamlet` are last-resort fallbacks.
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
  };
  name?: string;
}

/** Reverse-geocodes lat/lng → human address + (when OSM has them) phone +
 *  website extras. Honours Nominatim's 1 req/sec policy by being called at
 *  most once per resolver invocation; the route's per-user rate-limit covers
 *  the broader pattern. */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  name: string | null;
}> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&extratags=1&zoom=18&accept-language=hu,en`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return { address: null, city: null, phone: null, website: null, name: null };
    const data = (await res.json()) as NominatimResponse;
    const phone = data.extratags?.phone ?? data.extratags?.["contact:phone"] ?? null;
    const website =
      data.extratags?.website ?? data.extratags?.["contact:website"] ?? data.extratags?.url ?? null;
    const city =
      data.address?.city ??
      data.address?.town ??
      data.address?.village ??
      data.address?.municipality ??
      data.address?.hamlet ??
      null;
    return {
      address: data.display_name?.trim() || null,
      city: city?.trim() || null,
      phone: phone?.trim() || null,
      website: website?.trim() || null,
      name: data.name?.trim() || null,
    };
  } catch {
    return { address: null, city: null, phone: null, website: null, name: null };
  }
}

/** Entry point. Takes whatever the user pasted, returns whatever we can
 *  resolve. Every field independently nullable — UI fills only the slots it
 *  has data for. */
export async function resolveGoogleMapsUrl(raw: string): Promise<ResolvedPlace> {
  const empty: ResolvedPlace = {
    name: null,
    address: null,
    city: null,
    lat: null,
    lng: null,
    website: null,
    phone: null,
  };
  if (!isGoogleMapsUrl(raw)) return empty;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return empty;
  }

  // Short → resolve to long.
  if (SHORT_URL_HOSTS.has(url.hostname)) {
    const long = await resolveShortLink(url.toString());
    if (!long) return empty;
    try {
      url = new URL(long);
    } catch {
      return empty;
    }
  }

  const coords = extractLatLng(url);
  const placeName = extractPlaceName(url);
  if (!coords) {
    // No coordinates we can reverse-geocode. Return whatever the slug gave us.
    return { ...empty, name: placeName };
  }

  const geo = await reverseGeocode(coords.lat, coords.lng);
  return {
    name: placeName ?? geo.name,
    address: geo.address,
    city: geo.city,
    lat: coords.lat,
    lng: coords.lng,
    website: geo.website,
    phone: geo.phone,
  };
}
