// Vendor dashboard — the home surface for a role='vendor' user at /vendor.
// Renders inside VendorShell. Greets the vendor by business name, then acts as a
// command center: a completeness alert strip, a hero "last 30 days" inquiries
// number with secondary KPIs, contextual smart-action cards derived from the
// real fetched data, and a preview of upcoming Weddly-sourced bookings. FREE-tier
// vendors see a graceful upgrade banner; nothing here is PRO-gated.

import {
  ArrowRight,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ChevronDown,
  Image as ImageIcon,
  Inbox,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorPlan } from "@shared/vendor_plan";
import { Skeleton, SkeletonText } from "../../components/ui";
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
  // Captured from the listing view so the smart-action cards can suggest a cover
  // photo when the hero image is still missing.
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
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

  // Best-effort business name + hero image for the greeting and action cards. A
  // vendor without a listing yet falls back to their account name, then the
  // generic brand label - never blocks the dashboard.
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
        setHeroImageUrl(view.listing.hero_image_url);
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
  const revenuePositive = stats.revenue_tracked > 0;
  // Dismissing no longer HIDES the setup guidance, it COLLAPSES it to a small
  // persistent progress chip, so an incomplete listing always keeps a visible,
  // reopenable prompt (and the % is never lost until the listing is done).
  const completenessCollapsed = !completenessDone && dismissedPct === pct;
  const showCompletenessAlert = !completenessDone && !completenessCollapsed;

  // Smart action cards derived from the real, fetched data - no invented signals.
  const actions: ActionCardProps[] = [];
  if (heroImageUrl == null) {
    actions.push({
      to: "/vendor/listing",
      icon: <ImageIcon size={18} aria-hidden="true" />,
      title: t("vendor.dashboard.action_cover_title"),
      body: t("vendor.dashboard.action_cover_body"),
      tone: "steel",
    });
  }
  if (stats.upcoming.length > 0) {
    actions.push({
      to: "/vendor/clients",
      icon: <CalendarClock size={18} aria-hidden="true" />,
      title: t("vendor.dashboard.action_upcoming_title", { count: String(stats.upcoming.length) }),
      body: t("vendor.dashboard.action_upcoming_body"),
      tone: "steel",
    });
  }
  if (actions.length === 0) {
    actions.push({
      to: "/vendor/listing",
      icon: <CheckCircle2 size={18} aria-hidden="true" />,
      title: t("vendor.dashboard.action_allset_title"),
      body: t("vendor.dashboard.action_allset_body"),
      tone: "sage",
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Completeness alert strip - the full setup prompt, shown while the
          listing is incomplete and not collapsed. A live progress ring replaces
          the old static sparkle so the percent reads at a glance. */}
      {showCompletenessAlert && (
        <div className="flex items-start gap-3 rounded-2xl border border-steel-200 bg-steel-50 p-4 dark:border-steel-600/30 dark:bg-steel-600/15">
          <CompletenessRing pct={pct} size={36} stroke={4} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
              {t("vendor.dashboard.completeness_alert", { pct: String(pct) })}
            </p>
            <p className="text-sm text-ink-600 dark:text-paper-300">
              {t("vendor.dashboard.completeness_alert_body")}
            </p>
            <Link
              to="/vendor/listing"
              className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
            >
              <span>{t("vendor.dashboard.complete_now")}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <button
            type="button"
            onClick={() => dismissCompleteness(pct)}
            aria-label={t("vendor.dashboard.dismiss")}
            className="-m-1 shrink-0 rounded-lg p-1 text-ink-500 transition-colors hover:bg-steel-100 hover:text-ink-900 dark:text-paper-400 dark:hover:bg-steel-600/20 dark:hover:text-paper-50"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Collapsed setup progress: a small, persistent, reopenable chip. Keeps
          the % visible and one click from the full guidance, instead of the old
          dismiss-and-it-is-gone behaviour. */}
      {completenessCollapsed && (
        <button
          type="button"
          onClick={expandCompleteness}
          aria-label={t("vendor.dashboard.completeness_expand")}
          className="inline-flex items-center gap-2 self-start rounded-full border border-steel-200 bg-steel-50 py-1.5 pl-2 pr-3.5 text-sm text-ink-700 transition-colors hover:bg-steel-100 dark:border-steel-600/30 dark:bg-steel-600/15 dark:text-paper-200 dark:hover:bg-steel-600/25"
        >
          <CompletenessRing pct={pct} />
          <span className="font-medium">
            {t("vendor.dashboard.completeness_chip", { pct: String(pct) })}
          </span>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className="text-steel-500 dark:text-steel-300"
          />
        </button>
      )}

      {/* Greeting */}
      <header>
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.dashboard.welcome", { name: greetingName })}
        </h1>
      </header>

      {/* Upgrade banner — only on the FREE tier. */}
      {isFree && (
        <div className="flex flex-col gap-3 rounded-2xl border border-steel-200 bg-steel-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-steel-600/30 dark:bg-steel-600/15">
          <div className="flex items-start gap-3">
            <Sparkles
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-steel-700 dark:text-steel-300"
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
            className="shrink-0 self-start rounded-xl bg-steel-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-steel-700 sm:self-auto"
          >
            {t("vendor.upgrade.cta")}
          </Link>
        </div>
      )}

      {/* HERO metric - last 30 days of inquiries, the number that matters most. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-umber-600 dark:bg-umber-900">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-steel-600 dark:text-steel-300">
            <TrendingUp size={16} aria-hidden="true" />
            {t("vendor.dashboard.hero_label")}
          </span>
          <span className="font-grotesk text-5xl font-semibold leading-none tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
            {stats.inquiries_30d}
          </span>
          <span className="text-sm text-ink-600 dark:text-paper-300">
            {t("vendor.dashboard.hero_hint")}
          </span>
        </div>
        <Link
          to="/vendor/clients"
          className="inline-flex shrink-0 items-center gap-1 self-start rounded-xl border border-paper-300 px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-100 sm:self-auto dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
        >
          <span>{t("vendor.dashboard.view_clients")}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>

      {/* Secondary KPIs — each opens the surface behind the number. */}
      {/* Three KPIs: two per row on small screens with the odd third spanning
          the full width (no lonely half-empty row), three-up from lg. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <KpiCard
          icon={<Inbox size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.inquiries_total")}
          value={String(stats.inquiries_total)}
          to="/vendor/clients"
        />
        <KpiCard
          icon={<Wallet size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.revenue_tracked")}
          value={formatMoney(stats.revenue_tracked, currency, locale)}
          tone={revenuePositive ? "sage" : undefined}
          to="/vendor/clients"
        />
        <KpiCard
          icon={<CalendarOff size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.blocked_dates")}
          value={String(stats.blocked_dates_count)}
          to="/vendor/calendar"
        />
      </div>

      {/* Upcoming events preview + smart action cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
              <CalendarClock
                size={18}
                aria-hidden="true"
                className="text-steel-600 dark:text-steel-300"
              />
              <span>{t("vendor.dashboard.upcoming_title")}</span>
            </h2>
            <Link
              to="/vendor/clients"
              className="inline-flex items-center gap-1 text-sm font-medium text-steel-600 transition-colors hover:text-steel-700 dark:text-steel-300 dark:hover:text-steel-200"
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
            <ul className="flex flex-col divide-y divide-paper-200 dark:divide-umber-700">
              {stats.upcoming.map((event) => (
                <li key={event.id}>
                  <Link
                    to={`/vendor/clients/${event.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
                  >
                    <span
                      className="truncate text-sm font-medium text-ink-900 dark:text-paper-50"
                      title={event.couple_display_name}
                    >
                      {event.couple_display_name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-ink-600 dark:text-paper-300">
                      {event.event_date
                        ? formatDate(event.event_date, locale)
                        : t("vendor.clients.no_event_date")}
                      <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {t("vendor.dashboard.actions_title")}
          </h2>
          <div className="flex flex-col gap-3">
            {actions.map((action) => (
              <ActionCard key={`${action.title}-${action.to}`} {...action} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Listing-setup completion ring. Pure tokenised SVG (no chart lib), it
 *  animates as the percent climbs and is shared by the full setup alert and its
 *  collapsed chip so progress reads identically in both states. A small step
 *  toward the fuller onboarding module. */
function CompletenessRing({
  pct,
  size = 20,
  stroke = 3,
}: {
  pct: number;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="-rotate-90 shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-steel-200 dark:stroke-steel-600/40"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="stroke-steel-600 transition-[stroke-dashoffset] duration-700 ease-out dark:stroke-steel-300"
      />
    </svg>
  );
}

type KpiTone = "sage";

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
  to?: string;
}) {
  const iconTone =
    tone === "sage" ? "text-sage-600 dark:text-sage-300" : "text-steel-600 dark:text-steel-300";
  const valueTone =
    tone === "sage" ? "text-sage-700 dark:text-sage-300" : "text-ink-900 dark:text-paper-50";
  const body = (
    <>
      <div className={`flex items-center gap-2 ${iconTone}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      {/* Shrinks a notch on mobile and wraps (break-words) so a large money
          value like "1 200 000 Ft" stays inside the narrow tile instead of
          overflowing its right edge. */}
      <div
        className={`break-words text-center text-xl font-semibold leading-tight tabular-nums sm:text-2xl ${valueTone}`}
      >
        {value}
      </div>
      {sub && <div className="text-center text-xs text-ink-500 dark:text-paper-400">{sub}</div>}
    </>
  );
  const frame =
    "flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-600 dark:bg-umber-900";
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
    tone === "sage" ? "text-sage-600 dark:text-sage-300" : "text-steel-700 dark:text-steel-300";
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 transition-colors hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-900 dark:hover:bg-umber-800"
    >
      <span className={`mt-0.5 shrink-0 ${accent}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1 text-sm font-medium text-ink-900 dark:text-paper-50">
          <span className="truncate">{title}</span>
          <ArrowRight
            size={15}
            aria-hidden="true"
            className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 dark:text-paper-400"
          />
        </span>
        <span className="text-sm text-ink-600 dark:text-paper-300">{body}</span>
      </div>
    </Link>
  );
}

function DashboardSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
