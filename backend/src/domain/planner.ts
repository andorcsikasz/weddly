// Planner-account domain helpers (distinct from couple-side `planning.ts`).

import { PLANNER_PLAN_LIMITS, type PlannerPlan } from "@shared/types";

/** The public waitlist captures plans as basic/pro/unlimited; the planner
 *  account model uses starter/pro/premium. Map one to the other so a planner's
 *  waitlist choice carries straight into their account. Defaults to starter. */
export function waitlistPlanToPlannerPlan(selected: string | null | undefined): PlannerPlan {
  switch (selected) {
    case "basic":
      return "starter";
    case "pro":
      return "pro";
    case "unlimited":
      return "premium";
    default:
      return "starter";
  }
}

/** Client cap for a planner plan. Keeps `planner_max_clients` in lockstep with
 *  `planner_plan` whenever the plan is (re)applied. */
export function plannerPlanMaxClients(plan: PlannerPlan): number {
  return PLANNER_PLAN_LIMITS[plan];
}

const PLANNER_PLANS: readonly PlannerPlan[] = ["starter", "pro", "premium"];

export function isPlannerPlan(v: unknown): v is PlannerPlan {
  return typeof v === "string" && PLANNER_PLANS.includes(v as PlannerPlan);
}
