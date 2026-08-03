// Revenue Pulse: the two renderings of `shared/vendor_revenue.ts`.
//
// The vendor stats page is otherwise entirely backward-looking: "revenue
// tracked" is deposits that already arrived. This is the forward half, and it
// is deliberately drawn TWICE, because the two questions live in two places:
//
//   * `RevenuePulseBar`, one compact line at the top of the clients list.
//     "How much is in flight, and what lands this month" is a decision about
//     the leads on the screen underneath it, so it belongs there rather than on
//     a dashboard the vendor has to go and remember to open.
//   * `RevenuePulsePanel`, the full breakdown as a section on the stats page,
//     where there is room to say what each figure means.
//
// Rules worth not re-deriving:
//
//   * PRO ONLY, and on FREE this renders NOTHING, not a locked teaser. The
//     clients list is deliberately useful on the free tier, and a paywall bar
//     pinned above it would undo the one promise that tier makes. `useRevenue
//     Pulse(enabled)` never even fires the request when the feature is off.
//   * THE WEIGHTED FIGURE ALWAYS CARRIES THE "ESTIMATE" BADGE. It is the only
//     derived number here; everything else is a sum of what the vendor typed.
//     A forecast rendered like a fact is worse than no forecast.
//   * THE EXCLUDED COUNTS ARE PART OF THE FIGURE, not a footnote to drop when
//     space is tight. `pipeline` leaves out leads with no recorded value rather
//     than inventing an amount, so the number only reads honestly next to a
//     count of what it left out.
//   * Portal colour rules: `blush` marks only what the vendor can act on, so
//     none of these amounts wear it. Decorative icons are drawn on the surface
//     in `steel-600` / `steel-300` at strokeWidth 1.5, with no tinted plate.
//     The meters are the same hand-rolled thin tracks the stats funnel uses; no
//     charting library.

import { ArrowRight, Info, TrendingUp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VendorRevenuePulseView } from "@shared/vendor_revenue";
import { isRevenuePulseEmpty } from "@shared/vendor_revenue";
import { vendorRevenueApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

/** Fetch the pulse when the feature is on. `enabled` is the caller's
 *  `features.payment_tracking` flag, which is `null`-safe on purpose: while the
 *  plan is unknown nothing is requested and nothing is drawn, so a paying
 *  vendor never flashes an empty surface and a FREE one never sees a 403 in the
 *  console. A failed request is indistinguishable from FREE by design: this is
 *  a supplementary read, and it must never break the page it sits on. */
export function useRevenuePulse(enabled: boolean): VendorRevenuePulseView | null {
  const [pulse, setPulse] = useState<VendorRevenuePulseView | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPulse(null);
      return;
    }
    let cancelled = false;
    vendorRevenueApi
      .get()
      .then((res) => {
        if (!cancelled) setPulse(res);
      })
      .catch(() => {
        /* FREE (403) or a hiccup, the surface simply stays absent. */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return pulse;
}

/** A labelled amount. Money is a WHOLE unit of the vendor's currency (see the
 *  header of `shared/vendor_clients.ts`), so `formatMoney` prints it as-is. */
function Amount({
  label,
  value,
  currency,
  badge,
  help,
}: {
  label: string;
  value: number;
  currency: VendorRevenuePulseView["currency"];
  badge?: string;
  help?: string;
}) {
  const { locale } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
        <span className="truncate">{label}</span>
        {badge ? (
          <span className="shrink-0 rounded-full border border-paper-300 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-ink-500 dark:border-umber-600 dark:text-paper-400">
            {badge}
          </span>
        ) : null}
        {help ? <Help text={help} /> : null}
      </span>
      <span className="text-lg font-semibold text-ink-900 tabular-nums dark:text-paper-50">
        {formatMoney(value, currency, locale)}
      </span>
    </div>
  );
}

/** Hover/focus tooltip. The native `title` attribute is invisible on touch and
 *  keyboard, and every one of these explains why a number is what it is, which
 *  is not optional information. Mirrors the stats page's own KPI tooltip. */
function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0 cursor-help text-ink-400 focus:outline-none dark:text-paper-500">
      <Info size={13} aria-hidden="true" tabIndex={0} focusable="true" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-paper-50 shadow-lg group-hover:block group-focus-within:block dark:bg-umber-950 dark:ring-1 dark:ring-umber-700"
      >
        {text}
      </span>
    </span>
  );
}

/** Thin progress track, the same 12px rounded shape the stats funnel uses. */
function Meter({ share, fill }: { share: number; fill: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800">
      <div
        className={`h-full rounded-full ${fill} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
      />
    </div>
  );
}

/** The compact bar: pipeline plus what lands in the next 30 days, on one line,
 *  above the leads it is about. Links through to the full breakdown rather than
 *  growing a second copy of it here. */
export function RevenuePulseBar({ pulse }: { pulse: VendorRevenuePulseView | null }) {
  const { t, locale } = useT();
  if (!pulse || isRevenuePulseEmpty(pulse)) return null;
  return (
    <Link
      to="/vendor/stats"
      className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-paper-300 bg-paper-50 px-4 py-2.5 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-900 dark:hover:bg-umber-800"
    >
      <span className="flex items-center gap-2 text-ink-500 dark:text-paper-400">
        <TrendingUp
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-steel-600 dark:text-steel-300"
        />
        <span className="text-xs font-medium uppercase tracking-wide">
          {t("vendor.revenue.title")}
        </span>
      </span>
      <InlineFigure
        label={t("vendor.revenue.pipeline")}
        value={formatMoney(pulse.pipeline, pulse.currency, locale)}
      />
      <InlineFigure
        label={t("vendor.revenue.next_30")}
        value={formatMoney(pulse.upcoming_30, pulse.currency, locale)}
      />
      <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 dark:text-paper-400">
        {t("vendor.revenue.see_breakdown")}
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Link>
  );
}

function InlineFigure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-ink-500 dark:text-paper-400">{label}</span>
      <span className="text-sm font-semibold text-ink-900 tabular-nums dark:text-paper-50">
        {value}
      </span>
    </span>
  );
}

/** The full breakdown, as a section on the stats page. */
export function RevenuePulsePanel({ pulse }: { pulse: VendorRevenuePulseView | null }) {
  const { t, locale } = useT();
  if (!pulse || isRevenuePulseEmpty(pulse)) return null;
  const collectedShare = pulse.booked > 0 ? (pulse.collected / pulse.booked) * 100 : 0;
  const horizonTop = Math.max(pulse.upcoming_90, 1);
  const horizons = [
    { key: "30", label: t("vendor.revenue.next_30"), value: pulse.upcoming_30 },
    { key: "60", label: t("vendor.revenue.next_60"), value: pulse.upcoming_60 },
    { key: "90", label: t("vendor.revenue.next_90"), value: pulse.upcoming_90 },
  ];
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-paper-300 bg-paper-50 p-5 lg:col-span-2 dark:border-umber-600 dark:bg-umber-900">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
          <TrendingUp
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-steel-600 dark:text-steel-300"
          />
          <span>{t("vendor.revenue.title")}</span>
        </h2>
        <p className="text-xs text-ink-500 dark:text-paper-400">{t("vendor.revenue.body")}</p>
      </div>

      {/* Won work: what is booked, how much of it has arrived, what is left.
          The meter is the collected share of booked, so the empty remainder of
          the track IS the money still to come in. */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Amount
            label={t("vendor.revenue.booked")}
            value={pulse.booked}
            currency={pulse.currency}
            help={t("vendor.revenue.booked_help")}
          />
          <Amount
            label={t("vendor.revenue.collected")}
            value={pulse.collected}
            currency={pulse.currency}
          />
          <Amount
            label={t("vendor.revenue.outstanding")}
            value={pulse.outstanding}
            currency={pulse.currency}
          />
        </div>
        <Meter share={collectedShare} fill="bg-sage-600 dark:bg-sage-500" />
        {pulse.booked_unpriced > 0 ? (
          <Note text={t("vendor.revenue.booked_unpriced_note", { n: pulse.booked_unpriced })} />
        ) : null}
      </div>

      {/* Undecided work. `pipeline` is a fact (what has been quoted);
          `weighted` is the only derived number on this page and it says so. */}
      <div className="flex flex-col gap-3 border-t border-paper-200 pt-4 dark:border-umber-800">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Amount
            label={t("vendor.revenue.pipeline")}
            value={pulse.pipeline}
            currency={pulse.currency}
            help={t("vendor.revenue.pipeline_help")}
          />
          <Amount
            label={t("vendor.revenue.weighted")}
            value={pulse.weighted}
            currency={pulse.currency}
            badge={t("vendor.revenue.estimate")}
            help={t("vendor.revenue.weighted_help")}
          />
        </div>
        {pulse.pipeline_unpriced > 0 ? (
          <Note text={t("vendor.revenue.unpriced_note", { n: pulse.pipeline_unpriced })} />
        ) : null}
      </div>

      {/* Cash-flow horizons, by event date. Nested windows: the 60-day figure
          contains the 30-day one, which is why the bars grow rather than being
          three slices of a whole. */}
      <div className="flex flex-col gap-3 border-t border-paper-200 pt-4 dark:border-umber-800">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
          {t("vendor.revenue.upcoming_title")}
        </h3>
        <ul className="flex flex-col gap-2.5">
          {horizons.map((h) => (
            <li key={h.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink-700 dark:text-paper-200">{h.label}</span>
                <span className="text-sm font-semibold text-ink-900 tabular-nums dark:text-paper-50">
                  {formatMoney(h.value, pulse.currency, locale)}
                </span>
              </div>
              <Meter share={(h.value / horizonTop) * 100} fill="bg-chart-taupe" />
            </li>
          ))}
        </ul>
      </div>

      {/* The vendor's OWN history, next to the estimate above so they can judge
          the discount rather than have it silently applied. A null figure reads
          "-": an unknown average and an average of nothing are different
          answers, and printing 0 would say their bookings are worth nothing. */}
      <div className="flex flex-col gap-2 border-t border-paper-200 pt-4 dark:border-umber-800">
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label={t("vendor.revenue.average_booking")}
            value={
              pulse.average_booking_value === null
                ? null
                : formatMoney(pulse.average_booking_value, pulse.currency, locale)
            }
          />
          <Stat
            label={t("vendor.revenue.win_rate")}
            value={pulse.win_rate === null ? null : `${pulse.win_rate}%`}
          />
        </div>
        <Note
          text={t("vendor.revenue.trailing_note", {
            n: pulse.decided_count,
            days: pulse.trailing_days,
          })}
        />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
        {label}
      </span>
      <span className="text-lg font-semibold text-ink-900 tabular-nums dark:text-paper-50">
        {value ?? <span className="text-ink-400 dark:text-umber-400">-</span>}
      </span>
    </div>
  );
}

function Note({ text }: { text: ReactNode }) {
  return <p className="text-xs text-ink-500 dark:text-paper-400">{text}</p>;
}
