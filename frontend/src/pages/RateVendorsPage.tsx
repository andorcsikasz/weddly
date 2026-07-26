// Post-wedding "rate your vendors" surface. The T+7 email + in-app notification
// land here. The whole point is speed: one tap on a star files a live, verified
// review for that vendor (the couple picked it, so it earns the badge), no form,
// no navigation. A quiet "add a comment" link goes to the vendor page for anyone
// who wants to write more.

import { Check, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/ui";
import { categoryIcon } from "../lib/category_icons";
import { coupleApi, reviewApi, type VendorToReview } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function RateVendorsPage() {
  const { t } = useT();
  const toast = useToast();
  const [vendors, setVendors] = useState<VendorToReview[] | null>(null);
  const [rated, setRated] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; n: number } | null>(null);

  useEffect(() => {
    coupleApi
      .vendorsToReview()
      .then((r) => setVendors(r.vendors))
      .catch(() => {
        setVendors([]);
        toast.error(t("common.error_generic"));
      });
  }, [toast, t]);

  async function rate(v: VendorToReview, stars: number) {
    if (busy) return;
    setBusy(v.id);
    try {
      await reviewApi.create(v.id, { rating: stars });
      setRated((cur) => ({ ...cur, [v.id]: stars }));
      toast.success(t("rate_vendors.thanks"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 xl:px-10">
      <header className="mb-6">
        <h1 className="font-grotesk text-3xl text-ink-900 dark:text-paper-50">
          {t("rate_vendors.title")}
        </h1>
        <p className="mt-2 text-ink-600 dark:text-umber-200">{t("rate_vendors.subtitle")}</p>
      </header>

      {vendors === null ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
      ) : vendors.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-medium text-ink-900 dark:text-paper-50">
            {t("rate_vendors.empty_title")}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("rate_vendors.empty_body")}
          </p>
          <Link to="/app" className="btn-primary mt-4 inline-flex">
            {t("rate_vendors.back")}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {vendors.map((v) => {
            const done = rated[v.id];
            const Icon = categoryIcon(v.category);
            return (
              <li key={v.id} className="card flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-700 dark:bg-umber-700 dark:text-paper-100">
                    <Icon size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900 dark:text-paper-50">{v.name}</p>
                    <p className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t(`suppliers.cat.${v.category}`)}
                    </p>
                  </div>
                </div>
                {done ? (
                  <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-sage-700 dark:text-sage-300">
                    <Check size={16} aria-hidden />
                    <span className="inline-flex items-center gap-0.5">
                      {Array.from({ length: done }).map((_, i) => (
                        <Star key={i} size={16} className="fill-star stroke-star" aria-hidden />
                      ))}
                    </span>
                    <Link
                      to={`/app/suppliers/${encodeURIComponent(v.id)}?review=1`}
                      className="text-xs font-normal text-ink-500 underline underline-offset-2 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
                    >
                      {t("rate_vendors.add_comment")}
                    </Link>
                  </span>
                ) : (
                  <div
                    className="inline-flex shrink-0 items-center gap-1"
                    role="radiogroup"
                    aria-label={t("rate_vendors.stars_aria", { name: v.name })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {[1, 2, 3, 4, 5].map((n) => {
                      const lit = hover?.id === v.id ? n <= hover.n : false;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={false}
                          aria-label={String(n)}
                          disabled={busy === v.id}
                          onMouseEnter={() => setHover({ id: v.id, n })}
                          onClick={() => void rate(v, n)}
                          className="p-0.5 leading-none transition disabled:opacity-50"
                        >
                          <Star
                            size={26}
                            aria-hidden
                            className={
                              lit
                                ? "fill-star stroke-star"
                                : "stroke-paper-300 dark:stroke-umber-500"
                            }
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
