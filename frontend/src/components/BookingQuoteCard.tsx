// One quote (árajánlat), rendered identically on both sides.
//
// Same reasoning as `BookingThreadPanel`: an offer is one object seen from two
// ends, and two copies of the card would drift the moment one side gained a
// line. `side` decides which actions are offered; the numbers, the pill and the
// covering note are the same characters in both portals.
//
// Colour note: the pill is DATA, not a control, so it never takes blush. The
// vendor portal reserves blush for what the vendor can act on, which here is
// the button row and nothing above it. A live offer wears the app's own ink
// treatment (the same mark the thread uses for a message you sent), an accepted
// one wears sage, and everything already answered or lapsed goes quiet.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { BookingQuote, QuoteStatus } from "@shared/booking_quotes";
import { QUOTE_DECLINE_REASON_MAX, isQuoteAnswerable } from "@shared/booking_quotes";
import { Button, Dialog } from "./ui";
import { formatDate, formatDateMs, formatMoney } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

const PILL_CLASS: Record<QuoteStatus, string> = {
  draft:
    "border border-dashed border-paper-400 text-ink-500 dark:border-umber-600 dark:text-paper-300",
  sent: "bg-ink-800 text-paper-50 dark:bg-paper-200 dark:text-ink-900",
  viewed: "bg-ink-800 text-paper-50 dark:bg-paper-200 dark:text-ink-900",
  accepted: "bg-sage-100 text-sage-800 dark:bg-sage-900/60 dark:text-sage-200",
  declined: "bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-paper-300",
  withdrawn: "bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-paper-300",
  expired: "bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-paper-300",
};

function StatusPill({ status }: { status: QuoteStatus }) {
  const { t } = useT();
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${PILL_CLASS[status]}`}
    >
      {t(`quotes.status_${status}`)}
    </span>
  );
}

export interface BookingQuoteCardProps {
  quote: BookingQuote;
  locale: Locale;
  /** Which portal is reading. Decides which actions the footer offers. */
  side: "vendor" | "couple";
  onAccept?: () => void;
  /** The reason is optional: the couple can answer without explaining. */
  onDecline?: (reason: string | null) => void;
  onWithdraw?: () => void;
  onSend?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** A call about THIS quote is in flight. */
  busy?: boolean;
}

export function BookingQuoteCard({
  quote,
  locale,
  side,
  onAccept,
  onDecline,
  onWithdraw,
  onSend,
  onEdit,
  onDelete,
  busy = false,
}: BookingQuoteCardProps) {
  const { t } = useT();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");

  const fmt = (value: number) => formatMoney(value, quote.currency, locale);
  const answerable = isQuoteAnswerable(quote.status);
  const canAnswer = side === "couple" && answerable;
  const isDraft = quote.status === "draft";
  const canWithdraw =
    side === "vendor" && (answerable || quote.status === "expired") && onWithdraw !== undefined;

  const submitDecline = () => {
    const trimmed = reason.trim();
    setDeclineOpen(false);
    setReason("");
    onDecline?.(trimmed === "" ? null : trimmed);
  };

  return (
    <article className="rounded-2xl border border-paper-300 bg-paper-50/70 p-4 dark:border-umber-600 dark:bg-umber-900/40">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-medium text-ink-900 dark:text-paper-50">{quote.title}</h3>
          {quote.sent_at !== null ? (
            <p className="mt-0.5 text-xs text-ink-500 dark:text-paper-400">
              {formatDateMs(quote.sent_at, locale)}
            </p>
          ) : null}
        </div>
        <StatusPill status={quote.status} />
      </header>

      {quote.lines.length > 0 ? (
        <ul className="mt-3 divide-y divide-paper-200 border-y border-paper-200 text-sm dark:divide-umber-700 dark:border-umber-700">
          {quote.lines.map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block break-words text-ink-800 dark:text-paper-100">
                  {line.label}
                </span>
                {line.qty !== 1 ? (
                  <span className="block text-xs text-ink-500 dark:text-paper-400">
                    {line.qty} × {fmt(line.unit_amount)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-ink-800 dark:text-paper-100">
                {fmt(line.unit_amount * line.qty)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="field-label mb-0">{t("quotes.total")}</span>
        <span className="text-lg font-semibold tabular-nums text-ink-900 dark:text-paper-50">
          {fmt(quote.total)}
        </span>
      </div>

      {quote.deposit_amount !== null ? (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink-600 dark:text-paper-300">{t("quotes.deposit")}</span>
          <span className="tabular-nums text-ink-800 dark:text-paper-100">
            {fmt(quote.deposit_amount)}
          </span>
        </div>
      ) : null}

      {quote.valid_until !== null ? (
        <p className="mt-2 text-xs text-ink-500 dark:text-paper-400">
          {t("quotes.valid_until", { date: formatDate(quote.valid_until, locale) })}
        </p>
      ) : null}

      {quote.message ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          {quote.message}
        </p>
      ) : null}

      {quote.decline_reason ? (
        <div className="mt-3 rounded-xl bg-paper-100 px-3 py-2 text-sm text-ink-700 dark:bg-umber-800 dark:text-paper-200">
          <p className="field-label mb-0">{t("quotes.decline_reason")}</p>
          <p className="whitespace-pre-wrap break-words">{quote.decline_reason}</p>
        </div>
      ) : null}

      {canAnswer || isDraft || canWithdraw ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {canAnswer ? (
            <>
              <Button size="sm" onClick={onAccept} loading={busy}>
                {t("quotes.accept")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setDeclineOpen(true)}
              >
                {t("quotes.decline")}
              </Button>
            </>
          ) : null}

          {side === "vendor" && isDraft ? (
            <>
              {onSend ? (
                <Button size="sm" onClick={onSend} loading={busy}>
                  {t("vendor.quotes.send")}
                </Button>
              ) : null}
              {onEdit ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
                  {t("common.edit")}
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={onDelete}
                  aria-label={t("vendor.quotes.remove")}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              ) : null}
            </>
          ) : null}

          {canWithdraw ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onWithdraw}>
              {t("vendor.quotes.withdraw")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={declineOpen}
        role="dialog"
        title={t("quotes.decline_title")}
        onClose={() => setDeclineOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitDecline}>{t("quotes.decline")}</Button>
          </>
        }
      >
        <label htmlFor={`quote-decline-${quote.id}`} className="field-label">
          {t("quotes.decline_label")}
        </label>
        <textarea
          id={`quote-decline-${quote.id}`}
          rows={3}
          maxLength={QUOTE_DECLINE_REASON_MAX}
          className="input min-h-[5rem] resize-y leading-relaxed"
          placeholder={t("quotes.decline_placeholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>
    </article>
  );
}
