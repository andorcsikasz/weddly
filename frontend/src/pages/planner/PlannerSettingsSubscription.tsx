import { useEffect, useState } from "react";
import type { PlannerStats } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export default function PlannerSettingsSubscription() {
  const { t } = useT();
  const [stats, setStats] = useState<PlannerStats | null>(null);

  useEffect(() => {
    plannerApi.stats().then((r) => setStats(r.stats)).catch(() => {});
  }, []);

  if (!stats) {
    return <div className="mt-8 h-48 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />;
  }

  const usedPct = stats.max_clients > 0
    ? Math.round((stats.active_clients / stats.max_clients) * 100)
    : 0;

  return (
    <div className="mt-8 space-y-6">
      <div className="card">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("planner_profile.subscription_plan_label")}
        </p>
        <p className="mt-1 font-grotesk text-2xl font-semibold capitalize tracking-tight text-umber-900 dark:text-paper-50">
          {stats.plan}
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
              className="h-full rounded-full bg-umber-800 transition-all dark:bg-umber-400"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>

        {stats.plan !== "premium" && (
          <div className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700">
            <a
              href="/app/planner/billing"
              className="btn-primary block w-full text-center"
            >
              {t("planner_profile.subscription_upgrade_cta")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
