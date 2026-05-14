// Honeymoon flight estimate — server-side orchestration on top of the thin
// Amadeus client. Caches every successful price look-up in `flight_estimates`
// for 12 h so we stay well within the 2 000-calls/month Amadeus Self-Service
// free quota: the same dates + route shared across all couples hit the cache.
//
// Returns `null` whenever the inputs are incomplete (no destination, no
// dates), Amadeus isn't configured (env vars missing), or no offer comes
// back. Callers (HoneymoonPage) just hide the estimate card in that case.

import type { CoupleRow } from "./couples";
import type { FlightEstimate } from "@shared/types";
import { db } from "../db";
import { amadeusConfigured, getCheapestOffer, resolveIata } from "../lib/amadeus";
import { log as logger } from "../lib/logger";

/** Default origin for HU-first couples — Budapest Liszt Ferenc International.
 *  Not user-editable yet; revisit if we expand beyond Hungary. */
const DEFAULT_ORIGIN_IATA = "BUD";

/** Round-trip estimate is priced for two adults — the standard "honeymoon"
 *  assumption. Couples can sanity-check the per-person split themselves. */
const DEFAULT_ADULTS = 2;

/** TTL after which a cached row is considered stale and refreshed on next
 *  read. 12 hours balances freshness against the API budget. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Currency the estimate is requested + stored in. HUF-first because the
 *  rest of the app prices everything in forints; couples comparing the
 *  estimate to other line items don't need to do conversion. */
const DEFAULT_CURRENCY = "HUF";

interface EstimateRow {
  origin: string;
  destination_text: string;
  destination_iata: string | null;
  depart_date: string;
  return_date: string;
  adults: number;
  currency: string;
  price_amount: number | null;
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
                adults, currency, price_amount, fetched_at
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
        adults, currency, price_amount, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(origin, destination_text, depart_date, return_date, adults)
     DO UPDATE SET
       destination_iata = excluded.destination_iata,
       currency         = excluded.currency,
       price_amount     = excluded.price_amount,
       fetched_at       = excluded.fetched_at`,
  ).run(
    row.origin,
    row.destination_text,
    row.destination_iata,
    row.depart_date,
    row.return_date,
    row.adults,
    row.currency,
    row.price_amount,
    row.fetched_at,
  );
}

/** Compute (or read-from-cache) a flight estimate for the couple's current
 *  honeymoon destination + dates. Returns `null` for any reason the card
 *  should hide: missing inputs, Amadeus unconfigured, IATA unresolvable,
 *  or upstream failure. The cache table only stores "we tried and got
 *  back X" rows (X may be a price OR a null offer); it never caches the
 *  upstream-failure case so the next view will retry. */
export async function getFlightEstimate(couple: CoupleRow): Promise<FlightEstimate | null> {
  const destination = couple.honeymoon_destination?.trim() ?? "";
  const departDate = couple.honeymoon_start_date;
  const returnDate = couple.honeymoon_end_date;
  if (!destination || !departDate || !returnDate) return null;

  const origin = DEFAULT_ORIGIN_IATA;
  const adults = DEFAULT_ADULTS;

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

  const offer = await getCheapestOffer({
    origin,
    destination: destinationIata,
    departDate,
    returnDate,
    adults,
    currency: DEFAULT_CURRENCY,
  });

  // Cache both outcomes (price hit OR "no offer for these dates"). A null
  // price still represents an answer worth caching for 12 h so we don't
  // re-hit Amadeus on every page view for an empty route.
  const row: EstimateRow = {
    origin,
    destination_text: destination,
    destination_iata: destinationIata,
    depart_date: departDate,
    return_date: returnDate,
    adults,
    currency: offer?.currency ?? DEFAULT_CURRENCY,
    price_amount: offer?.price ?? null,
    fetched_at: now,
  };
  writeCache(row);
  return toEstimate(row);
}

function toEstimate(row: EstimateRow): FlightEstimate {
  return {
    origin: row.origin,
    destination_text: row.destination_text,
    destination_iata: row.destination_iata,
    depart_date: row.depart_date,
    return_date: row.return_date,
    adults: row.adults,
    currency: row.currency,
    price_amount: row.price_amount,
    fetched_at: row.fetched_at,
  };
}
