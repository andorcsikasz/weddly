import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PLANNER_PLAN_LIMITS, type PlannerPlan, type PlannerStats } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

// Plans in upgrade order. Client limits come from the shared source of truth
// (PLANNER_PLAN_LIMITS) so the page never drifts from the backend gate.
const PLAN_ORDER: PlannerPlan[] = ["starter", "pro", "premium"];

// Maps each plan to its existing onboarding i18n keys, so this page reuses the
// planner.* namespace rather than introducing new strings.
const PLAN_KEYS: Record<PlannerPlan, { name: string; clients: string; tagline: string }> = {
  starter: {
    name: "planner_onboarding.plan_starter_name",
    clients: "planner_onboarding.plan_starter_clients",
    tagline: "planner_onboarding.plan_starter_tagline",
  },
  pro: {
    name: "planner_onboarding.plan_pro_name",
    clients: "planner_onboarding.plan_pro_clients",
    tagline: "planner_onboarding.plan_pro_tagline",
  },
  premium: {
    name: "planner_onboarding.plan_premium_name",
    clients: "planner_onboarding.plan_premium_clients",
    tagline: "planner_onboarding.plan_premium_tagline",
  },
};

export default function PlannerBillingPage() {
  const { t } = useT();
  const [stats, setStats] = useState<PlannerStats | null>(null);

  useEffect(() => {
    plannerApi
      .stats()
      .then((r) => setStats(r.stats))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/app/planner"
          className="inline-flex items-center gap-1.5 text-xs text-umber-500 hover:text-umber-700 dark:text-umber-400 dark:hover:text-paper-200"
        >
          <ArrowLeft size={13} />
          {t("planner_home.back_to_planner")}
        </Link>

        <h1 className="mt-3 font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planner_profile.subscription_heading")}
        </h1>

        {!stats ? (
          <div className="mt-8 h-48 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />
        ) : (
          <BillingBody stats={stats} />
        )}
      </main>
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

              <ul className="mt-4 space-y-2 text-sm text-umber-700 dark:text-umber-300">
                <li className="flex items-start gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-eucalyptus-500" />
                  <span>{t(PLAN_KEYS[plan].clients)}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-eucalyptus-500" />
                  <span>
                    {t("planner_home.kpi_active_clients")}: {PLANNER_PLAN_LIMITS[plan]}
                  </span>
                </li>
              </ul>
            </div>
          );
        })}
      </div>

      {/* Upgrade CTA — paid plans not wired yet, so this surfaces intent only. */}
      {stats.plan !== "premium" && (
        <div className="card text-center">
          <button
            type="button"
            disabled
            className="btn-primary w-full cursor-not-allowed opacity-60"
          >
            {t("planner_profile.subscription_upgrade_cta")}
          </button>
          <p className="mt-3 text-xs text-umber-500 dark:text-umber-400">
            {t("planner_onboarding.plan_coming_soon")}
          </p>
        </div>
      )}
    </div>
  );
}
