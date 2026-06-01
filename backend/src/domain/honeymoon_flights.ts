// Honeymoon flight estimate — server-side orchestration on top of the thin
// SerpApi client (Google Flights). Caches up to 3 offers per route in
// `flight_estimates` for 12 h so we stay well within SerpApi's 100-search
// /month free tier: every couple targeting the same route hits the cache.
//
// Destination → IATA resolution is hybrid: a curated lookup of ~150 common
// honeymoon destinations gets first crack (zero API cost, instant), and
// SerpApi's general google-search engine is the fallback for anything not in
// the table. Whichever resolver succeeds is cached on the estimate row so
// the next refresh skips the lookup entirely.
//
// Returns `null` whenever the inputs are incomplete (no destination, no
// dates), SerpApi isn't configured (env var missing), or no offer comes
// back. Callers (HoneymoonPage) just hide the estimate card in that case.

import type { CoupleRow } from "./couples";
import type { FlightEstimate, FlightOffer } from "@shared/types";
import { db } from "../db";
import { lookupDestinationIata } from "./destination_iata";
import { getTopOffers, resolveIataViaSearch, serpapiConfigured } from "../lib/serpapi";
import { log as logger } from "../lib/logger";

/** Round-trip estimate is priced for two adults — the standard "honeymoon"
 *  assumption. Couples can sanity-check the per-person split themselves. */
const DEFAULT_ADULTS = 2;

/** TTL for rows that carry at least one offer. 12 h is the sweet spot
 *  between freshness for active honeymooners and SerpApi's 100-search/month
 *  free tier. */
const CACHE_TTL_OFFERS_MS = 12 * 60 * 60 * 1000;

/** TTL for "no offer" rows. Google Flights returns nothing for dates much
 *  further than ~12 months out — couples who set a 2027 honeymoon today
 *  would otherwise re-query SerpApi on every page view through the entire
 *  pre-inventory window. 24 h keeps the empty row stale-tolerant without
 *  pinning the card blank for a full week if inventory shows up sooner. */
const CACHE_TTL_EMPTY_MS = 24 * 60 * 60 * 1000;

/** How many offers we surface on the card. The Amadeus client requests more
 *  candidates internally and dedups by carrier; the slice happens server-side
 *  so the cached payload is already final. */
const OFFER_LIMIT = 3;

/** Pick a default departure airport based on the couple's display currency.
 *  HUF couples leave from BUD (only major HU international hub); everyone
 *  else defaults to VIE — the closest Star Alliance / low-cost hub that
 *  serves most European honeymoon destinations. This is just a starting
 *  point: couples can override via `honeymoon_origin_iata`. */
function defaultOriginFor(couple: CoupleRow): string {
  return couple.currency === "HUF" ? "BUD" : "VIE";
}

/** Currency the offers are requested + stored in. We mirror the couple's
 *  display currency so the card lines up with every other price on the
 *  honeymoon page without a runtime conversion. Falls back to HUF for the
 *  rare row that's still null after the schema's default-fill. */
function currencyFor(couple: CoupleRow): string {
  return couple.currency ?? "HUF";
}

interface EstimateRow {
  origin: string;
  destination_text: string;
  destination_iata: string | null;
  depart_date: string;
  return_date: string;
  adults: number;
  currency: string;
  price_amount: number | null;
  offers_json: string | null;
  fetched_at: number;
}

function readCache(
  origin: string,
  destinationText: string,
  departDate: string,
  returnDate: string,
  adults: number,
  currency: string,
): EstimateRow | null {
  const row =
    (db
      .prepare(
        `SELECT origin, destination_text, destination_iata, depart_date, return_date,
                adults, currency, price_amount, offers_json, fetched_at
           FROM flight_estimates
          WHERE origin = ? AND destination_text = ? AND depart_date = ?
            AND return_date = ? AND adults = ?`,
      )
      .get(origin, destinationText, departDate, returnDate, adults) as EstimateRow | undefined) ??
    null;
  if (!row) return null;
  // The cache row stores prices in whatever currency the FIRST requester asked
  // for, but the single UNIQUE(route, dates, adults) constraint means we keep
  // only one row per route. If a couple requests a different display currency
  // than the cached row holds, treat it as a miss so we refetch in the right
  // currency (writeCache's ON CONFLICT overwrites the row) rather than show a
  // HUF figure to a EUR couple, or vice-versa.
  if (row.currency !== currency) return null;
  // Two TTLs: full-offer rows stay fresh for 12 h, empty rows for 24 h so
  // we don't hammer SerpApi for couples sitting on far-future dates that
  // Google Flights won't have inventory for yet.
  const isEmpty = parseOffers(row.offers_json).length === 0;
  const ttl = isEmpty ? CACHE_TTL_EMPTY_MS : CACHE_TTL_OFFERS_MS;
  if (Date.now() - row.fetched_at > ttl) return null;
  return row;
}

/** Look up just the resolved IATA on this route, ignoring TTL. We use this
 *  to skip the destination → IATA lookup on stale-cache misses: the route
 *  hasn't changed, only the offers may have, so re-resolving via SerpApi
 *  search is wasted budget. */
function readStaleDestinationIata(
  origin: string,
  destinationText: string,
  departDate: string,
  returnDate: string,
  adults: number,
): string | null {
  const row = db
    .prepare(
      `SELECT destination_iata FROM flight_estimates
        WHERE origin = ? AND destination_text = ? AND depart_date = ?
          AND return_date = ? AND adults = ?`,
    )
    .get(origin, destinationText, departDate, returnDate, adults) as
    | { destination_iata: string | null }
    | undefined;
  return row?.destination_iata ?? null;
}

function writeCache(row: EstimateRow): void {
  db.prepare(
    `INSERT INTO flight_estimates
       (origin, destination_text, destination_iata, depart_date, return_date,
        adults, currency, price_amount, offers_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(origin, destination_text, depart_date, return_date, adults)
     DO UPDATE SET
       destination_iata = excluded.destination_iata,
       currency         = excluded.currency,
       price_amount     = excluded.price_amount,
       offers_json      = excluded.offers_json,
       fetched_at       = excluded.fetched_at`,
  ).run(
    row.origin,
    row.destination_text,
    row.destination_iata,
    row.depart_date,
    row.return_date,
    row.adults,
    row.currency,
    // The legacy column is NOT NULL on existing DBs; write 0 as the
    // "no-offer" sentinel so we don't trip the constraint. The card uses
    // the offers array now, not price_amount.
    row.price_amount ?? 0,
    row.offers_json,
    row.fetched_at,
  );
}

function parseOffers(json: string | null): FlightOffer[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    // Backfill the segments / layovers / booking_url fields that were added
    // after the original cache table was populated — pre-feature rows still
    // round-trip cleanly, the expand affordance just shows nothing extra.
    return arr
      .filter(
        (o): o is Partial<FlightOffer> =>
          typeof o === "object" &&
          o !== null &&
          typeof (o as FlightOffer).price === "number" &&
          typeof (o as FlightOffer).currency === "string",
      )
      .map(
        (o): FlightOffer => ({
          price: o.price ?? 0,
          currency: o.currency ?? "",
          carrier: o.carrier ?? "",
          depart_iso: o.depart_iso ?? "",
          arrival_iso: o.arrival_iso ?? "",
          duration_min: o.duration_min ?? 0,
          stops: o.stops ?? 0,
          segments: Array.isArray(o.segments) ? o.segments : [],
          layovers: Array.isArray(o.layovers) ? o.layovers : [],
          booking_url: o.booking_url ?? "",
        }),
      );
  } catch {
    return [];
  }
}

/** Compute (or read-from-cache) a flight estimate for the couple's current
 *  honeymoon destination + dates. Returns `null` for any reason the card
 *  should hide: missing inputs, Amadeus unconfigured, IATA unresolvable,
 *  or upstream failure. The cache table only stores "we tried and got
 *  back X" rows (X may be an offer array OR empty); it never caches the
 *  upstream-failure case so the next view will retry. */
export async function getFlightEstimate(couple: CoupleRow): Promise<FlightEstimate | null> {
  const destination = couple.honeymoon_destination?.trim() ?? "";
  const departDate = couple.honeymoon_start_date;
  const returnDate = couple.honeymoon_end_date;
  if (!destination || !departDate || !returnDate) return null;

  const origin = couple.honeymoon_origin_iata?.trim().toUpperCase() || defaultOriginFor(couple);
  const adults = DEFAULT_ADULTS;
  const currency = currencyFor(couple);

  // Destination equal to origin is a no-op (e.g. couple typed "Budapest"
  // while origin is BUD). Bail before any cache lookup or network call —
  // the card stays hidden, same contract as missing destination.
  if (destination.trim().toUpperCase() === origin) return null;

  // Fresh cache hit → return immediately. readCache enforces the TTL
  // (12 h for rows with offers, 24 h for empty rows) so a hit here is
  // always still fresh.
  const cached = readCache(origin, destination, departDate, returnDate, adults, currency);
  const now = Date.now();
  if (cached) return toEstimate(cached);
  // Stale row still gives us the resolved IATA for free — avoid burning a
  // SerpApi search call on the IATA fallback when we already know the
  // answer from a previous fetch on this exact route + dates.
  const staleIata = readStaleDestinationIata(origin, destination, departDate, returnDate, adults);

  // No (or stale) cache → upstream lookup. If SerpApi isn't configured we
  // bail before even trying the network so dev environments without a key
  // don't spam the warning log.
  if (!serpapiConfigured()) return null;

  let destinationIata: string | null = staleIata;
  if (!destinationIata) {
    // Curated lookup first — zero API cost, covers the top ~150 honeymoon
    // destinations. Only fall back to SerpApi's google search engine when
    // the lookup misses (niche city / typo / unusual spelling).
    destinationIata = lookupDestinationIata(destination);
    if (!destinationIata) destinationIata = await resolveIataViaSearch(destination);
  }
  if (!destinationIata) {
    // No segment matched the table and SerpApi search didn't surface a
    // plausible IATA either. Don't cache — user might rephrase, or the
    // lookup might succeed on a later attempt.
    logger.info("flight_estimate.iata_unresolved", { destination });
    return null;
  }
  if (destinationIata === origin) {
    // Same airport — same hide rule as above, just caught after the
    // location resolver normalised "Budapest" → "BUD".
    return null;
  }

  const offers = await getTopOffers({
    origin,
    destination: destinationIata,
    departDate,
    returnDate,
    adults,
    currency,
    limit: OFFER_LIMIT,
  });

  // null = upstream FAILED (network, auth, quota). Don't cache so the next
  // page view retries instead of waiting out a TTL on a misconfig. Return
  // an empty estimate so the route still has the resolved IATA in the
  // shape (frontend hides the card on offers.length === 0 either way).
  if (offers === null) {
    logger.warn("flight_estimate.upstream_failed", { destination, destinationIata });
    return toEstimate({
      origin,
      destination_text: destination,
      destination_iata: destinationIata,
      depart_date: departDate,
      return_date: returnDate,
      adults,
      currency,
      price_amount: null,
      offers_json: null,
      fetched_at: now,
    });
  }

  const row: EstimateRow = {
    origin,
    destination_text: destination,
    destination_iata: destinationIata,
    depart_date: departDate,
    return_date: returnDate,
    adults,
    currency,
    price_amount: offers[0]?.price ?? null,
    offers_json: JSON.stringify(offers),
    fetched_at: now,
  };
  // Cache both outcomes. Rows with offers expire after 12 h; empty rows
  // (Google Flights returned "no inventory" — common for far-future dates
  // until airlines open the date) expire after 24 h. The two TTLs keep
  // the SerpApi budget controlled while still self-healing once inventory
  // shows up.
  writeCache(row);
  return toEstimate(row);
}

function toEstimate(row: EstimateRow): FlightEstimate {
  const offers = parseOffers(row.offers_json);
  return {
    origin: row.origin,
    destination_text: row.destination_text,
    destination_iata: row.destination_iata,
    depart_date: row.depart_date,
    return_date: row.return_date,
    adults: row.adults,
    currency: row.currency,
    offers,
    fetched_at: row.fetched_at,
  };
}
