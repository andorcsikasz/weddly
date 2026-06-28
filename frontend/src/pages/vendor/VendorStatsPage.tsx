// Vendor stats — the analytics surface for a role='vendor' user at /vendor/stats.
// Renders inside VendorShell. Reads the rollup from vendorStatsApi.get() and the
// derived plan/feature flags from vendorBillingApi.get(). FREE-tier vendors see
// the summary KPI numbers (inquiry counts, revenue tracked, blocked dates,
// listing completeness gauge) plus a graceful upgrade CTA in place of the
// detailed analytics; PRO-tier vendors additionally see the inquiries-over-time
// comparison, the by-status breakdown bars, and the upcoming events list.
// No real chart library — simple bars/gauges built from design tokens.

import { BarChart3, CalendarClock, Inbox, Lock, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorFeatureFlags } from "@shared/vendor_plan";
import { vendorBillingApi, vendorStatsApi } from "../../lib/endpoints";
import { formatDate, formatMoney } from "../../lib/format";
import { useT } from "../../lib/i18n";

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

export default function VendorStatsPage() {
  const { t, locale } = useT();

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
  const completeness = Math.max(0, Math.min(100, Math.round(stats.listing_completeness)));

  // Status breakdown rows, busiest first, with a human label where we have one.
  const statusRows = Object.entries(stats.by_status)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      status,
      count,
      label: KNOWN_STATUSES.has(status) ? t(`suppliers.detail.calendar.status.${status}`) : status,
    }));
  const statusMax = statusRows.reduce((m, r) => Math.max(m, r.count), 0);

  // Inquiries-over-time is a two-bar comparison (all time vs last 30 days) —
  // the rollup doesn't carry a full time series.
  const inquiryMax = Math.max(stats.inquiries_total, stats.inquiries_30d, 1);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
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
        />
        <StatCard
          icon={<CalendarClock size={18} aria-hidden="true" />}
          label={t("vendor.stats.blocked_dates")}
          value={String(stats.blocked_dates_count)}
        />
      </div>

      {/* Listing completeness gauge — always visible. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {t("vendor.stats.completeness")}
          </h2>
          <span className="text-sm font-semibold text-ink-900 tabular-nums dark:text-paper-50">
            {completeness}%
          </span>
        </div>
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800"
          role="progressbar"
          aria-valuenow={completeness}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-blush-400 transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
      </section>

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

          {/* By status */}
          <section className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("vendor.stats.by_status")}
            </h2>
            {statusRows.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-500 dark:text-paper-400">
                {t("vendor.clients.empty_body")}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {statusRows.map((row) => (
                  <BarRow
                    key={row.status}
                    label={row.label}
                    count={row.count}
                    max={statusMax}
                    locale={locale}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Upcoming events */}
          <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 lg:col-span-2 dark:border-umber-700 dark:bg-umber-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
                <CalendarClock size={18} aria-hidden="true" />
                <span>{t("vendor.stats.upcoming")}</span>
              </h2>
              <Link
                to="/vendor/clients"
                className="text-sm font-medium text-ink-700 transition-colors hover:text-ink-900 dark:text-paper-200 dark:hover:text-blush-300"
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

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
      <div className="flex items-center gap-2 text-ink-500 dark:text-paper-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-ink-900 dark:text-paper-50">{value}</div>
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
          className="h-full rounded-full bg-blush-400 transition-all"
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
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-blush-200 bg-blush-50 p-6 dark:border-blush-400/30 dark:bg-blush-400/10">
      <div className="flex items-center gap-2 text-ink-700 dark:text-paper-200">
        <Lock size={18} aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink-900 dark:text-paper-50">{title}</h2>
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
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800"
          />
        ))}
      </div>
      <div className="h-20 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
        <div className="h-48 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
      </div>
    </div>
  );
}
