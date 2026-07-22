import { AlertTriangle, Check } from "lucide-react";
import { intlLocale } from "../../lib/format";
import { useEffect, useState } from "react";
import type { PlannerBillingStatus } from "@shared/planner_billing";
import type { PlannerPlan, PlannerStats } from "@shared/types";
import { plannerApi, plannerBillingApi } from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";

// Same truthful per-tier feature keys as PlannerBillingPage; the client-count
// line interpolates the live max_clients instead.
const PLAN_FEATURES: Record<PlannerPlan, string[]> = {
  starter: ["planner_billing.feat_messaging", "planner_billing.feat_references"],
  pro: [
    "planner_billing.feat_messaging",
    "planner_billing.feat_calendar",
    "planner_billing.feat_references",
    "planner_billing.feat_stats",
  ],
  premium: [
    "planner_billing.feat_messaging",
    "planner_billing.feat_calendar",
    "planner_billing.feat_references",
    "planner_billing.feat_stats",
    "planner_billing.feat_priority_support",
  ],
};

function formatPrice(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function PlannerSettingsSubscription() {
  const { t, locale } = useT();
  const [stats, setStats] = useState<PlannerStats | null>(null);
  const [billing, setBilling] = useState<PlannerBillingStatus | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    plannerApi
      .stats()
      .then((r) => {
        setStats(r.stats);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
    plannerBillingApi
      .status()
      .then(setBilling)
      .catch(() => {});
  }, []);

  if (!stats) {
    if (loadError) {
      return (
        <p
          role="alert"
          className="mt-8 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
        >
          {t("planner_profile.load_error")}
        </p>
      );
    }
    return <div className="mt-8 h-48 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />;
  }

  const usedPct =
    stats.max_clients > 0 ? Math.round((stats.active_clients / stats.max_clients) * 100) : 0;
  const b = billing?.billing;
  const stateKey = b ? stateLabelKey(b.subscription_status, b.entitled) : null;
  const readOnly = b !== undefined && b !== null && !b.entitled;

  const fmtDate = (ms: number) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long" }).format(
      new Date(ms),
    );
  // One factual line about where the plan stands: founding window end, trial
  // days left, or the next paid renewal date.
  let stateDetail: string | null = null;
  if (b?.subscription_status === "founding" && b.founding_until) {
    stateDetail = t("planner_billing.state_founding", { date: fmtDate(b.founding_until) });
  } else if (b?.subscription_status === "trialing" && b.trial_ends_at) {
    const days = Math.max(0, Math.ceil((b.trial_ends_at - Date.now()) / (1000 * 60 * 60 * 24)));
    stateDetail = t("planner_billing.state_trial", { days });
  } else if (b?.entitled && b.current_period_end) {
    stateDetail = t("planner_billing.renews_on", { date: fmtDate(b.current_period_end) });
  }
  const tier = b?.tier ?? stats.plan;
  const price = billing ? billing.prices[tier] : null;

  return (
    <div className="mt-8 space-y-6">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
              {t("planner_profile.subscription_plan_label")}
            </p>
            <p className="mt-1 font-grotesk text-2xl font-semibold capitalize tracking-tight text-umber-900 dark:text-paper-50">
              {stats.plan}
              {price != null && billing && (
                <span className="ml-2 align-middle font-sans text-sm font-normal normal-case text-umber-500 dark:text-umber-400">
                  {t("planner_billing.price_per_month", {
                    price: formatPrice(price, billing.currency, locale),
                  })}
                </span>
              )}
            </p>
            {stateDetail && (
              <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">{stateDetail}</p>
            )}
          </div>
          {stateKey && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                readOnly
                  ? "bg-blush-100 text-blush-700 dark:bg-blush-400/20 dark:text-blush-300"
                  : "bg-eucalyptus-100 text-eucalyptus-800 dark:bg-eucalyptus-900/30 dark:text-eucalyptus-300"
              }`}
            >
              {t(stateKey)}
            </span>
          )}
        </div>

        {readOnly && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-blush-200 bg-blush-50 px-3 py-2 text-sm text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{t("planner_billing.state_readonly")}</span>
          </p>
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-umber-700 dark:text-umber-300">
              {t("planner_profile.subscription_clients_label")}
            </span>
            <span className="font-medium text-umber-900 dark:text-paper-50">
              {stats.active_clients} / {stats.max_clients}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
            <div
              className="h-full rounded-full bg-eucalyptus-500 transition-all dark:bg-eucalyptus-400"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>

        {/* What the current tier includes, so upgrade/downgrade is an informed
            call without leaving the page. */}
        <ul className="mt-6 space-y-1.5 border-t border-paper-200 pt-4 text-sm text-umber-700 dark:border-umber-700 dark:text-umber-300">
          <li className="flex items-center gap-2">
            <Check size={14} className="shrink-0 text-eucalyptus-600 dark:text-eucalyptus-400" />
            {t("planner_billing.feat_clients", { count: stats.max_clients })}
          </li>
          {PLAN_FEATURES[tier].map((key) => (
            <li key={key} className="flex items-center gap-2">
              <Check size={14} className="shrink-0 text-eucalyptus-600 dark:text-eucalyptus-400" />
              {t(key as Parameters<typeof t>[0])}
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700">
          <a href="/app/planner/billing" className="btn-primary block w-full text-center">
            {t(
              readOnly || stats.plan !== "premium"
                ? "planner_profile.subscription_upgrade_cta"
                : "planner_billing.manage_cta",
            )}
          </a>
          <p className="mt-2 text-center text-xs text-umber-400 dark:text-umber-500">
            {t("planner_billing.compare_hint")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Compact state chip label for a planner subscription. */
function stateLabelKey(status: string, entitled: boolean): string {
  if (!entitled) return "planner_billing.state_readonly_short";
  if (status === "founding") return "planner_onboarding.plan_active_badge";
  if (status === "trialing") return "planner_billing.state_trial_short";
  if (status === "past_due") return "planner_billing.state_past_due";
  return "planner_billing.state_active";
}
