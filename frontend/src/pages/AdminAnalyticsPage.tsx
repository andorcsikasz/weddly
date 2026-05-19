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
  AdminDemoAnalytics,
  AdminEngagementAnalytics,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  // Engagement is a separate, independently-loaded rollup so that a backend
  // that hasn't yet shipped the engagement endpoint (parallel agent) still
  // lets the other three sections render cleanly. We DON'T fold it into the
  // Promise.all gate above for that reason.
  const [engagement, setEngagement] = useState<Loadable<AdminEngagementAnalytics>>({
    status: "loading",
  });
  // Demo analytics — same independent-load pattern as engagement; a
  // backend without /api/admin/analytics/demo still renders the other
  // sections cleanly.
  const [demo, setDemo] = useState<Loadable<AdminDemoAnalytics>>({ status: "loading" });

  // `nonce` lets the retry button re-run the effect without remounting the
  // whole tree — bumping it triggers a re-fetch and resets the four slots
  // to loading so the skeletons come back.
  const [nonce, setNonce] = useState(0);

  const loadAll = useCallback(() => {
    setMoney({ status: "loading" });
    setActivity({ status: "loading" });
    setPicks({ status: "loading" });
    setEngagement({ status: "loading" });
    setDemo({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let anyError = false;
    // Promise.all so the three legacy sections light up together — the visual
    // is cleaner than three independent waterfalls, and the cost is the
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

    // Engagement is fired in parallel but tracked independently. The backend
    // for this endpoint may not exist yet — show a graceful empty card
    // instead of dragging the whole page into the error state.
    adminAnalyticsApi
      .engagement()
      .then((e) => {
        if (!cancelled) setEngagement({ status: "ok", data: e });
      })
      .catch(() => {
        if (!cancelled) setEngagement({ status: "error" });
      });

    adminAnalyticsApi
      .demo()
      .then((d) => {
        if (!cancelled) setDemo({ status: "ok", data: d });
      })
      .catch(() => {
        if (!cancelled) setDemo({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [nonce, toast, t]);

  const hasAnyError =
    money.status === "error" || activity.status === "error" || picks.status === "error";

  return (
    <>
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
      <EngagementSection state={engagement} locale={locale} />
      <DemoSection state={demo} locale={locale} />
    </>
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

      {/* Daily signups — 14-day SVG area chart. Smoother than the
       *  former bar list and reads as a single shape, which is the
       *  more "minimalist informative" call. Falls back to a friendly
       *  empty-state when no signups landed in the window. */}
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
            <SignupsAreaChart points={a.signups_daily} max={dailyMax} />
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
  // Hover state — drives both the central total → hovered count swap AND
  // the slight pop on the hovered arc. `null` = no hover, show grand total.
  const [hovered, setHovered] = useState<"curated" | "community" | "diy" | null>(null);

  // Treat a zero total as the empty case so the donut still renders an
  // outline rather than NaN arc lengths.
  const safeTotal = total > 0 ? total : 1;

  // Arc-length math: each segment occupies `value/total` of the
  // circumference. We render three concentric arcs by computing
  // stroke-dasharray + stroke-dashoffset on a single circle path. SVG
  // strokes go clockwise from the top (after `transform rotate(-90)`).
  const SIZE = 144;
  const RADIUS = 56;
  const STROKE = 18;
  const CIRC = 2 * Math.PI * RADIUS;
  const cLen = (curated / safeTotal) * CIRC;
  const cmLen = (community / safeTotal) * CIRC;
  const dLen = (diy / safeTotal) * CIRC;
  // Cumulative offsets, walking clockwise around the ring.
  const cOff = 0;
  const cmOff = -cLen;
  const dOff = -(cLen + cmLen);

  const hoveredValue =
    hovered === "curated"
      ? curated
      : hovered === "community"
        ? community
        : hovered === "diy"
          ? diy
          : null;
  const hoveredLabel =
    hovered === "curated"
      ? t("admin.analytics_source_curated")
      : hovered === "community"
        ? t("admin.analytics_source_community")
        : hovered === "diy"
          ? t("admin.analytics_source_diy")
          : null;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`curated ${curated}, community ${community}, diy ${diy}`}
        className="shrink-0"
      >
        <title>
          {t("admin.analytics_picks_source_breakdown_title")} · {formatNumber(total, locale)}
        </title>
        <defs>
          {/* Subtle drop shadow — applied to the outer arc group so the
           *  donut feels lifted off the card without going Bootstrap-y. */}
          <filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
            <feOffset dx="0" dy="1" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.18" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Gradient fills per slice — tailwind tokens via currentColor so
           *  the colours come from the theme palette, not raw hex. */}
          <linearGradient id="donut-grad-curated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-violet-500" stopColor="currentColor" />
            <stop offset="100%" className="text-violet-700" stopColor="currentColor" />
          </linearGradient>
          <linearGradient id="donut-grad-community" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-sage-400" stopColor="currentColor" />
            <stop offset="100%" className="text-sage-600" stopColor="currentColor" />
          </linearGradient>
          <linearGradient id="donut-grad-diy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-blush-400" stopColor="currentColor" />
            <stop offset="100%" className="text-blush-600" stopColor="currentColor" />
          </linearGradient>
        </defs>
        <g
          transform={`translate(${SIZE / 2} ${SIZE / 2}) rotate(-90)`}
          fill="none"
          strokeWidth={STROKE}
          filter="url(#donut-shadow)"
        >
          {/* Track underneath each arc — keeps the empty case readable. */}
          <circle
            r={RADIUS}
            className="stroke-paper-200 dark:stroke-umber-700"
            strokeWidth={STROKE}
          />
          {curated > 0 && (
            <circle
              r={RADIUS}
              stroke="url(#donut-grad-curated)"
              strokeDasharray={`${cLen} ${CIRC - cLen}`}
              strokeDashoffset={cOff}
              strokeLinecap="butt"
              strokeWidth={hovered === "curated" ? STROKE + 2 : STROKE}
              onPointerEnter={() => setHovered("curated")}
              onPointerLeave={() => setHovered(null)}
              className="cursor-pointer transition-[stroke-width]"
            >
              <title>
                {t("admin.analytics_source_curated")} · {formatNumber(curated, locale)}
              </title>
            </circle>
          )}
          {community > 0 && (
            <circle
              r={RADIUS}
              stroke="url(#donut-grad-community)"
              strokeDasharray={`${cmLen} ${CIRC - cmLen}`}
              strokeDashoffset={cmOff}
              strokeLinecap="butt"
              strokeWidth={hovered === "community" ? STROKE + 2 : STROKE}
              onPointerEnter={() => setHovered("community")}
              onPointerLeave={() => setHovered(null)}
              className="cursor-pointer transition-[stroke-width]"
            >
              <title>
                {t("admin.analytics_source_community")} · {formatNumber(community, locale)}
              </title>
            </circle>
          )}
          {diy > 0 && (
            <circle
              r={RADIUS}
              stroke="url(#donut-grad-diy)"
              strokeDasharray={`${dLen} ${CIRC - dLen}`}
              strokeDashoffset={dOff}
              strokeLinecap="butt"
              strokeWidth={hovered === "diy" ? STROKE + 2 : STROKE}
              onPointerEnter={() => setHovered("diy")}
              onPointerLeave={() => setHovered(null)}
              className="cursor-pointer transition-[stroke-width]"
            >
              <title>
                {t("admin.analytics_source_diy")} · {formatNumber(diy, locale)}
              </title>
            </circle>
          )}
        </g>
        {/* Centre label — total by default, the hovered slice's value when
         *  the pointer is on a slice. The caption underneath (small) gives
         *  context so the value alone doesn't look untethered. */}
        <text
          x="50%"
          y="46%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink-900 dark:fill-paper-50 stat-num"
          fontSize="22"
          fontWeight={600}
        >
          {formatNumber(hoveredValue ?? total, locale)}
        </text>
        <text
          x="50%"
          y="62%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink-500 dark:fill-umber-300"
          fontSize="10"
        >
          {hoveredLabel ?? t("admin.analytics_engagement_total_picks")}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5 text-sm text-ink-700 dark:text-paper-100">
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

// ─── Engagement section ────────────────────────────────────────────────────

/** Engagement rollup — four sub-cards in a responsive 2×2 grid. Driven by
 *  `AdminEngagementAnalytics`. The backend endpoint may not be deployed
 *  yet (parallel agent in flight); the surrounding component fires it
 *  independently of the legacy three so a 404 here only hides this
 *  section, not the whole page. */
function EngagementSection({
  state,
  locale,
}: {
  state: Loadable<AdminEngagementAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (state.status === "loading") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_engagement_title")}
        </h2>
        <Skeleton height={240} />
      </section>
    );
  }
  if (state.status === "error") {
    // Soft fallback — render the title + a single line, no toast. The error
    // is most likely the endpoint not existing yet, and we don't want to
    // make the admin retry the whole page over it.
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_engagement_title")}
        </h2>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_load_error")}
        </p>
      </section>
    );
  }

  const e = state.data;
  return (
    <section className="card mt-6">
      <header className="mb-4">
        <h2 className="m-0 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_engagement_title")}
        </h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_sub")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SessionDurationCard
          stats={e.session_duration_minutes}
          totalSessions={e.total_sessions}
          locale={locale}
        />
        <RetentionCard retention={e.retention} locale={locale} />
        <TimeOfDayHeatmap matrix={e.time_of_day.matrix} max={e.time_of_day.max} />
        <TopFeaturesCard features={e.top_features} locale={locale} />
        <div className="lg:col-span-2">
          <TopUsersCard users={e.top_users} locale={locale} />
        </div>
      </div>
    </section>
  );
}

/** Top active users leaderboard — table of {full_name, email, event_count,
 *  last_seen_at}. Demo users are filtered out server-side so the rank
 *  reflects real engagement. Renders 10 rows max; empty state when the
 *  audit window is empty (the most-active value would be 0 across the
 *  board). */
function TopUsersCard({
  users,
  locale,
}: {
  users: AdminEngagementAnalytics["top_users"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (users.length === 0) {
    return (
      <SubCard title={t("admin.analytics_engagement_top_users")}>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_top_users_empty")}
        </p>
      </SubCard>
    );
  }
  const max = Math.max(1, ...users.map((u) => u.event_count));
  return (
    <SubCard title={t("admin.analytics_engagement_top_users")}>
      <ul className="space-y-2">
        {users.map((u, i) => {
          const pct = (u.event_count / max) * 100;
          return (
            <li
              key={u.user_id}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_6rem_4rem] items-center gap-3 text-sm"
            >
              <span className="stat-num text-xs text-ink-400 dark:text-umber-300">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate font-medium text-ink-900 dark:text-paper-50">
                {u.full_name}
              </span>
              <span className="truncate text-xs text-ink-500 dark:text-umber-300">{u.email}</span>
              <span className="truncate text-xs text-ink-500 dark:text-umber-300">
                {formatRelative(u.last_seen_at, locale, t)}
              </span>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                <div
                  className="h-full rounded-full bg-violet-600 dark:bg-violet-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="stat-num text-right text-xs text-ink-700 dark:text-paper-100">
                {u.event_count}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-ink-400 dark:text-umber-300">
        {t("admin.analytics_engagement_top_users_help")}
      </p>
    </SubCard>
  );
}

/** "X mins ago" / "X hours ago" / "X days ago" / absolute date past 7 days.
 *  Mirrors the relative formatter on AdminUsersPage so the wording stays
 *  identical across the admin surfaces. */
function formatRelative(
  unixMs: number | null,
  locale: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  if (unixMs == null) return t("admin.last_active_never");
  const diff = Date.now() - unixMs;
  if (diff < 60 * 1000) return t("admin.last_active_now");
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return t("admin.last_active_minutes", { n: mins });
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return t("admin.last_active_hours", { n: hours });
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 7) return t("admin.last_active_days", { n: days });
  const d = new Date(unixMs);
  return d.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Demo section ──────────────────────────────────────────────────────────

/** Demo platform monitoring. Distinct from engagement because demo
 *  workspaces are intentionally ephemeral — mixing them into signups /
 *  retention would inflate every real-user number. Same load pattern as
 *  the engagement panel; a 404 only hides this card, not the whole
 *  page. */
function DemoSection({
  state,
  locale,
}: {
  state: Loadable<AdminDemoAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (state.status === "loading") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_demo_title")}
        </h2>
        <Skeleton height={200} />
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="card mt-6">
        <h2 className="m-0 mb-3 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_demo_title")}
        </h2>
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_demo_load_error")}
        </p>
      </section>
    );
  }

  const d = state.data;
  const dailyMax = Math.max(0, ...d.demos_daily.map((p) => p.count));
  return (
    <section className="card mt-6">
      <header className="mb-4">
        <h2 className="m-0 text-lg font-semibold text-ink-900 dark:text-paper-50">
          {t("admin.analytics_demo_title")}
        </h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_demo_sub")}
        </p>
      </header>

      {/* Top KPI row — first-glance status of the demo funnel. `total`
       *  is live workspaces only (reaped after 4h); `total_served` adds the
       *  historic snapshots so the cumulative "how many tried it" survives
       *  the sweep. */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          label={t("admin.analytics_demo_total")}
          value={formatNumber(d.total_demos, locale)}
        />
        <KpiTile
          label={t("admin.analytics_demo_total_served")}
          value={formatNumber(d.total_demos_served, locale)}
        />
        <KpiTile
          label={t("admin.analytics_demo_new_24h")}
          value={formatNumber(d.new_demos.last_24h, locale)}
        />
        <KpiTile
          label={t("admin.analytics_demo_active_24h")}
          value={formatNumber(d.active_demos_24h, locale)}
        />
        <KpiTile
          label={t("admin.analytics_demo_avg_events")}
          value={formatNumber(d.avg_events_per_demo, locale)}
        />
        <KpiTile
          label={t("admin.analytics_demo_avg_lifetime")}
          value={formatLifetime(d.avg_lifetime_seconds, locale)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SubCard title={t("admin.analytics_demo_daily_title")}>
          {d.demos_daily.length === 0 || dailyMax === 0 ? (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("admin.analytics_demo_empty")}
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
                {t("admin.analytics_demo_daily_sub")}
              </p>
              <SignupsAreaChart points={d.demos_daily} max={dailyMax} />
              <div className="mt-1 flex justify-between text-[10px] text-ink-500 dark:text-umber-300 stat-num">
                <span>{d.demos_daily[0]?.date ?? ""}</span>
                <span>{d.demos_daily[d.demos_daily.length - 1]?.date ?? ""}</span>
              </div>
            </>
          )}
        </SubCard>
        <SubCard title={t("admin.analytics_demo_events_title")}>
          <div className="flex items-baseline gap-2">
            <span className="stat-num text-3xl font-semibold text-ink-900 dark:text-paper-50">
              {formatNumber(d.total_demo_events_30d, locale)}
            </span>
            <span className="text-xs text-ink-500 dark:text-umber-300">
              {t("admin.analytics_demo_events_unit")}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
            {t("admin.analytics_demo_events_help")}
          </p>
        </SubCard>
      </div>

      {/* Top features panel — combined view of features touched across
       *  live demos AND historic snapshots (the snapshot table preserves
       *  this signal past the 4h reaper). The bar widths use the highest
       *  count as the max so the strongest signal anchors the layout. */}
      <SubCard title={t("admin.analytics_demo_top_features_title")} className="mt-4">
        <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
          {t("admin.analytics_demo_top_features_sub")}
        </p>
        {d.top_features.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">
            {t("admin.analytics_demo_top_features_empty")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(() => {
              const max = Math.max(0, ...d.top_features.map((f) => f.count));
              return d.top_features.map((f) => {
                const pct = max === 0 ? 0 : Math.max(4, Math.round((f.count / max) * 100));
                return (
                  <li key={f.feature} className="text-sm">
                    <div className="mb-0.5 flex items-baseline justify-between gap-3">
                      <span className="font-medium text-ink-700 dark:text-paper-100">
                        {f.feature}
                      </span>
                      <span className="text-xs text-ink-500 dark:text-umber-300 stat-num">
                        {formatNumber(f.count, locale)}{" "}
                        <span className="opacity-70">
                          (
                          {t(
                            f.demos === 1
                              ? "admin.analytics_demo_feature_demos_one"
                              : "admin.analytics_demo_feature_demos_other",
                            { n: f.demos },
                          )}
                          )
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-paper-100 dark:bg-umber-800">
                      <div
                        className="h-full rounded-full bg-rose-500/70 dark:bg-rose-400/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              });
            })()}
          </ul>
        )}
      </SubCard>
    </section>
  );
}

/** Render avg-lifetime seconds as a human-scaled "5m 12s" / "2h 14m"
 *  string. Used by the demo KPI tile only — the value is bounded by the
 *  4h reaper, so we never need day-level formatting. */
function formatLifetime(seconds: number, locale: "hu" | "en"): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const hUnit = locale === "hu" ? "ó" : "h";
  const mUnit = locale === "hu" ? "p" : "m";
  const sUnit = locale === "hu" ? "mp" : "s";
  if (h > 0) return `${h}${hUnit} ${m}${mUnit}`;
  if (m > 0) return `${m}${mUnit} ${s}${sUnit}`;
  return `${s}${sUnit}`;
}

/** Compact KPI tile — used by the demo section header row. Mirrors the
 *  KPI-tile look from the legacy money/activity surfaces. */
function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper-50 p-3 ring-1 ring-ink-100 dark:bg-umber-900 dark:ring-umber-700">
      <div className="text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </div>
      <div className="stat-num mt-1 text-2xl font-semibold text-ink-900 dark:text-paper-50">
        {value}
      </div>
    </div>
  );
}

/** Sub-card wrapper — keeps spacing + ring consistent across the four
 *  engagement panels. Mirrors the look of the legacy KPI tiles (rounded-xl
 *  + ring-1 ink-100 + paper-50 fill) so the section feels of-a-piece. */
function SubCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-paper-50 p-5 ring-1 ring-ink-100 dark:bg-umber-900 dark:ring-umber-700${
        className ? ` ${className}` : ""
      }`}
    >
      <h3 className="m-0 mb-3 text-sm font-semibold text-ink-700 dark:text-paper-200">{title}</h3>
      {children}
    </div>
  );
}

function SessionDurationCard({
  stats,
  totalSessions,
  locale,
}: {
  stats: AdminAnalyticsStats;
  totalSessions: number;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  return (
    <SubCard title={t("admin.analytics_engagement_session_duration")}>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold text-ink-900 dark:text-paper-50 stat-num">
          {formatNumber(stats.avg, locale)}
        </span>
        <span className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_session_minutes")}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatChip
          label={t("admin.analytics_engagement_session_median", {
            value: formatNumber(stats.median, locale),
          })}
        />
        <StatChip
          label={t("admin.analytics_engagement_session_p25", {
            value: formatNumber(stats.p25, locale),
          })}
        />
        <StatChip
          label={t("admin.analytics_engagement_session_p75", {
            value: formatNumber(stats.p75, locale),
          })}
        />
        <StatChip
          label={t("admin.analytics_engagement_session_count", {
            count: stats.count,
          })}
        />
      </div>
      <p className="mt-3 text-xs text-ink-500 dark:text-umber-300 stat-num">
        {t("admin.analytics_engagement_session_total_sessions")}:{" "}
        {formatNumber(totalSessions, locale)}
      </p>
    </SubCard>
  );
}

function StatChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-paper-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-ink-700 stat-num dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100">
      {label}
    </span>
  );
}

function RetentionCard({
  retention,
  locale,
}: {
  retention: AdminEngagementAnalytics["retention"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const haveAny = retention.d1 !== null || retention.d7 !== null || retention.d30 !== null;
  return (
    <SubCard title={t("admin.analytics_engagement_retention")}>
      {!haveAny ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_retention_empty")}
        </p>
      ) : (
        <RetentionChart retention={retention} locale={locale} />
      )}
      <p className="mt-2 text-xs text-ink-500 dark:text-umber-300 stat-num">
        {t("admin.analytics_engagement_retention_cohort", {
          n: formatNumber(retention.cohort_size, locale),
        })}
      </p>
    </SubCard>
  );
}

function RetentionChart({
  retention,
  locale,
}: {
  retention: AdminEngagementAnalytics["retention"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  // Three points: D+1 / D+7 / D+30. Null bucket → render at 0 but ghost
  // the dot so the chart stays honest about missing data.
  const W = 280;
  const H = 100;
  const PAD_L = 32;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const pts = [
    { label: t("admin.analytics_engagement_retention_d1"), value: retention.d1 },
    { label: t("admin.analytics_engagement_retention_d7"), value: retention.d7 },
    { label: t("admin.analytics_engagement_retention_d30"), value: retention.d30 },
  ];
  const xs = pts.map((_, i) => PAD_L + (innerW * i) / Math.max(1, pts.length - 1));
  const ys = pts.map((p) =>
    p.value === null ? H - PAD_B : H - PAD_B - innerH * Math.max(0, Math.min(1, p.value)),
  );

  const linePath = pts
    .map((p, i) => {
      if (p.value === null) return null;
      const x = xs[i];
      const y = ys[i];
      if (x === undefined || y === undefined) return null;
      return { x, y };
    })
    .filter((p): p is { x: number; y: number } => p !== null)
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-24 w-full"
      role="img"
      aria-label="retention curve"
    >
      <title>retention D+1 / D+7 / D+30</title>
      {/* y-axis ticks at 0%, 50%, 100% — pure visual scaffolding. */}
      {[0, 0.5, 1].map((frac) => {
        const y = H - PAD_B - innerH * frac;
        return (
          <g key={frac}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
              className="stroke-paper-300 dark:stroke-umber-700"
              strokeWidth={1}
              strokeDasharray={frac === 0 ? undefined : "2 3"}
            />
            <text
              x={PAD_L - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-ink-500 dark:fill-umber-300"
              fontSize="9"
            >
              {Math.round(frac * 100)}%
            </text>
          </g>
        );
      })}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          className="stroke-violet-600 dark:stroke-violet-300"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {pts.map((p, i) => {
        const x = xs[i];
        const y = ys[i];
        if (x === undefined || y === undefined) return null;
        const isMissing = p.value === null;
        return (
          <g key={p.label}>
            <circle
              cx={x}
              cy={y}
              r={3.5}
              className={
                isMissing
                  ? "fill-paper-300 dark:fill-umber-600"
                  : "fill-violet-600 dark:fill-violet-300"
              }
            >
              <title>
                {p.label} · {isMissing ? "—" : `${Math.round((p.value ?? 0) * 100)}%`}
              </title>
            </circle>
            <text
              x={x}
              y={H - 6}
              textAnchor="middle"
              className="fill-ink-500 dark:fill-umber-300"
              fontSize="10"
            >
              {p.label}
            </text>
            {!isMissing && (
              <text
                x={x}
                y={y - 8}
                textAnchor="middle"
                className="fill-ink-700 dark:fill-paper-100 stat-num"
                fontSize="10"
                fontWeight={600}
              >
                {Math.round((p.value ?? 0) * 100)}%
              </text>
            )}
          </g>
        );
      })}
      {/* locale is used implicitly via the formatNumber-free percent text;
       *  kept in the deps so retention re-renders pick it up if we ever
       *  swap in locale-specific number formatting. */}
      {locale === "hu" ? null : null}
    </svg>
  );
}

/** 7×24 weekday × hour heatmap. Cells are 14×14 px (matches the spec) and
 *  the opacity scales linearly with `value / max`. We render with a
 *  fixed-width SVG so the column alignment stays pixel-perfect even when
 *  the surrounding card squeezes the row. Tooltips ride <title> on each
 *  <rect> — same pattern the legacy chart uses, no JS hover bookkeeping. */
function TimeOfDayHeatmap({ matrix, max }: { matrix: number[][]; max: number }) {
  const { t } = useT();
  // Render even when the matrix is undersized — the backend SHOULD return
  // 7×24 but a defensive default beats a runtime crash if the contract
  // drifts.
  const CELL = 14;
  const GAP = 2;
  const ROW_LABEL_W = 32;
  const COL_LABEL_H = 14;
  const gridW = 24 * CELL + 23 * GAP;
  const gridH = 7 * CELL + 6 * GAP;
  const W = ROW_LABEL_W + gridW + 8;
  const H = COL_LABEL_H + gridH + 4;

  const dowShort = [
    t("admin.analytics_engagement_dow_mon"),
    t("admin.analytics_engagement_dow_tue"),
    t("admin.analytics_engagement_dow_wed"),
    t("admin.analytics_engagement_dow_thu"),
    t("admin.analytics_engagement_dow_fri"),
    t("admin.analytics_engagement_dow_sat"),
    t("admin.analytics_engagement_dow_sun"),
  ];
  const dowLong = [
    t("admin.analytics_engagement_dow_long_mon"),
    t("admin.analytics_engagement_dow_long_tue"),
    t("admin.analytics_engagement_dow_long_wed"),
    t("admin.analytics_engagement_dow_long_thu"),
    t("admin.analytics_engagement_dow_long_fri"),
    t("admin.analytics_engagement_dow_long_sat"),
    t("admin.analytics_engagement_dow_long_sun"),
  ];

  const isEmpty = max <= 0;
  return (
    <SubCard title={t("admin.analytics_engagement_heatmap")}>
      <p className="mb-3 text-xs text-ink-500 dark:text-umber-300">
        {t("admin.analytics_engagement_heatmap_sub")}
      </p>
      {isEmpty ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_heatmap_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="time of day heatmap"
          >
            <title>activity heatmap, weekday × hour</title>
            {/* Column labels — every 6 hours. */}
            {[0, 6, 12, 18].map((h) => (
              <text
                key={`col-${h}`}
                x={ROW_LABEL_W + h * (CELL + GAP) + CELL / 2}
                y={COL_LABEL_H - 4}
                textAnchor="middle"
                className="fill-ink-500 dark:fill-umber-300"
                fontSize="9"
              >
                {String(h).padStart(2, "0")}
              </text>
            ))}
            {/* Row labels + cells. */}
            {Array.from({ length: 7 }).map((_, dow) => {
              const row = matrix[dow] ?? [];
              const rowY = COL_LABEL_H + dow * (CELL + GAP);
              return (
                <g key={`row-${dow}`}>
                  <text
                    x={ROW_LABEL_W - 6}
                    y={rowY + CELL / 2 + 3}
                    textAnchor="end"
                    className="fill-ink-500 dark:fill-umber-300"
                    fontSize="9"
                  >
                    {dowShort[dow]}
                  </text>
                  {Array.from({ length: 24 }).map((__, hour) => {
                    const value = row[hour] ?? 0;
                    const opacity = max > 0 ? value / max : 0;
                    return (
                      <rect
                        key={`cell-${dow}-${hour}`}
                        x={ROW_LABEL_W + hour * (CELL + GAP)}
                        y={rowY}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        className="fill-violet-500"
                        // Floor opacity to a faint paper tint so the empty
                        // cells still register as "a grid", not a hole.
                        fillOpacity={opacity === 0 ? 0.06 : 0.18 + opacity * 0.82}
                      >
                        <title>
                          {t("admin.analytics_engagement_heatmap_tooltip", {
                            day: dowLong[dow] ?? "",
                            hour: String(hour).padStart(2, "0"),
                            count: value,
                          })}
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </SubCard>
  );
}

function TopFeaturesCard({
  features,
  locale,
}: {
  features: AdminEngagementAnalytics["top_features"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  // Slice to 8 max per spec; the backend caps at 8 too but a belt-and-
  // suspenders slice keeps the surface honest if that ever drifts.
  const rows = features.slice(0, 8);
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <SubCard title={t("admin.analytics_engagement_top_features")}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-umber-300">
          {t("admin.analytics_engagement_top_features_empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            return (
              <li key={row.feature} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink-800 dark:text-paper-100">
                    {row.feature}
                  </div>
                  <div className="text-[11px] text-ink-500 dark:text-umber-300">
                    {t("admin.analytics_engagement_users", { count: row.users })}
                  </div>
                </div>
                <div
                  className="relative h-2.5 w-full rounded-full bg-paper-200 dark:bg-umber-700"
                  role="img"
                  aria-label={`${row.feature} ${row.count}`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-700 dark:from-violet-400 dark:to-violet-600"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-ink-800 stat-num dark:text-paper-50">
                  {formatNumber(row.count, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SubCard>
  );
}

// ─── Shared primitives ─────────────────────────────────────────────────────

/** Minimalist SVG area chart for the 14-day signups trend. Inline SVG —
 *  no chart library — so the bundle stays lean and the look matches the
 *  rest of the dashboard's quiet aesthetic.
 *
 *  Polish pass (May 2026):
 *   - violet-400 → transparent linear gradient fill (vertical)
 *   - 1px stroke on top
 *   - x-axis tick labels for every 3rd day
 *   - mouse-tracking overlay that shows the closest day's count + date
 *
 *  We render with two coordinate systems: an SVG whose viewBox uses real
 *  pixel-equivalent units (so stroke widths and font sizes don't get
 *  distorted by preserveAspectRatio="none"), and a percentage-based
 *  overlay <div> that handles pointer events. Mixing the two means we get
 *  crisp visuals AND a hover that survives any container width. */
function SignupsAreaChart({
  points,
  max,
}: {
  points: Array<{ date: string; count: number }>;
  max: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Polymarket-style layout: room on the right for Y-axis labels, room at
  // the bottom for x-ticks, no horizontal padding so the line touches the
  // edges. viewBox stretches to container width via preserveAspectRatio
  // "none"; stroke widths stay crisp via vectorEffect="non-scaling-stroke"
  // and text sizes via dominant-baseline + a separate font-size attribute.
  const W = 560;
  const H = 200;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 22;
  const PAD_LEFT = 0;
  const PAD_RIGHT = 36; // room for the right-anchored y-axis labels
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  // Round the y-axis ceiling to a "nice" number so the gridline labels are
  // human-readable (1/2/5/10/20/...). Falls back to 1 when every day is 0.
  const niceMax = niceCeiling(Math.max(1, max));
  const scale = innerH / niceMax;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const baselineY = H - PAD_BOTTOM;
  const coords = points.map((p, i) => ({
    x: PAD_LEFT + i * stepX,
    y: baselineY - p.count * scale,
  }));

  // Straight polyline between data points — one row per day, so the
  // honest representation is segment-by-segment. Bezier smoothing was
  // creating spurious bulges between adjacent zero-count days.
  const path = coords
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const fillPath = `${path} L ${PAD_LEFT + innerW} ${baselineY} L ${PAD_LEFT} ${baselineY} Z`;

  const total = points.reduce((acc, p) => acc + p.count, 0);
  const ariaLabel = `14 day signup chart, total ${total}`;
  const gradientId = "signups-area-gradient";

  // Y-axis grid lines at 0%, 25%, 50%, 75%, 100% of niceMax — Polymarket's
  // signature dashed horizontal rules with right-anchored numeric labels.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((q) => ({
    y: baselineY - q * innerH,
    value: Math.round(q * niceMax),
  }));

  // X-axis tick selector — show first, last, and evenly-spaced interior
  // ticks, but suppress any interior tick that lands within 2 indices of
  // the last one (the source of "05-1805-19" collisions on dense strips).
  const lastIdx = coords.length - 1;
  const tickIndices = new Set<number>();
  tickIndices.add(0);
  if (lastIdx > 0) tickIndices.add(lastIdx);
  const interiorStep = Math.max(1, Math.round(coords.length / 4));
  for (let i = interiorStep; i < lastIdx; i += interiorStep) {
    if (lastIdx - i < 2) continue; // would collide with the right edge
    tickIndices.add(i);
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Account for the right-side padding when mapping clientX → data index;
    // the inner plot area is narrower than the rendered div.
    const innerRatio = (W - PAD_LEFT - PAD_RIGHT) / W;
    const ratio = ((e.clientX - rect.left) / Math.max(1, rect.width)) / innerRatio;
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const hoveredCoord = hoverIdx !== null ? coords[hoverIdx] : null;
  // Convert the hovered point's x back to CSS percent for the HTML tooltip.
  // We anchor against the rendered width (which includes the right pad),
  // so the tooltip sits over the data point, not its padded position.
  const hoveredLeftPct =
    hoverIdx !== null
      ? ((PAD_LEFT + hoverIdx * stepX) / W) * 100
      : 0;

  return (
    <div
      className="relative w-full"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-48 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              className="text-violet-500"
              stopColor="currentColor"
              stopOpacity={0.35}
            />
            <stop
              offset="100%"
              className="text-violet-500"
              stopColor="currentColor"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        {/* Y-axis dashed gridlines + right-anchored numeric labels. */}
        {yTicks.map((t) => (
          <g key={`yt-${t.value}`}>
            <line
              x1={PAD_LEFT}
              x2={PAD_LEFT + innerW}
              y1={t.y}
              y2={t.y}
              className="stroke-paper-200 dark:stroke-umber-700"
              strokeWidth={1}
              strokeDasharray={t.value === 0 ? undefined : "3 4"}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={W - 4}
              y={t.y + 3}
              textAnchor="end"
              className="fill-ink-400 dark:fill-umber-300 stat-num"
              fontSize="9"
            >
              {t.value}
            </text>
          </g>
        ))}
        <path d={fillPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={path}
          className="stroke-violet-600 dark:stroke-violet-300"
          strokeWidth={1.75}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* X-axis ticks — first, last, and evenly-spaced interior dates.
         *  Suppressed when an interior tick would collide with the
         *  right-edge label (within 2 indices of the last). */}
        {coords.map((p, i) => {
          if (!tickIndices.has(i)) return null;
          const point = points[i];
          if (!point) return null;
          const short = point.date.slice(5);
          return (
            <text
              key={`tick-${point.date}`}
              x={p.x}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
              className="fill-ink-400 dark:fill-umber-300 stat-num"
              fontSize="9"
            >
              {short}
            </text>
          );
        })}
        {hovered && hoveredCoord && (
          <g>
            <line
              x1={hoveredCoord.x}
              x2={hoveredCoord.x}
              y1={PAD_TOP - 4}
              y2={baselineY}
              className="stroke-violet-600/40 dark:stroke-violet-300/40"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r={3.5}
              className="fill-violet-600 dark:fill-violet-300"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r={6}
              className="fill-violet-600/20 dark:fill-violet-300/20"
            />
          </g>
        )}
      </svg>
      {hovered && hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-2 rounded-md border border-ink-100 bg-white px-2 py-1 text-[11px] font-medium text-ink-700 shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
          style={{ left: `${hoveredLeftPct}%` }}
        >
          <div className="stat-num">{hovered.date}</div>
          <div className="stat-num text-violet-600 dark:text-violet-300">{hovered.count}</div>
        </div>
      )}
    </div>
  );
}

/** Round `n` up to a "nice" Y-axis ceiling — one of 1, 2, 5 × 10^k. So a
 *  max of 7 becomes 10, a max of 23 becomes 25 (well, 50 actually — the
 *  1/2/5 series). Used so the gridline labels read as round numbers
 *  instead of "0 / 1.75 / 3.5 / 5.25 / 7". */
function niceCeiling(n: number): number {
  if (n <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / pow;
  if (norm <= 1) return pow;
  if (norm <= 2) return 2 * pow;
  if (norm <= 5) return 5 * pow;
  return 10 * pow;
}

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
