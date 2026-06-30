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

/** Self-serve planner grant. Flips a user to `user_type='planner'` and seeds
 *  their plan/client-cap from the (basic/pro/unlimited) plan they picked on the
 *  waitlist. Idempotent and non-destructive: the `user_type != 'planner'` guard
 *  means re-running never clobbers an existing planner's chosen plan. Replaces
 *  the old admin-review gate — applying to the waitlist now grants the account
 *  immediately (auto-accept). */
export function grantPlannerAccount(
  userId: number,
  selectedPlan: string | null | undefined,
): void {
  const plan = waitlistPlanToPlannerPlan(selectedPlan);
  db.prepare(
    `UPDATE users
        SET user_type = 'planner', planner_plan = ?, planner_max_clients = ?, updated_at = ?
      WHERE id = ? AND user_type != 'planner'`,
  ).run(plan, plannerPlanMaxClients(plan), now(), userId);
}
