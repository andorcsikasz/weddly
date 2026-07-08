// Convert an existing (mis-routed) account into a real planner, and seed its
// planner profile from the person's `/planners` waitlist application. This is
// the shared core behind three callers:
//   1. the admin "Approve & open account" action for someone who already has a
//      couple/solo account (routes/admin_planners.ts),
//   2. the boot backfill that heals every accepted applicant who landed as a
//      couple account instead of a planner (backfillWaitlistPlannerConversions,
//      called from server.ts),
//   3. the collision branch of the approve flow.
//
// The account conversion is non-destructive by design: it never touches
// `users.couple_id`, the `couples` row, or `couple_members`, so all of a
// mis-routed applicant's workspace data survives. Turning that workspace into a
// client is a separate, consent-correct step (needs the real couple's email).

import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { grantPlannerAccount, plannerPlanMaxClients, waitlistPlanToPlannerPlan } from "./planner";
import { initPlannerBilling } from "./planner_billing";
import { getUserById, isAdminEmail } from "./users";

/** The `planner_waitlist` columns we carry into a planner's profile. Matches the
 *  onboarding prefill mapping in routes/planner.ts (`bio` <- message, styles <-
 *  the four style fields, plan <- selected_plan). */
export interface PlannerWaitlistSeedRow {
  id: number;
  email: string;
  full_name: string;
  company_name: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  weddings_per_year: number | null;
  km_radius: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  message: string | null;
  selected_plan: string | null;
}

const SEED_COLUMNS = `id, email, full_name, company_name, city, website, phone,
  weddings_per_year, km_radius, wedding_style_1, wedding_style_2, wedding_style_3,
  other_style, message, selected_plan`;

/** Load a waitlist row by id (the admin pending card carries a waitlist id). */
export function getWaitlistSeedRowById(id: number): PlannerWaitlistSeedRow | null {
  return (
    (db.prepare(`SELECT ${SEED_COLUMNS} FROM planner_waitlist WHERE id = ?`).get(id) as
      | PlannerWaitlistSeedRow
      | undefined) ?? null
  );
}

/** Newest accepted waitlist row for an email (a re-applicant keeps the latest). */
export function getLatestAcceptedWaitlistSeedRowByEmail(
  email: string,
): PlannerWaitlistSeedRow | null {
  return (
    (db
      .prepare(
        `SELECT ${SEED_COLUMNS} FROM planner_waitlist
          WHERE LOWER(email) = LOWER(?) AND status = 'accepted'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(email) as PlannerWaitlistSeedRow | undefined) ?? null
  );
}

/** Fill only the currently-empty planner profile columns from the waitlist row
 *  (COALESCE-style, never clobbers a value the planner already typed), and bump
 *  the plan/client-cap only while still at the default (starter). Idempotent and
 *  safe to re-run. */
export function seedPlannerProfileFromWaitlist(userId: number, row: PlannerWaitlistSeedRow): void {
  const styles = [
    row.wedding_style_1,
    row.wedding_style_2,
    row.wedding_style_3,
    row.other_style,
  ].filter((s): s is string => !!s && s.trim().length > 0);
  const stylesJson = styles.length ? JSON.stringify(styles) : null;
  const plan = waitlistPlanToPlannerPlan(row.selected_plan);
  const maxClients = plannerPlanMaxClients(plan);

  db.prepare(
    `UPDATE users SET
        business_name             = COALESCE(NULLIF(business_name, ''), ?),
        planner_city              = COALESCE(NULLIF(planner_city, ''), ?),
        planner_website           = COALESCE(NULLIF(planner_website, ''), ?),
        planner_phone             = COALESCE(NULLIF(planner_phone, ''), ?),
        planner_bio               = COALESCE(NULLIF(planner_bio, ''), ?),
        planner_styles            = COALESCE(NULLIF(planner_styles, ''), ?),
        planner_weddings_per_year = COALESCE(planner_weddings_per_year, ?),
        planner_km_radius         = COALESCE(planner_km_radius, ?),
        planner_plan              = CASE WHEN planner_plan IS NULL OR planner_plan = 'starter'
                                         THEN ? ELSE planner_plan END,
        planner_max_clients       = CASE WHEN planner_plan IS NULL OR planner_plan = 'starter'
                                         THEN ? ELSE planner_max_clients END,
        updated_at = ?
      WHERE id = ?`,
  ).run(
    row.company_name,
    row.city,
    row.website,
    row.phone,
    row.message,
    stylesJson,
    row.weddings_per_year,
    row.km_radius,
    plan,
    maxClients,
    now(),
    userId,
  );
}

/** Promote an existing account to a real planner: grant the role, grant billing
 *  (real founding-or-trial, first-come, same as a genuine applicant), and seed
 *  the profile from their newest accepted waitlist application. Idempotent.
 *  Never touches `users.couple_id` so any existing workspace data is preserved.
 *  Returns whether a waitlist row was found to seed from. */
export function convertUserToPlanner(userId: number): { seeded: boolean } {
  grantPlannerAccount(userId);
  initPlannerBilling(userId);
  const user = getUserById(userId);
  const row = user ? getLatestAcceptedWaitlistSeedRowByEmail(user.email) : null;
  if (row) seedPlannerProfileFromWaitlist(userId, row);
  return { seeded: !!row };
}

/** Boot reconciler: heal every accepted planner applicant who currently holds a
 *  non-planner account (the "Regisztrációra vár" mis-route). Skips vendors,
 *  admins, demo accounts, and suspended users. Account only: it never creates
 *  client links or touches couple_id (the workspace->client step needs a
 *  human-supplied email + couple consent). Idempotent, one audit row per
 *  conversion. Returns the number converted. */
export function backfillWaitlistPlannerConversions(): number {
  const candidates = db
    .prepare(
      `SELECT u.id AS user_id, u.email
         FROM users u
        WHERE u.user_type != 'planner'
          AND u.role != 'vendor'
          AND u.status != 'suspended'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND LOWER(u.email) IN (
                SELECT LOWER(w.email) FROM planner_waitlist w WHERE w.status = 'accepted')`,
    )
    .all() as { user_id: number; email: string }[];

  let converted = 0;
  for (const c of candidates) {
    if (isAdminEmail(c.email)) continue;
    convertUserToPlanner(c.user_id);
    addAuditLog({
      actor_user_id: null,
      couple_id: null,
      action: "system.planner_backfill_convert",
      target_kind: "user",
      target_id: c.user_id,
      after: { email: c.email },
    });
    converted++;
  }
  return converted;
}
