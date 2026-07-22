import type { SupplierReview } from "@shared/suppliers";
import type { Locale } from "../lib/i18n";
import { reviewSpendLabel } from "../lib/reviewSpend";

/** Muted "what it cost" line on a review card ("≈ 350 000 Ft · full day +
 *  album"). Renders nothing when the reviewer shared neither a price nor a
 *  note, so cards without cost data are unchanged. */
export function ReviewSpendLine({
  review,
  locale,
}: {
  review: SupplierReview;
  locale: Locale;
}) {
  const label = reviewSpendLabel(review, locale);
  if (!label) return null;
  return <p className="mb-2 text-xs font-medium text-ink-500 dark:text-umber-300">{label}</p>;
}
