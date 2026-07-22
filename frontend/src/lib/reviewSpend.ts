import { isCurrency } from "@shared/currency";
import type { SupplierReview } from "@shared/suppliers";
import { formatMoney } from "./format";
import type { Locale } from "./i18n";

/** One-line "what it cost" summary for a review card ("≈ 350 000 Ft · full day
 *  + album"), or null when the reviewer shared neither a price nor a note. The
 *  amount formats in the currency captured on the review, not the viewer's, so
 *  it reads exactly as the reviewer stated it. */
export function reviewSpendLabel(
  review: Pick<SupplierReview, "amount_paid" | "amount_currency" | "amount_note">,
  locale: Locale,
): string | null {
  const parts: string[] = [];
  if (review.amount_paid !== null && review.amount_paid > 0) {
    const currency = isCurrency(review.amount_currency) ? review.amount_currency : "EUR";
    parts.push(formatMoney(review.amount_paid, currency, locale));
  }
  if (review.amount_note) parts.push(review.amount_note);
  return parts.length > 0 ? parts.join(" · ") : null;
}
