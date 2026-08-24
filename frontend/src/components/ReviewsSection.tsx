// The reviews block — stars, the composer, the list — for any review SUBJECT.
//
// It lived inside SupplierDetailPage until planners got reviews too. Copying it
// would have meant two composers drifting apart on the things that are easy to
// get subtly wrong and invisible when wrong: the "don't default to 5 stars"
// rule, the admin editorial opt-in, which currency an amount is stored in.
// So the subject is a prop and everything else is written once, mirroring the
// backend, where `ReviewSubject` is the only thing the two kinds don't share.

import { MoreVertical, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Currency } from "@shared/currency";
import {
  REVIEW_BODY_MAX_CHARS,
  type SupplierCategory,
  type SupplierReview,
} from "@shared/suppliers";
import { Pill } from "./admin";
import { StarRow } from "./StarRow";
import { ReviewSpendFields } from "./ReviewSpendFields";
import { ReviewSpendLine } from "./ReviewSpendLine";
import { ReviewTagPicker } from "./ReviewTagPicker";
import { useConfirm } from "./ui/ConfirmDialogProvider";
import { useToast } from "./ui";
import { ApiError } from "../lib/api";
import { plannerReviewApi, reviewApi } from "../lib/endpoints";
import { intlLocale, localeCurrency } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { reviewTagLabel } from "../lib/reviewTags";

/** Which profile the reviews belong to. `id` is the directory supplier id or
 *  the planner's user id; the namespaced `planner:{id}` form the rows are
 *  actually keyed on is a backend detail this side never sees. */
export type ReviewSubject = { kind: "supplier"; id: string } | { kind: "planner"; id: number };

function apiFor(subject: ReviewSubject) {
  return subject.kind === "planner" ? plannerReviewApi : reviewApi;
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

function StarPicker({
  value,
  onChange,
}: {
  /** 0 = nothing picked yet (all glyphs hollow). Once the user clicks a
   *  star, `value` becomes that number and the submit button unlocks. */
  value: 0 | 1 | 2 | 3 | 4 | 5;
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
          className="p-0.5 leading-none transition"
        >
          <Star
            size={24}
            aria-hidden
            className={n <= value ? "fill-star stroke-star" : "stroke-paper-300 hover:stroke-star"}
          />
        </button>
      ))}
    </div>
  );
}

export function ReviewsSection({
  subject,
  reviews,
  avg,
  count,
  canReview,
  alreadyReviewed,
  category,
  currency,
  isAdmin,
  onChange,
  hideHeader = false,
}: {
  subject: ReviewSubject;
  reviews: SupplierReview[];
  avg: number | null;
  count: number;
  canReview: boolean;
  alreadyReviewed: boolean;
  category: SupplierCategory;
  /** The reviewing couple's currency; null for a viewer without a workspace. */
  currency: Currency | null;
  isAdmin: boolean;
  onChange: () => Promise<void>;
  /** Skips the "Reviews (n)" heading + inline star chip. For callers that
   *  already show that summary elsewhere — the ReviewSummaryCard bars, or a
   *  modal's own title bar — so the count isn't drawn twice on one screen. */
  hideHeader?: boolean;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const api = apiFor(subject);
  const subjectId = String(subject.id);
  // Default 0 = no rating picked yet. Stars render as hollow glyphs and the
  // Beküldés button stays disabled until the user actually clicks one.
  // Avoids the "everyone defaults to 5 stars" trap that inflates aggregates.
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountNote, setAmountNote] = useState("");
  // The draft lever, and it only exists for an editorial post. Checked, because
  // an unpublished review is invisible to the vendor, to the aggregate and to
  // every admin counter, and nothing anywhere queues it for a second look.
  const [published, setPublished] = useState(true);
  // Which voice an admin is writing in. Their OWN by default: staff hire
  // suppliers like everyone else, and that review should behave like everyone
  // else's: live immediately, no draft lever. Ticking the box opts into the
  // "Weddly editors" voice for a genuinely editorial entry.
  const [asEditorial, setAsEditorial] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (rating === 0) return; // guard: button is also disabled but be defensive
    setSubmitting(true);
    try {
      // `published` is an editorial lever only; every non-editorial review goes
      // live immediately server-side, and sending the field would 403.
      await api.create(subjectId, {
        rating,
        body: body.trim() || null,
        tags,
        amount_paid: amount,
        // The couple's currency, never the interface language. Only a viewer
        // with no workspace falls back to the locale guess.
        amount_currency: currency ?? localeCurrency(locale as Locale),
        amount_note: amountNote.trim() || null,
        ...(isAdmin ? { as_editorial: asEditorial } : {}),
        ...(isAdmin && asEditorial ? { published } : {}),
      });
      setBody("");
      setTags([]);
      setAmount(null);
      setAmountNote("");
      setRating(0);
      setPublished(true);
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
    <section className={hideHeader ? undefined : "mb-10"}>
      {!hideHeader && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
            {t("suppliers.detail.reviews.title")} ({count})
          </h2>
          {avg !== null && count >= 3 && (
            <span className="inline-flex items-center gap-2 text-sm">
              <StarRow value={Math.round(avg)} size={14} />
              <span className="font-medium">{avg.toFixed(1)}</span>
            </span>
          )}
        </div>
      )}

      {/* Composer opens for admins (editorial voice) and for any verified user
          who hasn't already reviewed this subject. Engaged couples additionally
          earn the "Verified" badge; everyone else posts an unbadged review. */}
      {!isAdmin && !canReview && (
        <p className="mb-6 text-sm italic text-ink-500 dark:text-umber-300">
          {alreadyReviewed
            ? t("suppliers.detail.reviews.alreadyReviewedNote")
            : t("suppliers.detail.reviews.eligibilityHint")}
        </p>
      )}
      {(isAdmin || canReview) && (
        <div className="mb-6 rounded-xl border border-ink-200/60 bg-paper-50 p-5 dark:border-umber-700/60 dark:bg-umber-800/40">
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
            locale={locale as Locale}
            currency={currency}
            t={t}
          />
          <ReviewTagPicker value={tags} onChange={setTags} category={category} t={t} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Two admin-only levers, and the second depends on the first: the
                editorial voice is a choice (an admin who hired this supplier
                writes as themselves), and draft/publish only means anything for
                an editorial row, since every other review goes live at once. */}
            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-umber-200">
                  <input
                    type="checkbox"
                    checked={asEditorial}
                    onChange={(e) => setAsEditorial(e.target.checked)}
                  />
                  {t("suppliers.detail.reviews.asEditorialLabel")}
                </label>
                {asEditorial && (
                  <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-umber-200">
                    <input
                      type="checkbox"
                      checked={published}
                      onChange={(e) => setPublished(e.target.checked)}
                    />
                    {t("suppliers.detail.reviews.publishedLabel")}
                  </label>
                )}
              </div>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={submitting || rating === 0}
              onClick={submit}
              title={rating === 0 ? t("suppliers.detail.reviews.pickStarFirst") : undefined}
              className="btn-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "…" : t("suppliers.detail.reviews.submit")}
            </button>
          </div>
        </div>
      )}

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
                  <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
                    {r.author.display_name}
                  </span>
                  {r.editorial && <Pill tone="violet">Editorial</Pill>}
                  {/* No "Verified couple" badge. The stars, the name and the
                      words are the review; a second pill restating that the
                      author is a real customer is chrome, and on a card that
                      already carries a rating, a date and a tag row it was the
                      loudest thing on it. `verified` still rides the DTO for
                      ranking and for the vendor's own view. */}
                  {!r.published && <Pill tone="blush">Draft</Pill>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatDate(r.created_at, locale as Locale)}
                  </span>
                  {(isAdmin || r.own) && <ReviewMenu t={t} onDelete={() => remove(r.id)} />}
                </div>
              </div>
              {r.body && (
                <p className="mb-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                  {r.body}
                </p>
              )}
              <ReviewSpendLine review={r} locale={locale as Locale} />
              {r.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((tag) => (
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
          ))}
        </ul>
      )}
    </section>
  );
}

/** The one destructive action on a review, behind an overflow trigger.
 *
 *  A bare trash icon pinned to the card put "delete" one stray tap from
 *  happening and, being the only glyph in the row, read as the card's primary
 *  control. Behind the dots it costs one deliberate tap, says what it does in
 *  words, and leaves the card as rating + name + words. The confirm dialog
 *  stays: the menu makes the action findable, not cheaper. */
function ReviewMenu({
  t,
  onDelete,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={t("suppliers.detail.reviews.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-50"
      >
        <MoreVertical size={16} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <span
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-max overflow-hidden rounded-lg border border-ink-200/60 bg-white py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-medium text-blush-700 transition-colors hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15"
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            {t("suppliers.detail.reviews.deleteAction")}
          </button>
        </span>
      )}
    </span>
  );
}
