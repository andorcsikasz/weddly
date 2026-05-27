// Admin-only supplier detail page. v1 surface for the locked-in spec, now in
// the editorial two-column layout: main scroll column on the left (hero,
// about, reviews, Q&A, bookings, admin meta) and a sticky right rail with
// the Información / Kapcsolat / Foglaltság cards. Inspired by the reference
// vendor pages couples already browse on competitor sites — same shape so the
// design transfers cleanly when the page opens up to couples in Phase 3.
//
// Route is wrapped in <RequireAdmin> at App.tsx, so this page assumes
// `user.is_admin === true`. The data-fetching layer still calls admin-only
// endpoints — a Phase-3 flip is a single auth-rule edit on the backend +
// removing the RequireAdmin wrap.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import type {
  CommentVisibility,
  SupplierAvailability,
  SupplierBooking,
  SupplierComment,
  SupplierDetail,
  SupplierReview,
  SupplierReviewTag,
} from "@shared/suppliers";
import {
  COMMENT_BODY_MAX_CHARS,
  MAX_REVIEW_TAGS,
  REVIEW_BODY_MAX_CHARS,
  SUPPLIER_REVIEW_TAGS,
} from "@shared/suppliers";
import { Pill } from "../components/admin";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { reviewApi, supplierApi, supplierBookingApi, supplierCommentApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const VISIBILITIES: CommentVisibility[] = ["admin_internal", "public", "vendor_only"];

function formatDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  // Filled (rose) for n ≤ value, hollow (ink-300) otherwise. Used both in the
  // header rating chip and on each review card.
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={
            n <= value ? "fill-rose-500 stroke-rose-500" : "stroke-ink-300 dark:stroke-umber-500"
          }
        />
      ))}
    </span>
  );
}

function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n as 1 | 2 | 3 | 4 | 5)}
          className={`text-2xl leading-none transition ${
            n <= value ? "text-rose-500" : "text-ink-300 hover:text-rose-300"
          }`}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

export default function SupplierDetailPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { supplier_id: supplierIdRaw } = useParams<{ supplier_id: string }>();
  const supplierId = supplierIdRaw ?? "";

  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [reviews, setReviews] = useState<SupplierReview[] | null>(null);
  const [comments, setComments] = useState<SupplierComment[] | null>(null);
  const [availability, setAvailability] = useState<SupplierAvailability | null>(null);
  const [bookings, setBookings] = useState<SupplierBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = detail ? `${detail.name} · ${t("suppliers.detail.adminTitle")}` : "Supplier";
  }, [detail, t]);

  const refresh = useCallback(async () => {
    if (!supplierId) return;
    try {
      const [d, rs, cs, av, bs] = await Promise.all([
        supplierApi.detail(supplierId),
        reviewApi.list(supplierId, { limit: 50 }),
        supplierCommentApi.list(supplierId, { limit: 50 }),
        supplierBookingApi.availability(supplierId),
        supplierBookingApi.list(supplierId),
      ]);
      setDetail(d);
      setReviews(rs.items);
      setComments(cs.items);
      setAvailability(av);
      setBookings(bs.items);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Load failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [supplierId, toast]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  if (loading || !detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <Skeleton className="mb-2 h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const ratingAvg = detail.reviews_summary.avg_rating;
  const ratingCount = detail.reviews_summary.reviews_count;

  return (
    // data-admin-shell opts every h1..h6 inside into the sans typography
    // override defined in index.css. Mirrors the /app/admin/* shell so the
    // admin-only detail page reads as an operational tool, not editorial copy.
    <div data-admin-shell="true" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700 dark:text-umber-300 dark:hover:text-umber-100"
      >
        <ChevronLeft size={14} aria-hidden />
        {t("suppliers.detail.back")}
      </button>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ─── MAIN COLUMN ────────────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Hero */}
          <section className="mb-10">
            {detail.hero_image_url && (
              <div className="mb-5 overflow-hidden rounded-xl">
                <img
                  src={detail.hero_image_url}
                  alt=""
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
            )}
            <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t(`suppliers.cat.${detail.category}`)} · {detail.city}
            </div>
            <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-cream-50 sm:text-4xl">
              {detail.name}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {ratingAvg !== null && ratingCount >= 3 ? (
                <span className="inline-flex items-center gap-2 text-sm">
                  <StarRow value={Math.round(ratingAvg)} size={16} />
                  <span className="font-medium text-ink-900 dark:text-cream-50">
                    {ratingAvg.toFixed(1)}
                  </span>
                  <span className="text-ink-500 dark:text-umber-300">·</span>
                  <span className="text-ink-600 dark:text-umber-200">{ratingCount}</span>
                </span>
              ) : (
                <span className="text-sm italic text-ink-500 dark:text-umber-300">
                  {t("suppliers.detail.info.ratingEmpty")}
                </span>
              )}
              {detail.vendor_account_id ? (
                <Pill tone="sage">{t("suppliers.detail.claimed")}</Pill>
              ) : (
                <Pill tone="muted">{t("suppliers.detail.unclaimed")}</Pill>
              )}
            </div>
          </section>

          {/* About / blurb */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
              {t("suppliers.detail.about.title")}
            </h2>
            <BlurbBody detail={detail} locale={locale} t={t} />
            {detail.reviews_summary.top_tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {detail.reviews_summary.top_tags.map((tt) => (
                  <span
                    key={tt.tag}
                    className="rounded-full bg-ink-900 px-3 py-1 text-xs text-cream-50 dark:bg-cream-50 dark:text-ink-900"
                  >
                    {t(`suppliers.reviewTags.${tt.tag}`)} · {tt.count}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Reviews */}
          <ReviewsSection
            supplierId={supplierId}
            reviews={reviews ?? []}
            avg={ratingAvg}
            count={ratingCount}
            onChange={refresh}
            confirm={confirm}
            toast={toast}
            locale={locale}
            t={t}
          />

          {/* Q&A */}
          <CommentsSection
            supplierId={supplierId}
            comments={comments ?? []}
            onChange={refresh}
            confirm={confirm}
            toast={toast}
            locale={locale}
            t={t}
          />

          {/* Bookings list (the mini-calendar moved to the right rail) */}
          <BookingsSection bookings={bookings} bookable={detail.bookable} t={t} />

          {/* Admin meta */}
          <AdminMetaSection detail={detail} t={t} />
        </div>

        {/* ─── SIDEBAR (sticky on lg+) ───────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <InfoCard detail={detail} avg={ratingAvg} count={ratingCount} locale={locale} t={t} />
          <ContactCard detail={detail} t={t} />
          <BusyCalendarCard availability={availability} locale={locale} t={t} />
        </aside>
      </div>
    </div>
  );
}

// ─── Main-column sections ────────────────────────────────────────────────────

function BlurbBody({
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

interface SectionCtx {
  supplierId: string;
  onChange: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
  confirm: ReturnType<typeof useConfirm>;
  locale: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

function ReviewsSection({
  reviews,
  avg,
  count,
  ...ctx
}: SectionCtx & { reviews: SupplierReview[]; avg: number | null; count: number }) {
  const { supplierId, onChange, toast, confirm, locale, t } = ctx;
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<SupplierReviewTag[]>([]);
  const [published, setPublished] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tag: SupplierReviewTag) => {
    setTags((prev) => {
      if (prev.includes(tag)) return prev.filter((x) => x !== tag);
      if (prev.length >= MAX_REVIEW_TAGS) return prev;
      return [...prev, tag];
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await reviewApi.create(supplierId, {
        rating,
        body: body.trim() || null,
        tags,
        published,
      });
      setBody("");
      setTags([]);
      setRating(5);
      setPublished(false);
      toast.success(t("suppliers.detail.reviews.submitted"));
      await onChange();
    } catch (e) {
      const code = e instanceof ApiError ? (e.detail as { code?: string } | undefined)?.code : null;
      const msg =
        code === "already_reviewed"
          ? t("suppliers.detail.reviews.alreadyReviewed")
          : e instanceof Error
            ? e.message
            : "Submit failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: t("suppliers.detail.reviews.deleteConfirmTitle"),
      body: t("suppliers.detail.reviews.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await reviewApi.remove(id);
      await onChange();
      toast.success(t("suppliers.detail.reviews.deleted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
          {t("suppliers.detail.reviews.title")} ({count})
        </h2>
        {avg !== null && count >= 3 && (
          <span className="inline-flex items-center gap-2 text-sm">
            <StarRow value={Math.round(avg)} size={14} />
            <span className="font-medium">{avg.toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-ink-200/60 bg-cream-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
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
        <div className="mb-3">
          <div className="mb-1.5 text-xs text-ink-500 dark:text-umber-300">
            {t("suppliers.detail.reviews.tagsLabel", { max: MAX_REVIEW_TAGS })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUPPLIER_REVIEW_TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    on
                      ? "bg-rose-500 text-white"
                      : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50 dark:bg-umber-700/60 dark:text-umber-100 dark:ring-umber-600"
                  }`}
                >
                  {t(`suppliers.reviewTags.${tag}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-umber-200">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            {t("suppliers.detail.reviews.publishedLabel")}
          </label>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm text-cream-50 disabled:opacity-50 dark:bg-cream-50 dark:text-ink-900"
          >
            {submitting ? "…" : t("suppliers.detail.reviews.submit")}
          </button>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.reviews.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StarRow value={r.rating} size={14} />
                  <span className="text-sm font-medium text-ink-900 dark:text-cream-50">
                    {r.author.display_name}
                  </span>
                  {r.editorial && <Pill tone="violet">Editorial</Pill>}
                  {!r.published && <Pill tone="blush">Draft</Pill>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatDate(r.created_at, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="text-ink-400 hover:text-rose-600 dark:text-umber-400"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
              {r.body && (
                <p className="mb-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                  {r.body}
                </p>
              )}
              {r.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
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
    </section>
  );
}

function CommentsSection({ comments, ...ctx }: SectionCtx & { comments: SupplierComment[] }) {
  const { supplierId, onChange, toast, confirm, locale, t } = ctx;
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>("admin_internal");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await supplierCommentApi.create(supplierId, { body: body.trim(), visibility });
      setBody("");
      toast.success(t("suppliers.detail.comments.submitted"));
      await onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Submit failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: t("suppliers.detail.comments.deleteConfirmTitle"),
      body: t("suppliers.detail.comments.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await supplierCommentApi.remove(id);
      await onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    }
  };

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.comments.title")}
      </h2>

      <div className="mb-6 rounded-xl border border-ink-200/60 bg-cream-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
        <textarea
          className="mb-3 w-full rounded-md border border-ink-200 bg-white p-3 text-sm dark:border-umber-700 dark:bg-umber-900"
          placeholder={t("suppliers.detail.comments.placeholder")}
          maxLength={COMMENT_BODY_MAX_CHARS}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as CommentVisibility)}
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-sm dark:border-umber-700 dark:bg-umber-900"
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(`suppliers.detail.comments.visibility.${v}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={submitting || !body.trim()}
            onClick={submit}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm text-cream-50 disabled:opacity-50 dark:bg-cream-50 dark:text-ink-900"
          >
            {submitting ? "…" : t("suppliers.detail.comments.submit")}
          </button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.comments.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-900 dark:text-cream-50">
                    {c.author.display_name}
                  </span>
                  {c.author.is_admin && <Pill tone="violet">Weddly</Pill>}
                  <Pill tone="muted">
                    {t(`suppliers.detail.comments.visibility.${c.visibility}`)}
                  </Pill>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatDate(c.created_at, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="text-ink-400 hover:text-rose-600 dark:text-umber-400"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookingsSection({
  bookings,
  bookable,
  t,
}: {
  bookings: SupplierBooking[];
  bookable: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (!bookable && bookings.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.calendar.title")}
      </h2>
      {bookings.length === 0 ? (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.calendar.noBookings")}
        </p>
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-xl border border-ink-200/60 bg-white p-4 text-sm dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div>
                <div className="font-medium text-ink-900 dark:text-cream-50">{b.event_date}</div>
                <div className="text-xs text-ink-500 dark:text-umber-300">
                  {t(`suppliers.detail.calendar.status.${b.status}`)}
                </div>
              </div>
              {b.status === "confirmed" && (
                <a
                  href={supplierBookingApi.icsUrl(b.id)}
                  download
                  className="text-xs text-rose-600 underline"
                >
                  {t("suppliers.detail.calendar.downloadIcs")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Right-rail sidebar cards ────────────────────────────────────────────────

function SidebarCard({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-ink-200/60 bg-white p-5 shadow-sm dark:border-umber-700/60 dark:bg-umber-900">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-cream-50">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function SidebarRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="mt-0.5 text-ink-500 dark:text-umber-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-400">
          {label}
        </div>
        <div className="text-sm text-ink-800 dark:text-umber-100">{value}</div>
      </div>
    </div>
  );
}

function InfoCard({
  detail,
  avg,
  count,
  locale,
  t,
}: {
  detail: SupplierDetail;
  avg: number | null;
  count: number;
  locale: string;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <SidebarCard title={t("suppliers.detail.info.title")}>
      <SidebarRow
        icon={<MapPin size={14} aria-hidden />}
        label={t("suppliers.detail.info.location")}
        value={detail.address ? `${detail.city} · ${detail.address}` : detail.city}
      />
      <SidebarRow
        icon={<Star size={14} aria-hidden />}
        label={t("suppliers.detail.info.rating")}
        value={
          avg !== null && count >= 3 ? (
            t("suppliers.detail.info.ratingValue", {
              avg: locale === "hu" ? avg.toFixed(1).replace(".", ",") : avg.toFixed(1),
              n: count,
            })
          ) : (
            <span className="italic text-ink-500 dark:text-umber-300">
              {t("suppliers.detail.info.ratingEmpty")}
            </span>
          )
        }
      />
      <SidebarRow
        icon={<Sparkles size={14} aria-hidden />}
        label={t("suppliers.detail.info.category")}
        value={t(`suppliers.cat.${detail.category}`)}
      />
      {detail.price_band !== null && (
        <SidebarRow
          icon={<span className="font-mono text-xs">$</span>}
          label={t("suppliers.detail.info.priceBand")}
          value={<span className="font-mono">{"$".repeat(detail.price_band)}</span>}
        />
      )}
    </SidebarCard>
  );
}

function ContactCard({
  detail,
  t,
}: {
  detail: SupplierDetail;
  t: (k: string) => string;
}) {
  const hasAny = Boolean(detail.website || detail.contact_email || detail.contact_phone);
  return (
    <SidebarCard title={t("suppliers.detail.contact.title")}>
      {!hasAny && (
        <p className="text-sm italic text-ink-500 dark:text-umber-300">
          {t("suppliers.detail.contact.empty")}
        </p>
      )}
      {detail.website && (
        <a
          href={`/r/supplier/${encodeURIComponent(detail.id)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
        >
          <Globe size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />
          {t("suppliers.detail.contact.website")}
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
    </SidebarCard>
  );
}

// ─── Mini busy-calendar ──────────────────────────────────────────────────────

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function BusyCalendarCard({
  availability,
  locale,
  t,
}: {
  availability: SupplierAvailability | null;
  locale: string;
  t: (k: string) => string;
}) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  const blocked = useMemo(
    () => new Set(availability?.unavailable_dates ?? []),
    [availability?.unavailable_dates],
  );

  const monthLabel = useMemo(() => {
    const d = new Date(cursor.year, cursor.month, 1);
    return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "long",
      year: "numeric",
    }).format(d);
  }, [cursor, locale]);

  // Build a 6-row × 7-col grid starting on Monday (HU + EN both treat Monday
  // as week-start in this admin context; couples reading the public site can
  // get a Sunday-start later if EU/US locale flips).
  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1);
    // JS getDay: 0=Sun..6=Sat. We want Mon=0..Sun=6.
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(cursor.year, cursor.month, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const dayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      weekday: "narrow",
    });
    // 2026-05-25 is a Monday — use it as the anchor for Mon..Sun ordering.
    const monday = new Date(2026, 4, 25);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return fmt.format(d);
    });
  }, [locale]);

  const goto = (offset: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + offset, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const hasAny = blocked.size > 0;

  return (
    <SidebarCard
      icon={<CalendarIcon size={14} aria-hidden className="text-ink-500 dark:text-umber-400" />}
      title={t("suppliers.detail.busy.title")}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => goto(-1)}
          aria-label={t("suppliers.detail.busy.prevMonth")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <span className="text-sm font-medium capitalize text-ink-800 dark:text-umber-100">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => goto(1)}
          aria-label={t("suppliers.detail.busy.nextMonth")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-500 dark:text-umber-400">
        {dayLabels.map((l, i) => (
          <div key={i} className="py-1 uppercase">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.month;
          const iso = ymd(d);
          const isBlocked = blocked.has(iso);
          const isToday = ymd(d) === ymd(today);
          return (
            <div
              key={i}
              className={`flex h-8 items-center justify-center rounded text-xs transition ${
                !inMonth
                  ? "text-ink-300 dark:text-umber-500"
                  : isBlocked
                    ? "bg-rose-200/70 font-medium text-rose-800 line-through dark:bg-rose-400/30 dark:text-rose-100"
                    : "text-ink-700 dark:text-umber-200"
              } ${isToday && inMonth && !isBlocked ? "ring-1 ring-rose-400" : ""}`}
              title={isBlocked ? iso : undefined}
            >
              {d.getDate()}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-500 dark:text-umber-300">
        <span className="inline-block h-3 w-3 rounded bg-rose-200/70 dark:bg-rose-400/30" />
        {hasAny ? t("suppliers.detail.busy.legendBooked") : t("suppliers.detail.busy.empty")}
      </div>
    </SidebarCard>
  );
}

// ─── Admin meta ──────────────────────────────────────────────────────────────

function AdminMetaSection({
  detail,
  t,
}: {
  detail: SupplierDetail;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <section className="mt-10 rounded-xl border border-dashed border-ink-300/60 bg-ink-50/40 p-5 text-sm dark:border-umber-600/60 dark:bg-umber-800/30">
      <h2 className="mb-3 text-base font-semibold uppercase tracking-wide text-ink-700 dark:text-umber-200">
        {t("suppliers.detail.adminMeta.title")}
      </h2>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.id")}
          </dt>
          <dd className="font-mono">{detail.id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.source")}
          </dt>
          <dd>{detail.source}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.vendorAccount")}
          </dt>
          <dd>{detail.vendor_account_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.commentsCount")}
          </dt>
          <dd>{detail.comments_count ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            {t("suppliers.detail.adminMeta.redirect")}
          </dt>
          <dd>
            <code className="font-mono">/r/supplier/{detail.id}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}
