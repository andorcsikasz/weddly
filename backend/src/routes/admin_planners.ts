// Admin planner management (KEZELÉS → Szervezők). A planner is a `users` row
// with user_type='planner' (auto-granted on waitlist apply), so this lists
// every planner account with plan tier + active-client count and lets an admin
// suspend/reactivate, delete, and change plan tier. Gated by requireAdmin().
//
// Provisioning: an admin can also pre-register a planner they struck a deal
// with in person (email + name + business name + category). The account is
// created dormant with a 2-year free comp and the planner receives an emailed
// activation link (domain/planner_provisioning.ts).

import type { PlannerInviteBatchResult } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "../domain/emails";
import { runPlannerInviteBatch } from "../domain/planner_invite_batch";
import {
  type PlannerProfileRow,
  plannerProfileMissing,
  sendPlannerProfileReminder,
} from "../domain/planner_profile";
import {
  isPlannerPlan,
  listAdminPlanners,
  listPendingPlannerWaitlist,
  setPlannerVerified,
  updatePlannerPlan,
} from "../domain/planner";
import { getPlannerSub } from "../domain/planner_billing";
import { aggregatePlannerAnalytics, emptyPlannerAnalytics } from "../domain/planner_views";
import { convertUserToPlanner, getWaitlistSeedRowById } from "../domain/planner_conversion";
import {
  provisionPlanner,
  provisionPlannerFromWaitlist,
  reissueActivationToken,
} from "../domain/planner_provisioning";
import { purgeOneUser } from "../domain/purge";
import { getUserByEmail, getUserById, requireAdmin, setUserStatus } from "../domain/users";
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
  // Attach couple-facing directory reach to each live account. Aggregated once
  // here (not in listAdminPlanners) so the domain query stays lean and callers
  // that don't need analytics never pay for the scan. Pending waitlist rows
  // have no account yet → no analytics.
  const analytics = aggregatePlannerAnalytics();
  const active = listAdminPlanners().map((p) => ({
    ...p,
    analytics: analytics.get(p.user_id) ?? emptyPlannerAnalytics(),
  }));
  return json({ planners: [...listPendingPlannerWaitlist(), ...active] });
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

// "Someone recommended these planners" batch. The admin pastes the list they
// were handed, previews what the parser made of it (`dry_run`), then runs it.
// Everything interesting lives in domain/planner_invite_batch.ts; this handler
// is the auth + input boundary.
async function handleInviteBatch(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<{ text?: unknown; dry_run?: unknown; locale?: unknown }>(ctx.req);
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw new HttpError(400, "`text` is required");
  }
  if (body.text.length > 100_000) throw new HttpError(400, "List is too long");
  const dryRun = body.dry_run !== false;
  // Absent/"auto" leaves the language to the per-row guess (HU phone or .hu
  // address); an explicit value forces the whole batch.
  const locale = body.locale === "hu" || body.locale === "en" ? body.locale : null;

  const rows = await runPlannerInviteBatch(body.text, { dryRun, locale });

  if (!dryRun) {
    const sent = rows.filter((r) => r.status === "sent");
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.planner_invite_batch",
      target_kind: "user",
      target_id: null,
      after: {
        parsed: rows.length,
        sent: sent.length,
        emails: sent.map((r) => r.email),
      },
    });
  }

  const result: PlannerInviteBatchResult = { dry_run: dryRun, rows };
  return json(result);
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

// Approve an accepted applicant stuck on "Regisztrációra vár" and open their
// planner account (keyed on planner_waitlist.id — a pending row may or may not
// already have a user). This is the admin approval gate: three branches.
//   1. No account yet -> provision a dormant planner (which takes the email, so
//      they can no longer self-register a couple account), seed the profile from
//      their application, and email an activation link that opens the account and
//      lands them in a pre-filled onboarding wizard.
//   2. Existing NON-planner account (the orphan / mis-route case) -> convert it
//      to a planner + seed the profile (non-destructive: users.couple_id and any
//      couple data are untouched), and email the "sign in" CTA.
//   3. Already a planner -> re-seed (idempotent) + "sign in" CTA.
// Either way they leave the pending list on the next refresh.
async function handleSendInvite(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const waitlistId = parseId(ctx);
  const row = getWaitlistSeedRowById(waitlistId);
  if (!row) throw new HttpError(404, "Waitlist entry not found");

  const existing = getUserByEmail(row.email);

  // Branch 1: provision + activation link -> pre-filled onboarding.
  if (!existing) {
    const { userId, token } = await provisionPlannerFromWaitlist(row);
    const sub = getPlannerSub(userId);
    const labels = freeUntilLabels(sub?.founding_until ?? sub?.trial_ends_at ?? Date.now());
    await sendKind(
      "planner_onboarding_invite",
      {
        plannerName: row.full_name,
        businessName: row.company_name?.trim() || row.full_name,
        activateUrl: `${CONFIG.frontendBaseUrl}/planner/activate/${token}`,
        freeUntilHu: labels.hu,
        freeUntilEn: labels.en,
      },
      { user: { id: userId, email: row.email, full_name: row.full_name } },
    );
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.planner_waitlist_provision",
      target_kind: "user",
      target_id: userId,
      after: { email: row.email, waitlist_id: waitlistId },
    });
    return json({ ok: true, provisioned: true, has_account: false });
  }

  // Branches 2 & 3: convert (idempotent for an existing planner) + seed, then
  // send the sign-in CTA to the real account holder.
  const wasPlanner = existing.user_type === "planner";
  convertUserToPlanner(existing.id);
  await sendKind(
    "planner_access_invite",
    { plannerName: existing.full_name, hasAccount: true },
    { user: { id: existing.id, email: existing.email, full_name: existing.full_name } },
  );
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: wasPlanner ? "admin.planner_waitlist_reseed" : "admin.planner_waitlist_convert",
    target_kind: "user",
    target_id: existing.id,
    after: { email: existing.email, waitlist_id: waitlistId, converted: !wasPlanner },
  });
  return json({ ok: true, converted: !wasPlanner, has_account: true });
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

/** Grant or revoke the couple-facing "verified" trust badge on a planner. */
function setPlannerVerifiedBadge(ctx: Ctx, verified: boolean): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  requirePlannerUser(userId);

  setPlannerVerified(userId, verified);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: verified ? "admin.planner_verify" : "admin.planner_unverify",
    target_kind: "user",
    target_id: userId,
  });
  return json({ ok: true, verified });
}

function handleVerify(ctx: Ctx): Response {
  return setPlannerVerifiedBadge(ctx, true);
}

function handleUnverify(ctx: Ctx): Response {
  return setPlannerVerifiedBadge(ctx, false);
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

/** Admin "Send reminder": email the planner a "your profile is missing info"
 *  nudge on demand. Unlike the automatic sweep this is NOT deduped — the admin
 *  clicked, so it always sends (a manual follow-up on top of the one auto
 *  nudge). Returns the missing-field breakdown so the UI can toast specifics. */
function handleRemindProfile(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  const planner = requirePlannerUser(userId);
  const row = db
    .prepare(
      `SELECT id, email, full_name, business_name, planner_city, planner_bio, planner_styles
         FROM users WHERE id = ?`,
    )
    .get(userId) as PlannerProfileRow | undefined;
  if (!row) throw new HttpError(404, "Planner not found");
  const missing = plannerProfileMissing(row);
  sendPlannerProfileReminder(row);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.planner_profile_reminder",
    target_kind: "user",
    target_id: userId,
    note: planner.email,
  });
  return json({ ok: true, missing });
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
  router.post("/api/admin/planners/invite-batch", handleInviteBatch, true);
  router.post("/api/admin/planners/pending/:id/send-invite", handleSendInvite, true);
  router.post("/api/admin/planners/:id/resend-activation", handleResendActivation, true);
  router.post("/api/admin/planners/:id/suspend", handleSuspend, true);
  router.post("/api/admin/planners/:id/reactivate", handleReactivate, true);
  router.post("/api/admin/planners/:id/verify", handleVerify, true);
  router.post("/api/admin/planners/:id/unverify", handleUnverify, true);
  router.post("/api/admin/planners/:id/remind-profile", handleRemindProfile, true);
  router.patch("/api/admin/planners/:id", handleUpdate, true);
  router.delete("/api/admin/planners/:id", handleDelete, true);
}
