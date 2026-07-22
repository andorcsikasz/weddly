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
  AcquisitionDimensionRow,
  AdminAcquisitionAnalytics,
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminDemoAnalytics,
  AdminDemoKind,
  AdminEngagementAnalytics,
  AdminGuestAnalytics,
  AdminHoneymoonAnalytics,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
  AdminTrafficAnalytics,
  AdminWeddingAnalytics,
  AnalyticsAudience,
  WeddingSeason,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import { Check, Plus } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, type PillTone } from "../components/admin";
import { EUROPE_NAMES, EUROPE_PATHS, EUROPE_VIEWBOX } from "../lib/europeGeo";
import { EUROPE_ISO_SET, WORLD_NAMES, WORLD_PATHS, WORLD_VIEWBOX } from "../lib/worldGeo";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminAnalyticsApi } from "../lib/endpoints";
import { formatHuf, formatNumber, intlLocale } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
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

type SectionId =
  | "money"
  | "activity"
  | "traffic"
  | "acquisition"
  | "picks"
  | "engagement"
  | "demo"
  | "weddings"
  | "honeymoon"
  | "guests";

interface SectionDef {
  id: SectionId;
  labelKey: string;
}

const SECTIONS: ReadonlyArray<SectionDef> = [
  { id: "money", labelKey: "admin.analytics_nav_money" },
  { id: "activity", labelKey: "admin.analytics_nav_activity" },
  { id: "traffic", labelKey: "admin.analytics_nav_traffic" },
  { id: "acquisition", labelKey: "admin.analytics_nav_acquisition" },
  { id: "weddings", labelKey: "admin.analytics_nav_weddings" },
  { id: "honeymoon", labelKey: "admin.analytics_nav_honeymoon" },
  { id: "guests", labelKey: "admin.analytics_nav_guests" },
  { id: "picks", labelKey: "admin.analytics_nav_picks" },
  { id: "engagement", labelKey: "admin.analytics_nav_engagement" },
  { id: "demo", labelKey: "admin.analytics_nav_demo" },
];

/** The clean default lens — every cohort flag off. */
const REAL_USERS_ONLY: AnalyticsAudience = {
  includeAdmins: false,
  includeTest: false,
  includeDemos: false,
  includeArchived: false,
  includeDeleting: false,
};

/** The five audience toggles, rendered as a chip row above the sections. */
const AUDIENCE_TOGGLES: ReadonlyArray<{ key: keyof AnalyticsAudience; labelKey: string }> = [
  { key: "includeAdmins", labelKey: "admin.analytics_audience_admins" },
  { key: "includeTest", labelKey: "admin.analytics_audience_test" },
  { key: "includeDemos", labelKey: "admin.analytics_audience_demos" },
  { key: "includeArchived", labelKey: "admin.analytics_audience_archived" },
  { key: "includeDeleting", labelKey: "admin.analytics_audience_deleting" },
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
  const [weddings, setWeddings] = useState<Loadable<AdminWeddingAnalytics>>({ status: "loading" });
  const [honeymoon, setHoneymoon] = useState<Loadable<AdminHoneymoonAnalytics>>({
    status: "loading",
  });
  const [guests, setGuests] = useState<Loadable<AdminGuestAnalytics>>({ status: "loading" });
  const [acquisition, setAcquisition] = useState<Loadable<AdminAcquisitionAnalytics>>({
    status: "loading",
  });

  // Audience filter. Default is the clean "real users only" lens — admins,
  // test accounts, demos, archived + deleting couples are all excluded until
  // toggled back in, so the team's own usage never silently distorts the
  // headline numbers. Applies to every lens except Demo (the demo view
  // itself) and Traffic (external GA4).
  const [audience, setAudience] = useState<AnalyticsAudience>(REAL_USERS_ONLY);

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
    traffic.status === "loading" ||
    weddings.status === "loading" ||
    honeymoon.status === "loading" ||
    guests.status === "loading" ||
    acquisition.status === "loading";

  const loadAll = useCallback(() => {
    setMoney({ status: "loading" });
    setActivity({ status: "loading" });
    setPicks({ status: "loading" });
    setEngagement({ status: "loading" });
    setDemo({ status: "loading" });
    setTraffic({ status: "loading" });
    setWeddings({ status: "loading" });
    setHoneymoon({ status: "loading" });
    setGuests({ status: "loading" });
    setAcquisition({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let anyError = false;
    // Audience-dependent lenses go back to skeletons while the filtered
    // refetch is in flight (a no-op on first mount — they start loading).
    setMoney({ status: "loading" });
    setActivity({ status: "loading" });
    setPicks({ status: "loading" });
    setEngagement({ status: "loading" });
    setWeddings({ status: "loading" });
    setHoneymoon({ status: "loading" });
    setGuests({ status: "loading" });
    setAcquisition({ status: "loading" });
    Promise.all([
      adminAnalyticsApi.money(audience).catch((e) => {
        anyError = true;
        if (!cancelled) setMoney({ status: "error" });
        throw e;
      }),
      adminAnalyticsApi.activity(audience).catch((e) => {
        anyError = true;
        if (!cancelled) setActivity({ status: "error" });
        throw e;
      }),
      adminAnalyticsApi.picks(audience).catch((e) => {
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
      .engagement(audience)
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

    adminAnalyticsApi
      .weddings(audience)
      .then((d) => {
        if (!cancelled) {
          setWeddings({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setWeddings({ status: "error" });
      });

    adminAnalyticsApi
      .honeymoon(audience)
      .then((d) => {
        if (!cancelled) {
          setHoneymoon({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setHoneymoon({ status: "error" });
      });

    adminAnalyticsApi
      .guests(audience)
      .then((d) => {
        if (!cancelled) {
          setGuests({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setGuests({ status: "error" });
      });

    adminAnalyticsApi
      .acquisition(audience)
      .then((d) => {
        if (!cancelled) {
          setAcquisition({ status: "ok", data: d });
          setLastLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setAcquisition({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [nonce, audience, toast, t]);

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

      <AudienceFilterBar audience={audience} onChange={setAudience} />

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
        <SectionAnchor id="acquisition">
          <AcquisitionSection state={acquisition} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="weddings">
          <WeddingsSection state={weddings} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="honeymoon">
          <HoneymoonSection state={honeymoon} locale={locale} />
        </SectionAnchor>
        <SectionAnchor id="guests">
          <GuestsSection state={guests} locale={locale} />
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

// ─── Audience filter (real-users-only baseline + cohort include toggles) ──

const AUDIENCE_CHIP_ACTIVE =
  "inline-flex items-center gap-1 rounded-full bg-ink-900 px-3 py-1 text-xs font-medium text-paper-50 dark:bg-paper-100 dark:text-umber-900";
const AUDIENCE_CHIP_IDLE =
  "inline-flex items-center gap-1 rounded-full border border-paper-300 bg-white px-3 py-1 text-xs text-ink-700 transition-colors hover:border-ink-500 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600";

function AudienceFilterBar({
  audience,
  onChange,
}: {
  audience: AnalyticsAudience;
  onChange: (a: AnalyticsAudience) => void;
}) {
  const { t } = useT();
  const anyOn = AUDIENCE_TOGGLES.some((x) => audience[x.key]);
  return (
    <div className="admin-card mb-6 flex flex-wrap items-center gap-2">
      <span className="eyebrow mr-1">{t("admin.analytics_audience_label")}</span>
      <button
        type="button"
        aria-pressed={!anyOn}
        onClick={() => onChange(REAL_USERS_ONLY)}
        className={!anyOn ? AUDIENCE_CHIP_ACTIVE : AUDIENCE_CHIP_IDLE}
      >
        {t("admin.analytics_audience_real_only")}
      </button>
      <span className="text-neutral-300 dark:text-umber-600">·</span>
      {AUDIENCE_TOGGLES.map((tg) => {
        const on = audience[tg.key];
        return (
          <button
            key={tg.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...audience, [tg.key]: !on })}
            className={on ? AUDIENCE_CHIP_ACTIVE : AUDIENCE_CHIP_IDLE}
          >
            {on ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
            {t(tg.labelKey)}
          </button>
        );
      })}
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
  locale: Locale;
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
    const time = d.toLocaleTimeString(intlLocale(locale), {
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
      <div className="flex flex-col gap-2.5">
        {/* Row 1: title on the left, refresh/timestamp on the right. */}
        <div className="flex items-center gap-x-3">
          <h1 className="m-0 shrink-0 text-lg font-semibold tracking-tight text-neutral-900 dark:text-paper-50">
            {t("admin.analytics_title")}
          </h1>
          {/* Subtitle is structurally present for screen readers but hidden
           *  visually — the page chrome's job is navigation, not exposition. */}
          <p className="sr-only">{t("admin.analytics_sub")}</p>

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

        {/* Row 2: section navigation, starting UNDER the title (not inline). */}
        <div className="flex items-center">
          {/* Below sm: collapse the section pills to a native select so the
           *  row stays compact. The same scrollTo() handler runs on change. */}
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
/** "vs previous period" delta badge. Renders nothing when the previous window
 *  was empty (a percentage off zero says nothing). Up is olive, down terracotta
 *  — both from the chart token palette, never raw hex. */
function DeltaPill({ cur, prev }: { cur: number; prev: number }) {
  const { t } = useT();
  if (prev <= 0) return null;
  const change = Math.round(((cur - prev) / prev) * 100);
  const cls =
    change > 0
      ? "text-chart-olive"
      : change < 0
        ? "text-chart-terracotta"
        : "text-neutral-400 dark:text-umber-400";
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "→";
  return (
    <span className={cls}>
      {arrow} {Math.abs(change)}% {t("admin.analytics_vs_prev")}
    </span>
  );
}

function KpiTile({
  label,
  value,
  sub,
  delta,
  demoNote,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Tiny colored "vs previous period" badge rendered under the value. */
  delta?: React.ReactNode;
  /** Tiny muted line under `sub` flagging the demo-account count that the
   *  headline `value` deliberately excludes (e.g. "demo: 11"). */
  demoNote?: string;
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
      {delta && <div className="mt-0.5 text-[11px] font-medium">{delta}</div>}
      {sub && (
        <div className="stat-num stat-num-centered mt-0.5 text-xs text-neutral-500 dark:text-umber-300">
          {sub}
        </div>
      )}
      {demoNote && (
        <div className="stat-num stat-num-centered mt-0.5 text-[10px] text-neutral-400 dark:text-umber-400">
          {demoNote}
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
  locale: Locale;
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
  // "No budget" share. Denominator = every couple in the audience-scoped money
  // view (the histogram sums to exactly that). Numerator uses the SAME broad
  // "has budget" definition as the KPI tile + per-category table
  // (couples_with_budget = ceiling set OR ≥1 budget_lines row), so a couple who
  // entered per-category amounts without a top-level ceiling no longer counts as
  // "no budget". Using the ceiling-only histogram bucket here read as a
  // contradiction against the per-category PÁR counts.
  const moneyCouples = m.budget_histogram.reduce((s, b) => s + b.count, 0);
  const noBudgetCount = Math.max(0, moneyCouples - m.couples_with_budget);

  return (
    <SectionCard title={title}>
      {!hasMoneyData ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_money_empty")}
        </p>
      ) : (
        <>
          {noBudgetCount > 0 && moneyCouples > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-chart-ochre/10 px-3 py-2 text-xs leading-snug text-neutral-700 ring-1 ring-chart-ochre/30 dark:text-paper-100">
              <span aria-hidden="true">⚠️</span>
              <span>
                {t("admin.analytics_money_no_budget_warning", {
                  pct: pct(noBudgetCount, moneyCouples),
                  count: formatNumber(noBudgetCount, locale),
                })}
              </span>
            </div>
          )}
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
            {/* Two histograms stacked in the left column (fills the gap left by
                the taller per-category table), the category table in the right. */}
            <div className="flex flex-col gap-3">
              <MoneyHistogram
                title={t("admin.analytics_money_histogram_title")}
                buckets={m.budget_histogram}
                zeroLabel={t("admin.analytics_money_histogram_no_budget")}
                locale={locale}
              />
              <MoneyHistogram
                title={t("admin.analytics_money_cost_histogram_title")}
                buckets={m.cost_histogram}
                zeroLabel={t("admin.analytics_money_cost_histogram_no_cost")}
                locale={locale}
              />
            </div>

            <InnerCard title={t("admin.analytics_money_per_category_title")}>
              <PerCategoryTable rows={m.per_category} locale={locale} />
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// Right-anchored HUF distribution bars. Shared by the budget-ceiling and
// total-cost histograms — both carry the same bucket shape (a `bucket_max_huf=0`
// "not given" pseudo-bucket + inclusive upper bounds), only the data + the
// wording of the 0-bucket differ (`zeroLabel`).
function MoneyHistogram({
  title,
  buckets,
  zeroLabel,
  locale,
}: {
  title: string;
  buckets: Array<{ bucket_max_huf: number; count: number }>;
  zeroLabel: string;
  locale: Locale;
}) {
  const { t } = useT();
  const max = Math.max(0, ...buckets.map((b) => b.count));
  return (
    <InnerCard title={title}>
      {buckets.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_money_histogram_empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {buckets.map((b) => (
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
                  ? zeroLabel
                  : t("admin.analytics_money_histogram_bucket_upper", {
                      max: formatHuf(b.bucket_max_huf, locale),
                    })}
              </span>
              <HBar pct={max > 0 ? (b.count / max) * 100 : 0} ariaLabel={`${b.count}`} />
              <span className="stat-num text-right text-xs font-medium text-neutral-700 dark:text-paper-100">
                {formatNumber(b.count, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </InnerCard>
  );
}

function PerCategoryTable({
  rows,
  locale,
}: {
  rows: AdminMoneyAnalytics["per_category"];
  locale: Locale;
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
  locale: Locale;
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
  // Small "demo: N" note rendered under a headline; omitted when there are
  // no demo accounts in that bucket so clean periods stay uncluttered.
  const demoNote = (n: number): string | undefined =>
    n > 0 ? t("admin.analytics_activity_demo_note", { n: formatNumber(n, locale) }) : undefined;

  return (
    <SectionCard title={title}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_activity_signups_24h")}
          value={formatNumber(a.signups.last_24h, locale)}
          demoNote={demoNote(a.demo.signups.last_24h)}
        />
        <KpiTile
          label={t("admin.analytics_activity_signups_7d")}
          value={formatNumber(a.signups.last_7d, locale)}
          delta={<DeltaPill cur={a.signups.last_7d} prev={a.signups.prev_7d} />}
          sub={t("admin.analytics_activity_signups_sub", {
            total: formatNumber(a.signups.total, locale),
          })}
          demoNote={demoNote(a.demo.signups.last_7d)}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_activity_signups_30d")}
          value={formatNumber(a.signups.last_30d, locale)}
          delta={<DeltaPill cur={a.signups.last_30d} prev={a.signups.prev_30d} />}
          demoNote={demoNote(a.demo.signups.last_30d)}
        />
        <KpiTile
          label={t("admin.analytics_activity_active_users_24h")}
          value={formatNumber(a.active_users.last_24h, locale)}
          sub={t("admin.analytics_activity_active_users_sub", {
            n: formatNumber(a.active_users.last_7d, locale),
          })}
          demoNote={demoNote(a.demo.active_users.last_24h)}
        />
        <KpiTile
          label={t("admin.analytics_activity_verified_pct")}
          value={`${pctVerified}%`}
          sub={t("admin.analytics_activity_pct_onboarded_sub", {
            onboarded: formatNumber(funnel.onboarded, locale),
            registered: formatNumber(funnel.registered, locale),
          })}
          demoNote={demoNote(a.demo.onboarding_funnel.onboarded)}
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
                demoNote={demoNote(a.demo.onboarding_funnel.registered)}
              />
              <FunnelStep
                label={t("admin.analytics_activity_funnel_verified")}
                count={funnel.verified}
                pct={Math.round((funnel.verified / funnelMax) * 100)}
                locale={locale}
                demoNote={demoNote(a.demo.onboarding_funnel.verified)}
              />
              <FunnelStep
                label={t("admin.analytics_activity_funnel_onboarded")}
                count={funnel.onboarded}
                pct={Math.round((funnel.onboarded / funnelMax) * 100)}
                locale={locale}
                demoNote={demoNote(a.demo.onboarding_funnel.onboarded)}
              />
            </div>
          </InnerCard>

          <InnerCard title={t("admin.analytics_activity_status_title")}>
            <div className="flex flex-wrap items-center gap-1.5">
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
              {a.demo.couples_total > 0 && (
                <span className="stat-num text-[10px] text-neutral-400 dark:text-umber-400">
                  {demoNote(a.demo.couples_total)}
                </span>
              )}
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
  demoNote,
}: {
  label: string;
  count: number;
  pct: number;
  locale: Locale;
  /** Tiny muted "demo: N" line under the count — demo workspaces are
   *  excluded from `count`, this surfaces how many sit alongside it. */
  demoNote?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
      <span className="text-left text-xs text-neutral-700 dark:text-paper-100">{label}</span>
      <HBar pct={clamped} ariaLabel={`${count}`} />
      <span className="flex flex-col items-end text-right">
        <span className="stat-num text-xs font-medium text-neutral-700 dark:text-paper-100">
          {formatNumber(count, locale)} · {clamped}%
        </span>
        {demoNote && (
          <span className="stat-num text-[10px] text-neutral-400 dark:text-umber-400">
            {demoNote}
          </span>
        )}
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
  locale: Locale;
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
    intlLocale(locale),
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

  const tp = d.totals_prev_7d;
  const channelMax = Math.max(0, ...d.channels.map((c) => c.sessions));
  const firstTouchMax = Math.max(0, ...d.first_touch_channels.map((c) => c.users));
  const countryMax = Math.max(0, ...d.countries.map((c) => c.users));
  const deviceMax = Math.max(0, ...d.devices.map((c) => c.users));
  const eventMax = Math.max(0, ...d.events.map((e) => e.count));
  const nvr = d.new_vs_returning;
  const nvrTotal = nvr.new_users + nvr.returning_users;
  const rt = d.realtime;

  return (
    <SectionCard title={title} subtitle={subtitle}>
      {rt.active_users > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2 text-sm ring-1 ring-neutral-200 dark:bg-neutral-500/10 dark:ring-neutral-500/30">
          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-800 dark:text-paper-100">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-chart-olive" />
            {t("admin.analytics_traffic_realtime_label")}
          </span>
          <span className="stat-num text-lg font-semibold text-neutral-900 dark:text-paper-50">
            {formatNumber(rt.active_users, locale)}
          </span>
          {rt.by_country.length > 0 && (
            <span className="text-xs text-neutral-500 dark:text-umber-300">
              {rt.by_country
                .slice(0, 4)
                .map((c) => `${c.country} ${formatNumber(c.users, locale)}`)
                .join(" · ")}
            </span>
          )}
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_traffic_active_users")}
          value={formatNumber(t7.active_users, locale)}
          delta={<DeltaPill cur={t7.active_users} prev={tp.active_users} />}
          sub={t("admin.analytics_traffic_28d_sub", {
            n: formatNumber(t28.active_users, locale),
          })}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_traffic_sessions")}
          value={formatNumber(t7.sessions, locale)}
          delta={<DeltaPill cur={t7.sessions} prev={tp.sessions} />}
          sub={t("admin.analytics_traffic_28d_sub", { n: formatNumber(t28.sessions, locale) })}
        />
        <KpiTile
          label={t("admin.analytics_traffic_page_views")}
          value={formatNumber(t7.page_views, locale)}
          delta={<DeltaPill cur={t7.page_views} prev={tp.page_views} />}
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

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InnerCard
          title={t("admin.analytics_traffic_new_returning_title")}
          subtitle={t("admin.analytics_traffic_28d_label")}
        >
          {nvrTotal === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_traffic_empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="stat-num text-2xl font-semibold text-neutral-900 dark:text-paper-50">
                    {formatNumber(nvr.new_users, locale)}
                  </div>
                  <div className="eyebrow mt-0.5">{t("admin.analytics_traffic_new_users")}</div>
                  <div className="stat-num text-xs text-neutral-500 dark:text-umber-300">
                    {Math.round((nvr.new_users / nvrTotal) * 100)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="stat-num text-2xl font-semibold text-neutral-900 dark:text-paper-50">
                    {formatNumber(nvr.returning_users, locale)}
                  </div>
                  <div className="eyebrow mt-0.5">
                    {t("admin.analytics_traffic_returning_users")}
                  </div>
                  <div className="stat-num text-xs text-neutral-500 dark:text-umber-300">
                    {Math.round((nvr.returning_users / nvrTotal) * 100)}%
                  </div>
                </div>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                <div
                  className="bg-chart-olive"
                  style={{ width: `${(nvr.new_users / nvrTotal) * 100}%` }}
                />
                <div
                  className="bg-chart-terracotta"
                  style={{ width: `${(nvr.returning_users / nvrTotal) * 100}%` }}
                />
              </div>
            </div>
          )}
        </InnerCard>

        <InnerCard
          title={t("admin.analytics_traffic_first_touch_title")}
          subtitle={t("admin.analytics_traffic_first_touch_sub")}
        >
          {d.first_touch_channels.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_traffic_channels_empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {d.first_touch_channels.slice(0, 6).map((c) => (
                <li
                  key={c.channel}
                  className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                >
                  <span className="truncate text-left text-neutral-700 dark:text-paper-100">
                    {c.channel}
                  </span>
                  <HBar
                    pct={firstTouchMax > 0 ? (c.users / firstTouchMax) * 100 : 0}
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

          <InnerCard
            title={t("admin.analytics_traffic_devices_title")}
            subtitle={t("admin.analytics_traffic_devices_sub")}
          >
            {d.devices.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_traffic_countries_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {d.devices.slice(0, 6).map((c) => (
                  <li
                    key={c.device}
                    className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                  >
                    <span className="truncate text-left text-neutral-700 capitalize dark:text-paper-100">
                      {c.device}
                    </span>
                    <HBar
                      pct={deviceMax > 0 ? (c.users / deviceMax) * 100 : 0}
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
                    <th className="py-1 pl-2 text-right">
                      {t("admin.analytics_traffic_col_avg_time")}
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
                      <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                        {formatLifetime(row.avg_engagement_seconds, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </InnerCard>
      </div>

      <div className="mt-3">
        <InnerCard
          title={t("admin.analytics_traffic_events_title")}
          subtitle={t("admin.analytics_traffic_events_sub")}
        >
          {d.events.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_traffic_empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {d.events.slice(0, 10).map((e) => (
                <li
                  key={e.name}
                  className="grid grid-cols-[10rem_1fr_4rem] items-center gap-2 text-xs"
                >
                  <span className="truncate text-left font-mono text-neutral-700 dark:text-paper-100">
                    {e.name}
                  </span>
                  <HBar
                    pct={eventMax > 0 ? (e.count / eventMax) * 100 : 0}
                    ariaLabel={`${e.count}`}
                  />
                  <span className="stat-num text-right font-medium text-neutral-700 dark:text-paper-100">
                    {formatNumber(e.count, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InnerCard>
      </div>
    </SectionCard>
  );
}

// ─── Acquisition (where signups come from, joined to onboarding funnel) ─────

const ACQ_CHANNELS = new Set(["paid", "social", "email", "organic", "referral", "direct"]);

/** Localized label for a nullable dimension key. null → "unknown"; the six
 *  known channel keys map to translated channel names; everything else renders
 *  verbatim (country codes, campaign names, locale codes). */
function acqKeyLabel(key: string | null, t: ReturnType<typeof useT>["t"]): string {
  if (key === null) return t("admin.analytics_acq_unknown");
  if (ACQ_CHANNELS.has(key)) return t(`admin.analytics_acq_channel_${key}`);
  return key;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "-";
  return `${Math.round((part / whole) * 100)}%`;
}

/** Signups in a dimension that actually resolved to a value (non-null key) —
 *  the "known" count behind a coverage line, so a column that's all-unknown
 *  reads as a capture gap rather than as zero demand. */
function dimKnown(rows: AcquisitionDimensionRow[]): number {
  return rows.reduce((sum, r) => (r.key === null ? sum : sum + r.signups), 0);
}

/** Tiny muted "known for X of Y" line shown above a dimension's table/bars so
 *  the unknown share is explained as missing data, not absent demand. */
function CoverageLine({
  known,
  total,
  locale,
}: {
  known: number;
  total: number;
  locale: Locale;
}) {
  const { t } = useT();
  return (
    <p className="mb-1.5 text-[11px] text-neutral-500 dark:text-umber-300">
      {t("admin.analytics_acq_coverage", {
        known: formatNumber(known, locale),
        total: formatNumber(total, locale),
      })}
    </p>
  );
}

/** Setup note shown when a dimension never resolves (country with no GeoIP DB)
 *  — points the operator at the missing key instead of leaving a dead column. */
function GeoIpNote() {
  const { t } = useT();
  return (
    <p className="mb-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11px] leading-snug text-neutral-600 ring-1 ring-neutral-200 dark:bg-neutral-500/10 dark:text-paper-200 dark:ring-neutral-500/30">
      {t("admin.analytics_acq_geoip_hint")}
    </p>
  );
}

/** Dimension table: key, signups bar, onboarded%, active%. Reused for the
 *  country breakdown and (re-sorted by activation) the campaign breakdown. */
function AcqDimTable({
  rows,
  keyHeader,
  locale,
  maxRows,
}: {
  rows: AcquisitionDimensionRow[];
  keyHeader: string;
  locale: Locale;
  maxRows?: number;
}) {
  const { t } = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_acq_empty")}
      </p>
    );
  }
  const visible = maxRows != null ? rows.slice(0, maxRows) : rows;
  const max = Math.max(0, ...rows.map((r) => r.signups));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow text-left">
            <th className="py-1 pr-2">{keyHeader}</th>
            <th className="py-1 pl-2 text-right">{t("admin.analytics_acq_col_signups")}</th>
            <th className="py-1 pl-2 text-right">{t("admin.analytics_acq_col_onboarded")}</th>
            <th className="py-1 pl-2 text-right">{t("admin.analytics_acq_col_active")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.key ?? "__null__"}
              className="border-t border-paper-200 dark:border-umber-700"
            >
              <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                <div className="flex items-center gap-2">
                  <span className="w-16 truncate">{acqKeyLabel(r.key, t)}</span>
                  <span className="hidden flex-1 sm:block">
                    <HBar pct={max > 0 ? (r.signups / max) * 100 : 0} ariaLabel={`${r.signups}`} />
                  </span>
                </div>
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                {formatNumber(r.signups, locale)}
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                {pct(r.onboarded, r.signups)}
              </td>
              <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                {pct(r.active, r.signups)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcqBarList({
  rows,
  locale,
}: {
  rows: AcquisitionDimensionRow[];
  locale: Locale;
}) {
  const { t } = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        {t("admin.analytics_acq_empty")}
      </p>
    );
  }
  const max = Math.max(0, ...rows.map((r) => r.signups));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.slice(0, 6).map((r) => (
        <li
          key={r.key ?? "__null__"}
          className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs"
        >
          <span className="truncate text-left text-neutral-700 dark:text-paper-100">
            {acqKeyLabel(r.key, t)}
          </span>
          <HBar pct={max > 0 ? (r.signups / max) * 100 : 0} ariaLabel={`${r.signups}`} />
          <span className="stat-num text-right font-medium text-neutral-700 dark:text-paper-100">
            {formatNumber(r.signups, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Choropleth fill ramp — token classes only (no raw hex, JIT-safe literals).
// Index 0 = no signups (faint base); 1..5 = increasing signup density.
const ACQ_CHORO_FILL = [
  "fill-umber-100 dark:fill-umber-800",
  "fill-umber-200 dark:fill-umber-600",
  "fill-umber-300 dark:fill-umber-500",
  "fill-umber-500 dark:fill-umber-400",
  "fill-umber-700 dark:fill-umber-300",
  "fill-umber-900 dark:fill-umber-200",
];

/** Europe choropleth: every mapped country filled by its signup density.
 *  Non-European countries fold into an "other" tally, null into "unknown" —
 *  both shown beside the map so the colored area never silently drops them.
 *  Hand-rolled inline SVG (see lib/europeGeo.ts), no map dependency. */
function EuropeChoropleth({
  rows,
  locale,
}: {
  rows: AcquisitionDimensionRow[];
  locale: Locale;
}) {
  const { t } = useT();
  const counts = new Map<string, number>();
  let other = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.key === null) {
      unknown += r.signups;
    } else if (EUROPE_PATHS[r.key]) {
      counts.set(r.key, (counts.get(r.key) ?? 0) + r.signups);
    } else {
      other += r.signups;
    }
  }
  const max = Math.max(0, ...counts.values());
  const bucket = (c: number): number => {
    if (c <= 0) return 0;
    if (max <= 0) return 1;
    return Math.min(5, Math.ceil((c / max) * 5));
  };

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={EUROPE_VIEWBOX}
        className="h-auto w-full"
        role="img"
        aria-label={t("admin.analytics_acq_map_title")}
      >
        <g strokeWidth={0.6} className="stroke-paper-100 dark:stroke-umber-900">
          {Object.entries(EUROPE_PATHS).map(([iso, d]) => {
            const c = counts.get(iso) ?? 0;
            return (
              <path key={iso} d={d} className={ACQ_CHORO_FILL[bucket(c)]}>
                <title>{`${EUROPE_NAMES[iso] ?? iso}: ${formatNumber(c, locale)}`}</title>
              </path>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-umber-300">
        <div className="flex items-center gap-1">
          <span>{t("admin.analytics_acq_map_less")}</span>
          {ACQ_CHORO_FILL.slice(1).map((cls) => (
            <svg key={cls} width="14" height="10" aria-hidden="true">
              <rect width="14" height="10" rx="2" className={cls} />
            </svg>
          ))}
          <span>{t("admin.analytics_acq_map_more")}</span>
        </div>
        <div className="flex items-center gap-3">
          {other > 0 && (
            <span>
              {t("admin.analytics_acq_map_other")}: {formatNumber(other, locale)}
            </span>
          )}
          {unknown > 0 && (
            <span>
              {t("admin.analytics_acq_unknown")}: {formatNumber(unknown, locale)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function WorldChoropleth({
  rows,
  locale,
}: {
  rows: AcquisitionDimensionRow[];
  locale: Locale;
}) {
  const { t } = useT();
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of rows) {
    if (r.key === null) {
      unknown += r.signups;
    } else {
      counts.set(r.key, (counts.get(r.key) ?? 0) + r.signups);
    }
  }
  const max = Math.max(0, ...counts.values());
  const bucket = (c: number): number => {
    if (c <= 0) return 0;
    if (max <= 0) return 1;
    return Math.min(5, Math.ceil((c / max) * 5));
  };

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={WORLD_VIEWBOX}
        className="h-auto w-full"
        role="img"
        aria-label={t("admin.analytics_acq_map_title")}
      >
        <g strokeWidth={0.4} className="stroke-paper-100 dark:stroke-umber-900">
          {Object.entries(WORLD_PATHS).map(([iso, d]) => {
            const c = counts.get(iso) ?? 0;
            return (
              <path key={iso} d={d} className={ACQ_CHORO_FILL[bucket(c)]}>
                <title>{`${WORLD_NAMES[iso] ?? iso}: ${formatNumber(c, locale)}`}</title>
              </path>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-umber-300">
        <div className="flex items-center gap-1">
          <span>{t("admin.analytics_acq_map_less")}</span>
          {ACQ_CHORO_FILL.slice(1).map((cls) => (
            <svg key={cls} width="14" height="10" aria-hidden="true">
              <rect width="14" height="10" rx="2" className={cls} />
            </svg>
          ))}
          <span>{t("admin.analytics_acq_map_more")}</span>
        </div>
        {unknown > 0 && (
          <span>
            {t("admin.analytics_acq_unknown")}: {formatNumber(unknown, locale)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Picks Europe or World choropleth based on whether any signup comes from
 *  outside the European country set. Defaults to Europe when all signups are
 *  either European or unresolved (null country). */
function AcquisitionChoropleth({
  rows,
  locale,
}: {
  rows: AcquisitionDimensionRow[];
  locale: Locale;
}) {
  const hasNonEurope = rows.some((r) => r.key !== null && !EUROPE_ISO_SET.has(r.key));
  if (hasNonEurope) return <WorldChoropleth rows={rows} locale={locale} />;
  return <EuropeChoropleth rows={rows} locale={locale} />;
}

function AcquisitionSection({
  state,
  locale,
}: {
  state: Loadable<AdminAcquisitionAnalytics>;
  locale: Locale;
}) {
  const { t } = useT();
  const title = t("admin.analytics_section_acquisition");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_acq_load_error")} />
    );

  const d = state.data;
  const subtitle = t("admin.analytics_acq_window", { n: d.window_days });

  if (d.total_signups === 0) {
    return (
      <SectionCard title={title} subtitle={subtitle}>
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_acq_empty")}
        </p>
      </SectionCard>
    );
  }

  const totalOnboarded = d.by_country.reduce((s, r) => s + r.onboarded, 0);
  const totalActive = d.by_country.reduce((s, r) => s + r.active, 0);
  const countryKnown = d.total_signups - d.unknown_country;
  const deviceKnown = dimKnown(d.by_device);
  const topChannel = d.by_channel[0];
  // Campaigns ranked by activation quality (active/signups), not raw volume —
  // a 500-signup campaign at 2% activation is worse than 50 at 40%.
  const campaignsByQuality = [...d.by_campaign].sort(
    (a, b) => b.active / Math.max(1, b.signups) - a.active / Math.max(1, a.signups),
  );

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label={t("admin.analytics_acq_total_signups")}
          value={formatNumber(d.total_signups, locale)}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_acq_onboarded_rate")}
          value={pct(totalOnboarded, d.total_signups)}
          sub={formatNumber(totalOnboarded, locale)}
        />
        <KpiTile
          label={t("admin.analytics_acq_active_rate")}
          value={pct(totalActive, d.total_signups)}
          sub={formatNumber(totalActive, locale)}
        />
        <KpiTile
          label={t("admin.analytics_acq_top_channel")}
          value={topChannel ? acqKeyLabel(topChannel.key, t) : "-"}
          sub={topChannel ? formatNumber(topChannel.signups, locale) : undefined}
        />
        <KpiTile
          label={t("admin.analytics_acq_unknown_country")}
          value={formatNumber(d.unknown_country, locale)}
          sub={pct(d.unknown_country, d.total_signups)}
        />
      </div>

      <div className="mb-3">
        <InnerCard
          title={t("admin.analytics_acq_map_title")}
          subtitle={t("admin.analytics_acq_map_sub")}
        >
          {countryKnown === 0 && <GeoIpNote />}
          <AcquisitionChoropleth rows={d.by_country} locale={locale} />
        </InnerCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <InnerCard
          title={t("admin.analytics_acq_by_country_title")}
          subtitle={t("admin.analytics_acq_conversion_sub")}
        >
          {countryKnown === 0 ? (
            <GeoIpNote />
          ) : (
            <CoverageLine known={countryKnown} total={d.total_signups} locale={locale} />
          )}
          <AcqDimTable
            rows={d.by_country}
            keyHeader={t("admin.analytics_acq_col_country")}
            locale={locale}
          />
        </InnerCard>

        <div className="flex flex-col gap-3">
          <InnerCard
            title={t("admin.analytics_acq_by_channel_title")}
            subtitle={t("admin.analytics_acq_channel_note")}
          >
            <AcqBarList rows={d.by_channel} locale={locale} />
          </InnerCard>
          <InnerCard title={t("admin.analytics_acq_by_device_title")}>
            <CoverageLine known={deviceKnown} total={d.total_signups} locale={locale} />
            <AcqBarList rows={d.by_device} locale={locale} />
          </InnerCard>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InnerCard
          title={t("admin.analytics_acq_campaigns_title")}
          subtitle={t("admin.analytics_acq_campaigns_sub")}
        >
          <AcqDimTable
            rows={campaignsByQuality}
            keyHeader={t("admin.analytics_acq_col_campaign")}
            locale={locale}
            maxRows={10}
          />
        </InnerCard>

        <InnerCard title={t("admin.analytics_acq_country_locale_title")}>
          {d.country_locale.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-umber-300">
              {t("admin.analytics_acq_empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-1 pr-2">{t("admin.analytics_acq_col_country")}</th>
                    <th className="py-1 px-2">{t("admin.analytics_acq_col_locale")}</th>
                    <th className="py-1 pl-2 text-right">{t("admin.analytics_acq_col_count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.country_locale.slice(0, 10).map((r) => (
                    <tr
                      key={`${r.country ?? "?"}|${r.locale ?? "?"}`}
                      className="border-t border-paper-200 dark:border-umber-700"
                    >
                      <td className="py-1 pr-2 text-left text-neutral-800 dark:text-paper-100">
                        {r.country ?? t("admin.analytics_acq_unknown")}
                      </td>
                      <td className="py-1 px-2 text-left text-neutral-700 dark:text-paper-100">
                        {r.locale ?? t("admin.analytics_acq_unknown")}
                      </td>
                      <td className="stat-num py-1 pl-2 text-right text-neutral-700 dark:text-paper-100">
                        {formatNumber(r.count, locale)}
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

// ─── Shared helpers for the wedding / honeymoon / guest sections ───────────

/** Short month label (1..12) in the admin's locale via Intl — keeps the
 *  seasonality bars label-free of 12 hand-maintained i18n keys. */
function monthLabel(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
  }).format(new Date(Date.UTC(2020, month - 1, 1)));
}

/** Short weekday label for ISO weekday (1=Mon..7=Sun). June 1 2020 was a
 *  Monday, so Date.UTC(2020, 5, weekday) maps 1→Mon … 7→Sun cleanly. */
function weekdayLabel(weekday: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
  }).format(new Date(Date.UTC(2020, 5, weekday)));
}

/** Median + IQR sub-line shared by the quartile-backed KPI tiles. */
function statSub(
  s: AdminAnalyticsStats,
  locale: Locale,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  return t("admin.analytics_stat_sub", {
    median: formatNumber(s.median, locale),
    p25: formatNumber(s.p25, locale),
    p75: formatNumber(s.p75, locale),
  });
}

/** Generic ranked horizontal-bar list. `rows` are pre-sorted by the caller;
 *  this just normalizes the bar width against the max and renders a
 *  label / bar / count grid. `labelWidth` lets callers widen the label column
 *  for long destination names. */
function DistBars({
  rows,
  locale,
  emptyLabel,
  labelWidth = "7rem",
}: {
  rows: Array<{ label: string; count: number; sub?: string }>;
  locale: Locale;
  emptyLabel: string;
  labelWidth?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-umber-300">{emptyLabel}</p>;
  }
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const pct = max > 0 ? (row.count / max) * 100 : 0;
        return (
          <li
            key={row.label}
            className="grid items-center gap-2 text-xs"
            style={{ gridTemplateColumns: `${labelWidth} 1fr 3rem` }}
          >
            <div className="min-w-0">
              <div className="truncate text-left font-medium text-neutral-800 dark:text-paper-100">
                {row.label}
              </div>
              {row.sub && (
                <div className="text-[10px] text-neutral-500 dark:text-umber-300">{row.sub}</div>
              )}
            </div>
            <HBar pct={pct} ariaLabel={`${row.label}: ${row.count}`} />
            <span className="stat-num text-right font-semibold text-neutral-800 dark:text-paper-50">
              {formatNumber(row.count, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Weddings section ──────────────────────────────────────────────────────

function WeddingsSection({
  state,
  locale,
}: {
  state: Loadable<AdminWeddingAnalytics>;
  locale: Locale;
}) {
  const { t } = useT();
  const title = t("admin.analytics_section_weddings");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const w = state.data;
  const monthRows = w.wedding_month.map((r) => ({
    label: monthLabel(r.month, locale),
    count: r.count,
  }));
  const weekdayRows = w.wedding_weekday.map((r) => ({
    label: weekdayLabel(r.weekday, locale),
    count: r.count,
  }));
  const seasonRows = w.wedding_season.map((r) => ({
    label: t(`admin.analytics_season_${r.season}` as `admin.analytics_season_${WeddingSeason}`),
    count: r.count,
  }));
  const currencyRows = w.by_currency.map((r) => ({ label: r.currency, count: r.count }));
  const countryRows = w.by_country.map((r) => ({ label: r.country, count: r.count }));
  const localeRows = w.by_locale.map((r) => ({
    label: r.locale === "unknown" ? t("admin.analytics_locale_unknown") : r.locale.toUpperCase(),
    count: r.count,
  }));
  const tagRows = w.top_style_tags.map((r) => ({ label: r.tag, count: r.count }));
  const cohortRows = w.lead_time_by_cohort.map((c) => ({
    label: monthLabel(Number(c.month.slice(5, 7)), locale),
    count: c.median,
    sub: t("admin.analytics_weddings_cohort_n", { count: formatNumber(c.count, locale) }),
  }));

  return (
    <SectionCard title={title}>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label={t("admin.analytics_weddings_total")}
          value={formatNumber(w.total_couples, locale)}
          sub={t("admin.analytics_weddings_with_date", {
            count: formatNumber(w.couples_with_date, locale),
          })}
          emphasis
        />
        <KpiTile
          label={t("admin.analytics_weddings_lead_time")}
          value={t("admin.analytics_days", {
            count: formatNumber(w.lead_time_days.median, locale),
          })}
          sub={statSub(w.lead_time_days, locale, t)}
        />
        <KpiTile
          label={t("admin.analytics_weddings_guest_target")}
          value={formatNumber(w.guest_count_target.median, locale)}
          sub={statSub(w.guest_count_target, locale, t)}
        />
        <KpiTile
          label={t("admin.analytics_weddings_peak_season")}
          value={
            seasonRows.reduce(
              (best, r) => (r.count > best.count ? r : best),
              seasonRows[0] ?? { label: "-", count: 0 },
            ).label
          }
        />
      </div>

      <div className="mb-3">
        <InnerCard
          title={t("admin.analytics_weddings_lead_time_trend_title")}
          subtitle={t("admin.analytics_weddings_lead_time_trend_sub")}
        >
          <DistBars
            rows={cohortRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="3rem"
          />
        </InnerCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InnerCard title={t("admin.analytics_weddings_by_month")}>
          <DistBars
            rows={monthRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="3rem"
          />
        </InnerCard>
        <InnerCard title={t("admin.analytics_weddings_by_weekday")}>
          <DistBars
            rows={weekdayRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="4rem"
          />
        </InnerCard>
        <InnerCard
          title={t("admin.analytics_weddings_style_tags")}
          subtitle={t("admin.analytics_weddings_style_adoption", {
            picked: formatNumber(w.couples_with_style, locale),
            total: formatNumber(w.total_couples, locale),
            pct: pct(w.couples_with_style, w.total_couples),
          })}
        >
          <DistBars
            rows={tagRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_tags_empty")}
            labelWidth="9rem"
          />
        </InnerCard>
        <InnerCard title={t("admin.analytics_weddings_locale_mix")}>
          <div className="mb-2 eyebrow">{t("admin.analytics_weddings_by_currency")}</div>
          <DistBars
            rows={currencyRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="4rem"
          />
          <div className="mt-3 mb-2 eyebrow">{t("admin.analytics_weddings_by_country")}</div>
          <DistBars
            rows={countryRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="4rem"
          />
          <div className="mt-3 mb-2 eyebrow">{t("admin.analytics_weddings_by_locale")}</div>
          <DistBars
            rows={localeRows}
            locale={locale}
            emptyLabel={t("admin.analytics_weddings_empty")}
            labelWidth="4rem"
          />
        </InnerCard>
      </div>
    </SectionCard>
  );
}

// ─── Honeymoon section ─────────────────────────────────────────────────────

function HoneymoonSection({
  state,
  locale,
}: {
  state: Loadable<AdminHoneymoonAnalytics>;
  locale: Locale;
}) {
  const { t } = useT();
  const title = t("admin.analytics_section_honeymoon");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const h = state.data;
  const adoptionPct = Math.round(h.adoption_pct * 100);
  const destRows = h.top_destinations.map((r) => ({ label: r.destination, count: r.count }));
  const originRows = h.top_origins.map((r) => ({ label: r.iata, count: r.count }));
  const monthRows = h.start_month.map((r) => ({
    label: monthLabel(r.month, locale),
    count: r.count,
  }));

  return (
    <SectionCard title={title}>
      {h.couples_with_destination < 10 ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {h.couples_with_destination === 0
            ? t("admin.analytics_honeymoon_empty")
            : t("admin.analytics_honeymoon_insufficient", { n: h.couples_with_destination })}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label={t("admin.analytics_honeymoon_with_destination")}
              value={formatNumber(h.couples_with_destination, locale)}
              sub={t("admin.analytics_honeymoon_adoption", { pct: adoptionPct })}
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_honeymoon_top_destination")}
              value={destRows[0]?.label ?? "-"}
              sub={
                destRows[0]
                  ? t("admin.analytics_honeymoon_couples", {
                      count: formatNumber(destRows[0].count, locale),
                    })
                  : undefined
              }
            />
            <KpiTile
              label={t("admin.analytics_honeymoon_trip_nights")}
              value={formatNumber(h.trip_nights.median, locale)}
              sub={statSub(h.trip_nights, locale, t)}
            />
            <KpiTile
              label={t("admin.analytics_honeymoon_with_dates")}
              value={formatNumber(h.couples_with_dates, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
            <InnerCard title={t("admin.analytics_honeymoon_top_destinations")}>
              <DistBars
                rows={destRows}
                locale={locale}
                emptyLabel={t("admin.analytics_honeymoon_empty")}
                labelWidth="9rem"
              />
            </InnerCard>
            <InnerCard title={t("admin.analytics_honeymoon_origins")}>
              <DistBars
                rows={originRows}
                locale={locale}
                emptyLabel={t("admin.analytics_honeymoon_origins_empty")}
                labelWidth="4rem"
              />
              <div className="mt-3 mb-2 eyebrow">{t("admin.analytics_honeymoon_start_month")}</div>
              <DistBars
                rows={monthRows}
                locale={locale}
                emptyLabel={t("admin.analytics_honeymoon_empty")}
                labelWidth="3rem"
              />
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─── Guests section ────────────────────────────────────────────────────────

function GuestsSection({
  state,
  locale,
}: {
  state: Loadable<AdminGuestAnalytics>;
  locale: Locale;
}) {
  const { t } = useT();
  const title = t("admin.analytics_section_guests");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_load_error")} />
    );

  const g = state.data;
  const gpc = g.guests_per_couple;
  const rsvpRows = [
    { label: t("admin.analytics_guests_rsvp_yes"), count: g.rsvp_breakdown.yes },
    { label: t("admin.analytics_guests_rsvp_maybe"), count: g.rsvp_breakdown.maybe },
    { label: t("admin.analytics_guests_rsvp_no"), count: g.rsvp_breakdown.no },
    { label: t("admin.analytics_guests_rsvp_pending"), count: g.rsvp_breakdown.pending },
  ];
  const kindRows = [
    { label: t("admin.analytics_guests_kind_adult"), count: g.kind_breakdown.adult },
    { label: t("admin.analytics_guests_kind_child"), count: g.kind_breakdown.child },
    { label: t("admin.analytics_guests_kind_baby"), count: g.kind_breakdown.baby },
  ];
  const dietaryRows = [
    { label: t("admin.analytics_guests_diet_vegetarian"), count: g.dietary.vegetarian },
    { label: t("admin.analytics_guests_diet_vegan"), count: g.dietary.vegan },
    { label: t("admin.analytics_guests_diet_gluten"), count: g.dietary.gluten },
    { label: t("admin.analytics_guests_diet_lactose"), count: g.dietary.lactose },
    { label: t("admin.analytics_guests_diet_nut"), count: g.dietary.nut },
    { label: t("admin.analytics_guests_diet_other"), count: g.dietary.other_text },
  ];

  return (
    <SectionCard title={title}>
      {g.total_guests === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_guests_empty")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label={t("admin.analytics_guests_total")}
              value={formatNumber(g.total_guests, locale)}
              sub={t("admin.analytics_guests_per_couple", {
                avg: formatNumber(gpc.avg, locale),
                couples: formatNumber(g.couples_with_guests, locale),
              })}
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_guests_response_rate")}
              value={`${Math.round(g.response_rate * 100)}%`}
              sub={t("admin.analytics_guests_response_rate_sub", {
                answered: formatNumber(
                  g.rsvp_breakdown.yes + g.rsvp_breakdown.no + g.rsvp_breakdown.maybe,
                  locale,
                ),
                total: formatNumber(g.total_guests, locale),
              })}
            />
            <KpiTile
              label={t("admin.analytics_guests_acceptance_rate")}
              value={`${Math.round(g.acceptance_rate * 100)}%`}
              sub={t("admin.analytics_guests_acceptance_rate_sub", {
                yes: formatNumber(g.rsvp_breakdown.yes, locale),
                definite: formatNumber(g.rsvp_breakdown.yes + g.rsvp_breakdown.no, locale),
              })}
            />
            <KpiTile
              label={t("admin.analytics_guests_plus_one")}
              value={formatNumber(g.plus_one_count, locale)}
              sub={t("admin.analytics_guests_accommodation", {
                count: formatNumber(g.accommodation_needed_count, locale),
              })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <InnerCard title={t("admin.analytics_guests_rsvp_title")}>
              <DistBars
                rows={rsvpRows}
                locale={locale}
                emptyLabel={t("admin.analytics_guests_empty")}
                labelWidth="5rem"
              />
            </InnerCard>
            <InnerCard title={t("admin.analytics_guests_kind_title")}>
              <DistBars
                rows={kindRows}
                locale={locale}
                emptyLabel={t("admin.analytics_guests_empty")}
                labelWidth="5rem"
              />
              <div className="mt-3 text-xs text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_guests_song_requests", {
                  count: formatNumber(g.song_request_count, locale),
                })}
              </div>
            </InnerCard>
            <InnerCard
              title={t("admin.analytics_guests_dietary_title")}
              subtitle={t("admin.analytics_guests_dietary_sub", {
                count: formatNumber(g.guests_with_dietary, locale),
              })}
            >
              <DistBars
                rows={dietaryRows}
                locale={locale}
                emptyLabel={t("admin.analytics_guests_dietary_empty")}
                labelWidth="6rem"
              />
            </InnerCard>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─── Picks section ─────────────────────────────────────────────────────────

function PicksSection({
  state,
  locale,
}: {
  state: Loadable<AdminPicksAnalytics>;
  locale: Locale;
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
  const weeklyRows = p.picks_weekly.map((w) => ({ label: w.week_start.slice(5), count: w.count }));

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
              sub={t("admin.analytics_picks_adoption_sub", {
                picked: formatNumber(p.couples_with_any_pick, locale),
                total: formatNumber(p.total_couples, locale),
                pct: pct(p.couples_with_any_pick, p.total_couples),
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

          <div className="mb-3">
            <InnerCard
              title={t("admin.analytics_picks_weekly_title")}
              subtitle={t("admin.analytics_picks_weekly_sub")}
            >
              <DistBars
                rows={weeklyRows}
                locale={locale}
                emptyLabel={t("admin.analytics_picks_empty")}
                labelWidth="3.5rem"
              />
            </InnerCard>
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
  locale: Locale;
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

function RetentionCard({
  retention,
  locale,
}: {
  retention: AdminEngagementAnalytics["retention"];
  locale: Locale;
}) {
  const { t } = useT();
  const cols = [
    { day: 1, value: retention.d1 },
    { day: 7, value: retention.d7 },
    { day: 30, value: retention.d30 },
    { day: 60, value: retention.d60 },
  ];
  return (
    <InnerCard
      title={t("admin.analytics_engagement_retention_title")}
      subtitle={t("admin.analytics_engagement_retention_cohort", {
        n: formatNumber(retention.cohort_size, locale),
      })}
    >
      {retention.cohort_size > 0 && retention.cohort_size < 50 && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-chart-ochre/10 px-3 py-1.5 text-[11px] leading-snug text-neutral-700 ring-1 ring-chart-ochre/30 dark:text-paper-100">
          <span aria-hidden="true">⚠️</span>
          <span>{t("admin.analytics_engagement_retention_small_sample")}</span>
        </div>
      )}
      <div className="grid grid-cols-4 gap-3">
        {cols.map((c) => (
          <div
            key={c.day}
            className="rounded-lg px-3 py-2 text-center ring-1 ring-paper-200 dark:ring-umber-700"
          >
            <div className="eyebrow">
              {t("admin.analytics_engagement_retention_day", { n: c.day })}
            </div>
            <div className="stat-num text-lg font-semibold text-neutral-800 dark:text-paper-50">
              {c.value === null ? "-" : `${Math.round(c.value * 100)}%`}
            </div>
            {c.day === 60 && (
              <div className="text-[10px] text-neutral-500 dark:text-umber-300">
                {t("admin.analytics_engagement_retention_cohort", {
                  n: formatNumber(retention.cohort_size_d60, locale),
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </InnerCard>
  );
}

function EngagementSection({
  state,
  locale,
}: {
  state: Loadable<AdminEngagementAnalytics>;
  locale: Locale;
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
          value={d7Pct === null ? "-" : `${d7Pct}%`}
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

      <div className="mb-3">
        <RetentionCard retention={e.retention} locale={locale} />
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
  locale: Locale;
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
                {row.users > 0 && (
                  <>
                    {" · "}
                    {t("admin.analytics_engagement_events_per_user", {
                      value: (row.count / row.users).toFixed(1),
                    })}
                  </>
                )}
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
  locale: Locale;
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
  locale: Locale,
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
  return d.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Demo section ──────────────────────────────────────────────────────────

const DEMO_KINDS: Array<{ id: AdminDemoKind; labelKey: string }> = [
  { id: "couple", labelKey: "admin.analytics_demo_type_couple" },
  { id: "planner", labelKey: "admin.analytics_demo_type_planner" },
  { id: "vendor", labelKey: "admin.analytics_demo_type_vendor" },
];

function DemoSection({
  state,
  locale,
}: {
  state: Loadable<AdminDemoAnalytics>;
  locale: Locale;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<AdminDemoKind>("couple");
  const title = t("admin.analytics_demo_title");
  if (state.status === "loading") return <SectionStatus title={title} variant="loading" />;
  if (state.status === "error")
    return (
      <SectionStatus title={title} variant="error" message={t("admin.analytics_demo_load_error")} />
    );

  const d = state.data;
  const s = d.by_type[kind];
  const dailyMax = Math.max(0, ...s.demos_daily.map((p) => p.count));
  const hasDemos = d.total_demos_served > 0 || d.total_demos > 0;
  const topFeatureMax = Math.max(0, ...s.top_features.map((f) => f.count));

  return (
    <SectionCard title={title} subtitle={t("admin.analytics_demo_sub")}>
      {!hasDemos ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.analytics_demo_empty")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {DEMO_KINDS.map((k) => {
              const stats = d.by_type[k.id];
              const active = k.id === kind;
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKind(k.id)}
                  className={
                    "rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 " +
                    (active
                      ? "border-ink-900 bg-ink-900/[0.04] dark:border-paper-100 dark:bg-paper-100/10"
                      : "border-paper-300 bg-white hover:border-ink-500 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600")
                  }
                >
                  <div className="text-[11px] font-medium text-neutral-500 dark:text-umber-300">
                    {t(k.labelKey)}
                  </div>
                  <div className="stat-num text-lg font-semibold text-neutral-800 dark:text-paper-50">
                    {formatNumber(stats.total, locale)}
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-umber-300">
                    {t("admin.analytics_demo_type_served_note", {
                      n: formatNumber(stats.served_total, locale),
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiTile
              label={t("admin.analytics_demo_kpi_total")}
              value={formatNumber(s.total, locale)}
              sub={
                t("admin.analytics_demo_kpi_served") + ` ${formatNumber(s.served_total, locale)}`
              }
              emphasis
            />
            <KpiTile
              label={t("admin.analytics_demo_new_24h")}
              value={formatNumber(s.new_demos.last_24h, locale)}
              sub={`${formatNumber(s.new_demos.last_7d, locale)} / 7d`}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_active")}
              value={formatNumber(s.active_24h, locale)}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_events")}
              value={formatNumber(s.avg_events, locale)}
              sub={`Σ ${formatNumber(s.events_30d, locale)}`}
            />
            <KpiTile
              label={t("admin.analytics_demo_kpi_lifetime")}
              value={formatLifetime(s.avg_lifetime_seconds, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <InnerCard
              title={t("admin.analytics_demo_daily_title")}
              subtitle={t("admin.analytics_demo_daily_sub")}
            >
              {s.demos_daily.length === 0 || dailyMax === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_demo_empty")}
                </p>
              ) : (
                <>
                  <SignupsAreaChart points={s.demos_daily} max={dailyMax} />
                  <div className="mt-1 flex justify-between text-[10px] text-neutral-500 dark:text-umber-300">
                    <span>{s.demos_daily[0]?.date ?? ""}</span>
                    <span>{s.demos_daily[s.demos_daily.length - 1]?.date ?? ""}</span>
                  </div>
                </>
              )}
            </InnerCard>

            <InnerCard
              title={t("admin.analytics_demo_top_features_title")}
              subtitle={t("admin.analytics_demo_top_features_sub")}
            >
              {s.top_features.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-umber-300">
                  {t("admin.analytics_demo_top_features_empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {s.top_features.slice(0, 6).map((f) => {
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

function formatLifetime(seconds: number, locale: Locale): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
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
