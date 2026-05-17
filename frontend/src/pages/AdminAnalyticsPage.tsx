// Read-only admin analytics dashboard. Three orthogonal rollups —
// money / activity / picks — fetched in parallel on mount. No actions, no
// per-row drilldown; just KPI tiles, simple tables and pure-CSS bar charts.
//
// The three backend endpoints follow the contracts in
// `shared/admin_analytics.ts`. If any of them 404 / 5xx we surface a single
// toast + a retry button instead of crashing the page — most of the time
// at least one of the rollups will resolve successfully, but we keep the
// "all-or-nothing" UX so the admin never reads half a dashboard.

import type {
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminAnalyticsApi } from "../lib/endpoints";
import { formatHuf, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

export default function AdminAnalyticsPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.admin_analytics_title", "seo.admin_analytics_description");
  const toast = useToast();

  const [money, setMoney] = useState<Loadable<AdminMoneyAnalytics>>({ status: "loading" });
  const [activity, setActivity] = useState<Loadable<AdminActivityAnalytics>>({ status: "loading" });
  const [picks, setPicks] = useState<Loadable<AdminPicksAnalytics>>({ status: "loading" });

  // `nonce` lets the retry button re-run the effect without remounting the
  // whole tree — bumping it triggers a re-fetch and resets the three slots
  // to loading so the skeletons come back.
  const [nonce, setNonce] = useState(0);

  const loadAll = useCallback(() => {
    setMoney({ status: "loading" });
    setActivity({ status: "loading" });
    setPicks({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let anyError = false;
    // Promise.all so the three sections light up together — the visual is
    // cleaner than three independent waterfalls, and the cost is the
    // slowest endpoint (typically money on a populated DB).
    Promise.all([
      adminAnalyticsApi.money().catch((e) => {
        anyError = true;
        if (!cancelled) setMoney({ status: "error" });
        throw e;
      }),
      adminAnalyticsApi.activity().catch((e) => {
        anyError = true;
        if (!cancelled) setActivity({ status: "error" });
        throw e;
      }),
      adminAnalyticsApi.picks().catch((e) => {
        anyError = true;
        if (!cancelled) setPicks({ status: "error" });
        throw e;
      }),
    ])
      .then(([m, a, p]) => {
        if (cancelled) return;
        setMoney({ status: "ok", data: m });
        setActivity({ status: "ok", data: a });
        setPicks({ status: "ok", data: p });
      })
      .catch((e) => {
        if (cancelled) return;
        // Single toast even if multiple endpoints failed — the retry button
        // re-runs them all together so the admin doesn't need per-endpoint
        // error detail.
        if (!anyError) anyError = true;
        toast.error(e instanceof ApiError ? e.message : t("admin.analytics_load_error"));
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, toast, t]);

  const hasAnyError =
    money.status === "error" || activity.status === "error" || picks.status === "error";

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("admin.analytics_title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("admin.analytics_sub")}</p>
        {hasAnyError && (
          <div className="mt-3">
            <button type="button" className="btn-outline btn-sm" onClick={loadAll}>
              {t("admin.analytics_retry")}
            </button>
          </div>
        )}
      </header>

      <MoneySection state={money} locale={locale} />
      <ActivitySection state={activity} locale={locale} />
      <PicksSection state={picks} locale={locale} />
    </AppShell>
  );
}

// ─── Money section ─────────────────────────────────────────────────────────

function MoneySection({
  state,
  locale,
}: {
  state: Loadable<AdminMoneyAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();

  if (state.status === "loading") {
    return (
      <section className="card">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_money")}
        </h2>
        <Skeleton height={200} />
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="card">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_money")}
        </h2>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_load_error")}
        </p>
      </section>
    );
  }

  const m = state.data;
  // Histogram is scaled to the largest bucket so a small dataset doesn't
  // render as a row of barely-visible slivers — see <HBar /> below.
  const histogramMax = Math.max(0, ...m.budget_histogram.map((b) => b.count));
  const hasMoneyData = m.couples_with_budget > 0;

  return (
    <section className="card">
      <h2 className="m-0 mb-4 text-lg font-semibold text-ink-900 dark:text-paper-50">
        {t("admin.analytics_section_money")}
      </h2>

      {!hasMoneyData ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_money_empty")}
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MoneyKpi
              label={t("admin.analytics_money_avg_budget")}
              stats={m.budget_ceiling_huf}
              locale={locale}
            />
            <MoneyKpi
              label={t("admin.analytics_money_avg_planned")}
              stats={m.planned_huf}
              locale={locale}
            />
            <MoneyKpi
              label={t("admin.analytics_money_avg_actual")}
              stats={m.actual_huf}
              locale={locale}
            />
          </div>

          {/* Per-category table — sorted by avg_planned DESC at the consumer
           *  end so the contract stays simple even if the backend returns
           *  the canonical row order. */}
          <div className="mb-6">
            <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
              {t("admin.analytics_money_per_category_title")}
            </h3>
            <PerCategoryTable rows={m.per_category} locale={locale} />
          </div>

          {/* Budget ceiling histogram — pure CSS horizontal bars. The
           *  `bucket_max_huf=0` row is the "no budget set" tombstone. */}
          <div>
            <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
              {t("admin.analytics_money_histogram_title")}
            </h3>
            {m.budget_histogram.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("admin.analytics_money_histogram_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {m.budget_histogram.map((b) => (
                  <li
                    key={b.bucket_max_huf}
                    className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2"
                  >
                    <span className="text-xs text-ink-600 dark:text-umber-200 stat-num">
                      {b.bucket_max_huf === 0
                        ? t("admin.analytics_money_histogram_no_budget")
                        : t("admin.analytics_money_histogram_bucket_upper", {
                            max: formatHuf(b.bucket_max_huf, locale),
                          })}
                    </span>
                    <HBar
                      pct={histogramMax > 0 ? (b.count / histogramMax) * 100 : 0}
                      ariaLabel={`${b.count}`}
                    />
                    <span className="text-right text-xs font-medium text-ink-700 dark:text-paper-100 stat-num">
                      {formatNumber(b.count, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MoneyKpi({
  label,
  stats,
  locale,
}: {
  label: string;
  stats: AdminAnalyticsStats;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-umber-800">
      <div className="text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-900 dark:text-paper-50 stat-num">
        {formatHuf(stats.avg, locale)}
      </div>
      <div className="mt-1 text-xs text-ink-500 dark:text-umber-300 stat-num">
        {t("admin.analytics_money_sub_distribution", {
          median: formatHuf(stats.median, locale),
          p25: formatHuf(stats.p25, locale),
          p75: formatHuf(stats.p75, locale),
        })}
      </div>
    </div>
  );
}

function PerCategoryTable({
  rows,
  locale,
}: {
  rows: AdminMoneyAnalytics["per_category"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  // Sort by avg_planned DESC — the spec asks for this and the table works
  // best when the biggest line items are at the top.
  const sorted = useMemo(() => [...rows].sort((a, b) => b.avg_planned - a.avg_planned), [rows]);
  if (sorted.length === 0) {
    return (
      <p className="text-sm text-ink-500 dark:text-umber-300">
        {t("admin.analytics_money_per_category_empty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
            <th className="px-2 py-1.5 font-medium">{t("admin.analytics_money_col_category")}</th>
            <th className="px-2 py-1.5 text-right font-medium">
              {t("admin.analytics_money_col_avg_planned")}
            </th>
            <th className="px-2 py-1.5 text-right font-medium">
              {t("admin.analytics_money_col_avg_actual")}
            </th>
            <th className="px-2 py-1.5 text-right font-medium">
              {t("admin.analytics_money_col_couples_with_data")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.category} className="border-t border-paper-200 dark:border-umber-700">
              <td className="px-2 py-1.5 text-ink-800 dark:text-paper-100">
                {t(`budget.cat.${row.category}` as `budget.cat.${BudgetCategory}`)}
              </td>
              <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                {formatHuf(row.avg_planned, locale)}
              </td>
              <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                {formatHuf(row.avg_actual, locale)}
              </td>
              <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                {formatNumber(row.couples_with_data, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Activity section ──────────────────────────────────────────────────────

function ActivitySection({
  state,
  locale,
}: {
  state: Loadable<AdminActivityAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (state.status === "loading") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_activity")}
        </h2>
        <Skeleton height={200} />
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_activity")}
        </h2>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_load_error")}
        </p>
      </section>
    );
  }

  const a = state.data;
  const dailyMax = Math.max(0, ...a.signups_daily.map((d) => d.count));
  const pctOnboarded = Math.round((a.onboarding_funnel.pct_onboarded ?? 0) * 100);
  const funnel = a.onboarding_funnel;
  const funnelMax = Math.max(1, funnel.registered);
  const statusKeys: CoupleStatus[] = ["active", "paused", "deleting", "archived"];

  return (
    <section className="card mt-6">
      <h2 className="m-0 mb-4 text-lg font-semibold text-ink-900 dark:text-paper-50">
        {t("admin.analytics_section_activity")}
      </h2>

      {/* KPI tiles. */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActivityKpi
          label={t("admin.analytics_activity_signups_7d")}
          value={formatNumber(a.signups.last_7d, locale)}
          sub={t("admin.analytics_activity_signups_sub", {
            total: formatNumber(a.signups.total, locale),
          })}
        />
        <ActivityKpi
          label={t("admin.analytics_activity_active_users_7d")}
          value={formatNumber(a.active_users.last_7d, locale)}
          sub={t("admin.analytics_activity_active_users_sub", {
            n: formatNumber(a.active_users.last_24h, locale),
          })}
        />
        <ActivityKpi
          label={t("admin.analytics_activity_pct_onboarded")}
          value={`${pctOnboarded}%`}
          sub={t("admin.analytics_activity_pct_onboarded_sub", {
            onboarded: formatNumber(funnel.onboarded, locale),
            registered: formatNumber(funnel.registered, locale),
          })}
        />
      </div>

      {/* Daily signups bar chart — 14 days, newest-last. Empty days render
       *  as tiny placeholder bars so the column stays visible. */}
      <div className="mb-6">
        <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
          {t("admin.analytics_activity_signups_daily_title")}
        </h3>
        {a.signups_daily.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("admin.analytics_activity_signups_empty")}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
              {t("admin.analytics_activity_signups_daily_sub")}
            </p>
            <ul className="flex h-24 items-end gap-1">
              {a.signups_daily.map((d) => {
                const pct = dailyMax > 0 ? (d.count / dailyMax) * 100 : 0;
                return (
                  <li
                    key={d.date}
                    className="flex flex-1 flex-col items-center justify-end gap-1"
                    title={`${d.date} · ${d.count}`}
                  >
                    <div
                      className="w-full rounded-t bg-violet-600 dark:bg-violet-500"
                      style={{ height: `${Math.max(2, pct)}%` }}
                      aria-label={`${d.date}: ${d.count}`}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 flex justify-between text-[10px] text-ink-500 dark:text-umber-300 stat-num">
              <span>{a.signups_daily[0]?.date ?? ""}</span>
              <span>{a.signups_daily[a.signups_daily.length - 1]?.date ?? ""}</span>
            </div>
          </>
        )}
      </div>

      {/* Onboarding funnel — three steps, with absolute counts + each
       *  stage's bar width relative to `registered`. */}
      <div className="mb-6">
        <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
          {t("admin.analytics_activity_funnel_title")}
        </h3>
        <FunnelStep
          label={t("admin.analytics_activity_funnel_registered")}
          count={funnel.registered}
          pct={100}
          locale={locale}
        />
        <FunnelStep
          label={t("admin.analytics_activity_funnel_verified")}
          count={funnel.verified}
          pct={Math.round((funnel.verified / funnelMax) * 100)}
          locale={locale}
        />
        <FunnelStep
          label={t("admin.analytics_activity_funnel_onboarded")}
          count={funnel.onboarded}
          pct={Math.round((funnel.onboarded / funnelMax) * 100)}
          locale={locale}
        />
      </div>

      {/* Couples-by-status badge row. */}
      <div className="mb-6">
        <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
          {t("admin.analytics_activity_status_title")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {statusKeys.map((s) => (
            <StatusBadge
              key={s}
              label={t(
                `admin.analytics_activity_status_${s}` as `admin.analytics_activity_status_${CoupleStatus}`,
              )}
              count={a.couples_by_status[s] ?? 0}
              tone={s}
              locale={locale}
            />
          ))}
        </div>
      </div>

      {/* Top audit-log actions table. */}
      <div>
        <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
          {t("admin.analytics_activity_top_actions_title")}
        </h3>
        {a.top_actions.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("admin.analytics_activity_top_actions_empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                  <th className="px-2 py-1.5 font-medium">
                    {t("admin.analytics_activity_col_action")}
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    {t("admin.analytics_activity_col_count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.top_actions.map((row) => (
                  <tr key={row.action} className="border-t border-paper-200 dark:border-umber-700">
                    <td className="px-2 py-1.5 font-mono text-xs text-ink-800 dark:text-paper-100">
                      {row.action}
                    </td>
                    <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                      {formatNumber(row.count, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityKpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-umber-800">
      <div className="text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-900 dark:text-paper-50 stat-num">
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-500 dark:text-umber-300 stat-num">{sub}</div>
    </div>
  );
}

function FunnelStep({
  label,
  count,
  pct,
  locale,
}: {
  label: string;
  count: number;
  pct: number;
  locale: "hu" | "en";
}) {
  // Clamp pct into [0, 100] so wild backend numbers (rounding edge cases on
  // empty DBs that produce verified > registered) don't blow the bar past
  // the row.
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="mb-2 grid grid-cols-[10rem_1fr_5rem] items-center gap-2">
      <span className="text-sm text-ink-700 dark:text-paper-100">{label}</span>
      <HBar pct={clamped} ariaLabel={`${count}`} />
      <span className="text-right text-sm font-medium text-ink-700 dark:text-paper-100 stat-num">
        {formatNumber(count, locale)} · {clamped}%
      </span>
    </div>
  );
}

function StatusBadge({
  label,
  count,
  tone,
  locale,
}: {
  label: string;
  count: number;
  tone: CoupleStatus;
  locale: "hu" | "en";
}) {
  // Tone follows the same palette the directory uses for these statuses,
  // staying within the design tokens (violet / sage / paper / blush).
  const cls =
    tone === "active"
      ? "border-sage-300 bg-sage-50 text-sage-900 dark:border-sage-500/30 dark:bg-sage-500/15 dark:text-sage-200"
      : tone === "paused"
        ? "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200"
        : tone === "deleting"
          ? "border-blush-300 bg-blush-50 text-blush-800 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-200"
          : "border-paper-300 bg-paper-100 text-ink-700 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}
    >
      <span>{label}</span>
      <span className="stat-num">{formatNumber(count, locale)}</span>
    </span>
  );
}

// ─── Picks section ─────────────────────────────────────────────────────────

function PicksSection({
  state,
  locale,
}: {
  state: Loadable<AdminPicksAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (state.status === "loading") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_picks")}
        </h2>
        <Skeleton height={200} />
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_section_picks")}
        </h2>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_load_error")}
        </p>
      </section>
    );
  }

  const p = state.data;
  const ppc = p.picks_per_couple;
  const hasPicks = p.total_picks > 0;

  // Category coverage sorted by coverage_pct DESC so the most-saturated
  // categories surface first. Server may already pre-sort; we re-sort to
  // keep the contract narrow.
  const coverageSorted = useMemo(
    () => [...p.category_coverage].sort((a, b) => b.coverage_pct - a.coverage_pct),
    [p.category_coverage],
  );

  const sourceTotal =
    p.source_breakdown.curated + p.source_breakdown.community + p.source_breakdown.diy;

  return (
    <section className="card mt-6">
      <h2 className="m-0 mb-4 text-lg font-semibold text-ink-900 dark:text-paper-50">
        {t("admin.analytics_section_picks")}
      </h2>

      {!hasPicks ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_picks_empty")}
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActivityKpi
              label={t("admin.analytics_picks_total")}
              value={formatNumber(p.total_picks, locale)}
              sub={t("admin.analytics_picks_total_sub", { avg: formatNumber(ppc.avg, locale) })}
            />
            <ActivityKpi
              label={t("admin.analytics_picks_median_per_couple")}
              value={formatNumber(ppc.median, locale)}
              sub={t("admin.analytics_picks_median_sub", {
                p25: formatNumber(ppc.p25, locale),
                p75: formatNumber(ppc.p75, locale),
              })}
            />
          </div>

          {/* Top picks table. */}
          <div className="mb-6">
            <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
              {t("admin.analytics_picks_top_title")}
            </h3>
            {p.top_picks.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("admin.analytics_picks_top_empty")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      <th className="px-2 py-1.5 font-medium">
                        {t("admin.analytics_picks_col_supplier")}
                      </th>
                      <th className="px-2 py-1.5 font-medium">
                        {t("admin.analytics_picks_col_category")}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        {t("admin.analytics_picks_col_pick_count")}
                      </th>
                      <th className="px-2 py-1.5 font-medium">
                        {t("admin.analytics_picks_col_source")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.top_picks.map((row) => (
                      <tr
                        key={row.supplier_id}
                        className="border-t border-paper-200 dark:border-umber-700"
                      >
                        <td className="px-2 py-1.5 text-ink-800 dark:text-paper-100">
                          {row.display_name}
                        </td>
                        <td className="px-2 py-1.5 text-ink-700 dark:text-paper-100">
                          {t(
                            `suppliers.cat.${row.category}` as `suppliers.cat.${SupplierCategory}`,
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                          {formatNumber(row.pick_count, locale)}
                        </td>
                        <td className="px-2 py-1.5">
                          <SourceBadge source={row.source} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Category coverage table. */}
          <div className="mb-6">
            <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
              {t("admin.analytics_picks_coverage_title")}
            </h3>
            {coverageSorted.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("admin.analytics_picks_coverage_empty")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      <th className="px-2 py-1.5 font-medium">
                        {t("admin.analytics_picks_col_category")}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        {t("admin.analytics_picks_col_picked")}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        {t("admin.analytics_picks_col_missing")}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        {t("admin.analytics_picks_col_coverage_pct")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageSorted.map((row) => {
                      const pct = Math.max(0, Math.min(100, Math.round(row.coverage_pct * 100)));
                      return (
                        <tr
                          key={row.category}
                          className="border-t border-paper-200 dark:border-umber-700"
                        >
                          <td className="px-2 py-1.5 text-ink-800 dark:text-paper-100">
                            {t(
                              `suppliers.cat.${row.category}` as `suppliers.cat.${SupplierCategory}`,
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                            {formatNumber(row.picked, locale)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-ink-500 dark:text-umber-300 stat-num">
                            {formatNumber(row.missing, locale)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-ink-700 dark:text-paper-100 stat-num">
                            {pct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Source breakdown stacked bar. Three segments inside one
           *  horizontal bar so the relative mix is legible at a glance. */}
          <div>
            <h3 className="m-0 mb-2 text-sm font-semibold text-ink-700 dark:text-paper-200">
              {t("admin.analytics_picks_source_breakdown_title")}
            </h3>
            <SourceStackedBar
              curated={p.source_breakdown.curated}
              community={p.source_breakdown.community}
              diy={p.source_breakdown.diy}
              total={sourceTotal}
              locale={locale}
            />
          </div>
        </>
      )}
    </section>
  );
}

function SourceBadge({ source }: { source: "curated" | "community" | "diy" }) {
  const { t } = useT();
  const cls =
    source === "curated"
      ? "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200"
      : source === "community"
        ? "border-sage-300 bg-sage-50 text-sage-900 dark:border-sage-500/30 dark:bg-sage-500/15 dark:text-sage-200"
        : "border-blush-300 bg-blush-50 text-blush-800 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-200";
  const label =
    source === "curated"
      ? t("admin.analytics_source_curated")
      : source === "community"
        ? t("admin.analytics_source_community")
        : t("admin.analytics_source_diy");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function SourceStackedBar({
  curated,
  community,
  diy,
  total,
  locale,
}: {
  curated: number;
  community: number;
  diy: number;
  total: number;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  // Treat a zero total as the empty case so the bar still renders an empty
  // outline rather than NaN widths.
  const safeTotal = total > 0 ? total : 1;
  const cPct = (curated / safeTotal) * 100;
  const cmPct = (community / safeTotal) * 100;
  const dPct = (diy / safeTotal) * 100;

  return (
    <div>
      <div
        className="flex h-6 overflow-hidden rounded-md border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
        role="img"
        aria-label={`curated ${curated}, community ${community}, diy ${diy}`}
      >
        <div
          className="h-full bg-violet-600 dark:bg-violet-500"
          style={{ width: `${cPct}%` }}
          title={`${t("admin.analytics_source_curated")} · ${formatNumber(curated, locale)}`}
        />
        <div
          className="h-full bg-sage-500 dark:bg-sage-400"
          style={{ width: `${cmPct}%` }}
          title={`${t("admin.analytics_source_community")} · ${formatNumber(community, locale)}`}
        />
        <div
          className="h-full bg-blush-500 dark:bg-blush-400"
          style={{ width: `${dPct}%` }}
          title={`${t("admin.analytics_source_diy")} · ${formatNumber(diy, locale)}`}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-700 dark:text-paper-100">
        <LegendDot
          colourClass="bg-violet-600 dark:bg-violet-500"
          label={t("admin.analytics_source_curated")}
          value={formatNumber(curated, locale)}
        />
        <LegendDot
          colourClass="bg-sage-500 dark:bg-sage-400"
          label={t("admin.analytics_source_community")}
          value={formatNumber(community, locale)}
        />
        <LegendDot
          colourClass="bg-blush-500 dark:bg-blush-400"
          label={t("admin.analytics_source_diy")}
          value={formatNumber(diy, locale)}
        />
      </div>
    </div>
  );
}

function LegendDot({
  colourClass,
  label,
  value,
}: {
  colourClass: string;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${colourClass}`} />
      <span>{label}</span>
      <span className="stat-num text-ink-500 dark:text-umber-300">{value}</span>
    </span>
  );
}

// ─── Shared primitives ─────────────────────────────────────────────────────

/** Pure-CSS horizontal bar. Width is a percentage of the parent so the
 *  caller controls the absolute scale via the surrounding grid. We render a
 *  thin track underneath so empty rows still read as "0", not as a gap. */
function HBar({ pct, ariaLabel }: { pct: number; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="relative h-3 w-full rounded bg-paper-200 dark:bg-umber-700"
      role="img"
      aria-label={ariaLabel}
    >
      <div
        className="h-full rounded bg-violet-600 dark:bg-violet-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
