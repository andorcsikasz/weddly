// Thin SerpApi client used by the honeymoon flight estimate. Two engines:
//
//   1. engine=google_flights — round-trip flight offers for IATA pair + dates
//   2. engine=google         — fallback IATA resolver (curated lookup misses)
//
// Both helpers return empty / null on missing credentials or any upstream
// hiccup so the card hides silently rather than surfacing an error. The
// free SerpApi tier is 100 searches/month so the orchestration layer
// (honeymoon_flights) leans on the 12 h cache to keep call volume low.

import { log as logger } from "./logger";

const BASE_URL = "https://serpapi.com/search.json";

function apiKey(): string | null {
  // Treat empty string as unconfigured — the test setup pins `SERPAPI_KEY=""`
  // to short-circuit the network path, and `??` alone would let the empty
  // string through and let the client try to call SerpApi with no key.
  const k = process.env.SERPAPI_KEY;
  if (!k || k.length === 0) return null;
  return k;
}

export function serpapiConfigured(): boolean {
  return apiKey() !== null;
}

export interface FlightOfferQuote {
  /** Whole-unit price in the requested currency (HUF: forints, no cents). */
  price: number;
  currency: string;
  /** Operating carrier IATA on the outbound first segment (e.g. "LH").
   *  Empty string when SerpApi didn't surface a parseable flight number. */
  carrier: string;
  /** ISO timestamps for the outbound leg's first departure and last
   *  arrival. SerpApi returns "YYYY-MM-DD HH:MM" without timezone; we
   *  normalise to ISO with a synthetic ":00" seconds suffix. */
  depart_iso: string;
  arrival_iso: string;
  /** Total outbound duration in minutes (SerpApi's `total_duration`). */
  duration_min: number;
  /** Outbound stops (0 = direct). */
  stops: number;
}

interface SerpSegment {
  departure_airport?: { id?: string; name?: string; time?: string };
  arrival_airport?: { id?: string; name?: string; time?: string };
  duration?: number;
  airline?: string;
  flight_number?: string;
}

interface SerpFlight {
  flights?: SerpSegment[];
  layovers?: unknown[];
  total_duration?: number;
  price?: number;
}

/** "2027-05-25 10:00" → "2027-05-25T10:00:00". No timezone offset:
 *  SerpApi reports local airport time, the UI formats it without TZ
 *  conversion (the "Mon 10:15" headline is already meaningful as-is). */
function toIso(t: string | undefined): string {
  if (!t) return "";
  return `${t.replace(" ", "T")}:00`;
}

/** Parse a carrier IATA out of SerpApi's `flight_number` ("LH 1234" →
 *  "LH"). SerpApi doesn't expose a clean carrier-IATA field. Falls
 *  back to the first two letters of the airline name. Empty string when
 *  neither is usable. */
function carrierFromFlight(flight: SerpSegment): string {
  const fn = flight.flight_number ?? "";
  const head = fn.split(/\s|\d/)[0] ?? "";
  if (/^[A-Z0-9]{2,3}$/.test(head)) return head;
  const al = flight.airline ?? "";
  if (al.length >= 2) return al.slice(0, 2).toUpperCase();
  return "";
}

/** Cheapest N round-trip offers for the IATA pair + dates, deduped by
 *  carrier when possible, top-up with carrier-repeats if the route is
 *  monopoly. Three-state return:
 *
 *  - `null` — upstream FAILURE (missing key, network error, 4xx/5xx,
 *    `error` field present in the body). The orchestration layer must
 *    NOT cache this; the next view should retry.
 *  - `[]`   — upstream SUCCESS but Google Flights returned no offers
 *    for the route + dates. Safe to cache against the 12 h TTL.
 *  - `[...]` — at least one offer. The card renders these. */
export async function getTopOffers(opts: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: number;
  currency: string;
  limit?: number;
}): Promise<FlightOfferQuote[] | null> {
  const key = apiKey();
  if (!key) return null;
  const limit = opts.limit ?? 3;
  const route = `${opts.origin}-${opts.destination}`;
  try {
    const u = new URL(BASE_URL);
    u.searchParams.set("engine", "google_flights");
    u.searchParams.set("api_key", key);
    u.searchParams.set("departure_id", opts.origin);
    u.searchParams.set("arrival_id", opts.destination);
    u.searchParams.set("outbound_date", opts.departDate);
    u.searchParams.set("return_date", opts.returnDate);
    u.searchParams.set("currency", opts.currency);
    u.searchParams.set("adults", String(opts.adults));
    u.searchParams.set("type", "1"); // 1 = round trip
    u.searchParams.set("hl", "en");
    const r = await fetch(u);
    if (!r.ok) {
      // Log the body too — SerpApi typically returns JSON like
      // `{ "error": "Your account ran out of searches." }` on quota / auth
      // failures and we want that detail in the log to diagnose live.
      const body = await safeBody(r);
      logger.warn("serpapi.flights_failed", { status: r.status, route, body });
      return null;
    }
    const j = (await r.json()) as {
      best_flights?: SerpFlight[];
      other_flights?: SerpFlight[];
      error?: string;
      search_metadata?: { status?: string };
    };
    if (j.error) {
      logger.warn("serpapi.flights_error_field", { error: j.error, route });
      return null;
    }
    const all = [...(j.best_flights ?? []), ...(j.other_flights ?? [])];
    if (all.length === 0) {
      // SerpApi returned 200 with no flights — real "no inventory" state.
      // Log it so we can spot misclassified failures (e.g. an upstream that
      // returns 200 + empty body when it really means "auth fail").
      logger.info("serpapi.flights_empty", {
        route,
        status: j.search_metadata?.status,
      });
      return [];
    }
    const parsed: FlightOfferQuote[] = [];
    for (const f of all) {
      const rawPrice = typeof f.price === "number" ? f.price : 0;
      if (!rawPrice || rawPrice <= 0) continue;
      const segments = f.flights ?? [];
      if (segments.length === 0) continue;
      const first = segments[0];
      const last = segments[segments.length - 1];
      if (!first || !last) continue;
      parsed.push({
        price: Math.round(rawPrice),
        currency: opts.currency,
        carrier: carrierFromFlight(first),
        depart_iso: toIso(first.departure_airport?.time),
        arrival_iso: toIso(last.arrival_airport?.time),
        duration_min: f.total_duration ?? 0,
        stops: Math.max(segments.length - 1, 0),
      });
    }
    parsed.sort((a, b) => a.price - b.price);
    const seen = new Set<string>();
    const distinct: FlightOfferQuote[] = [];
    for (const o of parsed) {
      if (seen.has(o.carrier)) continue;
      seen.add(o.carrier);
      distinct.push(o);
      if (distinct.length >= limit) break;
    }
    if (distinct.length >= limit) return distinct;
    for (const o of parsed) {
      if (distinct.includes(o)) continue;
      distinct.push(o);
      if (distinct.length >= limit) break;
    }
    return distinct;
  } catch (e) {
    logger.warn("serpapi.flights_throw", { route, error: String(e) });
    return null;
  }
}

/** Defensive body reader for the `!r.ok` path. SerpApi sometimes returns
 *  HTML on infra blips; we cap the slice so a giant body can't blow up
 *  the log payload. */
async function safeBody(r: Response): Promise<string> {
  try {
    const text = await r.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

/** Common false-positive 3-letter codes the answer-box regex would catch
 *  (currencies, country / region tags) — we want a real IATA airport
 *  code, not "USA" or "EUR". Reject these even if they're in parens. */
const IATA_BLACKLIST: ReadonlySet<string> = new Set([
  "USA",
  "EUR",
  "USD",
  "GBP",
  "HUF",
  "IST", // also a real IATA (Istanbul) — leave in, it's resolved correctly
  "EST", // timezone, not airport
  "GMT",
  "CET",
  "EDT",
  "PDT",
  "IATA",
  "FAA",
  "ICAO",
  "ID",
]);
const IATA_VALID = /^[A-Z]{3}$/;

function isPlausibleIata(code: string): boolean {
  if (!IATA_VALID.test(code)) return false;
  if (IATA_BLACKLIST.has(code)) return false;
  return true;
}

/** Fallback IATA lookup via SerpApi's general google-search engine.
 *  Searches "<destination> airport IATA code" and looks for a 3-letter
 *  uppercase token inside parens or right after the word IATA. Returns
 *  null on missing creds, network failure, or no plausible match. */
export async function resolveIataViaSearch(destination: string): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;
  const seed = destination.split(",")[0]?.trim() || destination;
  const q = `${seed} airport IATA code`;
  try {
    const u = new URL(BASE_URL);
    u.searchParams.set("engine", "google");
    u.searchParams.set("api_key", key);
    u.searchParams.set("q", q);
    u.searchParams.set("hl", "en");
    const r = await fetch(u);
    if (!r.ok) {
      logger.warn("serpapi.iata_search_failed", { status: r.status, q });
      return null;
    }
    const j = (await r.json()) as {
      answer_box?: { answer?: string; snippet?: string; result?: string };
      knowledge_graph?: { description?: string };
      organic_results?: { snippet?: string }[];
    };
    const candidates = [
      j.answer_box?.answer,
      j.answer_box?.result,
      j.answer_box?.snippet,
      j.knowledge_graph?.description,
      ...(j.organic_results ?? []).slice(0, 3).map((o) => o.snippet),
    ].filter((s): s is string => typeof s === "string");
    for (const text of candidates) {
      // Strongest signal first: "(LHR)" or "IATA: LHR".
      const paren = text.match(/\(([A-Z]{3})\)/);
      if (paren && isPlausibleIata(paren[1] ?? "")) return paren[1] ?? null;
      const tagged = text.match(/IATA(?:\s*code)?[:\s]+([A-Z]{3})\b/);
      if (tagged && isPlausibleIata(tagged[1] ?? "")) return tagged[1] ?? null;
    }
    return null;
  } catch (e) {
    logger.warn("serpapi.iata_search_throw", { error: String(e) });
    return null;
  }
}
