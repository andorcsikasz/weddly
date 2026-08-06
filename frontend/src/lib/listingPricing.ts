import type { Currency } from "@shared/currency";
import type { PackagePriceMode, PriceRange } from "@shared/listing_pricing";
import { formatMoney } from "./format";
import type { Locale } from "./i18n";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Localised package-price line. Open-ended ranges stay explicit instead of
 *  turning a missing maximum into a misleading fixed price. */
export function formatPackagePrice(
  range: PriceRange,
  mode: PackagePriceMode,
  currency: Currency,
  locale: Locale,
  t: T,
): string {
  let amount: string;
  if (range.min !== null && range.max !== null) {
    amount =
      range.min === range.max
        ? formatMoney(range.min, currency, locale)
        : `${formatMoney(range.min, currency, locale)} – ${formatMoney(range.max, currency, locale)}`;
  } else if (range.min !== null) {
    amount = t("suppliers.detail.packages.priceFrom", {
      price: formatMoney(range.min, currency, locale),
    });
  } else if (range.max !== null) {
    amount = t("suppliers.detail.packages.priceUpTo", {
      price: formatMoney(range.max, currency, locale),
    });
  } else {
    return "";
  }

  return t(
    mode === "per_person"
      ? "suppliers.detail.packages.pricePerPerson"
      : "suppliers.detail.packages.priceTotal",
    { price: amount },
  );
}
