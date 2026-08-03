// The client quick-look: everything a vendor wanted when they clicked a row,
// without leaving the list.
//
// The full page at `/vendor/clients/:id` is UNCHANGED and stays the row's own
// link, so a click, a middle-click and a bookmark all behave exactly as they
// did. This is the second door: a glance at who, when, how far along and what
// is owed, opened from a handle at the end of the row and closed with Escape.
// The vendor scanning fifteen leads on a Tuesday morning is not navigating,
// they are triaging, and a full page load per lead is what made that feel like
// filing rather than working.
//
// Rules worth not re-deriving:
//
//   * IT DERIVES NOTHING. The stage comes from `shared/booking_stage.ts`, the
//     next action arrives on the payload from `shared/vendor_next_action.ts`,
//     and the copy hooks are the same ones the detail page's own action bar
//     uses. Two doors onto one client must not disagree about it.
//   * THE QUOTE AND THE HOLD ARE BEST-EFFORT. Both reads are FREE server-side,
//     but a failure (or a plan that redacts them) leaves the fact `null`, and
//     the ladder simply stops lower rather than guessing. A quick look must
//     never be the thing that breaks the list behind it.
//   * THE STATUS CHANGE IS THE ONE WRITE HERE, and its undo is real: the owner
//     hands back a reversal that PATCHes the previous status to the server. A
//     toast that only repaints the row is a lie the vendor finds out about on
//     the next reload.

import { ArrowRight, Lock, MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { QuoteStatus } from "@shared/booking_quotes";
import { bookingStage, pickStageQuoteStatus } from "@shared/booking_stage";
import type { DateHoldState } from "@shared/date_holds";
import type { Currency } from "@shared/types";
import type { VendorClientView } from "@shared/vendor_clients";
import { PASSIVE_ACTIONS } from "@shared/vendor_next_action";
import { BookingProgressRail } from "./BookingProgressRail";
import { CoupleMonogram } from "./CoupleMonogram";
import { EventDate } from "./EventDate";
import {
  ACTION_ANCHOR,
  useActionHint,
  useActionLabel,
  useAttentionReason,
} from "./VendorNextAction";
import { useModalShell } from "./ui/modal_shell";
import { dateHoldApi, bookingQuoteApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

export function VendorClientDrawer({
  client,
  statuses,
  currency,
  crmLocked,
  onClose,
  onStatusChange,
}: {
  /** The row being looked at, or null when the drawer is shut. */
  client: VendorClientView | null;
  /** The canonical status order, passed in rather than re-listed here so the
   *  select, the filter pills and the badge can never fall out of step. */
  statuses: readonly string[];
  currency: Currency;
  /** FREE tier: the money lines are locked, exactly as in the list. */
  crmLocked: boolean;
  onClose: () => void;
  /** Persisted + undone by the owner, which is also what holds the list's own
   *  optimistic copy of the row. */
  onStatusChange: (client: VendorClientView, next: string) => void;
}) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const open = client !== null;
  useModalShell(open, onClose, containerRef);

  const actionLabel = useActionLabel();
  const actionHint = useActionHint();
  const reason = useAttentionReason();

  // Facts the list row does not carry. Both reads are best-effort: `null`
  // survives all the way into the ladder as "no evidence".
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus | null>(null);
  const [holdState, setHoldState] = useState<DateHoldState | null>(null);

  const clientId = client?.id ?? null;
  useEffect(() => {
    setQuoteStatus(null);
    setHoldState(null);
    if (clientId === null) return;
    let cancelled = false;
    bookingQuoteApi
      .vendorList(clientId)
      .then((res) => {
        if (!cancelled) setQuoteStatus(pickStageQuoteStatus(res.quotes));
      })
      .catch(() => {
        /* no quotes readable: the ladder stops at what the row itself proves */
      });
    dateHoldApi
      .get(clientId)
      .then((res) => {
        if (!cancelled) setHoldState(res.hold?.state ?? null);
      })
      .catch(() => {
        /* same: an unreadable hold is not a hold */
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!client) return null;

  const stage = bookingStage(
    {
      status: client.status,
      event_date: client.event_date,
      quote_status: quoteStatus,
      hold_state: holdState,
      contract_value: client.contract_value,
      deposit_paid: client.deposit_paid,
    },
    Date.now(),
  );

  const anchor = ACTION_ANCHOR[client.next_action];
  const passive = PASSIVE_ACTIONS.has(client.next_action);
  const detailHref = `/vendor/clients/${client.id}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-umber-950/50 backdrop-blur-[2px]"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={client.couple_display_name}
        className="drawer-panel relative flex h-full w-full flex-col overflow-y-auto bg-paper-50 shadow-pop sm:max-w-md dark:bg-umber-900"
      >
        {/* Header. The monogram + the date are the two brand marks: who, and
            the Saturday it is about. */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-paper-300 bg-paper-50 px-4 py-3 sm:px-5 dark:border-umber-700 dark:bg-umber-900">
          <CoupleMonogram name={client.couple_display_name} size="lg" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50"
              title={client.couple_display_name}
            >
              {client.couple_display_name}
            </p>
            <EventDate date={client.event_date} size="lg" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.dismiss")}
            className="-mr-1 shrink-0 rounded-lg p-2 text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 dark:text-paper-400 dark:hover:bg-umber-800 dark:hover:text-paper-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-4 py-4 sm:px-5">
          <BookingProgressRail stage={stage} />

          {/* The one thing to do next. Same derivation, same words as the
              detail page's own action bar; the button hands over to the page
              at the anchor where the work happens. */}
          {client.next_action !== "none" && (
            <section className="flex flex-col gap-2 border-t border-paper-200 pt-4 dark:border-umber-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
                {t("vendor.next.title")}
              </p>
              <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
                {actionLabel(client.next_action)}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">
                {client.attention ? reason(client.attention) : actionHint(client.next_action)}
              </p>
              {!passive && anchor && (
                <Link
                  to={`${detailHref}#${anchor}`}
                  className="btn btn-sm mt-1 self-start bg-blush-500 text-white hover:bg-blush-600"
                >
                  {actionLabel(client.next_action)}
                  <ArrowRight size={15} aria-hidden="true" className="ml-1.5" />
                </Link>
              )}
            </section>
          )}

          {/* Status. The one write this drawer offers, and the reason it needs
              an undo: a mis-tapped select on a phone is one gesture away from
              telling a couple their date was declined. */}
          <section className="flex flex-col gap-1.5 border-t border-paper-200 pt-4 dark:border-umber-800">
            <label
              htmlFor="vendor-drawer-status"
              className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400"
            >
              {t("vendor.clients.status_label")}
            </label>
            <select
              id="vendor-drawer-status"
              className="input"
              value={statuses.includes(client.status) ? client.status : ""}
              onChange={(e) => onStatusChange(client, e.target.value)}
            >
              {!statuses.includes(client.status) && <option value="">{client.status}</option>}
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t(`vendor.clients.status_${s}`)}
                </option>
              ))}
            </select>
          </section>

          {/* Money. Locked rather than absent on FREE, matching the list's own
              columns: the vendor should know the surface exists. */}
          <section className="flex flex-col gap-2 border-t border-paper-200 pt-4 dark:border-umber-800">
            <MoneyRow
              label={t("vendor.clients.contract_value")}
              value={client.contract_value}
              currency={currency}
              locked={crmLocked}
            />
            <MoneyRow
              label={t("vendor.clients.deposit_paid")}
              value={client.deposit_paid}
              currency={currency}
              locked={crmLocked}
            />
            <MoneyRow
              label={t("vendor.clients.balance")}
              value={client.balance}
              currency={currency}
              locked={crmLocked}
              strong
            />
          </section>

          {client.unread_count > 0 && (
            <Link
              to={`${detailHref}#vc-thread`}
              className="flex items-center gap-2 border-t border-paper-200 pt-4 text-sm font-medium text-ink-900 dark:border-umber-800 dark:text-paper-50"
            >
              <MessageSquare
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
                className="shrink-0 text-steel-600 dark:text-steel-300"
              />
              {t("vendor.clients.unread_messages", { count: client.unread_count })}
            </Link>
          )}
        </div>

        {/* The way through to everything this glance leaves out. */}
        <div className="sticky bottom-0 border-t border-paper-300 bg-paper-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 dark:border-umber-700 dark:bg-umber-900">
          <Link
            to={detailHref}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-paper-300 px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:border-ink-900 hover:bg-paper-100 dark:border-umber-700 dark:text-paper-200 dark:hover:border-paper-200 dark:hover:bg-umber-800"
          >
            {t("vendor.clients.view")}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MoneyRow({
  label,
  value,
  currency,
  locked,
  strong = false,
}: {
  label: string;
  value: number | null;
  currency: Currency;
  locked: boolean;
  strong?: boolean;
}) {
  const { t, locale } = useT();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-600 dark:text-paper-300">{label}</span>
      {locked ? (
        <span
          className="inline-flex items-center gap-1 text-xs text-ink-400 dark:text-umber-400"
          title={t("vendor.upgrade.feature_locked")}
        >
          <Lock size={13} aria-hidden="true" />
          <span className="sr-only">{t("vendor.upgrade.feature_locked")}</span>
        </span>
      ) : (
        <span
          className={`tabular-nums ${
            strong
              ? "text-base font-semibold text-ink-900 dark:text-paper-50"
              : "text-sm text-ink-700 dark:text-paper-200"
          }`}
        >
          {value === null ? (
            <span className="text-ink-400 dark:text-umber-400">-</span>
          ) : (
            formatMoney(value, currency, locale)
          )}
        </span>
      )}
    </div>
  );
}
