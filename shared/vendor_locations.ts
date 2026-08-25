// Category × city SEO landing pages (e.g. /eskuvoi-szolgaltatok/fotosok/budapest,
// /wedding-vendors/photographers/budapest). Search intent for "wedding
// photographer <city>" never lands on the generic /suppliers/browse hub — it
// wants a page about exactly that category, in exactly that place. This module
// is the slug vocabulary both sides (React page, backend SSR + sitemap) share,
// so a slug typed into a URL and a slug generated into a sitemap can never
// drift apart.
//
// City is free text on `listings.city` (`"Budapest"`, `"Zagreb, HR"` — the
// `, XX` suffix marks a non-HU curated batch, see CLAUDE.md's community
// supplier notes). There is no normalized city table, so a URL slug is
// generated FROM a real listing's city string, never typed by hand — see
// `domain/vendor_locations.ts` for how the slug ↔ real string map is built.

import type { SupplierCategory } from "./suppliers";

/** A page exists only for a combination with at least this many photographed,
 *  active listings. Below this a combination isn't generated at all (no
 *  route, no sitemap entry, no thin page to `noindex`) — matching the
 *  existing vendor-profile rule of leaving weak content out entirely rather
 *  than publishing and hiding it. */
export const MIN_LISTINGS_FOR_LOCATION_PAGE = 5;

/** HU URL segment per category. Hand-written rather than derived from
 *  `SUPPLIER_CATEGORY_LABEL_HU` — a slug wants a stable, ASCII, ideally
 *  plural/agentive form ("fotosok", not "Fotó"), matching how the /eszkozok/*
 *  tool slugs are written. `other` is a hidden legacy fallback (see
 *  shared/suppliers.ts) and deliberately has no page. */
export const CATEGORY_SLUG_HU: Partial<Record<SupplierCategory, string>> = {
  wedding_planner: "eskuvoszervezok",
  venue: "helyszinek",
  accommodation: "szallasok",
  tent_pavilion: "satrak",
  catering: "cateringek",
  cake_dessert: "tortak-desszertek",
  bar_drinks: "italszolgaltatok",
  food_trucks: "food-truckok",
  wedding_decor: "dekoraciok",
  florist: "viragkotok",
  lighting: "vilagitastechnika",
  rental_equipment: "kolcsonzok",
  photography: "fotosok",
  videography: "videosok",
  content_creator: "tartalomkeszitok",
  photo_booth: "fotofulkek",
  dj: "dj",
  live_music: "elozenekarok",
  entertainment: "musorszamok",
  mc_celebrant: "ceremoniamesterek",
  celebrant: "szertartasvezetok",
  dance_lessons: "tanctanitas",
  sound_tech: "hangtechnika",
  bridal_boutique: "menyasszonyi-ruhak",
  suit_formal: "oltonyok",
  hair_makeup: "smink-es-frizura",
  nails: "koromepites",
  wedding_jewelry: "ekszerek",
  invitation_graphics: "meghivok",
  transport: "eskuvoi-transzfer",
};

/** EN twin of `CATEGORY_SLUG_HU`. Same keys (minus `other`). */
export const CATEGORY_SLUG_EN: Partial<Record<SupplierCategory, string>> = {
  wedding_planner: "wedding-planners",
  venue: "venues",
  accommodation: "accommodation",
  tent_pavilion: "tents",
  catering: "catering",
  cake_dessert: "cakes-desserts",
  bar_drinks: "bar-drinks",
  food_trucks: "food-trucks",
  wedding_decor: "decor",
  florist: "florists",
  lighting: "lighting",
  rental_equipment: "equipment-rental",
  photography: "photographers",
  videography: "videographers",
  content_creator: "content-creators",
  photo_booth: "photo-booths",
  dj: "dj",
  live_music: "live-music",
  entertainment: "entertainment",
  mc_celebrant: "mc",
  celebrant: "celebrants",
  dance_lessons: "dance-lessons",
  sound_tech: "sound-av",
  bridal_boutique: "bridal-boutiques",
  suit_formal: "suits",
  hair_makeup: "hair-makeup",
  nails: "nails",
  wedding_jewelry: "jewelry",
  invitation_graphics: "invitations",
  transport: "transport",
};

const HU_SLUG_TO_CATEGORY = new Map(
  Object.entries(CATEGORY_SLUG_HU).map(([cat, slug]) => [slug, cat as SupplierCategory]),
);
const EN_SLUG_TO_CATEGORY = new Map(
  Object.entries(CATEGORY_SLUG_EN).map(([cat, slug]) => [slug, cat as SupplierCategory]),
);

export function categorySlugFor(category: SupplierCategory, locale: "hu" | "en"): string | null {
  return (locale === "hu" ? CATEGORY_SLUG_HU : CATEGORY_SLUG_EN)[category] ?? null;
}

export function categoryFromSlug(slug: string, locale: "hu" | "en"): SupplierCategory | null {
  return (locale === "hu" ? HU_SLUG_TO_CATEGORY : EN_SLUG_TO_CATEGORY).get(slug) ?? null;
}

/** Every category that has a location-page slug, in the fixed `SUPPLIER_GROUPS`
 *  presentation order isn't needed here — callers that need an order sort
 *  their own combos by listing count. */
export const LOCATION_PAGE_CATEGORIES: readonly SupplierCategory[] = Object.keys(
  CATEGORY_SLUG_HU,
) as SupplierCategory[];

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Turn a real `listings.city` value into a URL segment: strip the `, XX`
 *  non-HU country suffix (the slug is about the city, the suffix is a data
 *  disambiguator, not something a visitor would type), fold accents, and
 *  hyphenate. Deterministic and lossy — recovering the exact display string
 *  from a slug needs the lookup table `domain/vendor_locations.ts` builds
 *  from real rows, this function is one-directional by design. */
export function citySlugify(rawCity: string): string {
  const withoutCountrySuffix = rawCity.split(",")[0] ?? rawCity;
  return withoutCountrySuffix
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface CategoryCityCombo {
  category: SupplierCategory;
  categorySlugHu: string;
  categorySlugEn: string;
  citySlug: string;
  /** The exact `listings.city` value to pass as the `city` filter to
   *  `/api/public/vendors` — required because that endpoint exact-matches
   *  (folded) against this string, and a slug alone can't reconstruct
   *  capitalisation, accents or the country suffix. */
  cityDisplay: string;
  country: string;
  count: number;
}

/** URL prefixes for the two locales of a location page. A prefix, not a
 *  per-slug pair like the tool pages' `SLUG_PAIRS` — the combo space is
 *  large and DB-derived (hundreds of cities), so pairing is done by
 *  resolving the SAME category+city under the other prefix at request time,
 *  not by hand-listing every pair up front. */
export const LOCATION_PAGE_HU_PREFIX = "/eskuvoi-szolgaltatok";
export const LOCATION_PAGE_EN_PREFIX = "/wedding-vendors";

export interface LocationPathMatch {
  locale: "hu" | "en";
  categorySlug: string;
  citySlug: string;
}

const LOCATION_PATH_RE = /^\/(eskuvoi-szolgaltatok|wedding-vendors)\/([^/]+)\/([^/]+)\/?$/;

/** Parse a request path into its locale + raw slugs, without resolving
 *  whether the combo actually exists — resolution needs the DB-backed
 *  listing counts, which only the backend (`domain/vendor_locations.ts`) can
 *  compute. The frontend uses this to read its own route params the same
 *  way; the backend uses it in `seo_ssr.ts` before calling
 *  `resolveCategoryCityCombo`. */
export function matchLocationPath(pathname: string): LocationPathMatch | null {
  const m = LOCATION_PATH_RE.exec(pathname);
  if (!m) return null;
  const prefix = m[1];
  const categorySlug = m[2];
  const citySlug = m[3];
  if (!categorySlug || !citySlug) return null;
  return {
    locale: prefix === "eskuvoi-szolgaltatok" ? "hu" : "en",
    categorySlug,
    citySlug,
  };
}

/** Build a combo's URL in the given locale. */
export function locationPagePath(
  combo: Pick<CategoryCityCombo, "categorySlugHu" | "categorySlugEn" | "citySlug">,
  locale: "hu" | "en",
): string {
  return locale === "hu"
    ? `${LOCATION_PAGE_HU_PREFIX}/${combo.categorySlugHu}/${combo.citySlug}`
    : `${LOCATION_PAGE_EN_PREFIX}/${combo.categorySlugEn}/${combo.citySlug}`;
}
