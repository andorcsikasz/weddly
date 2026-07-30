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
import { HttpError } from "../lib/http";
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

/** What a vendor→planner reroute did, so the admin sees the blast radius rather
 *  than an "ok: true" that hides a deleted calendar. */
export interface VendorToPlannerResult {
  user_id: number;
  /** Listings handed back to the directory as unclaimed entries. */
  listings_released: number;
  /** Couple inquiries that survived, unlinked (supplier_bookings is SET NULL). */
  bookings_unlinked: number;
  /** Vendor-side rows the cascade removed: availability, tasks, payments,
   *  points, calendar link. Zero for the case this was built for (a planner who
   *  never used the vendor tools), non-zero is the admin's warning. */
  vendor_rows_deleted: number;
  /** Planner profile fields filled from an accepted /planners application. */
  seeded_from_waitlist: boolean;
}

/** Move a mis-routed VENDOR account over to the planner side — the repair for
 *  someone who came in through a vendor door (self-serve signup, or a listing
 *  claim on a `wedding_planner` directory entry) when their business is
 *  planning. Admin-only and deliberate: the two account kinds are separate
 *  aggregates, so this is a move, not a flag.
 *
 *  What survives: the person's login (same email, same password, still verified
 *  — they simply land on the planner shell next time), their directory card
 *  (released back to unclaimed, so the public page keeps working and a future
 *  admin can re-point it), and every couple's inquiry row.
 *
 *  What goes: the `vendor_accounts` row and everything the FK cascade owns —
 *  vendor subscription, availability, tasks, client payments, points, calendar
 *  connection. Keeping it would leave a zombie: `role` no longer passes the
 *  vendor gate, yet the listing would still advertise a bookable account.
 *
 *  Billing restarts on the planner side via `initPlannerBilling` (founding
 *  while slots remain, else the standard trial) — the same grant a genuine
 *  applicant gets, not a comp. */
export function convertVendorToPlanner(vendorAccountId: number): VendorToPlannerResult {
  const account = db
    .prepare(
      "SELECT id, owner_user_id, display_name, company_name FROM vendor_accounts WHERE id = ?",
    )
    .get(vendorAccountId) as
    | { id: number; owner_user_id: number; display_name: string; company_name: string | null }
    | undefined;
  if (!account) throw new HttpError(404, "Vendor not found");

  const user = getUserById(account.owner_user_id);
  if (!user) throw new HttpError(404, "Vendor owner not found");
  if (isAdminEmail(user.email)) throw new HttpError(400, "Cannot convert an admin account");

  const ts = now();
  const businessName = (account.company_name?.trim() || account.display_name.trim()).slice(0, 120);

  const move = db.transaction((): Omit<VendorToPlannerResult, "seeded_from_waitlist"> => {
    // Count what the cascade is about to take, BEFORE it happens — after the
    // DELETE the rows are gone and the report would read "nothing happened".
    const vendorRows = countVendorOwnedRows(vendorAccountId);
    const bookings = (
      db
        .prepare("SELECT COUNT(*) AS n FROM supplier_bookings WHERE vendor_account_id = ?")
        .get(vendorAccountId) as { n: number }
    ).n;

    // Release the directory cards first: they outlive the account (curated and
    // community entries were public before anyone claimed them) and the FK
    // would only null this column out anyway.
    const released = db
      .prepare(
        "UPDATE listings SET vendor_account_id = NULL, updated_at = ? WHERE vendor_account_id = ?",
      )
      .run(ts, vendorAccountId).changes;

    // `role` is single-valued, so leaving 'vendor' would keep them out of the
    // planner shell. business_name only fills when empty — a planner who
    // already typed their own keeps it.
    db.prepare(
      `UPDATE users
          SET role = 'owner',
              business_name = COALESCE(NULLIF(business_name, ''), ?),
              updated_at = ?
        WHERE id = ?`,
    ).run(businessName, ts, account.owner_user_id);

    db.prepare("DELETE FROM vendor_accounts WHERE id = ?").run(vendorAccountId);

    return {
      user_id: account.owner_user_id,
      listings_released: released,
      bookings_unlinked: bookings,
      vendor_rows_deleted: vendorRows,
    };
  });

  const moved = move();
  // Outside the tx: grantPlannerAccount + initPlannerBilling open their own, and
  // the seed reads the users row we just wrote.
  const { seeded } = convertUserToPlanner(account.owner_user_id);
  return { ...moved, seeded_from_waitlist: seeded };
}

/** Enough of a `users` row to answer `canAutoConvertToPlanner`. */
export interface PlannerConvertCandidate {
  email: string;
  role: string;
  status: string;
}

/** May this existing account be flipped to a planner with no admin looking at
 *  it — the question the self-serve `/planners` form has to answer about the
 *  address it was handed. Same fence `backfillWaitlistPlannerConversions`
 *  draws in SQL, kept here so the two can't drift:
 *    - a VENDOR needs `convertVendorToPlanner` (the flip alone leaves a zombie
 *      `vendor_accounts` row still advertising a bookable business),
 *    - an ADMIN's own shell must not change under them,
 *    - a suspended or demo account is not one we hand new surface to.
 *  An account that is ALREADY a planner passes: the grant is idempotent, and
 *  the point is to send them to their dashboard instead of a second signup. */
export function canAutoConvertToPlanner(user: PlannerConvertCandidate): boolean {
  if (user.role === "vendor") return false;
  if (user.status === "suspended") return false;
  if (user.email.toLowerCase().endsWith("@demo.weddly.local")) return false;
  return !isAdminEmail(user.email);
}

/** Vendor-side rows that `DELETE FROM vendor_accounts` cascades away. Counted so
 *  the admin action can report real data loss instead of implying none. */
function countVendorOwnedRows(vendorAccountId: number): number {
  const tables = [
    "vendor_subscriptions",
    "vendor_unavailable_dates",
    "vendor_availability_settings",
    "vendor_client_payments",
    "vendor_tasks",
    "vendor_google_calendar_connections",
    "vendor_points_ledger",
  ];
  let total = 0;
  for (const table of tables) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE vendor_account_id = ?`)
      .get(vendorAccountId) as { n: number } | undefined;
    total += row?.n ?? 0;
  }
  return total;
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

/** Boot reconciler: seed the PUBLIC profile of planners who are already
 *  `user_type='planner'` but whose directory card is still empty (no business
 *  name or city), from their accepted `/planners` application. Fixes accounts
 *  that became planners before the profile-seeding was wired up — their
 *  waitlist data (company, city, styles, website…) was never copied across, so
 *  their directory card renders blank. `backfillWaitlistPlannerConversions`
 *  above only touches NON-planner accounts, so these fall through it.
 *  Idempotent (COALESCE-only fill → once seeded they drop out of the query),
 *  safe to run every boot. Returns how many were seeded. */
export function backfillPlannerProfilesFromWaitlist(): number {
  const candidates = db
    .prepare(
      `SELECT u.id AS user_id, u.email
         FROM users u
        WHERE u.user_type = 'planner'
          AND u.status != 'suspended'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND (TRIM(COALESCE(u.business_name, '')) = ''
               OR TRIM(COALESCE(u.planner_city, '')) = '')
          AND LOWER(u.email) IN (
                SELECT LOWER(w.email) FROM planner_waitlist w WHERE w.status = 'accepted')`,
    )
    .all() as { user_id: number; email: string }[];

  let seeded = 0;
  for (const c of candidates) {
    const row = getLatestAcceptedWaitlistSeedRowByEmail(c.email);
    if (!row) continue;
    seedPlannerProfileFromWaitlist(c.user_id, row);
    seeded++;
  }
  return seeded;
}
