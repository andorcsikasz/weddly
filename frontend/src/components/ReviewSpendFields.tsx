import { REVIEW_AMOUNT_NOTE_MAX_CHARS } from "@shared/suppliers";
import { currencySymbol, localeCurrency } from "../lib/format";
import type { Locale } from "../lib/i18n";

/** Optional "what it cost" pair on the review composer: how much the couple
 *  paid (a plain numeric field with the locale currency symbol) and a short
 *  caption for what that bought. Both optional — the whole row is a soft prompt,
 *  no labels, so it stays out of the way of the star + tags flow. Currency
 *  follows the reviewer's locale (HU → Ft, else €); the parent sends it to the
 *  API so the stored figure is unambiguous for later viewers. */
export function ReviewSpendFields({
  amount,
  note,
  onAmount,
  onNote,
  locale,
  t,
}: {
  amount: number | null;
  note: string;
  onAmount: (next: number | null) => void;
  onNote: (next: string) => void;
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const symbol = currencySymbol(localeCurrency(locale), locale);

  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row">
      <div className="relative sm:w-40">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-ink-400 dark:text-umber-400">
          {symbol}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={amount === null ? "" : String(amount)}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/gu, "");
            onAmount(digits === "" ? null : Number(digits));
          }}
          placeholder={t("suppliers.detail.reviews.amountPlaceholder")}
          className="w-full rounded-md border border-ink-200 bg-white py-2 pr-3 pl-9 text-sm text-ink-800 placeholder:text-ink-400 focus:border-rose-400 focus:outline-none dark:border-umber-700 dark:bg-umber-900 dark:text-umber-100 dark:placeholder:text-umber-400"
        />
      </div>
      <input
        type="text"
        value={note}
        maxLength={REVIEW_AMOUNT_NOTE_MAX_CHARS}
        onChange={(e) => onNote(e.target.value)}
        placeholder={t("suppliers.detail.reviews.amountNotePlaceholder")}
        className="flex-1 rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-rose-400 focus:outline-none dark:border-umber-700 dark:bg-umber-900 dark:text-umber-100 dark:placeholder:text-umber-400"
      />
    </div>
  );
}
