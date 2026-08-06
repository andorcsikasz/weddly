// Structured package pricing: the currency a listing quotes in, and the two
// shapes a price can take (a total, or a rate per guest).
//
// This replaces a single free-text `price_text` field. That field was free text
// ON PURPOSE — vendors quote in wildly different shapes and a string keeps all
// of them expressible — but the cost was that a price could not be sorted,
// filtered, or compared across listings, and a couple could not put a 50-guest
// venue next to a 150-guest one on any common footing. `price_text` is kept and
// still rendered for rows that predate this (see `ListingPackage`); nothing is
// migrated by guesswork, because the one thing a string cannot tell us is
// whether "€30" was a total or a rate per head.
//
// CURRENCY IS DERIVED FROM THE LISTING'S COUNTRY, and the vendor may override
// it (owner direction 2026-08-06). So `listings.currency` is NULLABLE and NULL
// is not a missing value: it means "whatever this country trades in", which is
// what keeps a whole market correct without anyone editing a row. The same
// NULL-is-a-real-answer idiom the availability buffers use.

import { isCurrency, type Currency } from "./currency";

/** Official currency per country we list in, plus the near neighbours a vendor
 *  is most likely to arrive from. Deliberately a table and not "HU ? HUF :
 *  EUR": Czechia, Poland and Romania are in Europe and in none of them is the
 *  euro the currency a wedding is priced in. */
const COUNTRY_CURRENCY: Readonly<Record<string, Currency>> = {
  HU: "HUF",
  AT: "EUR",
  SK: "EUR",
  SI: "EUR",
  HR: "EUR",
  DE: "EUR",
  IT: "EUR",
  FR: "EUR",
  ES: "EUR",
  PT: "EUR",
  NL: "EUR",
  BE: "EUR",
  IE: "EUR",
  GR: "EUR",
  CZ: "CZK",
  PL: "PLN",
  RO: "RON",
  GB: "GBP",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
};

/** The currency a listing in `country` quotes in by default.
 *
 *  A MISSING country resolves to forint rather than to the euro: every row that
 *  predates international listings is Hungarian, so that is the status quo and
 *  not a guess. A country we simply have no row for resolves to the euro, which
 *  IS a guess, and the reason the vendor can override it. */
export function currencyForCountry(country: string | null | undefined): Currency {
  const code = (country ?? "").trim().toUpperCase();
  if (code.length === 0) return "HUF";
  return COUNTRY_CURRENCY[code] ?? "EUR";
}

/** The currency THIS listing quotes in: the vendor's explicit pick if they made
 *  one, otherwise their country's. The single reader — nothing should reach for
 *  `listing.currency` directly, or a null there reads as "no currency". */
export function listingCurrency(listing: {
  country?: string | null;
  currency?: string | null;
}): Currency {
  const own = (listing.currency ?? "").trim().toUpperCase();
  if (isCurrency(own)) return own;
  return currencyForCountry(listing.country);
}

/** What a package's numbers MEAN. Required on any package that carries them:
 *  "250 000" is not a price until you know whether it buys the day or one seat,
 *  and that is precisely the fact the old free-text column could not hold. */
export type PackagePriceMode = "total" | "per_person";

export const PACKAGE_PRICE_MODES: readonly PackagePriceMode[] = ["total", "per_person"];

export function isPackagePriceMode(value: unknown): value is PackagePriceMode {
  return typeof value === "string" && PACKAGE_PRICE_MODES.includes(value as PackagePriceMode);
}

/** Sanity ceiling on a package amount, in whole units of the listing's
 *  currency. Mirrors `REVIEW_AMOUNT_MAX`: guards a fat-fingered figure from
 *  becoming a wild outlier without refusing any real wedding price. */
export const PACKAGE_AMOUNT_MAX = 1_000_000_000;

export interface PackagePrice {
  /** Whole units of the listing's currency. Null = not given. */
  price_min: number | null;
  price_max: number | null;
  /** Null on rows written before structured pricing; those render `price_text`. */
  price_mode: PackagePriceMode | null;
}

/** A listing's guest capacity, as the editor and the DTO both carry it. */
export interface GuestRange {
  min: number | null;
  max: number | null;
}

export interface PriceRange {
  min: number | null;
  max: number | null;
}

/** True when there is a structured price worth rendering. A mode with no
 *  numbers is not a price, and numbers with no mode cannot be read. */
export function hasStructuredPrice(p: PackagePrice): boolean {
  return p.price_mode !== null && (p.price_min !== null || p.price_max !== null);
}

/** The package's price expressed in the OTHER mode, or null when it cannot be:
 *  no structured price, or no guest count to divide by.
 *
 *  The envelope is the honest one, and it crosses over. Cost per head is
 *  total / guests, so the CHEAPEST per-head figure is the lowest total spread
 *  across the MOST guests, and the dearest is the highest total over the
 *  FEWEST. Pairing min with min would quote a per-head range the vendor never
 *  offered. Going the other way there is no crossover: a per-head rate times
 *  the guest count at each end.
 *
 *  Each end is computed independently, so a "from 250 000" package with only a
 *  minimum still converts its minimum. */
export function convertedPrice(
  p: PackagePrice,
  guests: GuestRange,
): { mode: PackagePriceMode; range: PriceRange } | null {
  if (!hasStructuredPrice(p) || p.price_mode === null) return null;
  const gMin = guests.min !== null && guests.min > 0 ? guests.min : null;
  const gMax = guests.max !== null && guests.max > 0 ? guests.max : null;
  if (gMin === null && gMax === null) return null;

  if (p.price_mode === "total") {
    // Divide by the widest guest count we know at each end; a listing with only
    // one of the two uses it for both rather than refusing to answer.
    const low = gMax ?? gMin;
    const high = gMin ?? gMax;
    const range: PriceRange = {
      min: p.price_min !== null && low ? Math.round(p.price_min / low) : null,
      max: p.price_max !== null && high ? Math.round(p.price_max / high) : null,
    };
    return range.min === null && range.max === null ? null : { mode: "per_person", range };
  }

  const low = gMin ?? gMax;
  const high = gMax ?? gMin;
  const range: PriceRange = {
    min: p.price_min !== null && low ? p.price_min * low : null,
    max: p.price_max !== null && high ? p.price_max * high : null,
  };
  return range.min === null && range.max === null ? null : { mode: "total", range };
}
