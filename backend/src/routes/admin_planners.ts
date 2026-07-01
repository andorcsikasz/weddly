// Admin planner management (KEZELÉS → Szervezők). A planner is a `users` row
// with user_type='planner' (auto-granted on waitlist apply), so this lists
// every planner account with plan tier + active-client count and lets an admin
// suspend/reactivate, delete, and change plan tier. Gated by requireAdmin().

import { isPlannerPlan, listAdminPlanners, updatePlannerPlan } from "../domain/planner";
import { purgeOneUser } from "../domain/purge";
import { getUserById, requireAdmin, setUserStatus } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  return id;
}

/** Resolve the :id to a planner user, 404ing if it's missing or not a planner
 *  (so these endpoints can't be used to poke arbitrary users). */
function requirePlannerUser(userId: number) {
  const user = getUserById(userId);
  if (!user || user.user_type !== "planner") throw new HttpError(404, "Planner not found");
  return user;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ planners: listAdminPlanners() });
}

function setPlannerStatus(ctx: Ctx, status: "active" | "suspended"): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  const planner = requirePlannerUser(userId);
  if (planner.id === admin.id) throw new HttpError(400, "Cannot suspend your own account");

  setUserStatus(userId, status);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: status === "suspended" ? "admin.planner_suspend" : "admin.planner_reactivate",
    target_kind: "user",
    target_id: userId,
  });
  return json({ ok: true, status });
}

function handleSuspend(ctx: Ctx): Response {
  return setPlannerStatus(ctx, "suspended");
}

function handleReactivate(ctx: Ctx): Response {
  return setPlannerStatus(ctx, "active");
}

function handleDelete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  const planner = requirePlannerUser(userId);
  if (planner.id === admin.id) throw new HttpError(400, "Cannot delete your own account");

  purgeOneUser(userId, { adminInitiated: true });
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.planner_delete",
    target_kind: "user",
    target_id: userId,
    before: { email: planner.email },
  });
  return json({ ok: true });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  requirePlannerUser(userId);

  const body = await readJson<{ planner_plan?: unknown }>(ctx.req);
  if (!isPlannerPlan(body.planner_plan)) {
    throw new HttpError(400, "`planner_plan` must be 'starter', 'pro', or 'premium'");
  }

  updatePlannerPlan(userId, body.planner_plan);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.planner_plan_change",
    target_kind: "user",
    target_id: userId,
    note: `planner_plan → ${body.planner_plan}`,
  });
  return json({ ok: true, planner_plan: body.planner_plan });
}

export function registerAdminPlannerRoutes(router: Router) {
  router.get("/api/admin/planners", handleList, true);
  router.post("/api/admin/planners/:id/suspend", handleSuspend, true);
  router.post("/api/admin/planners/:id/reactivate", handleReactivate, true);
  router.patch("/api/admin/planners/:id", handleUpdate, true);
  router.delete("/api/admin/planners/:id", handleDelete, true);
}
