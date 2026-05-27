// Thin Amadeus Self-Service v2 client. We use exactly two endpoints:
//
//   1. POST /v1/security/oauth2/token        — client_credentials → bearer
//   2. GET  /v1/reference-data/locations     — keyword → IATA airport code
//   3. GET  /v2/shopping/flight-offers       — IATA route + dates → cheapest
//
// The client is intentionally narrow: it returns `null` whenever the
// credentials are missing or a call fails. Callers are expected to degrade
// silently (the honeymoon flight-estimate card just hides). No retries on
// failure — we cache the success path for 12 h elsewhere, so the user only
// sees one network call per missing-cache view.
//
// Production env (`https://api.amadeus.com`) is used by default; the free
// 2 000-calls/month Self-Service tier lives there once an app is approved.
// Set `AMADEUS_BASE_URL=https://test.api.amadeus.com` to point at the test
// environment if needed (limited mock data, no approval gate).

import { log as logger } from "./logger";

const DEFAULT_BASE_URL = "https://api.amadeus.com";

function baseUrl(): string {
  return process.env.AMADEUS_BASE_URL ?? DEFAULT_BASE_URL;
}

function creds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Module-scoped bearer token cache. Amadeus tokens are valid ~30 min; we
 *  refresh ~60 s before expiry to ride out clock skew. */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
    const r = await fetch(`${baseUrl()}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) {
      logger.warn("amadeus.oauth_failed", { status: r.status });
      return null;
    }
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    const ttlMs = (j.expires_in ?? 1800) * 1000;
    cachedToken = { token: j.access_token, expiresAt: now + ttlMs };
    return j.access_token;
  } catch (e) {
    logger.warn("amadeus.oauth_error", { error: String(e) });
    return null;
  }
}

/** Resolve a free-text destination (e.g. "Málaga, Spanyolország") to an IATA
 *  airport code. Returns the highest-ranked AIRPORT match — we strip any
 *  trailing region/country suffix on the input so the keyword matches the
 *  city name Amadeus's index uses. Null when no match or the API is down. */
export async function resolveIata(destination: string): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;
  // Amadeus's keyword search likes a short city name; long human strings
  // ("Málaga, Málaga-Costa del Sol, Malaga, Andalúzia, Spanyolország")
  // confuse it. Use the first comma-separated segment as the keyword.
  const trimmed = destination.trim();
  if (!trimmed) return null;
  const keyword = (trimmed.split(",")[0] ?? trimmed).trim();
  if (keyword.length < 2) return null;
  try {
    const u = new URL(`${baseUrl()}/v1/reference-data/locations`);
    u.searchParams.set("subType", "AIRPORT,CITY");
    u.searchParams.set("keyword", keyword);
    u.searchParams.set("page[limit]", "5");
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      logger.warn("amadeus.locations_failed", { status: r.status, keyword });
      return null;
    }
    const j = (await r.json()) as {
      data?: { subType?: string; iataCode?: string }[];
    };
    const hits = j.data ?? [];
    // Prefer the first AIRPORT hit. If none, fall back to the first CITY
    // (its IATA code is what you'd pass to flight-offers anyway).
    const airport = hits.find((h) => h.subType === "AIRPORT" && h.iataCode);
    if (airport?.iataCode) return airport.iataCode;
    const city = hits.find((h) => h.subType === "CITY" && h.iataCode);
    return city?.iataCode ?? null;
  } catch (e) {
    logger.warn("amadeus.locations_error", { error: String(e) });
    return null;
  }
}

export interface FlightOfferQuote {
  /** Whole-unit price in the requested currency (HUF: forints, no cents). */
  price: number;
  currency: string;
  /** Operating carrier's IATA code on the outbound (first) segment — e.g.
   *  "LH". When the offer is multi-carrier we still report the first leg's
   *  marketing carrier; the card just needs *something* to identify the
   *  option. Empty string when Amadeus didn't populate the field. */
  carrier: string;
  /** ISO timestamp of outbound departure (e.g. "2027-05-25T10:15:00"). */
  depart_iso: string;
  /** ISO timestamp of outbound arrival. Together with `depart_iso` the
   *  frontend can show "10:15 → 14:40 BUD-BCN" without re-parsing. */
  arrival_iso: string;
  /** Total outbound duration in minutes. Round-trip durations vary by leg;
   *  we surface the outbound as the "headline" so the card can sort. */
  duration_min: number;
  /** Outbound stops (0 = direct, 1 = one stop, …). The return leg often
   *  has the same shape and isn't surfaced separately. */
  stops: number;
}

/** Parse Amadeus's ISO 8601 duration (e.g. "PT13H45M") to minutes. Returns
 *  0 when the string is malformed — the caller can still rank by price. */
function parseIsoDuration(d: string | undefined): number {
  if (!d) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(d);
  if (!m) return 0;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  return h * 60 + min;
}

/** Look up the cheapest N offers for the given route + dates, sorted
 *  cheapest-first. Returns an empty array when no offer is found, the
 *  credentials are missing, or the call fails — same "degrade silently"
 *  contract as the legacy single-offer helper. */
export async function getTopOffers(opts: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: number;
  currency: string;
  /** Hard cap on results returned. The Amadeus `max` query is set higher so
   *  we can pick the cheapest distinct carriers; the slice happens here. */
  limit?: number;
}): Promise<FlightOfferQuote[]> {
  const limit = opts.limit ?? 3;
  const token = await getAccessToken();
  if (!token) return [];
  try {
    const u = new URL(`${baseUrl()}/v2/shopping/flight-offers`);
    u.searchParams.set("originLocationCode", opts.origin);
    u.searchParams.set("destinationLocationCode", opts.destination);
    u.searchParams.set("departureDate", opts.departDate);
    u.searchParams.set("returnDate", opts.returnDate);
    u.searchParams.set("adults", String(opts.adults));
    u.searchParams.set("currencyCode", opts.currency);
    u.searchParams.set("nonStop", "false");
    // 10 candidates so dedup-by-carrier still leaves us 3 distinct options
    // on most routes; Amadeus's own ranking is cheapest-first.
    u.searchParams.set("max", "10");
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      logger.warn("amadeus.offers_failed", {
        status: r.status,
        route: `${opts.origin}-${opts.destination}`,
      });
      return [];
    }
    const j = (await r.json()) as {
      data?: {
        price?: { total?: string; currency?: string };
        itineraries?: {
          duration?: string;
          segments?: {
            departure?: { at?: string };
            arrival?: { at?: string };
            carrierCode?: string;
          }[];
        }[];
      }[];
    };
    const raw = j.data ?? [];
    const parsed: FlightOfferQuote[] = [];
    for (const o of raw) {
      const total = o.price?.total;
      const currency = o.price?.currency;
      if (!total || !currency) continue;
      const n = Number(total);
      if (!Number.isFinite(n) || n <= 0) continue;
      const outbound = o.itineraries?.[0];
      const segments = outbound?.segments ?? [];
      const first = segments[0];
      const last = segments[segments.length - 1];
      const depart_iso = first?.departure?.at ?? "";
      const arrival_iso = last?.arrival?.at ?? "";
      const carrier = first?.carrierCode ?? "";
      const duration_min = parseIsoDuration(outbound?.duration);
      const stops = Math.max(segments.length - 1, 0);
      parsed.push({
        price: Math.round(n),
        currency,
        carrier,
        depart_iso,
        arrival_iso,
        duration_min,
        stops,
      });
    }
    // Sort cheapest-first, then collapse duplicate carriers so the 3 cards
    // show distinct airlines when possible. If the same carrier holds the
    // 3 cheapest slots (common on monopoly routes) we just take those.
    parsed.sort((a, b) => a.price - b.price);
    const seenCarriers = new Set<string>();
    const distinct: FlightOfferQuote[] = [];
    for (const o of parsed) {
      if (seenCarriers.has(o.carrier)) continue;
      seenCarriers.add(o.carrier);
      distinct.push(o);
      if (distinct.length >= limit) break;
    }
    if (distinct.length >= limit) return distinct;
    // Top-up with the cheapest remaining offers (carrier-deduped already
    // skipped) so we still hit `limit` when only one airline serves the route.
    for (const o of parsed) {
      if (distinct.includes(o)) continue;
      distinct.push(o);
      if (distinct.length >= limit) break;
    }
    return distinct;
  } catch (e) {
    logger.warn("amadeus.offers_error", { error: String(e) });
    return [];
  }
}

export function amadeusConfigured(): boolean {
  return creds() !== null;
}
