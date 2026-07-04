// Admin planner management (KEZELÉS → Szervezők). A planner is a `users` row
// with user_type='planner' (auto-granted on waitlist apply), so this lists
// every planner account with plan tier + active-client count and lets an admin
// suspend/reactivate, delete, and change plan tier. Gated by requireAdmin().
//
// Provisioning: an admin can also pre-register a planner they struck a deal
// with in person (email + name + business name + category). The account is
// created dormant with a 2-year free comp and the planner receives an emailed
// activation link (domain/planner_provisioning.ts).

import { CONFIG } from "../config";
import { sendKind } from "../domain/emails";
import {
  isPlannerPlan,
  listAdminPlanners,
  listPendingPlannerWaitlist,
  updatePlannerPlan,
} from "../domain/planner";
import { getPlannerSub } from "../domain/planner_billing";
import { provisionPlanner, reissueActivationToken } from "../domain/planner_provisioning";
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

// One list, two row kinds: accepted waitlist applicants without an account yet
// (state:"pending") lead, then the live accounts (state:"active"). Pending
// first so newly accepted planners surface at the top for the admin to notice.
function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ planners: [...listPendingPlannerWaitlist(), ...listAdminPlanners()] });
}

/** Trimmed, length-capped required string field, 400 on anything else. */
function parseRequiredText(raw: unknown, field: string, max: number): string {
  if (typeof raw !== "string") throw new HttpError(400, `\`${field}\` is required`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new HttpError(400, `\`${field}\` must be 1-${max} characters`);
  }
  return trimmed;
}

/** Localised human date for the activation email's "free until" line. */
function freeUntilLabels(untilMs: number): { hu: string; en: string } {
  const d = new Date(untilMs);
  return {
    hu: new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" }).format(
      d,
    ),
    en: new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "long", day: "numeric" }).format(
      d,
    ),
  };
}

async function sendActivationEmail(
  user: { id: number; email: string; full_name: string },
  opts: { businessName: string; category: string; token: string; foundingUntil: number },
): Promise<void> {
  const labels = freeUntilLabels(opts.foundingUntil);
  await sendKind(
    "planner_provisioned",
    {
      plannerName: user.full_name,
      businessName: opts.businessName,
      category: opts.category,
      activateUrl: `${CONFIG.frontendBaseUrl}/planner/activate/${opts.token}`,
      freeUntilHu: labels.hu,
      freeUntilEn: labels.en,
    },
    { user },
  );
}

async function handleProvision(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<{
    email?: unknown;
    full_name?: unknown;
    business_name?: unknown;
    category?: unknown;
  }>(ctx.req);

  const emailRaw = parseRequiredText(body.email, "email", 320).toLowerCase();
  if (!emailRaw.includes("@") || emailRaw.startsWith("@") || emailRaw.endsWith("@")) {
    throw new HttpError(400, "Email looks invalid");
  }
  const fullName = parseRequiredText(body.full_name, "full_name", 200);
  const businessName = parseRequiredText(body.business_name, "business_name", 200);
  const category = parseRequiredText(body.category, "category", 120);

  const { userId, token } = await provisionPlanner({
    email: emailRaw,
    fullName,
    businessName,
    category,
  });

  const sub = getPlannerSub(userId);
  await sendActivationEmail(
    { id: userId, email: emailRaw, full_name: fullName },
    { businessName, category, token, foundingUntil: sub?.founding_until ?? Date.now() },
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.planner_provision",
    target_kind: "user",
    target_id: userId,
    after: { email: emailRaw, business_name: businessName, category },
  });
  return json({ ok: true, user_id: userId }, { status: 201 });
}

async function handleResendActivation(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  const planner = requirePlannerUser(userId);

  const token = reissueActivationToken(userId);
  const sub = getPlannerSub(userId);
  await sendActivationEmail(
    { id: planner.id, email: planner.email, full_name: planner.full_name },
    {
      businessName: planner.business_name ?? planner.full_name,
      category: planner.planner_category ?? "",
      token,
      foundingUntil: sub?.founding_until ?? Date.now(),
    },
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.planner_provision_resend",
    target_kind: "user",
    target_id: userId,
  });
  return json({ ok: true });
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
  router.post("/api/admin/planners/provision", handleProvision, true);
  router.post("/api/admin/planners/:id/resend-activation", handleResendActivation, true);
  router.post("/api/admin/planners/:id/suspend", handleSuspend, true);
  router.post("/api/admin/planners/:id/reactivate", handleReactivate, true);
  router.patch("/api/admin/planners/:id", handleUpdate, true);
  router.delete("/api/admin/planners/:id", handleDelete, true);
}
