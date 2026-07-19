// Vendor reviews — read-only view of the couple-authored verified reviews on
// the vendor's own listing, at /vendor/reviews inside VendorShell. Reuses the
// public reviews endpoint (GET /api/suppliers/:id/reviews works for any authed
// viewer), so there is no vendor-specific backend surface. Responding to
// reviews is a deliberate non-goal for v1 — this page is about visibility.

import { ExternalLink, RefreshCw, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewSummary, SupplierReview } from "@shared/suppliers";
import { Skeleton, SkeletonText } from "../../components/ui";
import { reviewApi, vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          aria-hidden="true"
          className={
            n <= rating
              ? "fill-amber-400 text-amber-400"
              : "fill-paper-200 text-paper-200 dark:fill-umber-700 dark:text-umber-700"
          }
        />
      ))}
    </span>
  );
}

export default function VendorReviewsPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor.reviews.page_title"));

  const [listingId, setListingId] = useState<string | null>(null);
  const [items, setItems] = useState<SupplierReview[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const view = await vendorListingApi.me();
      const id = view.listing.id;
      setListingId(id);
      const page = await reviewApi.list(id);
      setItems(page.items);
      setSummary(page.summary);
      setNextCursor(page.nextCursor);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!listingId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await reviewApi.list(listingId, { cursor: nextCursor });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      /* keep what we have; the button stays for a retry */
    } finally {
      setLoadingMore(false);
    }
  };

  const fmtDate = (ms: number) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(ms));

  if (loading) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.reviews.page_title")}
        </h1>
        <div className="rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
          <Skeleton variant="line" width="30%" height={14} />
          <div className="mt-3">
            <SkeletonText lines={3} />
          </div>
        </div>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-10 text-center dark:border-umber-600 dark:bg-umber-900">
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("common.error_generic")}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost">
          <RefreshCw size={16} aria-hidden="true" />
          <span>{t("error_boundary.try_again")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.reviews.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.reviews.page_body")}</p>
      </header>

      {/* Aggregate header — average only appears past the cold-start gate
          (>= 3 published reviews), matching the public card. */}
      {summary && summary.reviews_count > 0 && (
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
          <div className="flex items-center gap-3">
            <span className="font-grotesk text-4xl font-semibold leading-none text-ink-900 tabular-nums dark:text-paper-50">
              {summary.avg_rating != null ? summary.avg_rating.toFixed(1) : "–"}
            </span>
            <div className="flex flex-col gap-0.5">
              {summary.avg_rating != null && <Stars rating={Math.round(summary.avg_rating)} />}
              <span className="text-xs text-ink-500 dark:text-paper-400">
                {t("vendor.reviews.count_label", { n: String(summary.reviews_count) })}
              </span>
            </div>
          </div>
          {summary.avg_rating == null && (
            <p className="text-sm text-ink-500 dark:text-paper-400">
              {t("vendor.reviews.cold_start_note")}
            </p>
          )}
          {summary.top_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.top_tags.map((tt) => (
                <span
                  key={tt.tag}
                  className="rounded-full bg-paper-100 px-2.5 py-1 text-xs text-ink-700 dark:bg-umber-800 dark:text-paper-200"
                >
                  {t(`suppliers.reviewTags.${tt.tag}`)} · {tt.count}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-paper-300 bg-paper-50 p-10 text-center dark:border-umber-600 dark:bg-umber-900">
          <Star size={24} aria-hidden="true" className="text-paper-300 dark:text-umber-600" />
          <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
            {t("vendor.reviews.empty_title")}
          </p>
          <p className="max-w-md text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.reviews.empty_body")}
          </p>
          {/* Preview the vendor's OWN listing as couples see it. Points at the
              PUBLIC `/vendors/:id` route, not the couple-app-internal
              `/app/suppliers/:id` (behind RequireCoupleAuth, which bounces a
              vendor back to /vendor). Same v{N} id, opened in a new tab. This
              was the third preview link that b35a24aa's "both links" fix missed. */}
          {listingId && (
            <Link
              to={`/vendors/${listingId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("vendor_home.preview_open")}
            </Link>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stars rating={r.rating} />
                  <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
                    {r.author.display_name}
                  </span>
                  {/* Editorial reviews already read as "Weddly editors" via the
                      author display name; only couple reviews get the badge. */}
                  {!r.editorial && (
                    <span className="rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sage-800 dark:bg-sage-900/40 dark:text-sage-300">
                      {t("suppliers.detail.reviews.verifiedBadge")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-ink-500 dark:text-paper-400">
                  {fmtDate(r.created_at)}
                </span>
              </div>
              {r.body && (
                <p className="whitespace-pre-line text-sm text-ink-800 dark:text-paper-200">
                  {r.body}
                </p>
              )}
              {r.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-paper-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-800 dark:text-paper-200"
                    >
                      {t(`suppliers.reviewTags.${tag}`)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="btn-ghost"
          >
            {loadingMore ? t("common.loading") : t("vendor.reviews.load_more")}
          </button>
        </div>
      )}
    </div>
  );
}
