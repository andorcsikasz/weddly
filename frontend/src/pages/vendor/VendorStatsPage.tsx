// Vendor stats — the analytics surface for a role='vendor' user at /vendor/stats.
// Renders inside VendorShell. Reads the rollup from vendorStatsApi.get() and the
// derived plan/feature flags from vendorBillingApi.get(). FREE-tier vendors see
// the summary KPI numbers (inquiry counts, revenue tracked, blocked dates) plus a
// graceful upgrade CTA in place of the detailed analytics; PRO-tier vendors
// additionally see the inquiries-over-time comparison, the by-status donut, and
// the upcoming events list.
// No real chart library - the donut and bars are hand-rolled from design tokens.
// Backend follow-up: there is no daily inquiry time series yet, so this page
// deliberately ships no date-range filter and no trend line. Once the rollup
// carries a per-day series we can add a proper sparkline / range pills here.

import { BarChart3, CalendarClock, Inbox, Info, Lock, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorFeatureFlags } from "@shared/vendor_plan";
import { Skeleton, SkeletonText } from "../../components/ui";
import { vendorBillingApi, vendorStatsApi } from "../../lib/endpoints";
import { formatDate, formatMoney } from "../../lib/format";
import { useT } from "../../lib/i18n";
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
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-10 text-center dark:border-umber-700 dark:bg-umber-900">
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

  // Inquiries-over-time is a two-bar comparison (all time vs last 30 days) —
  // the rollup doesn't carry a full time series.
  const inquiryMax = Math.max(stats.inquiries_total, stats.inquiries_30d, 1);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.stats.page_title")}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.stats.page_body")}</p>
      </header>

      {/* Summary numbers — always visible, both tiers. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Inbox size={18} aria-hidden="true" />}
          label={t("vendor.stats.inquiries")}
          value={String(stats.inquiries_total)}
        />
        <StatCard
          icon={<CalendarClock size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.inquiries_30d")}
          value={String(stats.inquiries_30d)}
        />
        <StatCard
          icon={<BarChart3 size={18} aria-hidden="true" />}
          label={t("vendor.stats.revenue")}
          value={formatMoney(stats.revenue_tracked, currency, locale)}
          help={t("vendor.stats.revenue_help")}
        />
        <StatCard
          icon={<CalendarClock size={18} aria-hidden="true" />}
          label={t("vendor.stats.blocked_dates")}
          value={String(stats.blocked_dates_count)}
        />
      </div>

      {/* Detailed analytics — PRO only. FREE sees an upgrade prompt. */}
      {advancedUnlocked ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Inquiries over time */}
          <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("vendor.stats.inquiries")}
            </h2>
            <div className="flex flex-col gap-3">
              <BarRow
                label={t("vendor.dashboard.inquiries_total")}
                count={stats.inquiries_total}
                max={inquiryMax}
                locale={locale}
              />
              <BarRow
                label={t("vendor.dashboard.inquiries_30d")}
                count={stats.inquiries_30d}
                max={inquiryMax}
                locale={locale}
              />
            </div>
          </section>

          {/* By status - donut + legend */}
          <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("vendor.stats.by_status")}
            </h2>
            {statusTotal === 0 ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <StatusDonut segments={[]} total={0} centerLabel={t("vendor.stats.inquiries")} />
                <p className="text-center text-sm text-ink-500 dark:text-paper-400">
                  {t("vendor.stats.status_empty")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
                <StatusDonut
                  segments={statusSegments}
                  total={statusTotal}
                  centerLabel={t("vendor.stats.inquiries")}
                />
                <ul className="flex w-full flex-col gap-2">
                  {statusSegments.map((seg) => (
                    <li
                      key={seg.status}
                      className="flex items-center justify-between gap-3 text-sm"
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
                        {seg.count.toLocaleString(locale === "hu" ? "hu-HU" : "en-GB")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Upcoming events */}
          <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 lg:col-span-2 dark:border-umber-700 dark:bg-umber-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
                <CalendarClock
                  size={18}
                  aria-hidden="true"
                  className="text-steel-700 dark:text-steel-300"
                />
                <span>{t("vendor.stats.upcoming")}</span>
              </h2>
              <Link
                to="/vendor/clients"
                className="text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
              >
                {t("vendor.dashboard.view_clients")}
              </Link>
            </div>
            {stats.upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500 dark:text-paper-400">
                {t("vendor.dashboard.no_upcoming")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-paper-200 dark:divide-umber-700">
                {stats.upcoming.map((event) => (
                  <li key={event.id}>
                    <Link
                      to={`/vendor/clients/${event.id}`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
                    >
                      <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                        {event.couple_display_name}
                      </span>
                      <span className="shrink-0 text-sm text-ink-600 dark:text-paper-300">
                        {event.event_date
                          ? formatDate(event.event_date, locale)
                          : t("vendor.clients.no_event_date")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <UpgradeAnalyticsCard
          title={t("vendor.upgrade.title")}
          locked={t("vendor.upgrade.feature_locked")}
          body={t("vendor.upgrade.body")}
          cta={t("vendor.upgrade.cta")}
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  help,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-3.5 dark:border-umber-700 dark:bg-umber-900">
      <div className="flex items-center gap-2 text-ink-500 dark:text-paper-400">
        <span className="text-steel-700 dark:text-steel-300">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {help ? (
          <span
            className="ml-auto inline-flex cursor-help text-ink-400 dark:text-paper-500"
            title={help}
          >
            <Info size={14} aria-hidden="true" />
            <span className="sr-only">{help}</span>
          </span>
        ) : null}
      </div>
      <div className="text-center text-2xl font-semibold text-ink-900 dark:text-paper-50">
        {value}
      </div>
    </div>
  );
}

// Inline SVG donut built from stroke-dasharray arcs over a base ring. The svg
// itself is rotated -90deg so the first arc starts at 12 o'clock; the total sits
// in the middle. An empty `segments` array renders just the muted base ring as a
// skeleton-like placeholder.
function StatusDonut({
  segments,
  total,
  centerLabel,
}: {
  segments: { status: string; count: number; color: string }[];
  total: number;
  centerLabel: string;
}) {
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
                className={`stroke-chart-${seg.color}`}
              />
            );
            drawn += length;
            return arc;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-ink-900 tabular-nums dark:text-paper-50">
          {total}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:text-paper-400">
          {centerLabel}
        </span>
      </div>
    </div>
  );
}

function BarRow({
  label,
  count,
  max,
  locale,
}: {
  label: string;
  count: number;
  max: number;
  locale: "hu" | "en";
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-ink-700 dark:text-paper-200">{label}</span>
        <span className="shrink-0 font-semibold text-ink-900 tabular-nums dark:text-paper-50">
          {count.toLocaleString(locale === "hu" ? "hu-HU" : "en-GB")}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800">
        <div
          className="h-full rounded-full bg-steel-600 transition-all dark:bg-steel-400"
          style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
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
            className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900"
          >
            <Skeleton variant="line" height={12} width="55%" />
            <Skeleton height={28} width="70%" rounded="md" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
          <Skeleton variant="line" height={12} width="40%" />
          <SkeletonText lines={2} />
        </div>
        <div className="flex items-center gap-6 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
          <Skeleton variant="circle" width={128} />
          <div className="flex-1">
            <SkeletonText lines={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
