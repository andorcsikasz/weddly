// Public, unauthenticated vendor page at `/suppliers/:supplier_id`. This is the
// surface a couple shares with someone OUTSIDE Weddly, and its whole job is to
// lead them into the app: it says who the vendor is, what they say about
// themselves, shows their photos and what couples say about them, and turns
// everything else (packages and prices, availability, contact, Q&A) into a
// locked placeholder with a sign-up CTA that returns to the vendor's page
// inside the app (owner direction 2026-09-21).
//
// Laid out in the SAME order as the in-app profile (`SupplierDetailPage`):
// header, photo mosaic, packages, about, reviews, availability and contact. The
// visible sections are real; the locked ones are placeholders, so a visitor sees
// where the rest lives. The data is the allowlisted `PublicVendorProfile` from
// `GET /api/public/vendors/:id`; nothing here is masked, because there is
// nothing to mask.
//
// The one interactive thing that stays is the review composer: a past client
// who is forwarded `?review=1` writes a review after a Google email check, with
// no account (the vendor review campaign depends on it).

import type {
  PublicVendorPageData,
  PublicVendorProfile,
  SupplierCategory,
  SupplierReview,
} from "@shared/suppliers";
import { pickListingBlurb } from "@shared/listing_language";
import { REVIEW_BODY_MAX_CHARS } from "@shared/suppliers";
import { vendorPublicId } from "@shared/vendor_slug";
import { ArrowLeft, CalendarCheck, Lock, MapPin, Send, Star, Tag } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ClaimListingModal } from "../components/ClaimListingModal";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { ReviewSnippets } from "../components/ReviewSnippets";
import { ReviewSpendFields } from "../components/ReviewSpendFields";
import { ReviewSpendLine } from "../components/ReviewSpendLine";
import { ReviewSummaryCard } from "../components/ReviewSummaryCard";
import { Dialog } from "../components/ui";
import { VendorGallery } from "../components/VendorGallery";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { ReviewTagPicker } from "../components/ReviewTagPicker";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getVisitorToken, setVisitorToken, supplierApi, visitorApi } from "../lib/endpoints";
import { intlLocale, localeCurrency } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { rememberDestination } from "../lib/post_signup_destination";
import { reviewTagLabel } from "../lib/reviewTags";

function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={
            n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"
          }
        />
      ))}
    </span>
  );
}

/** Interactive rating picker for the public composer. 0 = nothing chosen yet
 *  (submit stays disabled) so we never seed a default 5-star. */
function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={String(n)}
          className="p-0.5"
        >
          <Star
            size={22}
            className={
              n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"
            }
          />
        </button>
      ))}
    </span>
  );
}

/** Public review composer for an OUTSIDE-Weddly visitor. They confirm their
 *  email once via Google (mints a device token, stored client-side), then the
 *  star/tags/body form opens. Submits to the public visitor-review endpoint;
 *  the review is live immediately (a low rating is flagged for moderation). */
function PublicReviewComposer({
  supplierId,
  category,
  locale,
  t,
  onSubmitted,
}: {
  supplierId: string;
  category: SupplierCategory;
  locale: "hu" | "en";
  t: (k: string, vars?: Record<string, string | number>) => string;
  onSubmitted: () => void;
}) {
  const [verified, setVerified] = useState<boolean>(() => Boolean(getVisitorToken()));
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountNote, setAmountNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ownReview, setOwnReview] = useState<SupplierReview | null>(null);

  const loadReview = (review: SupplierReview) => {
    setOwnReview(review);
    setRating(review.rating);
    setBody(review.body ?? "");
    setTags(review.tags);
    setAmount(review.amount_paid);
    setAmountNote(review.amount_note ?? "");
  };

  useEffect(() => {
    if (!verified) return;
    let cancelled = false;
    visitorApi
      .ownReview(supplierId)
      .then((review) => {
        if (!cancelled) loadReview(review);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) return;
        if (e instanceof ApiError && e.status === 401) {
          setVisitorToken(null);
          setVerified(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId, verified]);

  const onGoogle = async (credential: string) => {
    setError(null);
    try {
      await visitorApi.googleVerify(credential, locale);
      setVerified(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const submit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const reviewBody = {
        rating,
        body: body.trim() || null,
        tags,
        amount_paid: amount,
        amount_currency: localeCurrency(locale),
        amount_note: amountNote.trim() || null,
      };
      const review = ownReview
        ? await visitorApi.updateReview(ownReview.id, reviewBody)
        : await visitorApi.createReview(supplierId, reviewBody);
      loadReview(review);
      setDone(true);
      onSubmitted();
    } catch (e) {
      const code = e instanceof ApiError ? (e.detail as { code?: string } | undefined)?.code : null;
      if (e instanceof ApiError && e.status === 401) {
        // Device token expired/unknown — drop it and re-prompt verification.
        setVisitorToken(null);
        setVerified(false);
        setError(t("suppliers.detail.reviews.visitorPrompt"));
      } else if (code === "already_reviewed") {
        setError(t("suppliers.detail.reviews.alreadyReviewed"));
      } else {
        setError(e instanceof Error ? e.message : "Submit failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!ownReview || !window.confirm(t("suppliers.detail.reviews.deleteConfirmTitle"))) return;
    setSubmitting(true);
    setError(null);
    try {
      await visitorApi.removeReview(ownReview.id);
      setOwnReview(null);
      setRating(0);
      setBody("");
      setTags([]);
      setAmount(null);
      setAmountNote("");
      setDone(false);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mt-6 rounded-xl border border-sage-300/60 bg-sage-50 p-4 text-sm text-sage-800 dark:border-sage-700/50 dark:bg-sage-900/30 dark:text-sage-100">
        <p>{t("suppliers.detail.reviews.visitorSubmitted")}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-outline" onClick={() => setDone(false)}>
            {t("common.edit")}
          </button>
          <button type="button" className="btn-outline" onClick={remove} disabled={submitting}>
            {t("common.delete")}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900">
      <h3 className="mb-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
        {t("suppliers.detail.reviews.visitorComposerTitle")}
      </h3>
      {!verified ? (
        <div>
          <p className="mb-3 text-sm text-ink-600 dark:text-umber-200">
            {t("suppliers.detail.reviews.visitorPrompt")}
          </p>
          <GoogleSignInButton mode="signin" onCredential={onGoogle} />
          {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm text-ink-600 dark:text-umber-200">
              {t("suppliers.detail.reviews.yourRating")}:
            </span>
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <textarea
            className="mb-3 w-full rounded-md border border-ink-200 bg-white p-3 text-sm dark:border-umber-700 dark:bg-umber-900"
            placeholder={t("suppliers.detail.reviews.bodyPlaceholder")}
            maxLength={REVIEW_BODY_MAX_CHARS}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <ReviewSpendFields
            amount={amount}
            note={amountNote}
            onAmount={setAmount}
            onNote={setAmountNote}
            locale={locale}
            t={t}
          />
          <ReviewTagPicker value={tags} onChange={setTags} category={category} t={t} />
          <div className="flex items-center justify-between gap-3">
            {error ? (
              <span className="text-xs text-rose-600 dark:text-rose-300">{error}</span>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={submitting || rating === 0}
              onClick={submit}
              className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-paper-100 dark:text-ink-900"
            >
              {submitting
                ? "…"
                : ownReview
                  ? t("common.save")
                  : t("suppliers.detail.reviews.submit")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(unixMs: number, locale: Locale): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

type T = (k: string, vars?: Record<string, string | number>) => string;

/** Every CTA on this page goes through here, so they all do the same thing: a
 *  signed-in visitor opens the vendor's page in the app, and everybody else
 *  goes to sign-up with that page remembered as where to land afterwards. */
function AccessCta({
  appPath,
  signedIn,
  label,
  className,
  t,
}: {
  appPath: string;
  signedIn: boolean;
  label: string;
  className: string;
  t: T;
}) {
  if (signedIn) {
    return (
      <Link to={appPath} className={className}>
        {t("publicVendor.openInApp")}
      </Link>
    );
  }
  return (
    <Link to="/signup" onClick={() => rememberDestination(appPath)} className={className}>
      {label}
    </Link>
  );
}

const CTA_DARK =
  "inline-flex items-center justify-center rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-200";

/** Slim public top bar: wordmark home link + a single sign-up CTA. The whole
 *  point of the shared page is acquisition, so the CTA is always visible. */
function PublicTopBar({
  t,
  appPath,
  signedIn,
}: {
  t: T;
  appPath: string | null;
  signedIn: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-paper-200 bg-paper-50/90 backdrop-blur dark:border-umber-700 dark:bg-umber-900/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Weddly" className="inline-flex items-center">
          <Wordmark size="sm" className="text-ink-900 dark:text-paper-50" />
        </Link>
        {appPath ? (
          <AccessCta
            appPath={appPath}
            signedIn={signedIn}
            label={t("publicVendor.signupCta")}
            className={CTA_DARK}
            t={t}
          />
        ) : (
          <Link to="/signup" className={CTA_DARK}>
            {t("publicVendor.signupCta")}
          </Link>
        )}
      </div>
    </header>
  );
}

/** A section the account unlocks. It mirrors the shape of the real section on
 *  the in-app page (same heading, skeleton rows where the content would be) but
 *  holds no data: the bars are fixed decoration, never derived from anything
 *  about this vendor, so even their count and width say nothing. */
function LockedSection({
  id,
  title,
  rows,
  cta,
  signedIn,
  t,
}: {
  id?: string;
  title: string;
  rows: number;
  cta: ReactNode;
  /** A signed-in visitor is not asked to sign up: the button says where to go
   *  and the sentence about signing up is dropped. */
  signedIn: boolean;
  t: T;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
        {title}
      </h2>
      <div className="relative overflow-hidden rounded-2xl border border-paper-300 bg-white dark:border-umber-600 dark:bg-umber-900">
        <div aria-hidden className="pointer-events-none select-none space-y-3 p-5">
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 rounded-xl border border-paper-200 px-4 py-4 dark:border-umber-700"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-paper-300 dark:bg-umber-600" />
                <div className="h-3 w-1/2 rounded bg-paper-200 dark:bg-umber-700" />
                <div className="h-3.5 w-1/4 rounded bg-paper-300 dark:bg-umber-600" />
              </div>
              <div className="h-9 w-28 rounded-full bg-paper-200 dark:bg-umber-700" />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper-50/50 px-6 text-center backdrop-blur-[1.5px] dark:bg-umber-900/60">
          <Lock
            size={20}
            strokeWidth={1.5}
            aria-hidden
            className="text-ink-600 dark:text-umber-200"
          />
          {!signedIn && (
            <p className="max-w-xs text-sm text-ink-700 dark:text-paper-100">
              {t("publicVendor.lockedBody")}
            </p>
          )}
          {cta}
        </div>
      </div>
    </section>
  );
}

/** The sticky side card: what the account adds, and the one button. Mirrors the
 *  in-app booking card's place and weight so the two pages read as one. */
function AccessCard({
  t,
  appPath,
  signedIn,
}: {
  t: T;
  appPath: string;
  signedIn: boolean;
}) {
  const items = [
    { icon: Tag, key: "publicVendor.sideItemPackages" },
    { icon: CalendarCheck, key: "publicVendor.sideItemDate" },
    { icon: MapPin, key: "publicVendor.sideItemContact" },
    { icon: Send, key: "publicVendor.sideItemQuote" },
  ];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-elevated ring-1 ring-black/[0.04] dark:bg-umber-900 dark:shadow-none dark:ring-umber-600">
      <p className="text-base font-bold text-ink-900 dark:text-paper-50">
        {t("publicVendor.sideTitle")}
      </p>
      <ul className="mt-3 space-y-2.5">
        {items.map(({ icon: Icon, key }) => (
          <li
            key={key}
            className="flex items-center gap-3 text-sm text-ink-700 dark:text-umber-100"
          >
            <Icon
              size={16}
              strokeWidth={1.5}
              aria-hidden
              className="shrink-0 text-ink-500 dark:text-umber-400"
            />
            <span className="flex-1">{t(key)}</span>
            <Lock
              size={13}
              strokeWidth={1.5}
              aria-hidden
              className="shrink-0 text-ink-400 dark:text-umber-400"
            />
          </li>
        ))}
      </ul>
      <AccessCta
        appPath={appPath}
        signedIn={signedIn}
        label={t("publicVendor.inquiryCta")}
        className="btn-accent mt-5 w-full justify-center"
        t={t}
      />
      {!signedIn && (
        <Link
          to="/login"
          state={{ from: appPath }}
          className="mt-3 block text-center text-sm text-ink-600 underline underline-offset-4 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
        >
          {t("publicVendor.haveAccount")}
        </Link>
      )}
    </div>
  );
}

export default function PublicVendorPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const signedIn = user !== null;
  const { supplier_id: supplierIdRaw } = useParams<{ supplier_id: string }>();
  const supplierId = supplierIdRaw ?? "";
  // `?review=1` on a shared link (the vendor forwarded it to a past client)
  // deep-links straight to the reviews section + composer.
  const [searchParams] = useSearchParams();
  const wantsReview = searchParams.get("review") === "1";

  const [data, setData] = useState<PublicVendorPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Owner-side claim dialog, opened from the unclaimed-listing notice below.
  // Anonymous-friendly: the modal mails the listing's own contact address, so
  // a business owner who found this page on Google needs no account first.
  const [claimOpen, setClaimOpen] = useState(false);
  // The reviews list + composer live behind this modal (see ReviewSummaryCard);
  // `wantsReview` opens it straight to the composer.
  const [reviewsOpen, setReviewsOpen] = useState(wantsReview);

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
    if (data?.detail) document.title = `${data.detail.name} · Wēddly`;
  }, [data]);

  // Count a public-profile view once the real vendor payload has loaded. Keyed
  // on the resolved listing id (v{N}) so a shared link feeds the same reach
  // number the admin vendor list shows. Fire-and-forget; failures are noise.
  const detailId = data?.detail?.id;
  useEffect(() => {
    if (!detailId) return;
    supplierApi.recordEvents([{ supplier_id: detailId, type: "view" }]).catch(() => undefined);
  }, [detailId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
        <PublicTopBar t={t} appPath={null} signedIn={signedIn} />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="h-64 w-full animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800" />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
        <PublicTopBar t={t} appPath={null} signedIn={signedIn} />
        <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
          <h1 className="text-2xl font-bold text-ink-900 dark:text-paper-50">
            {t("publicVendor.notFoundTitle")}
          </h1>
          <p className="mt-2 text-ink-600 dark:text-umber-200">{t("publicVendor.notFoundBody")}</p>
          <Link to="/suppliers" className={`mt-6 ${CTA_DARK} px-5 py-2.5`}>
            {t("publicVendor.browseCta")}
          </Link>
        </div>
      </div>
    );
  }

  const { detail, reviews } = data;
  // Where every CTA on this page ends up: the vendor's own page inside the app,
  // by its pretty id, the same URL the in-app page upgrades itself to.
  const appPath = `/app/suppliers/${encodeURIComponent(vendorPublicId(detail.id, detail.name))}`;
  // Re-pull the public payload after a visitor posts a review so their (now
  // live) review appears without a full page reload.
  const reloadDetail = () => {
    supplierApi
      .publicDetail(supplierId)
      .then((r) => setData(r))
      .catch(() => undefined);
  };
  const ratingAvg = detail.reviews_summary.avg_rating;
  const ratingCount = detail.reviews_summary.reviews_count;
  const ratingDisplay =
    ratingAvg !== null && ratingCount >= 3
      ? locale === "hu"
        ? ratingAvg.toFixed(1).replace(".", ",")
        : ratingAvg.toFixed(1)
      : null;

  const unlockCta = (
    <AccessCta
      appPath={appPath}
      signedIn={signedIn}
      label={t("publicVendor.unlockCta")}
      className={CTA_DARK}
      t={t}
    />
  );

  return (
    <div className="min-h-screen bg-paper-50 pb-24 dark:bg-umber-900 lg:pb-0">
      <PublicTopBar t={t} appPath={appPath} signedIn={signedIn} />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {/* The only way back into the catalogue this page ever offered was the
            browser's own back button, dead the moment someone arrived via a
            shared link or a search result. Carries the category forward so
            "back" lands on a relevant filtered view, not the bare rails. */}
        <Link
          to={`/suppliers/browse?category=${detail.category}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
        >
          <ArrowLeft size={15} aria-hidden />
          {t("publicVendor.browseAllCta")}
        </Link>

        {/* Header, in the in-app page's order: who, how good. The facts that
            page carries next to the rating (price band, capacity, languages)
            are behind the account, so they are simply not here. */}
        <header>
          <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t(`suppliers.cat.${detail.category}`)} · {detail.city}
          </div>
          <h1 className="mt-1 inline-flex flex-wrap items-center gap-x-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl">
            <span>{detail.name}</span>
            {detail.claimed && <VerifiedBadge size={28} complete={detail.listing_complete} />}
          </h1>
          {detail.company_name && detail.company_name !== detail.name && (
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{detail.company_name}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {ratingDisplay !== null && ratingAvg !== null ? (
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="font-semibold text-ink-900 dark:text-paper-50">
                  {ratingDisplay}
                </span>
                <StarRow value={Math.round(ratingAvg)} size={16} />
                <span className="text-ink-600 dark:text-umber-200">
                  {t("suppliers.detail.reviewsCount", { n: ratingCount })}
                </span>
              </span>
            ) : (
              <span className="text-sm italic text-ink-500 dark:text-umber-300">
                {t("suppliers.detail.info.ratingEmpty")}
              </span>
            )}
          </div>
        </header>

        <div className="mt-5">
          <VendorGallery
            layout="mosaic"
            images={detail.gallery_urls}
            name={detail.name}
            positionsY={detail.gallery_positions_y}
            emptyState={<PublicHero detail={detail} t={t} />}
          />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ── MAIN ─────────────────────────────────────────────────────── */}
          <main className="min-w-0">
            {/* Packages lead, exactly where the in-app page puts them, because
                this is the section a visitor most wants and the strongest
                reason to sign up. */}
            <LockedSection
              title={t("suppliers.detail.packages.title")}
              rows={3}
              cta={unlockCta}
              signedIn={signedIn}
              t={t}
            />

            <section className="mb-12">
              <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-paper-50">
                {t("suppliers.detail.about.title")}
              </h2>
              <PublicBlurb detail={detail} locale={locale} t={t} />
            </section>

            {/* Reviews: the average + 1-5★ bars and the latest few in their own
                words; the full list and the composer open in a modal. */}
            <section id="reviews" className="mb-12 scroll-mt-24">
              <ReviewSummaryCard
                summary={detail.reviews_summary}
                locale={locale}
                t={t}
                onOpen={() => setReviewsOpen(true)}
              />
              <ReviewSnippets
                reviews={reviews}
                locale={locale}
                t={t}
                onOpen={() => setReviewsOpen(true)}
              />
            </section>
            <Dialog
              open={reviewsOpen}
              onClose={() => setReviewsOpen(false)}
              title={`${t("suppliers.detail.reviews.title")} (${ratingCount})`}
              role="dialog"
              closeOnBackdrop
              size="lg"
            >
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
              <PublicReviewComposer
                supplierId={supplierId}
                category={detail.category}
                locale={locale === "hu" ? "hu" : "en"}
                t={t}
                onSubmitted={reloadDetail}
              />
            </Dialog>

            {/* Availability, address, phone, website, videos and Q&A: one
                locked block, because the in-app page spreads them over three
                places and a visitor only needs to know they exist. */}
            <LockedSection
              title={t("publicVendor.lockedDetailsTitle")}
              rows={2}
              cta={unlockCta}
              signedIn={signedIn}
              t={t}
            />
          </main>

          {/* ── SIDE ─────────────────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <AccessCard t={t} appPath={appPath} signedIn={signedIn} />
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
          <AccessCta
            appPath={appPath}
            signedIn={signedIn}
            label={t("publicVendor.bandCta")}
            className="mt-6 inline-flex rounded-full bg-paper-50 px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-paper-100"
            t={t}
          />
        </section>
      </div>

      <footer className="border-t border-paper-200 py-8 text-center text-xs text-ink-500 dark:border-umber-700 dark:text-umber-300">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4">
          <Link to="/" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerHome")}
          </Link>
          <Link to="/suppliers" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerVendors")}
          </Link>
          <Link to="/about" className="hover:text-ink-800 dark:hover:text-paper-100">
            {t("publicVendor.footerAbout")}
          </Link>
          {/* The owner's way in, and deliberately nothing more: one quiet
              footer link on listings nobody has claimed, in the same voice as
              the links around it. It is not a banner, because a visitor
              choosing a vendor has no use for it. */}
          {!detail.claimed && (
            <button
              type="button"
              onClick={() => setClaimOpen(true)}
              className="text-ink-400 hover:text-ink-700 dark:text-umber-400 dark:hover:text-paper-100"
            >
              {t("publicVendor.ownerNoticeClaim")}
            </button>
          )}
        </nav>
      </footer>

      {/* Below `lg` the side card falls to the end of the page, so the CTA
          rides along at the bottom of the screen the whole way down. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-paper-200 bg-paper-50/95 px-4 py-3 backdrop-blur lg:hidden dark:border-umber-700 dark:bg-umber-900/95">
        <AccessCta
          appPath={appPath}
          signedIn={signedIn}
          label={t("publicVendor.inquiryCta")}
          className="btn-accent w-full justify-center"
          t={t}
        />
      </div>

      <ClaimListingModal
        listingId={claimOpen ? detail.id : null}
        listingName={detail.name}
        onClose={() => setClaimOpen(false)}
      />
    </div>
  );
}

function PublicHero({ detail, t }: { detail: PublicVendorProfile; t: (k: string) => string }) {
  // No photos yet. This is the FIRST thing a visitor sees on a profile the
  // business has not filled in, so it has to look like a decision rather than
  // an absence: the stationery hairline texture the rest of the product uses,
  // a monogram in the accent, and the category set as a caption.
  return (
    <div
      role="img"
      aria-label={detail.name}
      className="stationery flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-paper-300 dark:border-umber-700 sm:aspect-[2.3/1]"
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full border border-blush-200 bg-paper-50/80 font-grotesk text-xl font-semibold uppercase tracking-wide text-blush-600 dark:border-blush-400/30 dark:bg-umber-900/60 dark:text-blush-300"
        >
          {monogramOf(detail.name)}
        </span>
        <Wordmark size="md" className="text-ink-700 dark:text-paper-100" />
        <div className="text-[11px] uppercase tracking-[0.22em] text-ink-500 dark:text-umber-300">
          {t(`suppliers.cat.${detail.category}`)}
        </div>
      </div>
    </div>
  );
}

/** Up to two initials from a business name, for the no-photo monogram. */
function monogramOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "W";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2);
  return ((words[0] ?? "")[0] ?? "") + ((words[1] ?? "")[0] ?? "");
}

function PublicBlurb({
  detail,
  locale,
  t,
}: {
  detail: PublicVendorProfile;
  locale: Locale;
  t: (k: string) => string;
}) {
  const blurb = pickListingBlurb(detail, locale);
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
  locale: Locale;
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
      <ReviewSpendLine review={review} locale={locale as Locale} />
      {review.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {review.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-paper-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
            >
              {reviewTagLabel(tag, t)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
