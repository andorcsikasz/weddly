// Types for the DeepL-backed auto-translate endpoint. Used by the bilingual
// vendor description fields (`blurb_hu` = the LOCAL language, `blurb_en`).
// Provider: backend/src/lib/translate.ts. Route: backend/src/routes/translate.ts.
//
// The pair used to be HU <-> EN and nothing else, because the local language
// was always Hungarian. Now it is whatever `listingLocalLanguage()` says for
// the vendor's country, so this union has to cover every local language we map
// — minus the ones DeepL simply does not have. Croatian is the reason that
// distinction is explicit rather than assumed: a Croatian vendor gets the two
// description fields like everyone else, and no translate button, because
// offering one that 400s on send is worse than not offering it.

/** DeepL language codes we accept. Every entry must be a language DeepL
 *  actually supports as BOTH source and target — the `deepl` field in
 *  `shared/listing_language.ts` is what maps a country onto one of these, and
 *  a null there means "no button". */
export type TranslateLang =
  | "EN"
  | "HU"
  | "DE"
  | "ES"
  | "SK"
  | "CS"
  | "PL"
  | "SL"
  | "RO"
  | "IT"
  | "FR"
  | "PT"
  | "NL"
  | "EL"
  | "BG"
  | "DA"
  | "SV"
  | "FI"
  | "ET"
  | "LV"
  | "LT"
  | "UK"
  | "TR";

export const TRANSLATE_LANGS: readonly TranslateLang[] = [
  "EN",
  "HU",
  "DE",
  "ES",
  "SK",
  "CS",
  "PL",
  "SL",
  "RO",
  "IT",
  "FR",
  "PT",
  "NL",
  "EL",
  "BG",
  "DA",
  "SV",
  "FI",
  "ET",
  "LV",
  "LT",
  "UK",
  "TR",
];

export function isTranslateLang(raw: unknown): raw is TranslateLang {
  return typeof raw === "string" && (TRANSLATE_LANGS as readonly string[]).includes(raw);
}

export interface TranslateRequest {
  text: string;
  source: TranslateLang;
  target: TranslateLang;
}

export interface TranslateResult {
  text: string;
}

export interface TranslateAvailability {
  /** True when a DeepL key is configured server-side. The UI hides the
   *  translate button when false. */
  available: boolean;
}

/** Max characters a single translate call accepts — matches the blurb field
 *  cap (MAX_BLURB_LEN in routes/vendor_listing.ts) so a full description
 *  round-trips in one call. */
export const TRANSLATE_MAX_CHARS = 2000;
