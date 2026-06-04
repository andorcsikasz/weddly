// Read-only admin analytics dashboard — May 2026 density + design overhaul.
//
// Five orthogonal rollups (money / activity / picks / engagement / demo)
// fetched in parallel on mount. The page chrome is a sticky header with a
// refresh button + section anchor pills; each section below is laid out as
// a KPI tile strip followed by a 2-column content grid so that — on a
// 1512-wide MBP — every section fits in one ~900px viewport without the
// admin needing to scroll within the section to read it.
//
// Backend contracts live in `shared/admin_analytics.ts`. Endpoints that
// 404 (engagement/demo on a partial deploy) degrade to a single-line
// fallback card rather than dragging the whole page into the error state.

import type {
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminDemoAnalytics,
  AdminEngagementAnalytics,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
  AdminTrafficAnalytics,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, type PillTone } from "../components/admin";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminAnalyticsApi } from "../lib/endpoints";
import { formatHuf, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

// ─── Shared chrome tokens ──────────────────────────────────────────────────
// CARD_CHROME / TILE_CHROME / SECTION_TITLE / KPI_LABEL constants were
// retired in the May 2026 design pass — the chrome lives in
// `.admin-card` / `.admin-tile` and uppercase labels go through
// `.eyebrow`. Only CARD_TITLE survives because its shape (sm + semibold
// + non-uppercase neutral-900) doesn't fit either utility.
const CARD_TITLE = "text-sm font-semibold text-neutral-900 dark:text-paper-50";

// ─── Section anchor list (used by the sticky pills + scroll spy) ──────────

type SectionId = "money" | "activity" | "traffic" | "picks" | "engagement" | "demo";

interface SectionDef {
  id: SectionId;
  labelKey: string;
}

const SECTIONS: ReadonlyArray<SectionDef> = [
  { id: "money", labelKey: "admin.analytics_nav_money" },
  { id: "activity", labelKey: "admin.analytics_nav_activity" },
  { id: "traffic", labelKey: "admin.analytics_nav_traffic" },
  { id: "picks", labelKey: "admin.analytics_nav_picks" },
  { id: "engagement", labelKey: "admin.analytics_nav_engagement" },
  { id: "demo", labelKey: "admin.analytics_nav_demo" },
];

export default function AdminAnalyticsPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.admin_analytics_title", "seo.admin_analytics_description");
  const toast = useToast();

  const [money, setMoney] = useState<Loadable<AdminMoneyAnalytics>>({ status: "loading" });
  const [activity, setActivity] = useState<Loadable<AdminActivityAnalytics>>({ status: "loading" });
  const [picks, setPicks] = useState<Loadable<AdminPicksAnalytics>>({ status: "loading" });
  const [engagement, setEngagement] = useState<Loadable<AdminEngagementAnalytics>>({
    status: "loading",
  });
  const [demo, setDemo] = useState<Loadable<AdminDemoAnalytics>>({ status: "loading" });
  const [traffic, setTraffic] = useState<Loadable<AdminTrafficAnalytics>>({ status: "loading" });

  // `nonce` lets the refresh button re-run the effect without remounting the
  // whole tree — bumping it triggers a re-fetch and resets the five slots
  // to loading so the skeletons come back.
  const [nonce, setNonce] = useState(0);
  // The wall-clock timestamp of the most recent successful (or partially
  // successful) load — rendered as "Loaded 14:23" in the sticky header so
  // the admin knows how fresh the numbers are after a refresh.
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const isRefreshing =
    money.status === "loading" ||
    activity.status === "loading" ||
    picks.status === "loading" ||
    engagement.status === "loading" ||
    demo.status === "loading" ||
    traffic.status === "loading";

  const loadAll = useCallback(() => {
    setMoney({ status: "loading" });
    setActivity({ status: "loading" });
    setPicks({ status: "loading" });
    setEngagement({ status: "loading" });
    setDemo({ status: "loading" });
    setTraffic({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let anyError = false;
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
        setLastLoadedAt(Date.now());
      })
      .catch((e) => {
        if (cancelled) return;
        if (!anyError) anyError = true;
        toast.error(e instanceof ApiError ? e.message : t("admin.analytics_load_error"));
      });

    adminAnalyticsApi
      .engagement()
      .then((e) => {
        if (!cancelled) {
          setEngagement({ status: "ok", data: e });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setEngagement({ status: "error" });
      });

    adminAnalyticsApi
      .demo()
      .then((d) => {
        if (!cancelled) {
          setDemo({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setDemo({ status: "error" });
      });

    adminAnalyticsApi
      .traffic()
      .then((d) => {
        if (!cancelled) {
          setTraffic({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setTraffic({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [nonce, toast, t]);

  const hasAnyError =
    money.status === "error" || activity.status === "error" || picks.status === "error";

  return (
    <>
      <PageHeader
        lastLoadedAt={lastLoadedAt}
        onRefresh={loadAll}
        refreshing={isRefreshing}
        hasError={hasAnyError}
        locale={locale}
      />

      <div className="flex flex-col gap-6">
        <SectionAnchor id="money">
          <MoneySection state={money} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="activity">
          <ActivitySection state={activity} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="traffic">
          <TrafficSection state={traffic} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="picks">
          <PicksSection state={picks} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="engagement">
          <EngagementSection state={engagement} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="demo">
          <DemoSection state={demo} locale={locale} />
        </SectionAnchor>
      </div>
    </>
  );
}

/** Section wrapper that adds a stable id + scroll-margin so the sticky-header
 *  anchor pills jump to the right spot without the header overlapping the
 *  KPI strip. `scroll-margin-top` accounts for the AppShell sticky header
 *  (~56px) + the page's sticky pill row (~64px). */
function SectionAnchor({ id, children }: { id: SectionId; children: React.ReactNode }) {
  return (
    <div id={`analytics-${id}`} data-analytics-section={id} className="scroll-mt-32">
      {children}
    </div>
  );
}

// ─── Page header (title + last loaded + refresh + section pills) ──────────

function PageHeader({
  lastLoadedAt,
  onRefresh,
  refreshing,
  hasError,
  locale,
}: {
  lastLoadedAt: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  hasError: boolean;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const [activeId, setActiveId] = useState<SectionId>("money");

  // Scroll spy: pick the section whose anchor is closest to the top of the
  // viewport (just below the sticky header). IntersectionObserver fires on
  // any threshold crossing; we re-scan the candidates each time and choose
  // the topmost intersecting one. Falls back to the first section.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const els = SECTIONS.map(
      (s) => document.querySelector(`[data-analytics-section="${s.id}"]`) as HTMLElement | null,
    ).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const pickActive = () => {
      // 140px = AppShell sticky header (~56) + this page's pill row (~84).
      // Find the section whose top edge is just above this threshold.
      const probeY = 140;
      let chosen: SectionId = "money";
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        const id = el.getAttribute("data-analytics-section") as SectionId | null;
        if (!id) continue;
        if (rect.top - probeY <= 0) {
          chosen = id;
        }
      }
      setActiveId(chosen);
    };
    pickActive();
    window.addEventListener("scroll", pickActive, { passive: true });
    window.addEventListener("resize", pickActive);
    return () => {
      window.removeEventListener("scroll", pickActive);
      window.removeEventListener("resize", pickActive);
    };
  }, []);

  const lastLoadedLabel = useMemo(() => {
    if (lastLoadedAt == null) return null;
    const d = new Date(lastLoadedAt);
    const time = d.toLocaleTimeString(locale === "hu" ? "hu-HU" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return t("admin.analytics_last_loaded", { time });
  }, [lastLoadedAt, locale, t]);

  const scrollTo = useCallback((id: SectionId) => {
    const el = document.getElementById(`analytics-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <header className="sticky top-14 z-10 -mx-4 mb-6 border-b border-paper-200 bg-paper-100/85 px-4 pb-2.5 pt-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10 dark:border-umber-700 dark:bg-umber-900/85">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-0 shrink-0 text-lg font-semibold tracking-tight text-neutral-900 dark:text-paper-50">
          {t("admin.analytics_title")}
        </h1>
        {/* Subtitle is structurally present for screen readers but hidden
         *  visually — the page chrome's job is navigation, not exposition. */}
        <p className="sr-only">{t("admin.analytics_sub")}</p>

        {/* Below sm: collapse the section pills to a native select so the
         *  header stays single-row. The same scrollTo() handler runs on
         *  change. */}
        <label className="flex shrink-0 items-center sm:hidden">
          <span className="sr-only">{t("admin.analytics_jump_to_section")}</span>
          <select
            value={activeId}
            onChange={(ev) => scrollTo(ev.target.value as SectionId)}
            aria-label={t("admin.analytics_jump_to_section")}
            className="btn-lifted rounded-lg bg-paper-50 px-2 py-1 text-xs font-medium text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 dark:bg-umber-800 dark:text-paper-100"
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <nav
          aria-label={t("admin.analytics_title")}
          className="hidden flex-wrap items-center gap-1.5 sm:flex"
        >
          {SECTIONS.map((s) => {
            const active = activeId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                aria-current={active ? "true" : undefined}
                className={
                  "btn-lifted rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 " +
                  (active
                    ? "is-pressed bg-neutral-600 text-white dark:bg-neutral-500"
                    : "bg-paper-200/70 text-neutral-700 hover:bg-paper-300/80 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700")
                }
              >
                {t(s.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {lastLoadedLabel && (
            <span className="hidden text-xs text-neutral-500 dark:text-umber-300 sm:inline">
              {lastLoadedLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={t("admin.analytics_refresh")}
            className="btn-lifted inline-flex items-center gap-1.5 rounded-lg bg-paper-50 px-3 py-1.5 text-xs font-medium text-neutral-800 transition-colors duration-150 hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <RefreshIcon spinning={refreshing} />
            <span>{hasError ? t("admin.analytics_retry") : t("admin.analytics_refresh")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ─── Generic primitives ────────────────────────────────────────────────────

/** Section card — the outer container for one of the five rollups. Holds
 *  the section title + an optional subtitle on a single row. */
function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-card !p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow m-0">{title}</h2>
        {subtitle && (
          <span className="text-xs text-neutral-500 dark:text-umber-300">{subtitle}</span>
        )}
      </header>
      {children}
    </section>
  );
}

/** Compact KPI tile — centred eyebrow label over a big centred value, with an
 *  optional sub-line. A shared min-height plus flex centring keeps every tile
 *  in a row on the same baseline whether or not it has a sub-line. Used in the
 *  KPI strip at the top of every section. */
function KpiTile({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  /** When true, swap the neutral-tinted "primary" treatment in. Used for the
   *  signature KPI in a strip (e.g. avg session minutes, total picks). */
  emphasis?: boolean;
}) {
  const containerCls = emphasis
    ? "rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200 dark:bg-neutral-500/10 dark:ring-neutral-500/30"
    : "admin-tile";
  return (
    <div
      className={`${containerCls} flex min-h-[5.5rem] flex-col items-center justify-center text-center`}
    >
      <div className="eyebrow">{label}</div>
      <div className="stat-num stat-num-centered mt-1 text-2xl font-semibold text-neutral-900 dark:text-paper-50">
        {value}
      </div>
      {sub && (
        <div className="stat-num stat-num-centered mt-0.5 text-xs text-neutral-500 dark:text-umber-300">
          {sub}
        </div>
      )}
    </div>
  );
}

/** Inner card used inside the 2-col grid of each section. Smaller padding +
 *  same rounded-2xl ring chrome as the global tokens. */
function InnerCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`admin-card${className ? ` ${className}` : ""}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className={`m-0 ${CARD_TITLE}`}>{title}</h3>
        {subtitle && (
          <span className="text-xs text-neutral-500 dark:text-umber-300">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function SectionStatus({
  title,
  variant,
  message,
}: {
  title: string;
  variant: "loading" | "error";
  message?: string;
}) {
  return (
    <SectionCard title={title}>
      {variant === "loading" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={72} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-umber-300">{message}</p>
      )}
    </SectionCard>
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
  const title = t("admin.analytics_section_money");

  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const m = state.data;
  const hasMoneyData = m.couples_with_budget > 0;
  const histogramMax = Math.max(0, ...m.budget_histogram.map((b) => b.count));

  return (
    <SectionCard title={title}>
      {!hasMoneyData ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_money_empty")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiTile
              label={t("admin.analytics_money_couples_with_budget_short")}
              value={formatNumber(m.couples_with_budget, locale)}
            />
            <KpiTile
              label={t("admin.analytics_money_couples_with_actuals_short")}
              value={formatNumber(m.couples_with_actuals, locale)}
            />
            <KpiTile
              label={t("admin.analytics_money_avg_planned")}
              value={formatHuf(m.planned_huf.avg, locale)}
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_money_avg_actual")}
              value={formatHuf(m.actual_huf.avg, locale)}
            />
            <KpiTile
              label={t("admin.analytics_money_median_ceiling")}
              value={formatHuf(m.budget_ceiling_huf.median, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <InnerCard title={t("admin.analytics_money_histogram_title")}>
              {m.budget_histogram.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_money_histogram_empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {m.budget_histogram.map((b) => (
                    <li
                      key={b.bucket_max_huf}
                      className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2"
                    >
                      <span
                        className={`text-left text-xs text-neutral-600 dark:text-umber-200 ${
                          b.bucket_max_huf === 0 ? "" : "stat-num"
                        }`}
                      >
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
                      <span className="stat-num text-right text-xs font-medium text-neutral-700 dark:text-paper-100">
                        {formatNumber(b.count, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </InnerCard>

            <InnerCard title={t("admin.analytics_money_per_category_title")}>
              <PerCategoryTable rows={m.per_category} locale={locale} />
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
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
  const sorted = useMemo(() => [...rows].sort((a, b) => b.avg_planned - a.avg_planned), [rows]);
  if (sorted.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_money_per_category_empty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow text-left">
            <th className="py-1 pr-2">{t("admin.analytics_money_col_category")}</th>
            <th className="py-1 pl-2 text-right">{t("admin.analytics_money_col_avg_planned")}</th>
            <th className="py-1 pl-2 text-right">{t("admin.analytics_money_col_avg_actual")}</th>
            <th className="py-1 pl-2 text-right">
              {t("admin.analytics_money_col_couples_with_data")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.category} className="border-t border-paper-200 dark:border-umber-700">
              <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                {t(`budget.cat.${row.category}` as `budget.cat.${BudgetCategory}`)}
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                {formatHuf(row.avg_planned, locale)}
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                {formatHuf(row.avg_actual, locale)}
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
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
  const title = t("admin.analytics_section_activity");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const a = state.data;
  const dailyMax = Math.max(0, ...a.signups_daily.map((d) => d.count));
  const funnel = a.onboarding_funnel;
  const funnelMax = Math.max(1, funnel.registered);
  const pctVerified = Math.round((funnel.pct_verified ?? 0) * 100);
  const statusKeys: CoupleStatus[] = ["active", "paused", "deleting", "archived"];

  return (
    <SectionCard title={title}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_activity_signups_24h")}
          value={formatNumber(a.signups.last_24h, locale)}
        />
        <KpiTile
          label={t("admin.analytics_activity_signups_7d")}
          value={formatNumber(a.signups.last_7d, locale)}
          sub={t("admin.analytics_activity_signups_sub", {
            total: formatNumber(a.signups.total, locale),
          })}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_activity_signups_30d")}
          value={formatNumber(a.signups.last_30d, locale)}
        />
        <KpiTile
          label={t("admin.analytics_activity_active_users_24h")}
          value={formatNumber(a.active_users.last_24h, locale)}
          sub={t("admin.analytics_activity_active_users_sub", {
            n: formatNumber(a.active_users.last_7d, locale),
          })}
        />
        <KpiTile
          label={t("admin.analytics_activity_verified_pct")}
          value={`${pctVerified}%`}
          sub={t("admin.analytics_activity_pct_onboarded_sub", {
            onboarded: formatNumber(funnel.onboarded, locale),
            registered: formatNumber(funnel.registered, locale),
          })}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InnerCard
          title={t("admin.analytics_activity_signups_daily_title")}
          subtitle={t("admin.analytics_activity_signups_daily_sub")}
        >
          {a.signups_daily.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_activity_signups_empty")}
            </p>
          ) : (
            <>
              <SignupsAreaChart points={a.signups_daily} max={dailyMax} />
              <div className="mt-1 flex justify-between text-[10px] text-neutral-500 dark:text-umber-300">
                <span>{a.signups_daily[0]?.date ?? ""}</span>
                <span>{a.signups_daily[a.signups_daily.length - 1]?.date ?? ""}</span>
              </div>
            </>
          )}
        </InnerCard>

        <div className="flex flex-col gap-3">
          <InnerCard title={t("admin.analytics_activity_funnel_title")}>
            <div className="flex flex-col gap-1.5">
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
          </InnerCard>

          <InnerCard title={t("admin.analytics_activity_status_title")}>
            <div className="flex flex-wrap gap-1.5">
              {statusKeys.map((s) => (
                <Pill key={s} tone={STATUS_TONE[s]}>
                  <span>
                    {t(
                      `admin.analytics_activity_status_${s}` as `admin.analytics_activity_status_${CoupleStatus}`,
                    )}
                  </span>
                  <span className="stat-num">
                    {formatNumber(a.couples_by_status[s] ?? 0, locale)}
                  </span>
                </Pill>
              ))}
            </div>
          </InnerCard>
        </div>
      </div>
      {/* `top_actions` chip row removed — raw audit-log action names with
       *  counts were developer-log debris, not an admin signal. The
       *  Engagement section's `top_features` rollup covers the same idea
       *  with cleaner aggregation. */}
    </SectionCard>
  );
}

const STATUS_TONE: Record<CoupleStatus, PillTone> = {
  active: "sage",
  paused: "violet",
  deleting: "blush",
  archived: "paper",
};

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
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
      <span className="text-left text-xs text-neutral-700 dark:text-paper-100">{label}</span>
      <HBar pct={clamped} ariaLabel={`${count}`} />
      <span className="stat-num text-right text-xs font-medium text-neutral-700 dark:text-paper-100">
        {formatNumber(count, locale)} · {clamped}%
      </span>
    </div>
  );
}

// ─── Traffic section (Google Analytics 4) ──────────────────────────────────

function TrafficSection({
  state,
  locale,
}: {
  state: Loadable<AdminTrafficAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const title = t("admin.analytics_section_traffic");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus
        title={title}
        variant="error"
        message={t("admin.analytics_traffic_load_error")}
      />
    );

  const d = state.data;

  // GA4 not wired up yet — show the one-card setup hint instead of zeros.
  if (!d.configured) {
    return (
      <SectionCard title={title}>
        <div className="rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-200 dark:bg-neutral-500/10 dark:ring-neutral-500/30">
          <h3 className={`m-0 mb-1 ${CARD_TITLE}`}>{t("admin.analytics_traffic_setup_title")}</h3>
          <p className="m-0 text-sm text-neutral-600 dark:text-paper-200">
            {t("admin.analytics_traffic_setup_body")}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-neutral-700 dark:text-paper-100">
            <li className="stat-num">GA4_PROPERTY_ID</li>
            <li className="stat-num">GA4_SERVICE_ACCOUNT_JSON</li>
          </ul>
        </div>
      </SectionCard>
    );
  }

  // Configured, but the GA4 Data API rejected the call — show the actual cause
  // (admin-only surface) plus the usual culprits so the operator can self-fix.
  if (d.error) {
    return (
      <SectionCard title={title}>
        <div className="rounded-xl bg-blush-50 p-4 ring-1 ring-blush-200 dark:bg-blush-500/10 dark:ring-blush-500/30">
          <h3 className={`m-0 mb-1 ${CARD_TITLE}`}>
            {t("admin.analytics_traffic_api_error_title")}
          </h3>
          <p className="m-0 break-words font-mono text-xs text-neutral-700 dark:text-paper-100">
            {d.error}
          </p>
          <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-paper-200">
            {t("admin.analytics_traffic_api_error_hint")}
          </p>
        </div>
      </SectionCard>
    );
  }

  const t7 = d.totals_7d;
  const t28 = d.totals_28d;
  const dailyMax = Math.max(0, ...d.active_users_daily.map((p) => p.count));
  const hasTraffic = t28.active_users > 0 || t7.active_users > 0;
  const generatedLabel = new Date(d.generated_at).toLocaleTimeString(
    locale === "hu" ? "hu-HU" : "en-GB",
    { hour: "2-digit", minute: "2-digit" },
  );
  const subtitle = t("admin.analytics_traffic_source", {
    property: d.property_id,
    time: generatedLabel,
  });

  if (!hasTraffic) {
    return (
      <SectionCard title={title} subtitle={subtitle}>
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_traffic_empty")}
        </p>
      </SectionCard>
    );
  }

  const channelMax = Math.max(0, ...d.channels.map((c) => c.sessions));
  const countryMax = Math.max(0, ...d.countries.map((c) => c.users));

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_traffic_active_users")}
          value={formatNumber(t7.active_users, locale)}
          sub={t("admin.analytics_traffic_28d_sub", {
            n: formatNumber(t28.active_users, locale),
          })}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_traffic_sessions")}
          value={formatNumber(t7.sessions, locale)}
          sub={t("admin.analytics_traffic_28d_sub", { n: formatNumber(t28.sessions, locale) })}
        />
        <KpiTile
          label={t("admin.analytics_traffic_page_views")}
          value={formatNumber(t7.page_views, locale)}
          sub={t("admin.analytics_traffic_28d_sub", { n: formatNumber(t28.page_views, locale) })}
        />
        <KpiTile
          label={t("admin.analytics_traffic_engagement_rate")}
          value={`${Math.round(t7.engagement_rate * 100)}%`}
        />
        <KpiTile
          label={t("admin.analytics_traffic_avg_session")}
          value={formatLifetime(t7.avg_session_seconds, locale)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <InnerCard
          title={t("admin.analytics_traffic_daily_title")}
          subtitle={t("admin.analytics_traffic_daily_sub")}
        >
          {d.active_users_daily.length === 0 || dailyMax === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_traffic_empty")}
            </p>
          ) : (
            <>
              <SignupsAreaChart points={d.active_users_daily} max={dailyMax} />
              <div className="mt-1 flex justify-between text-[10px] text-neutral-500 dark:text-umber-300">
                <span>{d.active_users_daily[0]?.date ?? ""}</span>
                <span>{d.active_users_daily[d.active_users_daily.length - 1]?.date ?? ""}</span>
              </div>
            </>
          )}
        </InnerCard>

        <div className="flex flex-col gap-3">
          <InnerCard title={t("admin.analytics_traffic_channels_title")}>
            {d.channels.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_traffic_channels_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {d.channels.slice(0, 6).map((c) => (
                  <li
                    key={c.channel}
                    className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                  >
                    <span className="truncate text-left text-neutral-700 dark:text-paper-100">
                      {c.channel}
                    </span>
                    <HBar
                      pct={channelMax > 0 ? (c.sessions / channelMax) * 100 : 0}
                      ariaLabel={`${c.sessions}`}
                    />
                    <span className="stat-num text-right font-medium text-neutral-700 dark:text-paper-100">
                      {formatNumber(c.sessions, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </InnerCard>

          <InnerCard title={t("admin.analytics_traffic_countries_title")}>
            {d.countries.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_traffic_countries_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {d.countries.slice(0, 6).map((c) => (
                  <li
                    key={c.country}
                    className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                  >
                    <span className="truncate text-left text-neutral-700 dark:text-paper-100">
                      {c.country}
                    </span>
                    <HBar
                      pct={countryMax > 0 ? (c.users / countryMax) * 100 : 0}
                      ariaLabel={`${c.users}`}
                    />
                    <span className="stat-num text-right font-medium text-neutral-700 dark:text-paper-100">
                      {formatNumber(c.users, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </InnerCard>
        </div>
      </div>

      <div className="mt-3">
        <InnerCard title={t("admin.analytics_traffic_top_pages_title")}>
          {d.top_pages.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_traffic_top_pages_empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-1 pr-2">{t("admin.analytics_traffic_col_page")}</th>
                    <th className="py-1 pl-2 text-right">
                      {t("admin.analytics_traffic_col_views")}
                    </th>
                    <th className="py-1 pl-2 text-right">
                      {t("admin.analytics_traffic_col_visitors")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.top_pages.slice(0, 10).map((row) => (
                    <tr key={row.path} className="border-t border-paper-200 dark:border-umber-700">
                      <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                        <span className="block truncate">{row.path}</span>
                      </td>
                      <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                        {formatNumber(row.views, locale)}
                      </td>
                      <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                        {formatNumber(row.users, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </InnerCard>
      </div>
    </SectionCard>
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
  const title = t("admin.analytics_section_picks");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const p = state.data;
  const ppc = p.picks_per_couple;
  const hasPicks = p.total_picks > 0;
  const sourceTotal =
    p.source_breakdown.curated + p.source_breakdown.community + p.source_breakdown.diy;

  const coverageSorted = useMemo(
    () => [...p.category_coverage].sort((a, b) => b.coverage_pct - a.coverage_pct),
    [p.category_coverage],
  );

  return (
    <SectionCard title={title}>
      {!hasPicks ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_picks_empty")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label={t("admin.analytics_picks_total")}
              value={formatNumber(p.total_picks, locale)}
              sub={t("admin.analytics_picks_total_sub", {
                avg: formatNumber(ppc.avg, locale),
              })}
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_picks_per_couple_avg")}
              value={formatNumber(ppc.avg, locale)}
              sub={t("admin.analytics_picks_median_sub", {
                p25: formatNumber(ppc.p25, locale),
                p75: formatNumber(ppc.p75, locale),
              })}
            />
            <KpiTile
              label={t("admin.analytics_picks_median_per_couple")}
              value={formatNumber(ppc.median, locale)}
            />
            <KpiTile
              label={t("admin.analytics_picks_sources_mix")}
              value={`${formatNumber(p.source_breakdown.curated, locale)} · ${formatNumber(p.source_breakdown.community, locale)} · ${formatNumber(p.source_breakdown.diy, locale)}`}
              sub={`${t("admin.analytics_source_curated")} · ${t("admin.analytics_source_community")} · ${t("admin.analytics_source_diy")}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
            <InnerCard title={t("admin.analytics_picks_top_title")}>
              {p.top_picks.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_picks_top_empty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="eyebrow text-left">
                        <th className="py-1 pr-2">{t("admin.analytics_picks_col_supplier")}</th>
                        <th className="py-1 px-2">{t("admin.analytics_picks_col_category")}</th>
                        <th className="py-1 px-2">{t("admin.analytics_picks_col_source")}</th>
                        <th className="py-1 pl-2 text-right">
                          {t("admin.analytics_picks_col_pick_count")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.top_picks.slice(0, 10).map((row) => (
                        <tr
                          key={row.supplier_id}
                          className="border-t border-paper-200 dark:border-umber-700"
                        >
                          <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                            <span className="block truncate">{row.display_name}</span>
                          </td>
                          <td className="py-1 px-2 text-left text-xs text-neutral-700 dark:text-paper-100">
                            {t(
                              `suppliers.cat.${row.category}` as `suppliers.cat.${SupplierCategory}`,
                            )}
                          </td>
                          <td className="py-1 px-2 text-left">
                            <SourceBadge source={row.source} />
                          </td>
                          <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                            {formatNumber(row.pick_count, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </InnerCard>

            <InnerCard title={t("admin.analytics_picks_coverage_title")}>
              {coverageSorted.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_picks_coverage_empty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="eyebrow text-left">
                        <th className="py-1 pr-2">{t("admin.analytics_picks_col_category")}</th>
                        <th className="py-1 px-2 text-right">
                          {t("admin.analytics_picks_col_picked")}
                        </th>
                        <th className="py-1 pl-2 text-right">
                          {t("admin.analytics_picks_col_coverage_pct")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageSorted.slice(0, 11).map((row) => {
                        const pct = Math.max(0, Math.min(100, Math.round(row.coverage_pct * 100)));
                        return (
                          <tr
                            key={row.category}
                            className="border-t border-paper-200 dark:border-umber-700"
                          >
                            <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                              {t(
                                `suppliers.cat.${row.category}` as `suppliers.cat.${SupplierCategory}`,
                              )}
                            </td>
                            <td className="stat-num py-1 px-2 text-right text-neutral-700 dark:text-paper-100">
                              {formatNumber(row.picked, locale)}
                            </td>
                            <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                              {pct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {sourceTotal > 0 && (
                <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-700">
                  <div className="eyebrow mb-1.5">
                    {t("admin.analytics_picks_source_breakdown_title")}
                  </div>
                  <SourceMiniBar
                    curated={p.source_breakdown.curated}
                    community={p.source_breakdown.community}
                    diy={p.source_breakdown.diy}
                    total={sourceTotal}
                    locale={locale}
                  />
                </div>
              )}
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function SourceBadge({ source }: { source: "curated" | "community" | "diy" }) {
  const { t } = useT();
  const tone: PillTone =
    source === "curated" ? "violet" : source === "community" ? "sage" : "blush";
  const label =
    source === "curated"
      ? t("admin.analytics_source_curated")
      : source === "community"
        ? t("admin.analytics_source_community")
        : t("admin.analytics_source_diy");
  return <Pill tone={tone}>{label}</Pill>;
}

/** Compact 3-segment horizontal bar — replaces the donut chart from the
 *  previous design. Saves vertical space (~120px) so the picks section fits
 *  one MBP viewport without scrolling. */
function SourceMiniBar({
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
  const safeTotal = total > 0 ? total : 1;
  const cPct = (curated / safeTotal) * 100;
  const cmPct = (community / safeTotal) * 100;
  const dPct = (diy / safeTotal) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
        role="img"
        aria-label={`curated ${curated}, community ${community}, diy ${diy}`}
      >
        {curated > 0 && (
          <div
            className="bg-neutral-600 dark:bg-neutral-500"
            style={{ width: `${cPct}%` }}
            title={`${t("admin.analytics_source_curated")} · ${formatNumber(curated, locale)}`}
          />
        )}
        {community > 0 && (
          <div
            className="bg-sage-500 dark:bg-sage-400"
            style={{ width: `${cmPct}%` }}
            title={`${t("admin.analytics_source_community")} · ${formatNumber(community, locale)}`}
          />
        )}
        {diy > 0 && (
          <div
            className="bg-blush-500 dark:bg-blush-400"
            style={{ width: `${dPct}%` }}
            title={`${t("admin.analytics_source_diy")} · ${formatNumber(diy, locale)}`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-700 dark:text-paper-100">
        <LegendDot
          colourClass="bg-neutral-600 dark:bg-neutral-500"
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
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${colourClass}`} />
      <span>{label}</span>
      <span className="stat-num text-neutral-500 dark:text-umber-300">{value}</span>
    </span>
  );
}

// ─── Engagement section ────────────────────────────────────────────────────

function EngagementSection({
  state,
  locale,
}: {
  state: Loadable<AdminEngagementAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const title = t("admin.analytics_engagement_title");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus
        title={title}
        variant="error"
        message={t("admin.analytics_engagement_load_error")}
      />
    );

  const e = state.data;
  const topFeature = e.top_features[0];
  const d7Pct =
    e.retention.d7 === null ? null : Math.max(0, Math.min(100, Math.round(e.retention.d7 * 100)));

  return (
    <SectionCard title={title} subtitle={t("admin.analytics_engagement_sub")}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_engagement_session_avg_short")}
          value={formatNumber(e.session_duration_minutes.avg, locale)}
          sub={t("admin.analytics_engagement_session_median", {
            value: formatNumber(e.session_duration_minutes.median, locale),
          })}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_engagement_sessions_total_short")}
          value={formatNumber(e.total_sessions, locale)}
        />
        <KpiTile
          label={t("admin.analytics_engagement_active_users_30d")}
          value={formatNumber(e.active_users_30d, locale)}
        />
        <KpiTile
          label={t("admin.analytics_engagement_d7_retention")}
          value={d7Pct === null ? "—" : `${d7Pct}%`}
          sub={t("admin.analytics_engagement_retention_cohort", {
            n: formatNumber(e.retention.cohort_size, locale),
          })}
        />
        <KpiTile
          label={t("admin.analytics_engagement_top_feature_kpi")}
          value={topFeature ? topFeature.feature : t("admin.analytics_engagement_top_feature_none")}
          sub={
            topFeature
              ? `${formatNumber(topFeature.count, locale)} · ${t("admin.analytics_engagement_users", { count: topFeature.users })}`
              : ""
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
        <InnerCard
          title={t("admin.analytics_engagement_heatmap")}
          subtitle={t("admin.analytics_engagement_heatmap_sub")}
        >
          <TimeOfDayHeatmap matrix={e.time_of_day.matrix} max={e.time_of_day.max} />
        </InnerCard>

        <div className="flex flex-col gap-3">
          <InnerCard title={t("admin.analytics_engagement_top_features")}>
            <TopFeaturesList features={e.top_features} locale={locale} />
          </InnerCard>
          <InnerCard title={t("admin.analytics_engagement_top_users")}>
            <TopUsersList users={e.top_users} locale={locale} />
          </InnerCard>
        </div>
      </div>
    </SectionCard>
  );
}

function TimeOfDayHeatmap({ matrix, max }: { matrix: number[][]; max: number }) {
  const { t } = useT();
  const CELL = 14;
  const GAP = 2;
  const ROW_LABEL_W = 28;
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

  if (max <= 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_engagement_heatmap_empty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="time of day heatmap"
      >
        <title>activity heatmap, weekday × hour</title>
        {[0, 6, 12, 18].map((h) => (
          <text
            key={`col-${h}`}
            x={ROW_LABEL_W + h * (CELL + GAP) + CELL / 2}
            y={COL_LABEL_H - 4}
            textAnchor="middle"
            className="fill-neutral-500 dark:fill-umber-300"
            fontSize="9"
          >
            {String(h).padStart(2, "0")}
          </text>
        ))}
        {Array.from({ length: 7 }).map((_, dow) => {
          const row = matrix[dow] ?? [];
          const rowY = COL_LABEL_H + dow * (CELL + GAP);
          return (
            <g key={`row-${dow}`}>
              <text
                x={ROW_LABEL_W - 6}
                y={rowY + CELL / 2 + 3}
                textAnchor="end"
                className="fill-neutral-500 dark:fill-umber-300"
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
                    className="fill-neutral-500"
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
  );
}

function TopFeaturesList({
  features,
  locale,
}: {
  features: AdminEngagementAnalytics["top_features"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const rows = features.slice(0, 5);
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_engagement_top_features_empty")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
        return (
          <li
            key={row.feature}
            className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate text-left font-medium text-neutral-800 dark:text-paper-100">
                {row.feature}
              </div>
              <div className="text-[10px] text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_engagement_users", { count: row.users })}
              </div>
            </div>
            <div className="relative h-2 w-full rounded-full bg-paper-200 dark:bg-umber-700">
              <div
                className="h-full rounded-full bg-neutral-600 dark:bg-neutral-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="stat-num text-right font-semibold text-neutral-800 dark:text-paper-50">
              {formatNumber(row.count, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TopUsersList({
  users,
  locale,
}: {
  users: AdminEngagementAnalytics["top_users"];
  locale: "hu" | "en";
}) {
  const { t } = useT();
  if (users.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_engagement_top_users_empty")}
      </p>
    );
  }
  const max = Math.max(1, ...users.map((u) => u.event_count));
  return (
    <ul className="flex flex-col gap-1">
      {users.slice(0, 5).map((u, i) => {
        const pct = (u.event_count / max) * 100;
        return (
          <li
            key={u.user_id}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_3rem] items-center gap-2 text-xs"
          >
            <span className="stat-num text-neutral-400 dark:text-umber-300">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-neutral-900 dark:text-paper-50">
                {u.full_name}
              </div>
              <div className="truncate text-[10px] text-neutral-500 dark:text-umber-300">
                {formatRelative(u.last_seen_at, locale, t)}
              </div>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
              <div
                className="h-full rounded-full bg-neutral-600 dark:bg-neutral-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="stat-num text-right font-semibold text-neutral-800 dark:text-paper-50">
              {formatNumber(u.event_count, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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

function DemoSection({
  state,
  locale,
}: {
  state: Loadable<AdminDemoAnalytics>;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const title = t("admin.analytics_demo_title");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_demo_load_error")} />
    );

  const d = state.data;
  const dailyMax = Math.max(0, ...d.demos_daily.map((p) => p.count));
  const hasDemos = d.total_demos_served > 0 || d.total_demos > 0;
  const topFeatureMax = Math.max(0, ...d.top_features.map((f) => f.count));

  return (
    <SectionCard title={title} subtitle={t("admin.analytics_demo_sub")}>
      {!hasDemos ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_demo_empty")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiTile
              label={t("admin.analytics_demo_kpi_total")}
              value={formatNumber(d.total_demos, locale)}
              sub={
                t("admin.analytics_demo_kpi_served") +
                ` ${formatNumber(d.total_demos_served, locale)}`
              }
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_demo_new_24h")}
              value={formatNumber(d.new_demos.last_24h, locale)}
              sub={`${formatNumber(d.new_demos.last_7d, locale)} / 7d`}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_active")}
              value={formatNumber(d.active_demos_24h, locale)}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_events")}
              value={formatNumber(d.avg_events_per_demo, locale)}
              sub={`Σ ${formatNumber(d.total_demo_events_30d, locale)}`}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_lifetime")}
              value={formatLifetime(d.avg_lifetime_seconds, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <InnerCard
              title={t("admin.analytics_demo_daily_title")}
              subtitle={t("admin.analytics_demo_daily_sub")}
            >
              {d.demos_daily.length === 0 || dailyMax === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_demo_empty")}
                </p>
              ) : (
                <>
                  <SignupsAreaChart points={d.demos_daily} max={dailyMax} />
                  <div className="mt-1 flex justify-between text-[10px] text-neutral-500 dark:text-umber-300">
                    <span>{d.demos_daily[0]?.date ?? ""}</span>
                    <span>{d.demos_daily[d.demos_daily.length - 1]?.date ?? ""}</span>
                  </div>
                </>
              )}
            </InnerCard>

            <InnerCard
              title={t("admin.analytics_demo_top_features_title")}
              subtitle={t("admin.analytics_demo_top_features_sub")}
            >
              {d.top_features.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_demo_top_features_empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {d.top_features.slice(0, 6).map((f) => {
                    const pct =
                      topFeatureMax === 0
                        ? 0
                        : Math.max(4, Math.round((f.count / topFeatureMax) * 100));
                    return (
                      <li
                        key={f.feature}
                        className="grid grid-cols-[7rem_1fr_4rem] items-center gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-left font-medium text-neutral-800 dark:text-paper-100">
                            {f.feature}
                          </div>
                          <div className="text-[10px] text-neutral-500 dark:text-umber-300">
                            {t(
                              f.demos === 1
                                ? "admin.analytics_demo_feature_demos_one"
                                : "admin.analytics_demo_feature_demos_other",
                              { n: f.demos },
                            )}
                          </div>
                        </div>
                        <div className="relative h-2 w-full rounded-full bg-paper-200 dark:bg-umber-700">
                          <div
                            className="h-full rounded-full bg-blush-500/80 dark:bg-blush-400/80"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="stat-num text-right font-semibold text-neutral-800 dark:text-paper-50">
                          {formatNumber(f.count, locale)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 border-t border-paper-200 pt-2 text-[11px] text-neutral-500 dark:border-umber-700 dark:text-umber-300">
                {t("admin.analytics_demo_events_help")}
              </p>
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
  );
}

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

// ─── Shared chart primitives ──────────────────────────────────────────────

function SignupsAreaChart({
  points,
  max,
}: {
  points: Array<{ date: string; count: number }>;
  max: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 560;
  const H = 180;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 22;
  const PAD_LEFT = 0;
  const PAD_RIGHT = 32;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const niceMax = niceCeiling(Math.max(1, max));
  const scale = innerH / niceMax;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const baselineY = H - PAD_BOTTOM;
  const coords = points.map((p, i) => ({
    x: PAD_LEFT + i * stepX,
    y: baselineY - p.count * scale,
  }));

  const path = coords.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const fillPath = `${path} L ${PAD_LEFT + innerW} ${baselineY} L ${PAD_LEFT} ${baselineY} Z`;

  const total = points.reduce((acc, p) => acc + p.count, 0);
  const ariaLabel = `${points.length} day signup chart, total ${total}`;
  const gradientId = useMemo(() => `signups-grad-${Math.random().toString(36).slice(2, 8)}`, []);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((q) => ({
    y: baselineY - q * innerH,
    value: Math.round(q * niceMax),
  }));

  const lastIdx = coords.length - 1;
  const tickIndices = new Set<number>();
  tickIndices.add(0);
  if (lastIdx > 0) tickIndices.add(lastIdx);
  const interiorStep = Math.max(1, Math.round(coords.length / 4));
  for (let i = interiorStep; i < lastIdx; i += interiorStep) {
    if (lastIdx - i < 2) continue;
    tickIndices.add(i);
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const innerRatio = (W - PAD_LEFT - PAD_RIGHT) / W;
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width) / innerRatio;
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const hoveredCoord = hoverIdx !== null ? coords[hoverIdx] : null;
  const hoveredLeftPct = hoverIdx !== null ? ((PAD_LEFT + hoverIdx * stepX) / W) * 100 : 0;

  return (
    <div
      className="relative w-full"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-40 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              className="text-neutral-500"
              stopColor="currentColor"
              stopOpacity={0.35}
            />
            <stop
              offset="100%"
              className="text-neutral-500"
              stopColor="currentColor"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => (
          <g key={`yt-${tick.value}`}>
            <line
              x1={PAD_LEFT}
              x2={PAD_LEFT + innerW}
              y1={tick.y}
              y2={tick.y}
              className="stroke-paper-200 dark:stroke-umber-700"
              strokeWidth={1}
              strokeDasharray={tick.value === 0 ? undefined : "3 4"}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={W - 4}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-neutral-400 stat-num dark:fill-umber-300"
              fontSize="9"
            >
              {tick.value}
            </text>
          </g>
        ))}
        <path d={fillPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={path}
          className="stroke-neutral-600 dark:stroke-neutral-300"
          strokeWidth={1.75}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
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
              className="fill-neutral-400 stat-num dark:fill-umber-300"
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
              className="stroke-neutral-600/40 dark:stroke-neutral-300/40"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r={3.5}
              className="fill-neutral-600 dark:fill-neutral-300"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r={6}
              className="fill-neutral-600/20 dark:fill-neutral-300/20"
            />
          </g>
        )}
      </svg>
      {hovered && hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-2 rounded-md border border-neutral-100 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 shadow-soft dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
          style={{ left: `${hoveredLeftPct}%` }}
        >
          <div>{hovered.date}</div>
          <div className="stat-num text-neutral-600 dark:text-neutral-300">{hovered.count}</div>
        </div>
      )}
    </div>
  );
}

/** Round `n` up to a "nice" Y-axis ceiling — one of 1, 2, 5 × 10^k. */
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
 *  caller controls the absolute scale via the surrounding grid. */
function HBar({ pct, ariaLabel }: { pct: number; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="relative h-2.5 w-full rounded bg-paper-200 dark:bg-umber-700"
      role="img"
      aria-label={ariaLabel}
    >
      <div
        className="h-full rounded bg-neutral-600 dark:bg-neutral-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
