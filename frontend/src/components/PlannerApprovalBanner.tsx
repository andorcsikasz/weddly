// Surfaces a "a planner is waiting for your approval" prompt on the dashboard
// when a planner invited this couple by email and the consent request is still
// pending (status 'pending' + initiated_by 'planner'). Links to the Planners
// panel in settings/workspace where the couple approves. Renders nothing when
// there's no pending planner-initiated request, so it's safe to mount
// unconditionally near the top of the dashboard.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { couplePlannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export function PlannerApprovalBanner() {
  const { t } = useT();
  const [plannerLabel, setPlannerLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    couplePlannerApi
      .listPlanners()
      .then((r) => {
        if (cancelled) return;
        const pending = r.planners.find(
          (p) => p.status === "pending" && p.initiated_by === "planner",
        );
        setPlannerLabel(pending ? (pending.business_name ?? pending.full_name) : null);
      })
      .catch(() => {
        // Non-fatal — the banner just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!plannerLabel) return null;

  return (
    <div className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-soft dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
        {t("couple_planners.approval_banner_title")}
      </p>
      <p className="mt-1 break-words text-sm text-amber-900/90 hyphens-auto dark:text-amber-200/90">
        {t("couple_planners.approval_banner_body", { planner: plannerLabel })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link to="/app/settings/workspace" className="btn-primary btn-sm">
          {t("couple_planners.approval_banner_cta")}
        </Link>
      </div>
    </div>
  );
}
