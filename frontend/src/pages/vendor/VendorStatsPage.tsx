// Vendor stats — the analytics surface for a role='vendor' user at /vendor/stats.
// Renders inside VendorShell. Reads the rollup from vendorStatsApi.get() and the
// derived plan/feature flags from vendorBillingApi.get(). FREE-tier vendors see
// the summary KPI numbers (profile views, inquiry counts, revenue tracked,
// blocked dates) plus a graceful upgrade CTA in place of the detailed analytics;
// PRO-tier vendors additionally see the inquiries-over-time comparison, the
// by-status donut, and the views-to-inquiries-to-bookings funnel.
// No real chart library - the donut and the trend bars are hand-rolled from
// design tokens. The trend chart buckets the rollup's sparse per-day series
// (stats.inquiries_by_day) into daily / weekly / monthly bars per the selected
// range pill.

import {
  BarChart3,
  CalendarClock,
  Eye,
  Inbox,
  Info,
  Lock,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorFeatureFlags } from "@shared/vendor_plan";
import { Skeleton, SkeletonText } from "../../components/ui";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { vendorBillingApi, vendorStatsApi } from "../../lib/endpoints";
import { formatDate, formatMoney, intlLocale } from "../../lib/format";
import { type Locale, useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

// Booking statuses we have human labels for (reused from the supplier detail
// calendar namespace). Anything outside this set falls back to the raw value.
const KNOWN_STATUSES = new Set([
  "requested",
  "vendor_seen",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
]);

// Editorial chart palette (see tailwind theme.extend.colors.chart). We cycle
// through these per status; the suffixes are safelisted as stroke-/bg-chart-*.
const CHART_COLORS = ["terracotta", "sage", "taupe", "rose", "olive", "ochre", "sand"] as const;

export default function VendorStatsPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor.stats.page_title"));

  const [stats, setStats] = useState<VendorStats | null>(null);
  const [features, setFeatures] = useState<VendorFeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [range, setRange] = useState<RangeKey>("30d");

  const buckets = useMemo(
    () => (stats ? bucketInquiries(stats.inquiries_by_day, range, locale) : []),
    [stats, range, locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const [statsRes, billingRes] = await Promise.all([
        vendorStatsApi.get(),
        vendorBillingApi.get(),
      ]);
      setStats(statsRes);
      setFeatures(billingRes.features);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <StatsSkeleton title={t("vendor.stats.page_title")} />;
  }

  if (errored || !stats) {
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

  const advancedUnlocked = features?.advanced_stats ?? false;
  const currency = stats.currency;

  // Status breakdown, busiest first, with a human label and a cycled palette
  // colour where we have one.
  const statusSegments = Object.entries(stats.by_status)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count], i) => ({
      status,
      count,
      label: KNOWN_STATUSES.has(status) ? t(`suppliers.detail.calendar.status.${status}`) : status,
      color: CHART_COLORS[i % CHART_COLORS.length] ?? "terracotta",
    }));
  const statusTotal = statusSegments.reduce((sum, s) => sum + s.count, 0);

  // Conversion: profile views to inquiries to confirmed bookings. Each stage's
  // displayed percentage is its conversion from the stage ABOVE it; the bar
  // length is its share of the funnel top.
  //
  // The top is max(views, inquiries), not views: view tracking is younger than
  // the booking table, and a couple can arrive from a shared link we never
  // counted, so inquiries can legitimately exceed views. Taking the max keeps
  // the funnel monotonic instead of drawing a second bar longer than the first.
  const confirmedCount = stats.by_status.confirmed ?? 0;
  const funnelTop = Math.max(stats.views_total, stats.inquiries_total);
  const share = (n: number) => (funnelTop > 0 ? Math.round((n / funnelTop) * 100) : 0);
  // Undefined, not 0, when the stage above is empty. Five inquiries against zero
  // recorded views is an UNKNOWN rate, not a 0% one, and printing "0%" next to a
  // real count reads as "nobody who saw you wrote" — the exact opposite of what
  // happened. Vendors whose views predate the tracking split hit this.
  const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : undefined);

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.stats.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.stats.page_body")}</p>
      </header>

      {/* Detailed analytics — PRO only. FREE sees the basic counts plus an
          upgrade prompt.

          The summary cards deliberately live ONLY in the FREE branch. The
          Overview page already owns the glanceable numbers (inquiries_total,
          revenue_tracked, blocked_dates_count, and inquiries_30d as its hero),
          so repeating them at the top of this page was a verbatim re-render
          that pushed the real content — trend, status split, funnel — below the
          fold. A PRO vendor now lands straight on the analysis; a FREE vendor,
          who has no analysis to land on, still gets the counts here. */}
      {advancedUnlocked ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Inquiries over time — range pills + bucketed trend bars. */}
          <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {t("vendor.stats.trend_title")}
              </h2>
              <div className="flex gap-1" role="group" aria-label={t("vendor.stats.trend_title")}>
                {RANGE_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={range === key}
                    onClick={() => setRange(key)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      range === key
                        ? "bg-steel-600 text-white"
                        : "text-ink-600 hover:bg-paper-200 dark:text-paper-300 dark:hover:bg-umber-800"
                    }`}
                  >
                    {t(`vendor.stats.range_${key}`)}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart
              buckets={buckets}
              unit={t("vendor.stats.unit_inquiries")}
              empty={t("vendor.stats.trend_empty")}
            />
          </section>

          {/* By status - donut + legend */}
          <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("vendor.stats.by_status")}
            </h2>
            {statusTotal === 0 ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <StatusDonut
                  segments={[]}
                  total={0}
                  centerLabel={t("vendor.stats.unit_inquiries")}
                />
                <p className="text-center text-sm text-ink-500 dark:text-paper-400">
                  {t("vendor.stats.status_empty")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
                <StatusDonut
                  segments={statusSegments}
                  total={statusTotal}
                  centerLabel={t("vendor.stats.unit_inquiries")}
                />
                {/* Legend rows deep-link into the client list pre-filtered to
                    that status. */}
                <ul className="flex w-full flex-col gap-1">
                  {statusSegments.map((seg) => (
                    <li key={seg.status}>
                      <Link
                        to={`/vendor/clients?status=${encodeURIComponent(seg.status)}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 shrink-0 rounded-full bg-chart-${seg.color}`}
                          />
                          <span className="truncate text-ink-700 dark:text-paper-200">
                            {seg.label}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold text-ink-900 tabular-nums dark:text-paper-50">
                          {seg.count.toLocaleString(intlLocale(locale))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Conversion summary — performance context instead of duplicating
              the overview page's upcoming-events list here. */}
          <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 lg:col-span-2 dark:border-umber-600 dark:bg-umber-900">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
              <TrendingUp
                size={18}
                aria-hidden="true"
                className="text-steel-700 dark:text-steel-300"
              />
              <span>{t("vendor.stats.conversion_title")}</span>
            </h2>
            <ConversionFunnel
              locale={locale}
              stages={[
                {
                  key: "views",
                  label: t("vendor.stats.views"),
                  value: stats.views_total,
                  share: share(stats.views_total),
                  sub: t("vendor.stats.views_recent", {
                    n: stats.views_30d.toLocaleString(intlLocale(locale)),
                  }),
                  fill: "bg-chart-taupe",
                },
                {
                  key: "inquiries",
                  label: t("vendor.stats.inquiries"),
                  value: stats.inquiries_total,
                  share: share(stats.inquiries_total),
                  rate: rate(stats.inquiries_total, stats.views_total),
                  fill: "bg-steel-600 dark:bg-steel-500",
                  to: "/vendor/clients",
                },
                {
                  key: "confirmed",
                  label: t("vendor.stats.conversion_confirmed"),
                  value: confirmedCount,
                  share: share(confirmedCount),
                  rate: rate(confirmedCount, stats.inquiries_total),
                  fill: "bg-sage-600 dark:bg-sage-500",
                  to: "/vendor/clients?status=confirmed",
                },
              ]}
            />
          </section>
        </div>
      ) : (
        <>
          {/* Five cards on a three-column track: the last one spans the spare
              column so neither the mobile nor the desktop row ends ragged. It
              is the money card on purpose, since a formatted amount is the
              widest value here. Views lead: on FREE the vendor cannot be
              contacted directly, so "people are looking at you" is the number
              that makes the upgrade card underneath mean something. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 [&>*:last-child]:col-span-2">
            <StatCard
              icon={<Eye size={18} aria-hidden="true" />}
              label={t("vendor.stats.views")}
              value={<AnimatedNumber value={stats.views_total} />}
              sub={t("vendor.stats.views_recent", {
                n: stats.views_30d.toLocaleString(intlLocale(locale)),
              })}
              help={t("vendor.stats.views_help")}
            />
            <StatCard
              icon={<Inbox size={18} aria-hidden="true" />}
              label={t("vendor.stats.inquiries")}
              value={<AnimatedNumber value={stats.inquiries_total} />}
              to="/vendor/clients"
            />
            <StatCard
              icon={<CalendarClock size={18} aria-hidden="true" />}
              label={t("vendor.dashboard.inquiries_30d")}
              value={<AnimatedNumber value={stats.inquiries_30d} />}
              sub={t("vendor.stats.unit_inquiries")}
              to="/vendor/clients"
            />
            <StatCard
              icon={<CalendarClock size={18} aria-hidden="true" />}
              label={t("vendor.stats.blocked_dates")}
              value={<AnimatedNumber value={stats.blocked_dates_count} />}
              to="/vendor/calendar"
            />
            <StatCard
              icon={<BarChart3 size={18} aria-hidden="true" />}
              label={t("vendor.stats.revenue")}
              value={
                <AnimatedNumber
                  value={stats.revenue_tracked}
                  format={(n) => formatMoney(n, currency, locale)}
                />
              }
              help={t("vendor.stats.revenue_help")}
            />
          </div>
          <UpgradeAnalyticsCard
            title={t("vendor.upgrade.title")}
            locked={t("vendor.upgrade.feature_locked")}
            body={t("vendor.upgrade.body")}
            cta={t("vendor.upgrade.cta")}
          />
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  help,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  help?: string;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-ink-500 dark:text-paper-400">
        <span className="text-steel-700 dark:text-steel-300">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {help ? (
          // Styled hover/focus tooltip — the native title attr is unreliable
          // and invisible on touch/keyboard, so the explanation gets a real
          // popover layer.
          <span className="group relative ml-auto inline-flex cursor-help text-ink-400 focus:outline-none dark:text-paper-500">
            <Info size={14} aria-hidden="true" tabIndex={0} focusable="true" />
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-56 rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-paper-50 shadow-lg group-hover:block group-focus-within:block dark:bg-umber-950 dark:ring-1 dark:ring-umber-700"
            >
              {help}
            </span>
          </span>
        ) : null}
      </div>
      <div className="text-center text-2xl font-semibold text-ink-900 dark:text-paper-50">
        {value}
      </div>
      {sub && (
        <div className="-mt-1.5 text-center text-xs text-ink-500 dark:text-paper-400">{sub}</div>
      )}
    </>
  );
  const frame =
    "flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-3.5 dark:border-umber-600 dark:bg-umber-900";
  if (!to) return <div className={frame}>{body}</div>;
  return (
    <Link
      to={to}
      className={`${frame} transition-colors hover:border-steel-300 hover:bg-paper-100 dark:hover:border-steel-600 dark:hover:bg-umber-800`}
    >
      {body}
    </Link>
  );
}

// Inline SVG donut built from stroke-dasharray arcs over a base ring. The svg
// itself is rotated -90deg so the first arc starts at 12 o'clock; the total sits
// in the middle. An empty `segments` array renders just the muted base ring as a
// skeleton-like placeholder.
//
// `centerLabel` wants the UNIT word ("megkeresés", "inquiries"), not the plural
// heading: it sits directly under a numeral, where Hungarian takes the singular,
// and the plural was wide enough to crowd the 128px ring.
function StatusDonut({
  segments,
  total,
  centerLabel,
}: {
  segments: { status: string; count: number; color: string; label?: string }[];
  total: number;
  centerLabel: string;
}) {
  const navigate = useNavigate();
  const size = 132;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let drawn = 0;

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-32 w-32 -rotate-90"
        role="img"
        aria-label={centerLabel}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-paper-200 dark:stroke-umber-800"
        />
        {total > 0 &&
          segments.map((seg) => {
            const length = (seg.count / total) * circumference;
            // Each arc mirrors its legend row: hover shows a native tooltip and a
            // subtle brighten, click deep-links to the pre-filtered client list.
            const tip = seg.label ? `${seg.label}: ${seg.count}` : `${seg.status}: ${seg.count}`;
            const arc = (
              <circle
                key={seg.status}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-drawn}
                onClick={() => navigate(`/vendor/clients?status=${encodeURIComponent(seg.status)}`)}
                className={`cursor-pointer stroke-chart-${seg.color} transition-[filter] duration-150 hover:brightness-110`}
              >
                <title>{tip}</title>
              </circle>
            );
            drawn += length;
            return arc;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="font-grotesk text-2xl font-semibold leading-none text-ink-900 tabular-nums dark:text-paper-50">
          {total}
        </span>
        <span className="mt-1 whitespace-nowrap text-[10px] font-medium uppercase tracking-normal text-ink-500 dark:text-paper-400">
          {centerLabel}
        </span>
      </div>
    </div>
  );
}

// ----- Trend chart -----------------------------------------------------------

const RANGE_KEYS = ["7d", "30d", "90d", "365d"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

interface TrendBucket {
  /** Axis label (already locale-formatted). */
  label: string;
  count: number;
}

/** UTC day helper — the backend series uses UTC ISO days, so bucketing walks
 *  UTC midnights to avoid off-by-one days around midnight local time. */
function utcDayISO(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Fold the sparse per-day series into the buckets of the selected range:
 *  7/30 days → one bucket per day, 90 days → per ISO week (7-day windows
 *  ending today), 365 days → per calendar month. Zero-count buckets are kept
 *  so the axis is continuous. */
function bucketInquiries(
  series: { date: string; count: number }[],
  range: RangeKey,
  locale: Locale,
): TrendBucket[] {
  const tag = intlLocale(locale);
  const counts = new Map(series.map((s) => [s.date, s.count]));
  const dayLabel = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric" });
  const monthLabel = new Intl.DateTimeFormat(tag, { year: "2-digit", month: "short" });

  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    return Array.from({ length: days }, (_, i) => {
      const iso = utcDayISO(days - 1 - i);
      return {
        label: dayLabel.format(new Date(`${iso}T00:00:00Z`)),
        count: counts.get(iso) ?? 0,
      };
    });
  }

  if (range === "90d") {
    // 13 rolling 7-day windows ending today, labelled by their start day.
    return Array.from({ length: 13 }, (_, w) => {
      const startOffset = (13 - w) * 7 - 1;
      let count = 0;
      for (let d = 0; d < 7; d++) count += counts.get(utcDayISO(startOffset - d)) ?? 0;
      const startIso = utcDayISO(startOffset);
      return { label: dayLabel.format(new Date(`${startIso}T00:00:00Z`)), count };
    });
  }

  // 365d → the last 12 calendar months (current month last).
  const nowD = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - (11 - i), 1));
    const ym = d.toISOString().slice(0, 7);
    let count = 0;
    for (const [date, c] of counts) if (date.startsWith(ym)) count += c;
    return { label: monthLabel.format(d), count };
  });
}

/** Hand-rolled bar trend: one thin rounded bar per bucket on a recessive
 *  three-line grid, with a per-bar hover/focus tooltip (exact bucket + count).
 *  Single series, so identity lives in the section title — no legend. */
function TrendChart({
  buckets,
  unit,
  empty,
}: {
  buckets: TrendBucket[];
  unit: string;
  empty: string;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 0);
  if (max === 0) {
    return (
      <p className="flex h-44 items-center justify-center text-center text-sm text-ink-500 dark:text-paper-400">
        {empty}
      </p>
    );
  }
  // Label thinning: at most ~6 axis labels, evenly spaced from the first.
  const step = Math.ceil(buckets.length / 6);
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-40">
        {/* Recessive grid: baseline, midline, max line with tiny value tags. */}
        {[0, 0.5, 1].map((f) => (
          <div
            key={f}
            className="absolute inset-x-0 border-t border-paper-200 dark:border-umber-800"
            style={{ bottom: `${f * 100}%` }}
          >
            <span className="absolute -top-2 right-0 text-[10px] text-ink-400 tabular-nums dark:text-paper-500">
              {Math.round(f * max)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] pr-6">
          {buckets.map((b, i) => (
            <div key={`${b.label}-${i}`} className="group relative flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-steel-600 transition-colors group-hover:bg-steel-700 dark:bg-steel-400 dark:group-hover:bg-steel-300"
                style={{ height: `${Math.max((b.count / max) * 100, b.count > 0 ? 3 : 0)}%` }}
              />
              {/* Full-column hover target + tooltip. */}
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-paper-50 shadow-lg group-hover:block dark:bg-umber-950 dark:ring-1 dark:ring-umber-700"
              >
                {b.label}: <span className="font-semibold tabular-nums">{b.count}</span> {unit}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-[2px] pr-6">
        {buckets.map((b, i) => (
          <span
            key={`${b.label}-${i}`}
            className="min-w-0 flex-1 whitespace-nowrap text-center text-[10px] text-ink-400 dark:text-paper-500"
          >
            {i % step === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

interface FunnelStage {
  key: string;
  /** Human stage name (already localized). */
  label: string;
  /** Raw count for this stage. */
  value: number;
  /** Bar length as a percent of the funnel top (0..100), so the bar lengths ARE
   *  the funnel and the empty remainder of a track IS the drop-off. */
  share: number;
  /** Conversion from the stage ABOVE, shown next to the count. Omitted on the
   *  first stage, which has nothing to convert from. Kept separate from
   *  `share`: with three stages the interesting number is "how many of the
   *  people who saw me wrote", not "how many of the top of the funnel". */
  rate?: number;
  /** Optional second line under the label, e.g. the trailing-30-day count. */
  sub?: string;
  /** Tailwind fill classes (light + dark) for the bar. One hue per stage. */
  fill: string;
  /** Optional deep-link into the matching client list. */
  to?: string;
}

/** Conversion funnel: profile views to inquiries to confirmed bookings. The
 *  views stage is the honest top of the funnel: it answers "how many people
 *  have seen me" and turns the two counts below it into a rate rather than a
 *  pair of bare numbers. Magnitude means a single hue per stage (not a
 *  categorical palette): counts live in text tokens, never on the fill, and
 *  every row is directly labeled so identity is never colour-alone. Rows
 *  deep-link into the matching client list where one exists. */
function ConversionFunnel({
  stages,
  locale,
}: {
  stages: FunnelStage[];
  locale: Locale;
}) {
  const nf = (n: number) => n.toLocaleString(intlLocale(locale));
  return (
    <ul className="flex flex-col gap-3">
      {stages.map((s) => {
        // Keep a sliver visible for a non-zero stage so a tiny count never
        // collapses to an invisible bar; a genuine zero stays empty.
        const width = s.value > 0 ? Math.max(s.share, 4) : 0;
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-ink-700 dark:text-paper-200">
                  {s.label}
                </span>
                {s.sub && (
                  <span className="text-xs text-ink-500 tabular-nums dark:text-paper-400">
                    {s.sub}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span className="text-sm font-semibold text-ink-900 tabular-nums dark:text-paper-50">
                  {nf(s.value)}
                </span>
                {/* Conversion from the stage above, where there is one. */}
                {s.rate !== undefined && (
                  <span className="text-xs font-medium text-ink-500 tabular-nums dark:text-paper-400">
                    {s.rate}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-8 w-full overflow-hidden rounded-lg bg-paper-200 dark:bg-umber-800">
              <div
                className={`h-full rounded-lg ${s.fill} transition-[width] duration-700 ease-out`}
                style={{ width: `${width}%` }}
              />
            </div>
          </>
        );
        if (!s.to) {
          return <li key={s.key}>{body}</li>;
        }
        return (
          <li key={s.key}>
            <Link
              to={s.to}
              className="block rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-steel-400"
            >
              {body}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UpgradeAnalyticsCard({
  title,
  locked,
  body,
  cta,
}: {
  title: string;
  locked: string;
  body: string;
  cta: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-steel-200 bg-steel-50 p-5 dark:border-steel-600/30 dark:bg-steel-600/15">
      <div className="flex items-center gap-2 text-ink-900 dark:text-paper-50">
        <Lock size={18} aria-hidden="true" className="text-steel-700 dark:text-steel-300" />
        <h2 className="font-grotesk text-lg font-semibold text-ink-900 dark:text-paper-50">
          {title}
        </h2>
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
        {locked}
      </p>
      <p className="text-sm text-ink-600 dark:text-paper-300">{body}</p>
      <div>
        <Link to="/vendor/billing" className="btn-primary inline-flex">
          {cta}
        </Link>
      </div>
    </section>
  );
}

function StatsSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900"
          >
            <Skeleton variant="line" height={12} width="55%" />
            <Skeleton height={28} width="70%" rounded="md" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
          <Skeleton variant="line" height={12} width="40%" />
          <SkeletonText lines={2} />
        </div>
        <div className="flex items-center gap-6 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-900">
          <Skeleton variant="circle" width={128} />
          <div className="flex-1">
            <SkeletonText lines={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
