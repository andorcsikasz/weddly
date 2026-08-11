import { AlertTriangle, ArrowLeft, Check, CreditCard, Sparkles } from "lucide-react";
import { intlLocale } from "../../lib/format";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerBillingStatus } from "@shared/planner_billing";
import { PLANNER_PLAN_LIMITS, type PlannerPlan, type PlannerStats } from "@shared/types";
import { useToast } from "../../components/ui";
import { plannerApi, plannerBillingApi } from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";

// Plans in upgrade order. Client limits come from the shared source of truth
// (PLANNER_PLAN_LIMITS) so the page never drifts from the backend gate.
const PLAN_ORDER: PlannerPlan[] = ["starter", "pro", "premium"];

// Maps each plan to its existing onboarding i18n keys, so this page reuses the
// planner.* namespace rather than introducing new strings.
const PLAN_KEYS: Record<PlannerPlan, { name: string; tagline: string }> = {
  starter: {
    name: "planner_onboarding.plan_starter_name",
    tagline: "planner_onboarding.plan_starter_tagline",
  },
  pro: {
    name: "planner_onboarding.plan_pro_name",
    tagline: "planner_onboarding.plan_pro_tagline",
  },
  premium: {
    name: "planner_onboarding.plan_premium_name",
    tagline: "planner_onboarding.plan_premium_tagline",
  },
};

// Truthful feature list per plan, additive up the tiers. Each entry is an i18n
// key under planner_billing.feat_*; the client-count line is rendered
// separately so it can interpolate PLANNER_PLAN_LIMITS.
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

/** Currency-format a whole-unit monthly price (EUR 29 → "€29", HUF 6900 →
 *  "6 900 Ft") following the couple/vendor display convention. */
function formatPrice(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function PlannerBillingPage() {
  const { t } = useT();
  useDocumentMeta("planner_billing.meta_title", "planner_billing.meta_description");
  const [billing, setBilling] = useState<PlannerBillingStatus | null>(null);
  const [stats, setStats] = useState<PlannerStats | null>(null);

  useEffect(() => {
    plannerBillingApi
      .status()
      .then(setBilling)
      .catch(() => {});
    plannerApi
      .stats()
      .then((r) => setStats(r.stats))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-4xl py-2">
      <Link
        to="/app/planner/settings/subscription"
        className="inline-flex items-center gap-1.5 text-xs text-umber-500 hover:text-umber-700 dark:text-umber-400 dark:hover:text-paper-200"
      >
        <ArrowLeft size={13} />
        {t("planner_nav.settings")}
      </Link>

      <h1 className="mt-3 font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
        {t("planner_profile.subscription_heading")}
      </h1>

      {!billing ? (
        <div className="mt-8 h-48 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />
      ) : (
        <BillingBody billing={billing} stats={stats} />
      )}
    </div>
  );
}

function BillingBody({
  billing,
  stats,
}: {
  billing: PlannerBillingStatus;
  stats: PlannerStats | null;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [pendingTier, setPendingTier] = useState<PlannerPlan | null>(null);
  const [portalPending, setPortalPending] = useState(false);

  const { billing: b, currency, prices, founding_spots_left } = billing;
  const status = b.subscription_status;
  const hasStripeSub = status === "active" || status === "past_due" || status === "canceled";

  async function handleCheckout(tier: PlannerPlan) {
    setPendingTier(tier);
    try {
      const { url } = await plannerBillingApi.checkout(tier);
      if (url) window.location.href = url;
    } catch {
      toast.error(t("planner_billing.checkout_error"));
      setPendingTier(null);
    }
  }

  async function handlePortal() {
    setPortalPending(true);
    try {
      const { url } = await plannerBillingApi.portal();
      if (url) window.location.href = url;
    } catch {
      toast.error(t("planner_billing.checkout_error"));
      setPortalPending(false);
    }
  }

  const usedPct =
    stats && stats.max_clients > 0
      ? Math.min(100, Math.round((stats.active_clients / stats.max_clients) * 100))
      : 0;

  return (
    <div className="mt-8 space-y-8">
      {/* Status banner — reflects the live subscription state. */}
      <StatusBanner billing={b} locale={locale} />

      {founding_spots_left > 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-eucalyptus-700 dark:text-eucalyptus-300">
          <Sparkles size={13} className="shrink-0" />
          {t("planner_billing.founding_spots", { n: founding_spots_left })}
        </p>
      )}

      {/* Current plan + usage */}
      <div className="card">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("planner_profile.subscription_plan_label")}
        </p>
        <p className="mt-1 font-grotesk text-2xl font-semibold capitalize tracking-tight text-umber-900 dark:text-paper-50">
          {t(PLAN_KEYS[b.tier].name)}
        </p>

        {stats && (
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
        )}

        {billing.enabled && hasStripeSub && (
          <button
            type="button"
            onClick={() => void handlePortal()}
            disabled={portalPending}
            className="btn-ghost mt-6 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <CreditCard size={15} aria-hidden="true" />
            {t("planner_billing.manage_cta")}
          </button>
        )}
      </div>

      {/* Plan comparison + per-tier checkout */}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const isCurrent = b.tier === plan && b.entitled;
          return (
            <div
              key={plan}
              className={`card flex flex-col ${
                isCurrent
                  ? "border-2 border-eucalyptus-400 dark:border-eucalyptus-500"
                  : "border border-paper-200 dark:border-umber-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
                  {t(PLAN_KEYS[plan].name)}
                </p>
                {isCurrent && (
                  <span className="rounded-full bg-eucalyptus-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-eucalyptus-800 dark:bg-eucalyptus-900/30 dark:text-eucalyptus-300">
                    {t("planner_onboarding.plan_active_badge")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-umber-400 dark:text-umber-500">
                {t(PLAN_KEYS[plan].tagline)}
              </p>

              <div className="mt-4 border-t border-paper-200 pt-4 dark:border-umber-800">
                <p className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                  {t("planner_billing.price_per_month", {
                    price: formatPrice(prices[plan], currency, locale),
                  })}
                </p>
              </div>

              <ul className="mt-4 space-y-2 text-sm text-umber-700 dark:text-umber-300">
                <li className="flex items-start gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-eucalyptus-500" />
                  <span>
                    {t("planner_billing.feat_clients", { count: PLANNER_PLAN_LIMITS[plan] })}
                  </span>
                </li>
                {PLAN_FEATURES[plan].map((featKey) => (
                  <li key={featKey} className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 shrink-0 text-eucalyptus-500" />
                    <span>{t(featKey)}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="mt-5 pt-1">
                {isCurrent ? (
                  <button type="button" disabled className="btn-ghost w-full opacity-60">
                    {t("planner_billing.cta_current")}
                  </button>
                ) : !billing.checkout_enabled ? (
                  <p className="text-center text-[11px] text-umber-400 dark:text-umber-500">
                    {t("planner_billing.disabled_note")}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleCheckout(plan)}
                    disabled={pendingTier !== null}
                    className="btn-primary w-full disabled:opacity-60"
                  >
                    {t(
                      hasStripeSub ? "planner_billing.cta_switch" : "planner_billing.cta_subscribe",
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Live subscription-state banner: founding window, trial countdown, active,
 *  payment issue, or a read-only warning once access lapses. */
function StatusBanner({
  billing,
  locale,
}: {
  billing: PlannerBillingStatus["billing"];
  locale: Locale;
}) {
  const { t } = useT();
  const status = billing.subscription_status;

  const fmtDate = (ms: number) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(ms));

  if (!billing.entitled) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{t("planner_billing.state_readonly")}</span>
      </div>
    );
  }

  let label: string;
  if (status === "founding") {
    label = t("planner_billing.state_founding", {
      date: billing.founding_until ? fmtDate(billing.founding_until) : "—",
    });
  } else if (status === "trialing") {
    const days = billing.trial_ends_at
      ? Math.max(0, Math.ceil((billing.trial_ends_at - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
    label = t("planner_billing.state_trial", { days });
  } else if (status === "past_due") {
    label = t("planner_billing.state_past_due");
  } else {
    label = t("planner_billing.state_active");
  }

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-eucalyptus-300 bg-eucalyptus-50 px-4 py-3 text-sm text-eucalyptus-900 dark:border-eucalyptus-500/40 dark:bg-eucalyptus-500/15 dark:text-eucalyptus-200">
      <Sparkles size={16} className="mt-0.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
