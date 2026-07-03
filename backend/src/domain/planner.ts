// Planner-account domain helpers (distinct from couple-side `planning.ts`).

import {
  type AdminPlannerView,
  PLANNER_PLAN_LIMITS,
  type PlannerPlan,
  type UserStatus,
} from "@shared/types";
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

interface AdminPlannerRow {
  user_id: number;
  full_name: string;
  email: string;
  status: string;
  planner_plan: string | null;
  planner_max_clients: number | null;
  planner_city: string | null;
  planner_onboarding_done: number | null;
  client_count: number;
  created_at: number;
  business_name: string | null;
  planner_category: string | null;
  pending_activation: number;
  founding_until: number | null;
}

function toAdminPlannerView(row: AdminPlannerRow): AdminPlannerView {
  const plan = isPlannerPlan(row.planner_plan) ? row.planner_plan : "starter";
  return {
    user_id: row.user_id,
    full_name: row.full_name,
    email: row.email,
    status: (row.status === "suspended" ? "suspended" : "active") as UserStatus,
    planner_plan: plan,
    planner_max_clients: row.planner_max_clients ?? plannerPlanMaxClients(plan),
    planner_city: row.planner_city,
    planner_onboarding_done: row.planner_onboarding_done === 1,
    client_count: row.client_count,
    created_at: row.created_at,
    business_name: row.business_name,
    planner_category: row.planner_category,
    pending_activation: row.pending_activation === 1,
    founding_until: row.founding_until,
  };
}

/** Every planner account (a `users` row with user_type='planner'), with a count
 *  of their active `planner_clients` links, for the admin Szervezők list. */
export function listAdminPlanners(): AdminPlannerView[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id,
              u.full_name,
              u.email,
              u.status,
              u.planner_plan,
              u.planner_max_clients,
              u.planner_city,
              u.planner_onboarding_done,
              u.created_at,
              u.business_name,
              u.planner_category,
              (SELECT COUNT(*) FROM planner_clients pc
                WHERE pc.planner_user_id = u.id AND pc.status = 'active') AS client_count,
              EXISTS(SELECT 1 FROM planner_activation_tokens pat
                WHERE pat.user_id = u.id AND pat.consumed_at IS NULL) AS pending_activation,
              (SELECT ps.founding_until FROM planner_subscriptions ps
                WHERE ps.user_id = u.id AND ps.subscription_status = 'founding') AS founding_until
         FROM users u
        WHERE u.user_type = 'planner'
          AND u.email NOT LIKE '%@demo.weddly.local'
        ORDER BY u.created_at DESC`,
    )
    .all() as AdminPlannerRow[];
  return rows.map(toAdminPlannerView);
}

/** Admin sets a planner's plan tier; keeps `planner_max_clients` in lockstep. */
export function updatePlannerPlan(userId: number, plan: PlannerPlan): void {
  db.prepare(
    "UPDATE users SET planner_plan = ?, planner_max_clients = ?, updated_at = ? WHERE id = ?",
  ).run(plan, plannerPlanMaxClients(plan), now(), userId);
}
