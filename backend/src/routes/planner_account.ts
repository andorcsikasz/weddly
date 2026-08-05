// Planner self-serve account data rights — the planner-side twin of
// `vendor_account.ts`.
//
//   GET    /api/planner/export  — the planner's full data snapshot as one JSON
//     document (profile + billing + clients + notes + invitations + messages +
//     events + portfolio + packages + blocked dates + points + reviews about
//     them). Deliberately NOT plan-gated: takeout of your own data is a right,
//     not a PRO feature, so this sits outside `plannerEntitlementBlock`.
//   DELETE /api/planner/account — GDPR right-to-erasure, executed immediately
//     and synchronously (there is no planner equivalent of the couples'
//     30-day pause window; a planner has no partner who could object).
//
// Authorisation: `requirePlannerAuth` on both — a session bearer whose user is
// `user_type='planner'`. Deliberately NOT `requireVerifiedAuth`: planners can be
// admin-provisioned with `verified_email=0`, and an unverified planner must
// still be able to take their data out and delete their account.

import type { PlannerDataExport } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { getPlannerSub, getPlannerTier, toPlannerBilling } from "../domain/planner_billing";
import { purgeOnePlanner } from "../domain/purge";
import { getUserById, isAdminEmail } from "../domain/users";
import { plannerReviewSubjectId } from "@shared/planner_reviews";
import { requirePlannerAuth } from "./planner";

/** Tables dumped verbatim into the export, keyed by `planner_user_id`.
 *  An allowlist because SQLite can't bind an identifier — same guard the
 *  couple export uses. */
const EXPORTABLE_PLANNER_TABLES = [
  "planner_clients",
  "planner_client_notes",
  "planner_invitations",
  "planner_messages",
  "planner_events",
  "planner_portfolio",
  "planner_packages",
  "planner_unavailable_dates",
  "planner_points_ledger",
] as const;

type ExportablePlannerTable = (typeof EXPORTABLE_PLANNER_TABLES)[number];

function rowsByPlanner(table: ExportablePlannerTable, plannerUserId: number) {
  if (!EXPORTABLE_PLANNER_TABLES.includes(table)) {
    throw new HttpError(500, "Invalid export table");
  }
  return db
    .prepare(`SELECT * FROM ${table} WHERE planner_user_id = ? ORDER BY id ASC`)
    .all(plannerUserId) as Record<string, unknown>[];
}

/** The `planner_*` columns on `users`, read generically so a column added later
 *  lands in the takeout without anyone remembering to extend a mapper. */
function plannerProfileColumns(plannerUserId: number): Record<string, unknown> {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(plannerUserId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return {};
  const profile: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("planner_") || key === "business_name" || key === "user_type") {
      profile[key] = value;
    }
  }
  return profile;
}

function handleExport(ctx: Ctx): Response {
  const userId = requirePlannerAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(401, "User not found");

  const sub = getPlannerSub(userId);
  const reviews = db
    .prepare("SELECT * FROM supplier_reviews WHERE supplier_id = ? ORDER BY id ASC")
    .all(plannerReviewSubjectId(userId)) as Record<string, unknown>[];
  // Same cap and ordering as the couple export — a takeout is a copy of the
  // record, not an unbounded log dump.
  const auditEntries = db
    .prepare("SELECT * FROM audit_log WHERE actor_user_id = ? ORDER BY id DESC LIMIT 500")
    .all(userId) as Record<string, unknown>[];
  const emailLog = db
    .prepare("SELECT * FROM email_log WHERE user_id = ? ORDER BY id ASC")
    .all(userId) as Record<string, unknown>[];

  const payload: PlannerDataExport = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      locale: user.locale ?? null,
      created_at: user.created_at,
    },
    profile: plannerProfileColumns(userId),
    billing: sub ? toPlannerBilling(sub, getPlannerTier(userId)) : null,
    clients: rowsByPlanner("planner_clients", userId),
    client_notes: rowsByPlanner("planner_client_notes", userId),
    invitations: rowsByPlanner("planner_invitations", userId),
    messages: rowsByPlanner("planner_messages", userId),
    events: rowsByPlanner("planner_events", userId),
    portfolio: rowsByPlanner("planner_portfolio", userId),
    packages: rowsByPlanner("planner_packages", userId),
    unavailable_dates: rowsByPlanner("planner_unavailable_dates", userId),
    points_ledger: rowsByPlanner("planner_points_ledger", userId),
    reviews,
    email_log: emailLog,
    audit_log_recent: auditEntries,
  };

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "planner.data_export",
    target_kind: "user",
    target_id: userId,
    after: { clients: payload.clients.length, packages: payload.packages.length },
  });

  return json(payload);
}

function handleDeleteAccount(ctx: Ctx): Response {
  const userId = requirePlannerAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(401, "User not found");
  // An admin deleting themselves out of the console is a support ticket. The
  // admin-side planner delete refuses the same move (`admin_planners.ts`).
  if (isAdminEmail(user.email)) {
    throw new HttpError(409, "Admin accounts are deleted by another admin", {
      code: "admin_account",
    });
  }

  // The audit entry has to be written BEFORE the sweep: `addAuditLog` resolves
  // the actor against a `users` row that the purge is about to scrub, and the
  // point of the entry is to record who asked.
  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "planner.self_delete",
    target_kind: "user",
    target_id: userId,
    before: { email: user.email },
  });

  purgeOnePlanner(userId);
  return json({ ok: true, deleted_at: now() });
}

export function registerPlannerAccountRoutes(router: Router) {
  router.get("/api/planner/export", handleExport, true);
  router.delete("/api/planner/account", handleDeleteAccount, true);
}
