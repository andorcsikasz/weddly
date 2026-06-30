// Planner-account domain helpers (distinct from couple-side `planning.ts`).

import { PLANNER_PLAN_LIMITS, type PlannerPlan } from "@shared/types";
import { db, now } from "../db";

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

/** Self-serve planner grant. Flips a user to `user_type='planner'` so they can
 *  enter the planner area immediately. Replaces the old admin-review gate:
 *  applying to the waitlist now grants the account on the spot (auto-accept).
 *  The plan/client-cap stay at their default (starter/4) until the planner
 *  confirms a plan during onboarding — the waitlist only SUGGESTS one via the
 *  prefill `mapped_plan` (see handleGetProfile). Idempotent: the
 *  `user_type != 'planner'` guard means re-running never disturbs an existing
 *  planner's chosen plan. */
export function grantPlannerAccount(userId: number): void {
  db.prepare(
    "UPDATE users SET user_type = 'planner', updated_at = ? WHERE id = ? AND user_type != 'planner'",
  ).run(now(), userId);
}
