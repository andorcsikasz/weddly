// The latest few written reviews, in the reviewers' own words, under the
// average + histogram. Clicking any of them opens the full list. Shared by the
// signed-in vendor page and the anonymous one, so the two show the same thing
// in the same place.

import type { SupplierReview } from "@shared/suppliers";
import { intlLocale } from "../lib/format";
import type { Locale } from "../lib/i18n";
import { StarRow } from "./StarRow";

function formatDate(unixMs: number, locale: Locale): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function ReviewSnippets({
  reviews,
  locale,
  t,
  onOpen,
}: {
  reviews: SupplierReview[];
  locale: Locale;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpen: () => void;
}) {
  const latest = reviews
    .filter((r) => r.published && r.body && r.body.trim().length > 0)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 3);
  if (latest.length === 0) return null;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-3">
      {latest.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={onOpen}
            className="flex h-full w-full flex-col rounded-2xl border border-paper-300 bg-white p-4 text-left transition hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-600 dark:bg-umber-900 dark:hover:border-umber-500"
          >
            <span className="flex items-center justify-between gap-2">
              <StarRow value={r.rating} size={14} />
              <span className="text-xs text-ink-500 dark:text-umber-300">
                {formatDate(r.created_at, locale)}
              </span>
            </span>
            <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink-700 dark:text-paper-100">
              {r.body}
            </span>
            <span className="mt-3 text-xs font-medium text-ink-600 dark:text-umber-200">
              {r.author.display_name}
              {r.verified ? ` · ${t("suppliers.detail.reviews.verifiedBadge")}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
