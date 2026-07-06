// Types for the DeepL-backed auto-translate endpoint. Used by the bilingual
// vendor "Leírás" fields (blurb_hu / blurb_en). HU <-> EN only for now; the
// language pair is a closed union so both sides share one contract.
// Provider: backend/src/lib/translate.ts. Route: backend/src/routes/translate.ts.

export type TranslateLang = "HU" | "EN";

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
