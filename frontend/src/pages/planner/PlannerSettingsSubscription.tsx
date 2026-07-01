import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlannerBillingStatus } from "@shared/planner_billing";
import type { PlannerStats } from "@shared/types";
import { plannerApi, plannerBillingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export default function PlannerSettingsSubscription() {
  const { t } = useT();
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
            </p>
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

        <div className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700">
          <a href="/app/planner/billing" className="btn-primary block w-full text-center">
            {t(
              readOnly || stats.plan !== "premium"
                ? "planner_profile.subscription_upgrade_cta"
                : "planner_billing.manage_cta",
            )}
          </a>
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
