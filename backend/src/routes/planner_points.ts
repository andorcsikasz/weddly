// Weddly Points read API for planners. `GET /api/planner/points` returns the
// calling planner's derived total, tier, perks, recent ledger entries and
// standing in the directory pool.
//
// READ-ONLY on purpose, exactly like the vendor twin: nothing here awards,
// adjusts or recomputes. Points enter the system only through the outbox →
// engine path (domain/planner_points.ts), so there is no HTTP surface a client
// could use to pay itself.

import type { PlannerPointsStatus } from "@shared/planner_points";
import { type Ctx, json, type Router } from "../lib/http";
import { plannerPointsStatus } from "../domain/planner_points";
import { requirePlannerAuth } from "./planner";

async function handleGetPoints(ctx: Ctx): Promise<Response> {
  const plannerUserId = requirePlannerAuth(ctx);
  const status: PlannerPointsStatus = plannerPointsStatus(plannerUserId);
  return json(status);
}

export function registerPlannerPointsRoutes(router: Router) {
  router.get("/api/planner/points", handleGetPoints, true);
}
