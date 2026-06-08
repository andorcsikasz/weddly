// Konzinfo (Hungarian MFA Consular Service) travel-advice integration for the
// honeymoon planner. Surfaces the OFFICIAL per-country consular page for a
// couple's honeymoon destination — entry rules, security rating, last-updated
// date — plus honeymoon-flavoured pre-trip reminders.
//
// The data here is SCRAPED, not hand-authored: `konzinfo_country_links.json`
// is the full country/region list pulled from the Konzinfo country selector
// (each <option> carries a Drupal node id; we resolved every id to its canonical
// `/utazasi-tanacsok-orszagonkent/<slug>` alias). `konzinfo_destination_map.json`
// maps honeymoon spots (islands / cities / regions) onto the official country
// name so "Bali" resolves to "Indonézia", "Santorini" to "Görögország", etc.
//
// IMPORTANT: the Konzinfo site content changes — security ratings and the link
// list are NOT permanent. The link list should be re-scraped periodically (see
// backend/scripts/scrape_konzinfo.ts) and the live status is fetched at read
// time with a short cache + graceful fallback (see backend/src/domain/konzinfo.ts).

import countryLinksRaw from "./konzinfo_country_links.json";
import destinationMapRaw from "./konzinfo_destination_map.json";

/** One official Konzinfo country/region page. `konzinfo_url` is the absolute
 *  canonical URL; `node_id` is the Drupal node behind it (kept so a re-scrape
 *  can diff against the source). */
export interface KonzinfoCountry {
  country_hu: string;
  slug: string;
  konzinfo_url: string;
  node_id: number;
}

/** A destination-to-country rule. `match` is a list of NORMALISED keywords
 *  (lowercase, diacritics stripped). Single-word keywords match a whole token
 *  of the destination; multi-word keywords match as a substring. */
export interface KonzinfoDestinationRule {
  country_hu: string;
  match: string[];
}

/** Live values parsed off a country page at read time. Every field is nullable
 *  — the page layout or labels can change, and a failed fetch still renders the
 *  static link. Dates are kept verbatim in the source's `YYYY.MM.DD.` form. */
export interface KonzinfoLiveStatus {
  /** "Utolsó módosítás dátuma" — when the advice text was last edited. */
  last_modified: string | null;
  /** "Mai napon is érvényes" — the date the advice was last re-confirmed. */
  valid_today: string | null;
  /** "Biztonsági besorolás" — verbatim category text, e.g. "zöld, (IV.) kategória". */
  safety_category: string | null;
  /** "Biztonsági besorolás utolsó módosítása" — when the rating last changed. */
  safety_modified: string | null;
}

/** What the API returns for one honeymoon destination. `matched` is null when no
 *  country could be resolved (the UI then shows the generic Konzinfo index). */
export interface KonzinfoInfo {
  /** The destination text the resolution ran against (echoed for the UI). */
  destination: string | null;
  matched: KonzinfoCountry | null;
  status: KonzinfoLiveStatus | null;
  /** Always present — the country-picker index, the universal fallback link. */
  index_url: string;
}

export const KONZINFO_BASE = "https://konzinfo.mfa.gov.hu";
export const KONZINFO_INDEX_URL = `${KONZINFO_BASE}/utazasi-tanacsok-orszagonkent`;
/** Consular-protection trip registration ("Regisztrálja külföldi utazását"). */
export const KONZINFO_REGISTER_URL = `${KONZINFO_BASE}/regisztralja-kulfoldi-utazasat`;
/** KonzInfo Utazom mobile app. */
export const KONZINFO_APP_IOS_URL = "https://apps.apple.com/hu/app/konzinfo-utazom/id1600676404";
export const KONZINFO_APP_ANDROID_URL =
  "https://play.google.com/store/apps/details?id=hu.gov.mfa.konzinfo.utazom.v2.android";
export const KONZINFO_APP_INFO_URL = `${KONZINFO_BASE}/kozerdeku-informaciok/kulgazdasagi-es-kulugyminiszterium-konzinfo-utazom-mobil-alkalmazasa`;

export const KONZINFO_COUNTRIES: ReadonlyArray<KonzinfoCountry> =
  countryLinksRaw as KonzinfoCountry[];
export const KONZINFO_DESTINATION_RULES: ReadonlyArray<KonzinfoDestinationRule> =
  destinationMapRaw as KonzinfoDestinationRule[];

const COUNTRY_BY_NAME = new Map(KONZINFO_COUNTRIES.map((c) => [c.country_hu, c]));
const COUNTRY_BY_SLUG = new Map(KONZINFO_COUNTRIES.map((c) => [c.slug, c]));

/** Lowercase + strip diacritics so "Maldív-szigetek" and "maldiv" compare
 *  equal. Keeps the original collapse of whitespace for substring keywords. */
export function normalizeKonzinfo(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
}

export function findKonzinfoCountryBySlug(slug: string): KonzinfoCountry | null {
  return COUNTRY_BY_SLUG.get(slug) ?? null;
}

/** Resolve a free-text honeymoon destination (often a Nominatim breadcrumb like
 *  "Denpasar, Bali, Indonesia") to its official Konzinfo country page.
 *
 *  Order: (1) the curated destination→country rules — islands / cities / region
 *  names that don't contain the country, plus HU + EN country aliases; (2) a
 *  direct fallback where the destination text literally contains an official
 *  Hungarian country name. Returns null when nothing matches — the caller then
 *  shows the generic country-picker link. */
export function matchKonzinfoCountry(
  destination: string | null | undefined,
): KonzinfoCountry | null {
  if (!destination) return null;
  const norm = normalizeKonzinfo(destination);
  if (!norm) return null;
  const tokens = tokenize(norm);

  for (const rule of KONZINFO_DESTINATION_RULES) {
    for (const keyword of rule.match) {
      const hit = keyword.includes(" ") ? norm.includes(keyword) : tokens.has(keyword);
      if (hit) {
        const country = COUNTRY_BY_NAME.get(rule.country_hu);
        if (country) return country;
      }
    }
  }

  // Direct fallback: the destination text contains an official HU country name
  // verbatim (covers HU-locale place strings the rules don't enumerate).
  for (const country of KONZINFO_COUNTRIES) {
    if (norm.includes(normalizeKonzinfo(country.country_hu))) return country;
  }

  return null;
}
