// What language a listing's own-language description is written in.
//
// A listing carries TWO descriptions: `blurb_en` and `blurb_hu`. The second
// column name is historic — the directory started in Hungary, so "the other
// language" and "Hungarian" were the same thing. They are not any more: a
// Croatian photographer's own-language description is Croatian, an Austrian
// venue's is German. The column still holds it; only the LABEL and the
// audience change, which is why this is a presentation module and not a
// migration (schema here is additive only, and rewriting 60+ rows into a new
// column would buy nothing a lookup can't).
//
// So: `blurb_hu` means "the local-language description", and this file is the
// one place that answers "local to what?".

import type { UiLocale } from "./locales";
import type { TranslateLang } from "./translate";

export interface ListingLanguage {
  /** BCP-47 primary subtag, lowercase. Compared against the viewer's UI locale
   *  to decide which of the two descriptions they are served. */
  code: string;
  /** The language's name IN ITSELF, for the editor's tab. Endonyms, matching
   *  how `LOCALE_NAMES` labels the UI switcher — a vendor picking the language
   *  they write in should read it in that language. */
  label: string;
  /** DeepL's code for this language, or null where DeepL has no such language
   *  (Croatian and Serbian, today). Null is what HIDES the auto-translate
   *  button rather than letting it fail on send.
   *
   *  Typed as `TranslateLang`, not `string`: this value is handed straight to
   *  the translate endpoint, so a code DeepL does not accept has to be a
   *  compile error here rather than a 400 the vendor discovers by pressing the
   *  button. It is also what lets the editor pass it without a cast. */
  deepl: TranslateLang | null;
}

const EN: ListingLanguage = { code: "en", label: "English", deepl: "EN" };

/** ISO 3166-1 alpha-2 → the language a business there writes its own copy in.
 *  One language per country on purpose: this picks a default for a text field,
 *  not an official-language list, and a vendor in a bilingual country can
 *  always write English in the other box. */
const BY_COUNTRY: Record<string, ListingLanguage> = {
  HU: { code: "hu", label: "Magyar", deepl: "HU" },
  HR: { code: "hr", label: "Hrvatski", deepl: null },
  DE: { code: "de", label: "Deutsch", deepl: "DE" },
  AT: { code: "de", label: "Deutsch", deepl: "DE" },
  CH: { code: "de", label: "Deutsch", deepl: "DE" },
  ES: { code: "es", label: "Español", deepl: "ES" },
  SK: { code: "sk", label: "Slovenčina", deepl: "SK" },
  CZ: { code: "cs", label: "Čeština", deepl: "CS" },
  PL: { code: "pl", label: "Polski", deepl: "PL" },
  SI: { code: "sl", label: "Slovenščina", deepl: "SL" },
  RS: { code: "sr", label: "Srpski", deepl: null },
  RO: { code: "ro", label: "Română", deepl: "RO" },
  IT: { code: "it", label: "Italiano", deepl: "IT" },
  FR: { code: "fr", label: "Français", deepl: "FR" },
  PT: { code: "pt", label: "Português", deepl: "PT" },
  NL: { code: "nl", label: "Nederlands", deepl: "NL" },
  BE: { code: "nl", label: "Nederlands", deepl: "NL" },
  GR: { code: "el", label: "Ελληνικά", deepl: "EL" },
  BG: { code: "bg", label: "Български", deepl: "BG" },
  DK: { code: "da", label: "Dansk", deepl: "DA" },
  SE: { code: "sv", label: "Svenska", deepl: "SV" },
  FI: { code: "fi", label: "Suomi", deepl: "FI" },
  EE: { code: "et", label: "Eesti", deepl: "ET" },
  LV: { code: "lv", label: "Latviešu", deepl: "LV" },
  LT: { code: "lt", label: "Lietuvių", deepl: "LT" },
  UA: { code: "uk", label: "Українська", deepl: "UK" },
  TR: { code: "tr", label: "Türkçe", deepl: "TR" },
  // Anglophone countries resolve to English, which is what collapses the
  // editor to a single description field — two tabs both saying "English"
  // would be a form asking the vendor to write the same text twice.
  GB: EN,
  IE: EN,
  US: EN,
  CA: EN,
  AU: EN,
  NZ: EN,
};

/** The local language for a listing in `country`.
 *
 *  An unknown or missing country falls back to Hungarian, which is not a guess
 *  so much as the status quo: every row that predates international listings
 *  has Hungarian in that column, and answering anything else would relabel
 *  their existing text as a language it is not written in. */
export function listingLocalLanguage(country: string | null | undefined): ListingLanguage {
  const code = (country ?? "").trim().toUpperCase();
  return BY_COUNTRY[code] ?? BY_COUNTRY.HU!;
}

/** True when the listing has only ONE description to give: its local language
 *  IS English, so the second field would ask for the same text twice. */
export function isEnglishOnlyListing(country: string | null | undefined): boolean {
  return listingLocalLanguage(country).code === "en";
}

/** Which of a listing's two descriptions a given reader is served.
 *
 *  Rules, in order:
 *   1. A reader whose UI language IS the listing's local language gets the
 *      local text. That is the whole point of the second field, and it is what
 *      the old `locale === "hu" ? blurb_hu : blurb_en` could never do for a
 *      Croatian reading a Croatian vendor.
 *   2. Everyone else gets English.
 *   3. Either way, an EMPTY winner falls through to the other one. A listing
 *      with a description in one language only used to render a blank block to
 *      everybody else, which reads as an abandoned page rather than as a
 *      vendor who hasn't translated themselves yet. Text in the "wrong"
 *      language still tells a couple who this business is; nothing tells them
 *      nothing. */
export function pickListingBlurb(
  listing: { country?: string | null; blurb_hu?: string | null; blurb_en?: string | null },
  viewer: UiLocale,
): string {
  const local = (listing.blurb_hu ?? "").trim();
  const english = (listing.blurb_en ?? "").trim();
  const preferLocal = listingLocalLanguage(listing.country).code === viewer;
  return (preferLocal ? local || english : english || local).trim();
}
