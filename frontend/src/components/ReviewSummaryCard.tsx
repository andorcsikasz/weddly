// Google-style ratings summary: a big average, the 5→1★ distribution bars,
// and a single CTA that opens the full review list + composer in a modal
// (see ReviewsSection's `hideHeader` mode and PublicVendorPage's own modal).
// Shared between the public (/suppliers/:id) and in-app (/app/suppliers/:id)
// vendor pages so the two histograms are drawn once, not redrawn twice.

import type { ReviewSummary } from "@shared/suppliers";
import type { Locale } from "../lib/i18n";
import { StarRow } from "./StarRow";

export function ReviewSummaryCard({
  summary,
  locale,
  t,
  onOpen,
}: {
  summary: ReviewSummary;
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpen: () => void;
}) {
  const { avg_rating, reviews_count, histogram } = summary;
  const avgDisplay =
    avg_rating !== null
      ? locale === "hu"
        ? avg_rating.toFixed(1).replace(".", ",")
        : avg_rating.toFixed(1)
      : null;
  const avgRounded = avg_rating !== null ? Math.round(avg_rating) : 0;
  const maxBar = Math.max(1, ...histogram);

  return (
    <div className="rounded-2xl border border-paper-300 bg-white p-5 shadow-soft sm:p-6 dark:border-umber-600 dark:bg-umber-800 dark:shadow-none">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink-900 dark:text-paper-50">
        {t("suppliers.detail.reviews.summaryTitle")}
      </h2>

      {avgDisplay !== null ? (
        <div className="flex items-center gap-4 sm:gap-8">
          {/* The strips — one per star level, 5 down to 1, filled relative to
              the busiest row so a lopsided histogram (almost all 5★) still
              reads clearly rather than every bar looking nearly full. */}
          <div className="min-w-0 flex-1 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = histogram[star - 1] ?? 0;
              const pct = n > 0 ? Math.max(Math.round((n / maxBar) * 100), 4) : 0;
              return (
                <div key={star} className="flex items-center gap-2">
                  <span className="w-2.5 shrink-0 text-right text-xs tabular-nums text-ink-500 dark:text-umber-300">
                    {star}
                  </span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                    <div className="h-full rounded-full bg-star" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1 border-l border-paper-200 pl-4 sm:pl-8 dark:border-umber-700">
            <span className="text-4xl font-bold leading-none tabular-nums text-ink-900 dark:text-paper-50 sm:text-5xl">
              {avgDisplay}
            </span>
            <StarRow value={avgRounded} size={16} />
            <span className="whitespace-nowrap text-xs text-ink-600 dark:text-umber-300">
              {t("suppliers.detail.reviewsCount", { n: reviews_count })}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.info.ratingEmpty")}
        </p>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="btn-accent mt-5 w-full justify-center sm:w-auto"
      >
        {reviews_count > 0
          ? t("suppliers.detail.reviews.seeAllCta", { n: reviews_count })
          : t("suppliers.detail.reviews.writeFirstCta")}
      </button>
    </div>
  );
}
