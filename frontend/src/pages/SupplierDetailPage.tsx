// Admin-only supplier detail page. v1 surface for the locked-in spec:
//   - Hero with claim + rating chip
//   - Reviews section (compose + list, with star picker and tag chips)
//   - Q&A comments section (compose + list, with visibility selector)
//   - Calendar / availability (read-only in v1; booking inquiry CTA shows
//     only when the supplier is claimed — unclaimed surfaces the tracked
//     /r/supplier/:id redirect instead)
//   - Admin meta block (claim status, redirect link, raw ids)
//
// Route is wrapped in <RequireAdmin> at App.tsx, so this page assumes
// `user.is_admin === true`. The data-fetching layer still calls admin-only
// endpoints — a Phase-3 flip is a single auth-rule edit on the backend +
// removing the RequireAdmin wrap.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  MAX_REVIEW_TAGS,
  REVIEW_BODY_MAX_CHARS,
  COMMENT_BODY_MAX_CHARS,
  SUPPLIER_REVIEW_TAGS,
} from "@shared/suppliers";
import { AdminPageHeader, Pill } from "../components/admin";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  reviewApi,
  supplierApi,
  supplierBookingApi,
  supplierCommentApi,
} from "../lib/endpoints";
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

function RatingChip({ avg, count }: { avg: number | null; count: number }) {
  if (avg === null || count < 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100/60 px-3 py-1 text-xs text-ink-600 dark:bg-umber-700/40 dark:text-umber-200">
        New · No rating yet
      </span>
    );
  }
  const rounded = Math.round(avg * 10) / 10;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
      ★ {rounded.toFixed(1)} · {count} reviews
    </span>
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
    document.title = detail
      ? `${detail.name} · ${t("suppliers.detail.adminTitle")}`
      : "Supplier";
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
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <Skeleton className="mb-2 h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-ink-500 hover:text-ink-700 dark:text-umber-300 dark:hover:text-umber-100"
      >
        ← {t("suppliers.detail.back")}
      </button>

      {/* Hero */}
      <section className="mb-8">
        {detail.hero_image_url && (
          <div className="mb-4 overflow-hidden rounded-lg">
            <img
              src={detail.hero_image_url}
              alt=""
              className="aspect-video w-full object-cover"
            />
          </div>
        )}
        <div className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t(`suppliers.cat.${detail.category}`)} · {detail.city}
        </div>
        <h1 className="mt-1 font-cormorant text-4xl italic text-ink-900 dark:text-cream-50">
          {detail.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RatingChip avg={detail.reviews_summary.avg_rating} count={detail.reviews_summary.reviews_count} />
          {detail.vendor_account_id ? (
            <Pill tone="sage">{t("suppliers.detail.claimed")}</Pill>
          ) : (
            <Pill tone="muted">{t("suppliers.detail.unclaimed")}</Pill>
          )}
        </div>
        {detail.reviews_summary.top_tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {detail.reviews_summary.top_tags.map((tt) => (
              <span
                key={tt.tag}
                className="rounded-full bg-cream-100 px-2.5 py-1 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
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

      {/* Calendar / Booking */}
      <CalendarSection
        supplierId={supplierId}
        detail={detail}
        availability={availability}
        bookings={bookings}
        onChange={refresh}
        toast={toast}
        confirm={confirm}
        locale={locale}
        t={t}
      />

      {/* Admin meta */}
      <AdminMetaSection detail={detail} t={t} />
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
  ...ctx
}: SectionCtx & { reviews: SupplierReview[] }) {
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
      const code =
        e instanceof ApiError ? (e.detail as { code?: string } | undefined)?.code : null;
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
      <h2 className="mb-3 font-cormorant text-2xl italic text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.reviews.title")}
      </h2>

      <div className="mb-6 rounded-lg border border-ink-200/60 bg-cream-50 p-4 dark:border-umber-700/60 dark:bg-umber-800/40">
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
          <div className="mb-1 text-xs text-ink-500 dark:text-umber-300">
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
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-umber-700/60 dark:text-umber-100"
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
        <ul className="space-y-4">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-ink-200/60 bg-white p-4 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.author.display_name}</span>
                  {r.editorial && <Pill tone="violet">Editorial</Pill>}
                  {!r.published && <Pill tone="blush">Draft</Pill>}
                </div>
                <span className="text-xs text-ink-500 dark:text-umber-300">
                  {formatDate(r.created_at, locale)}
                </span>
              </div>
              <div className="mb-2 text-rose-500">
                {"★".repeat(r.rating)}
                <span className="text-ink-300">{"☆".repeat(5 - r.rating)}</span>
              </div>
              {r.body && (
                <p className="mb-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                  {r.body}
                </p>
              )}
              {r.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
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
              <button
                type="button"
                onClick={() => remove(r.id)}
                className="text-xs text-ink-500 hover:text-rose-600 dark:text-umber-300"
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentsSection({
  comments,
  ...ctx
}: SectionCtx & { comments: SupplierComment[] }) {
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
      <h2 className="mb-3 font-cormorant text-2xl italic text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.comments.title")}
      </h2>

      <div className="mb-6 rounded-lg border border-ink-200/60 bg-cream-50 p-4 dark:border-umber-700/60 dark:bg-umber-800/40">
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
              className="rounded-lg border border-ink-200/60 bg-white p-4 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.author.display_name}</span>
                  {c.author.is_admin && <Pill tone="violet">Weddly</Pill>}
                  <Pill tone="muted">
                    {t(`suppliers.detail.comments.visibility.${c.visibility}`)}
                  </Pill>
                </div>
                <span className="text-xs text-ink-500 dark:text-umber-300">
                  {formatDate(c.created_at, locale)}
                </span>
              </div>
              <p className="whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                {c.body}
              </p>
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="mt-2 text-xs text-ink-500 hover:text-rose-600 dark:text-umber-300"
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CalendarSection({
  detail,
  availability,
  bookings,
  ...ctx
}: SectionCtx & {
  detail: SupplierDetail;
  availability: SupplierAvailability | null;
  bookings: SupplierBooking[];
}) {
  const { locale, t } = ctx;
  const unavailable = useMemo(
    () => new Set(availability?.unavailable_dates ?? []),
    [availability?.unavailable_dates],
  );

  return (
    <section className="mb-10">
      <h2 className="mb-3 font-cormorant text-2xl italic text-ink-900 dark:text-cream-50">
        {t("suppliers.detail.calendar.title")}
      </h2>

      {!detail.bookable ? (
        <div className="rounded-lg border border-ink-200/60 bg-cream-50 p-4 text-sm dark:border-umber-700/60 dark:bg-umber-800/40">
          <p className="mb-2">{t("suppliers.detail.calendar.unclaimedNote")}</p>
          <a
            href={`/r/supplier/${encodeURIComponent(detail.id)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-rose-600 underline"
          >
            {t("suppliers.detail.calendar.visitWebsite")} →
          </a>
        </div>
      ) : (
        <>
          <div className="mb-3 text-sm text-ink-600 dark:text-umber-200">
            {availability?.next_available
              ? t("suppliers.detail.calendar.nextAvailable", {
                  date: formatDate(
                    new Date(`${availability.next_available}T00:00:00Z`).getTime(),
                    locale,
                  ),
                })
              : t("suppliers.detail.calendar.fullyBooked")}
          </div>
          {unavailable.size > 0 && (
            <div className="mb-3 text-xs text-ink-500 dark:text-umber-300">
              {t("suppliers.detail.calendar.blockedCount", { n: unavailable.size })}
            </div>
          )}
          {bookings.length === 0 ? (
            <p className="text-sm italic text-ink-500 dark:text-umber-300">
              {t("suppliers.detail.calendar.noBookings")}
            </p>
          ) : (
            <ul className="space-y-2">
              {bookings.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-ink-200/60 bg-white p-3 text-sm dark:border-umber-700/60 dark:bg-umber-900"
                >
                  <div>
                    <div className="font-medium">{b.event_date}</div>
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
        </>
      )}
    </section>
  );
}

function AdminMetaSection({
  detail,
  t,
}: {
  detail: SupplierDetail;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <section className="mb-10 rounded-lg border border-dashed border-ink-300/60 bg-ink-50/40 p-4 text-sm dark:border-umber-600/60 dark:bg-umber-800/30">
      <AdminPageHeader title={t("suppliers.detail.adminMeta.title")} />
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
