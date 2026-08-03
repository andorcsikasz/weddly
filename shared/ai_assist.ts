// AI Concierge contract — the assistant strip on the vendor's client detail.
//
// It does exactly three things and nothing else: summarise the inquiry, draft a
// reply the vendor edits and sends themselves, and point at ONE of the vendor's
// OWN saved `listing_packages`. It is not a chatbot, it has no memory, and no
// output of it can leave the building without a human clicking send.
//
// Rules worth not re-deriving, all of them product decisions rather than
// implementation notes:
//
//   * THE MODEL NEVER INVENTS A PRICE OR A TERM. The package suggestion is a
//     SELECTION from what the vendor already saved, and the price is their own
//     `price_text` copied verbatim server-side from the row the id names. The
//     model returns an id, never a price string, so a hallucinated figure has
//     nowhere to land. A vendor with no saved packages gets `no_packages: true`
//     and `package: null` — the strip then says so rather than guessing, because
//     a marketplace assistant that quotes a number nobody agreed to does
//     commercial damage that no disclaimer undoes.
//
//   * EVERY OUTPUT IS A DRAFT. `draft_reply` lands in an editable field with a
//     draft label on it and a copy handle, never in an outbox. There is
//     deliberately no endpoint anywhere that takes a model output and sends it.
//
//   * `missing` IS THE POINT, not a footnote. What the couple did NOT say (no
//     venue, no budget, no guest count) is what tells the vendor which question
//     to ask back, and it is the half a summary alone always drops.
//
//   * A MODEL FAILURE IS A NON-EVENT. `generated: false` with a null assist is a
//     200, and the strip renders nothing. The vendor's job does not depend on
//     this feature working, so it must never be able to break the page it sits
//     on.

/** The three languages the vendor portal speaks. Output follows the COUPLE's
 *  locale, not the vendor's: the draft is a reply addressed to them. */
export type AssistLanguage = "en" | "hu" | "es";

export function isAssistLanguage(v: unknown): v is AssistLanguage {
  return v === "en" || v === "hu" || v === "es";
}

/** Map any stored locale string onto the three the assistant writes in.
 *  Anything unknown, including a null, falls to EN — the app's default
 *  everywhere else. */
export function assistLanguageFor(locale: string | null | undefined): AssistLanguage {
  const l = (locale ?? "").trim().toLowerCase();
  if (l === "hu" || l.startsWith("hu-")) return "hu";
  if (l === "es" || l.startsWith("es-")) return "es";
  return "en";
}

/** The package the assistant points at. Every field here is copied from the
 *  vendor's own `listing_packages` row, EXCEPT `reason`, which is the only
 *  sentence the model contributes. */
export interface InquiryAssistPackage {
  /** `listing_packages.id` on the vendor's own listing. */
  package_id: number;
  /** The vendor's own package name, verbatim. */
  name: string;
  /** The vendor's own free-text price, verbatim, or null when they never typed
   *  one. NEVER a figure the model produced. */
  price_text: string | null;
  /** One line on why this tier fits this inquiry, in `language`. */
  reason: string;
}

/** One assistant answer about one inquiry. */
export interface InquiryAssist {
  /** Two or three lines: guest count, date, what the couple actually asked for. */
  summary: string;
  /** What the couple did NOT say, one short phrase each. Empty when the inquiry
   *  left nothing open. */
  missing: string[];
  /** A suggested response for the vendor to edit. A DRAFT, always. */
  draft_reply: string;
  /** The suggested package, or null when the vendor saved none or the model
   *  picked none. */
  package: InquiryAssistPackage | null;
  /** True when the vendor's listing has no saved packages at all. The strip
   *  says so in words instead of leaving a silent gap where a suggestion goes. */
  no_packages: boolean;
  language: AssistLanguage;
}

/** What `POST /api/vendor/clients/:id/ai-assist` answers with. `generated:false`
 *  is the ordinary degraded answer (model unreachable, refused, or unparseable)
 *  and is still a 200 — see the module header. */
export interface InquiryAssistResult {
  generated: boolean;
  assist: InquiryAssist | null;
}

/** What `GET /api/ai/availability` answers with. Mirrors the DeepL translate
 *  availability endpoint: a pure in-process env check, so the UI can hide the
 *  whole strip before it ever asks for an answer. */
export interface AiAvailability {
  available: boolean;
}

/** How much of the couple's inquiry text is forwarded. A cap rather than a
 *  guard: nothing longer than this adds signal to a three-line summary, and an
 *  unbounded prompt is an unbounded bill. */
export const ASSIST_INQUIRY_MAX_CHARS = 4000;

/** Ceiling on `missing`. More than four "they did not say" bullets stops being
 *  a prompt to ask something and becomes a wall. */
export const ASSIST_MISSING_MAX = 4;

/** Ceiling on the drafted reply, in characters. Long enough for a warm, complete
 *  first response, short enough that the vendor edits it rather than rewrites. */
export const ASSIST_DRAFT_MAX_CHARS = 1600;

/** Ceiling on the summary. */
export const ASSIST_SUMMARY_MAX_CHARS = 600;
