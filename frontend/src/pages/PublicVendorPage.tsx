// Public, unauthenticated vendor page at `/vendors/:supplier_id`. This is the
// surface a couple shares with someone OUTSIDE Weddly — no login wall. It's a
// read-only editorial view: hero, gallery, blurb, packages, videos, published
// reviews and public Q&A, plus a contact rail and a "plan your own wedding"
// conversion band. Everything interactive on the in-app detail page (save,
// inquire, review composer, admin meta) is stripped. Data comes from the
// single public aggregate endpoint `GET /api/public/vendors/:id`.

import type {
  PublicVendorPageData,
  SupplierComment,
  SupplierDetail,
  SupplierReview,
} from "@shared/suppliers";
import {
  BadgeCheck,
  ExternalLink,
  FileText,
  Globe,
  Mail,
  MapPin,
  Phone,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LazyVideoPlayer } from "../components/VideoEmbed";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"}
        />
      ))}
    </span>
  );
}

function PriceBandDots({ band }: { band: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-sm" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={
            n <= band ? "text-paper-700 dark:text-paper-300" : "text-paper-300 dark:text-umber-600"
          }
        >
          $
        </span>
      ))}
    </span>
  );
}

function formatDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Slim public top bar: wordmark home link + a single sign-up CTA. The whole
 *  point of the shared page is acquisition, so the CTA is always visible. */
function PublicTopBar({ t }: { t: (k: string) => string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-paper-200 bg-paper-50/90 backdrop-blur dark:border-umber-700 dark:bg-umber-900/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Weddly" className="inline-flex items-center">
          <Wordmark size="sm" className="text-ink-900 dark:text-paper-50" />
        </Link>
        <Link
          to="/signup"
          className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-200"
        >
          {t("publicVendor.signupCta")}
        </Link>
      </div>
    </header>
  );
}

export default function PublicVendorPage() {
  const { t, locale } = useT();
  const { supplier_id: supplierIdRaw } = useParams<{ supplier_id: string }>();
  const supplierId = supplierIdRaw ?? "";

  const [data, setData] = useState<PublicVendorPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    supplierApi
      .publicDetail(supplierId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  useEffect(() => {
    if (data?.detail) document.title = `${data.detail.name} · Weddly`;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
        <PublicTopBar t={t} />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="h-64 w-full animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800" />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
        <PublicTopBar t={t} />
        <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
          <h1 className="text-2xl font-bold text-ink-900 dark:text-paper-50">
            {t("publicVendor.notFoundTitle")}
          </h1>
          <p className="mt-2 text-ink-600 dark:text-umber-200">
            {t("publicVendor.notFoundBody")}
          </p>
          <Link
            to="/vendors"
            className="mt-6 inline-flex rounded-full bg-ink-900 px-5 py-2.5 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900"
          >
            {t("publicVendor.browseCta")}
          </Link>
        </div>
      </div>
    );
  }

  const { detail, reviews, comments, availability } = data;
  const ratingAvg = detail.reviews_summary.avg_rating;
  const ratingCount = detail.reviews_summary.reviews_count;
  const ratingDisplay =
    ratingAvg !== null && ratingCount >= 3
      ? locale === "hu"
        ? ratingAvg.toFixed(1).replace(".", ",")
        : ratingAvg.toFixed(1)
      : null;

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
      <PublicTopBar t={t} />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* ── MAIN ─────────────────────────────────────────────────────── */}
          <main className="min-w-0">
            <PublicHero detail={detail} t={t} />
            {detail.gallery_urls && detail.gallery_urls.length > 1 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {detail.gallery_urls.slice(1).map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`${detail.name} ${i + 2}`}
                    loading="lazy"
                    className="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-24 sm:w-24"
                  />
                ))}
              </div>
            )}

            <div className="mt-5 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t(`suppliers.cat.${detail.category}`)} · {detail.city}
            </div>
            <h1 className="mt-1 inline-flex flex-wrap items-center gap-x-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl">
              <span>{detail.name}</span>
              {detail.vendor_account_id !== null && (
                <BadgeCheck
                  size={28}
                  aria-label={t("suppliers.detail.verifiedAria")}
                  className="shrink-0 fill-steel-600 stroke-white"
                />
              )}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {ratingDisplay !== null && ratingAvg !== null ? (
                <span className="inline-flex items-center gap-2 text-sm">
                  <StarRow value={Math.round(ratingAvg)} size={16} />
                  <span className="font-medium text-ink-900 dark:text-paper-50">
                    {ratingDisplay}
                  </span>
                  <span className="text-ink-500 dark:text-umber-300">·</span>
                  <span className="text-ink-600 dark:text-umber-200">
                    {t("suppliers.detail.reviewsCount", { n: ratingCount })}
                  </span>
                </span>
              ) : (
                <span className="text-sm italic text-ink-500 dark:text-umber-300">
                  {t("suppliers.detail.info.ratingEmpty")}
                </span>
              )}
              {detail.price_band !== null && <PriceBandDots band={detail.price_band} />}
            </div>

            {/* Videos */}
            {detail.videos.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  {t("suppliers.detail.videos.title")}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {detail.videos.map((v, i) => (
                    <LazyVideoPlayer
                      key={v.id}
                      video={v}
                      title={t("suppliers.detail.videos.playAria", { name: detail.name, n: i + 1 })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* About */}
            <section className="mt-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                {t("suppliers.detail.about.title")}
              </h2>
              <PublicBlurb detail={detail} locale={locale} t={t} />
            </section>

            {/* Packages */}
            {detail.packages.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  {t("suppliers.detail.packages.title")}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.packages.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-col rounded-xl border border-paper-300 bg-white p-4 dark:border-umber-700 dark:bg-umber-800"
                    >
                      <h3 className="text-base font-semibold text-ink-900 dark:text-paper-50">
                        {p.name}
                      </h3>
                      {p.price_text && (
                        <p className="mt-1 text-sm font-semibold text-steel-700 dark:text-steel-300">
                          {p.price_text}
                        </p>
                      )}
                      {p.description && (
                        <p className="mt-2 whitespace-pre-line text-sm text-ink-600 dark:text-umber-200">
                          {p.description}
                        </p>
                      )}
                      {p.pdf_url && (
                        <a
                          href={p.pdf_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-3 inline-flex items-center gap-1.5 self-start text-sm text-steel-700 hover:underline dark:text-steel-300"
                        >
                          <FileText size={15} aria-hidden />
                          {p.pdf_name ?? t("suppliers.detail.packages.download")}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Reviews (read-only) */}
            <section className="mt-10">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  {t("suppliers.detail.reviews.title")} ({ratingCount})
                </h2>
                {ratingAvg !== null && ratingCount >= 3 && (
                  <span className="inline-flex items-center gap-2 text-sm">
                    <StarRow value={Math.round(ratingAvg)} size={14} />
                    <span className="font-medium">{ratingAvg.toFixed(1)}</span>
                  </span>
                )}
              </div>
              {reviews.length === 0 ? (
                <p className="text-sm italic text-ink-500 dark:text-umber-300">
                  {t("suppliers.detail.reviews.empty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {reviews.map((r) => (
                    <PublicReviewCard key={r.id} review={r} locale={locale} t={t} />
                  ))}
                </ul>
              )}
            </section>

            {/* Public Q&A (read-only) — only when there is public content */}
            {comments.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  {t("suppliers.detail.comments.title")}
                </h2>
                <ul className="space-y-3">
                  {comments.map((c) => (
                    <PublicCommentCard key={c.id} comment={c} locale={locale} />
                  ))}
                </ul>
              </section>
            )}
          </main>

          {/* ── SIDEBAR ──────────────────────────────────────────────────── */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <PublicContactCard detail={detail} availability={availability} locale={locale} t={t} />
          </aside>
        </div>

        {/* Conversion band */}
        <section className="mt-14 overflow-hidden rounded-2xl bg-ink-900 px-6 py-10 text-center dark:bg-umber-800">
          <h2 className="text-2xl font-bold text-paper-50 sm:text-3xl">
            {t("publicVendor.bandTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-paper-200">
            {t("publicVendor.bandBody")}
          </p>
          <Link
            to="/signup"
            className="mt-6 inline-flex rounded-full bg-paper-50 px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-paper-100"
          >
            {t("publicVendor.bandCta")}
          </Link>
        </section>
      </div>

      <footer className="border-t border-paper-200 py-8 text-center text-xs text-ink-500 dark:border-umber-700 dark:text-umber-300">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4">
          <Link to="/" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerHome")}
          </Link>
          <Link to="/vendors" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerVendors")}
          </Link>
          <Link to="/about" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerAbout")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}

function PublicHero({ detail, t }: { detail: SupplierDetail; t: (k: string) => string }) {
  if (detail.hero_image_url) {
    return (
      <div className="overflow-hidden rounded-2xl">
        <img
          src={detail.hero_image_url}
          alt={detail.name}
          className="aspect-[16/9] w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={detail.name}
      className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl border-2 border-dashed border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800/60"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Wordmark size="lg" className="text-ink-700 dark:text-paper-100" />
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t(`suppliers.cat.${detail.category}`)}
        </div>
      </div>
    </div>
  );
}

function PublicBlurb({
  detail,
  locale,
  t,
}: {
  detail: SupplierDetail;
  locale: string;
  t: (k: string) => string;
}) {
  const blurb = (locale === "hu" ? detail.blurb_hu : detail.blurb_en).trim();
  if (!blurb) {
    return (
      <p className="text-sm italic text-ink-500 dark:text-umber-300">
        {t("suppliers.detail.about.empty")}
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-700 dark:text-paper-100">
      {blurb.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>{para.trim()}</p>
      ))}
    </div>
  );
}

function PublicReviewCard({
  review,
  locale,
  t,
}: {
  review: SupplierReview;
  locale: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <li className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900">
      <div className="mb-2 flex items-center gap-3">
        <StarRow value={review.rating} size={14} />
        <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
          {review.author.display_name}
        </span>
        <span className="text-xs text-ink-500 dark:text-umber-300">
          {formatDate(review.created_at, locale)}
        </span>
      </div>
      {review.body && (
        <p className="mb-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
          {review.body}
        </p>
      )}
      {review.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {review.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-paper-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
            >
              {t(`suppliers.reviewTags.${tag}`)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function PublicCommentCard({ comment, locale }: { comment: SupplierComment; locale: string }) {
  return (
    <li className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
          {comment.author.display_name}
        </span>
        <span className="text-xs text-ink-500 dark:text-umber-300">
          {formatDate(comment.created_at, locale)}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">{comment.body}</p>
    </li>
  );
}

function PublicContactCard({
  detail,
  availability,
  locale,
  t,
}: {
  detail: SupplierDetail;
  availability: PublicVendorPageData["availability"];
  locale: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    detail.address ? `${detail.name}, ${detail.address}` : `${detail.name}, ${detail.city}`,
  )}`;
  const addressLine = detail.address ? `${detail.city} · ${detail.address}` : detail.city;
  const nextAvailable =
    availability.bookable && availability.next_available
      ? new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(new Date(`${availability.next_available}T00:00:00`))
      : null;

  return (
    <div className="rounded-2xl border border-ink-200/60 bg-white p-5 shadow-sm dark:border-umber-700/60 dark:bg-umber-900">
      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
      >
        <MapPin size={14} aria-hidden className="mt-0.5 text-ink-500 dark:text-umber-400" />
        <span>{addressLine}</span>
      </a>
      {detail.website && (
        <a
          href={`/r/supplier/${encodeURIComponent(detail.id)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Globe size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {t("suppliers.detail.contact.website")}
          <ExternalLink size={12} aria-hidden className="text-ink-400 dark:text-umber-400" />
        </a>
      )}
      {detail.contact_email && (
        <a
          href={`mailto:${detail.contact_email}`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Mail size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {detail.contact_email}
        </a>
      )}
      {detail.contact_phone && (
        <a
          href={`tel:${detail.contact_phone}`}
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Phone size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {detail.contact_phone}
        </a>
      )}
      {nextAvailable && (
        <p className="mt-3 border-t border-paper-200 px-2 pt-3 text-xs text-ink-500 dark:border-umber-700 dark:text-umber-300">
          {t("publicVendor.nextAvailable", { date: nextAvailable })}
        </p>
      )}
    </div>
  );
}
