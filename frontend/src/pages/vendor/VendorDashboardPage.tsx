// Vendor dashboard — the home surface for a role='vendor' user at /vendor.
// Renders inside VendorShell. Greets the vendor by business name, rolls up the
// key counters from vendorStatsApi.get() (total + 30-day inquiries, revenue
// tracked, blocked dates, listing completeness, plan status), previews the
// upcoming Weddly-sourced bookings, and offers quick links into the listing,
// stats, and billing surfaces. FREE-tier vendors see a graceful upgrade banner;
// nothing here is PRO-gated, so the page always renders the basics.

import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarOff,
  CreditCard,
  Inbox,
  RefreshCw,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VendorStats } from "@shared/vendor_clients";
import type { VendorPlan } from "@shared/vendor_plan";
import { vendorBillingApi, vendorListingApi, vendorStatsApi } from "../../lib/endpoints";
import { formatDate, formatMoney } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";

export default function VendorDashboardPage() {
  const { t, locale } = useT();
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
  // falls back to their account name, then the generic brand label — never
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

  const greetingName = businessName ?? user?.full_name ?? t("vendor.nav.brand_fallback");

  if (loading || redirecting) {
    return <DashboardSkeleton title={t("vendor.dashboard.page_title")} />;
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

  const isFree = plan === "free";
  const currency = stats.currency;

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor.dashboard.welcome", { name: greetingName })}
        </h1>
        <p className="text-sm text-ink-600 dark:text-paper-300">
          {t("vendor.dashboard.page_body")}
        </p>
      </header>

      {/* Upgrade banner — only on the FREE tier. */}
      {isFree && (
        <div className="flex flex-col gap-3 rounded-2xl border border-blush-200 bg-blush-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-blush-400/30 dark:bg-blush-400/10">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-200 text-ink-900 dark:bg-blush-400/20 dark:text-paper-50">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("vendor.upgrade.title")}
              </p>
              <p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.upgrade.body")}</p>
            </div>
          </div>
          <Link to="/vendor/billing" className="btn-primary shrink-0 self-start sm:self-auto">
            {t("vendor.upgrade.cta")}
          </Link>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiCard
          icon={<Inbox size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.inquiries_total")}
          value={String(stats.inquiries_total)}
        />
        <KpiCard
          icon={<TrendingUp size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.inquiries_30d")}
          value={String(stats.inquiries_30d)}
        />
        <KpiCard
          icon={<Wallet size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.revenue_tracked")}
          value={formatMoney(stats.revenue_tracked, currency, locale)}
        />
        <KpiCard
          icon={<CalendarOff size={18} aria-hidden="true" />}
          label={t("vendor.dashboard.blocked_dates")}
          value={String(stats.blocked_dates_count)}
        />
        <KpiCard
          icon={<BarChart3 size={18} aria-hidden="true" />}
          label={t("vendor.stats.completeness")}
          value={`${Math.round(stats.listing_completeness)}%`}
        />
        <KpiCard
          icon={<CreditCard size={18} aria-hidden="true" />}
          label={t("vendor.billing.current_plan")}
          value={t(isFree ? "vendor.plan.free_label" : "vendor.plan.pro_label")}
          sub={t(
            stats.billing.entitled ? "vendor.billing.entitled_yes" : "vendor.billing.entitled_no",
          )}
        />
      </div>

      {/* Upcoming events preview + quick links */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 flex flex-col gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
              <CalendarClock size={18} aria-hidden="true" />
              <span>{t("vendor.dashboard.upcoming_title")}</span>
            </h2>
            <Link
              to="/vendor/clients"
              className="inline-flex items-center gap-1 text-sm font-medium text-ink-700 transition-colors hover:text-ink-900 dark:text-paper-200 dark:hover:text-blush-300"
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
                    <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
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

        <section className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-900">
          <QuickLink
            to="/vendor/clients"
            icon={<Inbox size={18} aria-hidden="true" />}
            label={t("vendor.nav.clients")}
          />
          <QuickLink
            to="/vendor/listing"
            icon={<Store size={18} aria-hidden="true" />}
            label={t("vendor.dashboard.view_listing")}
          />
          <QuickLink
            to="/vendor/stats"
            icon={<BarChart3 size={18} aria-hidden="true" />}
            label={t("vendor.nav.stats")}
          />
          <QuickLink
            to="/vendor/billing"
            icon={<CreditCard size={18} aria-hidden="true" />}
            label={t("vendor.nav.billing")}
          />
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900">
      <div className="flex items-center gap-2 text-ink-500 dark:text-paper-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-ink-900 dark:text-paper-50">{value}</div>
      {sub && <div className="text-xs text-ink-500 dark:text-paper-400">{sub}</div>}
    </div>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
    >
      <span className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

function DashboardSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="font-serif text-2xl italic text-ink-900 sm:text-3xl dark:text-paper-50">
        {title}
      </h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-56 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 lg:col-span-2 dark:border-umber-700 dark:bg-umber-800" />
        <div className="h-56 animate-pulse rounded-2xl border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800" />
      </div>
    </div>
  );
}
