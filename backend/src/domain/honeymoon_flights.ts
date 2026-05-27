// Honeymoon flight estimate — server-side orchestration on top of the thin
// Amadeus client. Caches up to 3 offers per route in `flight_estimates` for
// 12 h so we stay well within the 2 000-calls/month Amadeus Self-Service
// free quota: the same dates + route shared across all couples hit the cache.
//
// Returns `null` whenever the inputs are incomplete (no destination, no
// dates), Amadeus isn't configured (env vars missing), or no offer comes
// back. Callers (HoneymoonPage) just hide the estimate card in that case.

import type { CoupleRow } from "./couples";
import type { FlightEstimate, FlightOffer } from "@shared/types";
import { db } from "../db";
import { amadeusConfigured, getTopOffers, resolveIata } from "../lib/amadeus";
import { log as logger } from "../lib/logger";

/** Round-trip estimate is priced for two adults — the standard "honeymoon"
 *  assumption. Couples can sanity-check the per-person split themselves. */
const DEFAULT_ADULTS = 2;

/** TTL after which a cached row is considered stale and refreshed on next
 *  read. 12 hours balances freshness against the API budget. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

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
): EstimateRow | null {
  return (
    (db
      .prepare(
        `SELECT origin, destination_text, destination_iata, depart_date, return_date,
                adults, currency, price_amount, offers_json, fetched_at
           FROM flight_estimates
          WHERE origin = ? AND destination_text = ? AND depart_date = ?
            AND return_date = ? AND adults = ?`,
      )
      .get(origin, destinationText, departDate, returnDate, adults) as EstimateRow | undefined) ??
    null
  );
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
    return arr.filter(
      (o): o is FlightOffer =>
        typeof o === "object" &&
        o !== null &&
        typeof (o as FlightOffer).price === "number" &&
        typeof (o as FlightOffer).currency === "string",
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

  // Fresh cache hit → return immediately.
  const cached = readCache(origin, destination, departDate, returnDate, adults);
  const now = Date.now();
  if (cached && now - cached.fetched_at < CACHE_TTL_MS) {
    return toEstimate(cached);
  }

  // No (or stale) cache → upstream lookup. If Amadeus isn't configured we
  // bail before even trying the network so dev environments without keys
  // don't spam the warning log.
  if (!amadeusConfigured()) return null;

  let destinationIata: string | null = cached?.destination_iata ?? null;
  if (!destinationIata) {
    destinationIata = await resolveIata(destination);
  }
  if (!destinationIata) {
    // The keyword didn't resolve to anything Amadeus knows. Don't cache —
    // user might rephrase, or the lookup might succeed on a later attempt.
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

  // Cache both outcomes (offers found OR empty). An empty array still
  // represents an answer worth caching for 12 h so we don't re-hit Amadeus
  // on every page view for a route with no inventory.
  const cheapest = offers[0]?.price ?? null;
  const row: EstimateRow = {
    origin,
    destination_text: destination,
    destination_iata: destinationIata,
    depart_date: departDate,
    return_date: returnDate,
    adults,
    currency,
    price_amount: cheapest,
    offers_json: JSON.stringify(offers),
    fetched_at: now,
  };
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
