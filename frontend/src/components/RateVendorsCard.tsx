// Dashboard nudge for the post-wedding "rate your vendors" flow — the in-app
// twin of the T+7 email, so a couple who never opens the mail still sees it.
// Self-fetching and self-hiding: it only appears once the wedding has passed AND
// there are vendors the couple picked but hasn't rated, and it vanishes the
// moment the list is empty (they rated everyone). Mirrors UpcomingTasksCard's
// "render its own states" pattern.

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function RateVendorsCard({ weddingDate }: { weddingDate: string | null }) {
  const { t } = useT();
  const [count, setCount] = useState<number | null>(null);

  // Only past weddings — pre-wedding a couple who has already picked vendors
  // must not be told to rate them.
  const past = weddingDate !== null && weddingDate <= new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!past) return;
    let cancelled = false;
    coupleApi
      .vendorsToReview()
      .then((r) => {
        if (!cancelled) setCount(r.vendors.length);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [past]);

  if (!past || count === null || count === 0) return null;

  return (
    <section className="card mb-8 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-700 dark:bg-sage-400/20 dark:text-sage-200">
          <Star size={20} aria-hidden />
        </span>
        <div>
          <h2 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
            {t("rate_vendors.title")}
          </h2>
          <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">
            {t("rate_vendors.card_body", { count })}
          </p>
        </div>
      </div>
      <Link to="/app/rate-vendors" className="btn-primary shrink-0 self-start sm:self-auto">
        {t("rate_vendors.card_cta")}
      </Link>
    </section>
  );
}
