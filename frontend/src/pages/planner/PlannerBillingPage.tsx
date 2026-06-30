import { ArrowLeft, BellRing, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PLANNER_PLAN_LIMITS, type PlannerPlan, type PlannerStats } from "@shared/types";
import { useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
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

export default function PlannerBillingPage() {
  const { t } = useT();
  useDocumentMeta("planner_billing.meta_title", "planner_billing.meta_description");
  const [stats, setStats] = useState<PlannerStats | null>(null);

  useEffect(() => {
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

      {!stats ? (
        <div className="mt-8 h-48 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />
      ) : (
        <BillingBody stats={stats} />
      )}
    </div>
  );
}

function BillingBody({ stats }: { stats: PlannerStats }) {
  const { t } = useT();

  const usedPct =
    stats.max_clients > 0
      ? Math.min(100, Math.round((stats.active_clients / stats.max_clients) * 100))
      : 0;

  return (
    <div className="mt-8 space-y-8">
      {/* Current plan + usage */}
      <div className="card">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("planner_profile.subscription_plan_label")}
        </p>
        <p className="mt-1 font-grotesk text-2xl font-semibold capitalize tracking-tight text-umber-900 dark:text-paper-50">
          {t(PLAN_KEYS[stats.plan].name)}
        </p>

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
      </div>

      {/* Plan comparison */}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const isActive = stats.plan === plan;
          return (
            <div
              key={plan}
              className={`card flex flex-col ${
                isActive
                  ? "border-2 border-eucalyptus-400 dark:border-eucalyptus-500"
                  : "border border-paper-200 dark:border-umber-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
                  {t(PLAN_KEYS[plan].name)}
                </p>
                {isActive && (
                  <span className="rounded-full bg-eucalyptus-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-eucalyptus-800 dark:bg-eucalyptus-900/30 dark:text-eucalyptus-300">
                    {t("planner_onboarding.plan_active_badge")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs uppercase tracking-wide text-umber-400 dark:text-umber-500">
                {t(PLAN_KEYS[plan].tagline)}
              </p>

              {/* Price - paid plans aren't wired yet, so this is coming-soon. */}
              <div className="mt-4 border-t border-paper-200 pt-4 dark:border-umber-800">
                <p className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                  {t("planner_billing.price_soon")}
                </p>
                <p className="mt-0.5 text-[11px] text-umber-400 dark:text-umber-500">
                  {t("planner_billing.price_note")}
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
            </div>
          );
        })}
      </div>

      {/* Upgrade CTA - paid plans not wired yet, so this gathers notify intent. */}
      {stats.plan !== "premium" && <NotifyCta />}
    </div>
  );
}

// Shared coming-soon + notify-me block. Lets a planner opt in to be told when
// paid plans launch (plannerApi.notifyPlans is idempotent), with a confirmed
// state so the button doesn't invite repeat taps.
export function NotifyCta() {
  const { t } = useT();
  const toast = useToast();
  const [notified, setNotified] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleNotify() {
    setPending(true);
    try {
      await plannerApi.notifyPlans();
      setNotified(true);
      toast.success(t("planner_billing.notify_toast"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card text-center">
      <p className="text-sm text-umber-600 dark:text-umber-300">
        {t("planner_onboarding.plan_coming_soon")}
      </p>
      {notified ? (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-moss-50 px-4 py-2 text-sm font-medium text-moss-800 dark:bg-moss-900/30 dark:text-moss-200">
          <Check size={15} aria-hidden="true" />
          {t("planner_billing.notify_done")}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void handleNotify()}
          disabled={pending}
          className="btn-primary mt-4 inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          <BellRing size={15} aria-hidden="true" />
          {t("planner_billing.notify_cta")}
        </button>
      )}
    </div>
  );
}
