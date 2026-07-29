// Vendor dashboard — the home surface for a role='vendor' user at /vendor.
// Renders inside VendorShell. Greets the vendor by business name, then acts as a
// command center: the setup panel while the listing is unfinished, a hero
// "last 30 days" inquiries number with secondary KPIs, a preview of upcoming
// Weddly-sourced bookings, and — only once setup is done — the contextual
// action cards. FREE-tier vendors see a graceful upgrade banner; nothing here
// is PRO-gated.
//
// Exactly one surface recommends work at a time. The old layout ran the setup
// checklist as a tinted alert at the top AND repeated its first step as a card
// under "Ajánlott következő lépések", in a different visual language.

import {
  ArrowRight,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ChevronRight,
  Eye,
  Inbox,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorPlan } from "@shared/vendor_plan";
import { Skeleton, SkeletonText } from "../../components/ui";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import {
  SetupLinger,
  SetupProgressChip,
  VendorSetupPanel,
} from "../../components/VendorSetupProgress";
import { vendorBillingApi, vendorListingApi, vendorStatsApi } from "../../lib/endpoints";
import { formatDate, formatMoney } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

const COMPLETENESS_DISMISS_KEY = "weddly.vendor_completeness_dismissed";

export default function VendorDashboardPage() {
  const { t, locale } = useT();
  useDocumentTitle(t("vendor.dashboard.page_title"));
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<VendorStats | null>(null);
  const [plan, setPlan] = useState<VendorPlan | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  // A self-serve vendor who hasn't finished the signup wizard is bounced into
  // it. Tracked so we render the skeleton (not a flash of the dashboard) while
  // the redirect resolves.
  const [redirecting, setRedirecting] = useState(false);
  // The listing-completeness percent the vendor last dismissed the alert at.
  // Re-shows the alert if the percent later changes (read from localStorage so
  // the dismissal survives reloads).
  const [dismissedPct, setDismissedPct] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(COMPLETENESS_DISMISS_KEY);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      // Stats + billing drive the page; both must succeed. The plan badge and
      // upgrade banner read from the canonical billing endpoint rather than
      // re-deriving from stats.billing so the two never disagree.
      const [statsRes, billingRes] = await Promise.all([
        vendorStatsApi.get(),
        vendorBillingApi.get(),
      ]);
      setStats(statsRes);
      setPlan(billingRes.plan);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Best-effort business name for the greeting. A vendor without a listing yet
  // falls back to their account name, then the generic brand label - never
  // blocks the dashboard.
  useEffect(() => {
    let cancelled = false;
    vendorListingApi
      .me()
      .then((view) => {
        if (cancelled) return;
        if (!view.account.onboarding_done) {
          setRedirecting(true);
          navigate("/vendor/onboarding", { replace: true });
          return;
        }
        setBusinessName(view.account.display_name);
      })
      .catch(() => {
        /* no listing/account yet — greeting falls back below */
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const dismissCompleteness = useCallback((pct: number) => {
    setDismissedPct(pct);
    try {
      window.localStorage.setItem(COMPLETENESS_DISMISS_KEY, String(pct));
    } catch {
      /* private mode / storage full - the in-memory dismissal still holds */
    }
  }, []);

  // Reopen the full setup guidance from the collapsed chip. Clearing the stored
  // percent is what re-shows the alert (and keeps it shown across reloads until
  // dismissed again).
  const expandCompleteness = useCallback(() => {
    setDismissedPct(null);
    try {
      window.localStorage.removeItem(COMPLETENESS_DISMISS_KEY);
    } catch {
      /* private mode / storage full - the in-memory expand still holds */
    }
  }, []);

  // Greet the PERSON, not the brand: "Üdv, Mézi" reads right, "Üdv, Mézi
  // Tortaműhely" reads like two names glued together. The business name still
  // owns the shell header + profile chip.
  const greetingName = user?.full_name ?? businessName ?? t("vendor.nav.brand_fallback");

  if (loading || redirecting) {
    return <DashboardSkeleton title={t("vendor.dashboard.page_title")} />;
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

  const isFree = plan === "free";
  const currency = stats.currency;
  const pct = Math.round(stats.listing_completeness);
  const completenessDone = pct >= 100;
  // Dismissing no longer HIDES the setup guidance, it COLLAPSES it to a small
  // persistent progress chip, so an incomplete listing always keeps a visible,
  // reopenable prompt (and the % is never lost until the listing is done).
  const completenessCollapsed = !completenessDone && dismissedPct === pct;

  // Smart action cards derived from the real, fetched data - no invented signals.
  // They only appear once the listing is finished: while it isn't, the setup
  // panel at the top of the page is the recommendation, and a card saying "add
  // a cover photo" next to a checklist row saying "Borítókép" was one task
  // wearing two costumes.
  const actions: ActionCardProps[] = [];
  if (completenessDone) {
    if (stats.upcoming.length > 0) {
      actions.push({
        to: "/vendor/clients",
        icon: <CalendarClock size={18} aria-hidden="true" />,
        title: t("vendor.dashboard.action_upcoming_title", {
          count: String(stats.upcoming.length),
        }),
        body: t("vendor.dashboard.action_upcoming_body"),
        tone: "steel",
      });
    } else {
      actions.push({
        to: "/vendor/listing",
        icon: <CheckCircle2 size={18} aria-hidden="true" />,
        title: t("vendor.dashboard.action_allset_title"),
        body: t("vendor.dashboard.action_allset_body"),
        tone: "sage",
      });
    }
  }

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      {/* The setup surface, and the ONLY place the dashboard recommends
          listing work. SetupLinger keeps it up for the last step's
          tick-strike-fade + confetti instead of yanking it away the instant the
          listing hits 100%. */}
      {!completenessCollapsed && (
        <SetupLinger complete={completenessDone}>
          <VendorSetupPanel
            steps={stats.listing_steps}
            pct={pct}
            onDismiss={() => dismissCompleteness(pct)}
            dismissLabel={t("vendor.dashboard.dismiss")}
          />
        </SetupLinger>
      )}

      {completenessCollapsed && (
        <SetupProgressChip
          pct={pct}
          onExpand={expandCompleteness}
          label={t("vendor.dashboard.completeness_expand")}
        />
      )}

      {/* Greeting */}
      <header>
        <h1 className="font-grotesk text-3xl font-semibold leading-[1.05] tracking-[-0.02em] text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("vendor.dashboard.welcome", { name: greetingName })}
        </h1>
      </header>

      {/* Upgrade banner — only on the FREE tier. */}
      {isFree && (
        <div className="flex flex-col gap-3 rounded-2xl border border-paper-300 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-umber-700">
          <div className="flex items-start gap-3">
            <Sparkles
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-400"
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("vendor.upgrade.title")}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.upgrade.body")}</p>
            </div>
          </div>
          <Link
            to="/vendor/billing"
            className="shrink-0 self-start rounded-xl bg-blush-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blush-600 sm:self-auto"
          >
            {t("vendor.upgrade.cta")}
          </Link>
        </div>
      )}

      {/* HERO metric - last 30 days of inquiries, the number that matters most. */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-sm text-ink-500 dark:text-paper-400">
            <TrendingUp size={15} aria-hidden="true" className="text-ink-400 dark:text-paper-400" />
            {t("vendor.dashboard.hero_label")}
          </span>
          <span className="font-grotesk text-6xl font-semibold leading-none tracking-[-0.03em] text-ink-900 tabular-nums sm:text-7xl dark:text-paper-50">
            <AnimatedNumber value={stats.inquiries_30d} />
          </span>
          <span className="text-sm text-ink-500 dark:text-paper-400">
            {t("vendor.dashboard.hero_hint")}
          </span>
        </div>
        <Link
          to="/vendor/clients"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 self-start rounded-xl bg-blush-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-blush-600 sm:self-auto"
        >
          <span>{t("vendor.dashboard.view_clients")}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>

      {/* Secondary KPIs — each opens the surface behind the number. */}
      {/* Four KPIs divide evenly two-up on small screens and four-up from lg,
          so no row ends ragged and the odd-one-out span hack is unnecessary. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-paper-200 border-y border-paper-200 lg:grid-cols-4 lg:divide-y-0 dark:divide-umber-700 dark:border-umber-700">
        <KpiCard
          icon={<Eye size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.views_30d")}
          value={<AnimatedNumber value={stats.views_30d} />}
          to="/vendor/stats"
          linkLabel={t("vendor.stats.page_title")}
        />
        <KpiCard
          icon={<Inbox size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.inquiries_total")}
          value={<AnimatedNumber value={stats.inquiries_total} />}
          to="/vendor/clients"
          linkLabel={t("vendor.dashboard.view_clients")}
        />
        <KpiCard
          icon={<Wallet size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.revenue_tracked")}
          value={
            <AnimatedNumber
              value={stats.revenue_tracked}
              format={(n) => formatMoney(n, currency, locale)}
            />
          }
          to="/vendor/clients"
          linkLabel={t("vendor.dashboard.view_clients")}
        />
        <KpiCard
          icon={<CalendarOff size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.blocked_dates")}
          value={<AnimatedNumber value={stats.blocked_dates_count} />}
          to="/vendor/calendar"
          linkLabel={t("vendor.dashboard.open_calendar")}
        />
      </div>

      {/* Upcoming events preview + smart action cards. With no cards to show
          (an unfinished listing), upcoming takes the whole width rather than
          leaving a third of the row empty. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section
          className={`flex flex-col gap-2 ${actions.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}`}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-grotesk text-lg font-semibold tracking-[-0.01em] text-ink-900 dark:text-paper-50">
              <CalendarClock
                size={18}
                aria-hidden="true"
                className="text-ink-400 dark:text-paper-400"
              />
              <span>{t("vendor.dashboard.upcoming_title")}</span>
            </h2>
            <Link
              to="/vendor/clients"
              className="inline-flex items-center gap-1 text-sm font-medium text-blush-600 transition-colors hover:text-blush-700 dark:text-blush-300 dark:hover:text-blush-200"
            >
              <span>{t("vendor.dashboard.view_clients")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          {stats.upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500 dark:text-paper-400">
              {t("vendor.dashboard.no_upcoming")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
              {stats.upcoming.map((event) => (
                <li key={event.id}>
                  <Link
                    to={`/vendor/clients/${event.id}`}
                    className="group -mx-2 flex items-center justify-between gap-3 px-2 py-4 transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
                  >
                    <span
                      className="truncate font-medium text-ink-900 dark:text-paper-50"
                      title={event.couple_display_name}
                    >
                      {event.couple_display_name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-ink-500 dark:text-paper-400">
                      {event.event_date
                        ? formatDate(event.event_date, locale)
                        : t("vendor.clients.no_event_date")}
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-paper-400"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {actions.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-grotesk text-lg font-semibold tracking-[-0.01em] text-ink-900 dark:text-paper-50">
              {t("vendor.dashboard.actions_title")}
            </h2>
            <div className="flex flex-col divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
              {actions.map((action) => (
                <ActionCard key={`${action.title}-${action.to}`} {...action} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  to,
  linkLabel,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  to?: string;
  /** Names the destination in the tile, in the same "Ügyfelek megtekintése →"
   *  shape the sections above use. A whole-tile Link with nothing but a hover
   *  tint reads as a static stat: the Foglalt napok tile had been a working
   *  link to the calendar that nobody could tell was one. */
  linkLabel?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-ink-500 dark:text-paper-400">
        <span className="shrink-0">{icon}</span>
        {/* Wraps rather than truncating: on a phone the two-up grid is narrow
            enough that "Követett bevétel" would otherwise read "Követett bev…". */}
        <span className="min-w-0 leading-snug">{label}</span>
        {to && (
          <ChevronRight
            size={16}
            aria-hidden="true"
            className="ml-auto shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-paper-400"
          />
        )}
      </div>
      {/* Wraps (break-words) so a large money value like "1 200 000 Ft" stays
          inside the narrow tile instead of overflowing its right edge. */}
      <div className="break-words font-grotesk text-2xl font-semibold leading-tight tracking-[-0.02em] tabular-nums text-ink-900 sm:text-3xl dark:text-paper-50">
        {value}
      </div>
      {sub && <div className="text-xs text-ink-500 dark:text-paper-400">{sub}</div>}
    </>
  );
  // No frame: the tiles are cells of one hairline grid, which is why the
  // destination is a chevron rather than a labelled link. The whole cell is the
  // hit area, so naming it twice was the old card's compensation for looking
  // static.
  const frame = "group flex flex-col gap-1 px-4 py-5 sm:px-5";
  if (!to) return <div className={frame}>{body}</div>;
  return (
    <Link
      to={to}
      aria-label={linkLabel ? `${label} · ${linkLabel}` : label}
      className={`${frame} transition-colors hover:bg-paper-100 dark:hover:bg-umber-800`}
    >
      {body}
    </Link>
  );
}

type ActionTone = "sage" | "steel";

type ActionCardProps = {
  to: string;
  icon: ReactNode;
  title: string;
  body: string;
  tone: ActionTone;
};

function ActionCard({ to, icon, title, body, tone }: ActionCardProps) {
  const accent =
    tone === "sage" ? "text-sage-600 dark:text-sage-300" : "text-ink-400 dark:text-paper-400";
  return (
    <Link
      to={to}
      className="group -mx-2 flex items-center gap-3 px-2 py-4 transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
    >
      <span className={`shrink-0 ${accent}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-ink-900 dark:text-paper-50">{title}</span>
        <span className="text-sm text-ink-500 dark:text-paper-400">{body}</span>
      </div>
      <ChevronRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-paper-400"
      />
    </Link>
  );
}

function DashboardSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      {/* Hero metric */}
      <div className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-6 dark:border-umber-600 dark:bg-umber-900">
        <Skeleton variant="line" width="40%" height={12} />
        <Skeleton width={140} height={48} rounded="lg" />
        <Skeleton variant="line" width="55%" height={12} />
      </div>
      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900"
          >
            <Skeleton variant="line" width="70%" height={10} />
            <Skeleton width={72} height={24} rounded="md" />
          </div>
        ))}
      </div>
      {/* Upcoming + actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 lg:col-span-2 dark:border-umber-600 dark:bg-umber-900">
          <Skeleton variant="line" width="35%" height={12} />
          <SkeletonText lines={4} />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900"
            >
              <Skeleton variant="circle" width={36} />
              <div className="flex-1">
                <SkeletonText lines={2} lastLineWidth="80%" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
