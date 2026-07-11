// Planner-account domain helpers (distinct from couple-side `planning.ts`).

import type { ListingPackage } from "@shared/listing_packages";
import {
  type AdminPlannerAccount,
  type AdminPlannerPending,
  type AdminPlannerWaitlistDetail,
  PLANNER_PLAN_LIMITS,
  type PlannerPlan,
  type UserStatus,
} from "@shared/types";
import { db, now } from "../db";
import { isIsoDate } from "./supplier_bookings";

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
  planner_verified: number;
  pending_activation: number;
  founding_until: number | null;
}

/** The `planner_waitlist` columns we surface in the admin card's collapsible
 *  detail section. A local shape (not the route's full `PlannerWaitlistRow`) so
 *  domain code stays independent of the route layer. */
interface WaitlistDetailRow {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  km_radius: number | null;
  weddings_per_year: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  website: string | null;
  reference_links: string | null;
  early_bird: number | null;
  message: string | null;
  created_at: number;
}

const WAITLIST_DETAIL_COLUMNS = `id, full_name, email, phone, company_name, city, km_radius,
  weddings_per_year, wedding_style_1, wedding_style_2, wedding_style_3, other_style,
  website, reference_links, early_bird, message, created_at`;

function toWaitlistDetail(row: WaitlistDetailRow): AdminPlannerWaitlistDetail {
  return {
    company_name: row.company_name,
    city: row.city,
    km_radius: row.km_radius,
    weddings_per_year: row.weddings_per_year,
    wedding_styles: [row.wedding_style_1, row.wedding_style_2, row.wedding_style_3].filter(
      (s): s is string => Boolean(s),
    ),
    other_style: row.other_style,
    website: row.website,
    reference_links: row.reference_links,
    early_bird: row.early_bird === 1,
    message: row.message,
  };
}

/** Latest accepted waitlist submission per email, keyed by lowercased email.
 *  Used to hang the rich profile onto a matching live account. A planner who
 *  re-applied keeps only their newest row (MAX(id)). */
function latestAcceptedWaitlistByEmail(): Map<string, WaitlistDetailRow> {
  const rows = db
    .prepare(
      `SELECT ${WAITLIST_DETAIL_COLUMNS} FROM planner_waitlist w
        WHERE w.status = 'accepted'
          AND w.id = (SELECT MAX(w2.id) FROM planner_waitlist w2
                        WHERE lower(w2.email) = lower(w.email) AND w2.status = 'accepted')`,
    )
    .all() as WaitlistDetailRow[];
  const map = new Map<string, WaitlistDetailRow>();
  for (const r of rows) map.set(r.email.toLowerCase(), r);
  return map;
}

function toAdminPlannerView(
  row: AdminPlannerRow,
  waitlist: AdminPlannerWaitlistDetail | null,
): AdminPlannerAccount {
  const plan = isPlannerPlan(row.planner_plan) ? row.planner_plan : "starter";
  return {
    state: "active",
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
    verified: row.planner_verified === 1,
    pending_activation: row.pending_activation === 1,
    founding_until: row.founding_until,
    waitlist,
  };
}

/** Every planner account (a `users` row with user_type='planner'), with a count
 *  of their active `planner_clients` links, for the admin Szervezők list. Each
 *  row carries its matching waitlist profile (by email) for the collapsible
 *  detail section. */
export function listAdminPlanners(): AdminPlannerAccount[] {
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
              u.planner_verified,
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
  const details = latestAcceptedWaitlistByEmail();
  return rows.map((r) => toAdminPlannerView(r, waitlistDetailOrNull(details, r.email)));
}

function waitlistDetailOrNull(
  map: Map<string, WaitlistDetailRow>,
  email: string,
): AdminPlannerWaitlistDetail | null {
  const row = map.get(email.toLowerCase());
  return row ? toWaitlistDetail(row) : null;
}

/** Accepted waitlist applicants who have NO planner account yet (their email
 *  matches no `users` row of user_type='planner'). These surface as "pending"
 *  rows in the admin Szervezők list — the planner-side analogue of the vendor
 *  onboarding pending rows. `created_at` is normalised to ms (the waitlist
 *  table stores seconds). */
export function listPendingPlannerWaitlist(): AdminPlannerPending[] {
  const rows = db
    .prepare(
      `SELECT ${WAITLIST_DETAIL_COLUMNS},
              EXISTS(SELECT 1 FROM users u WHERE lower(u.email) = lower(w.email)) AS has_account
         FROM planner_waitlist w
        WHERE w.status = 'accepted'
          AND w.id = (SELECT MAX(w2.id) FROM planner_waitlist w2
                        WHERE lower(w2.email) = lower(w.email) AND w2.status = 'accepted')
          AND lower(w.email) NOT IN (
                SELECT lower(u.email) FROM users u WHERE u.user_type = 'planner')
        ORDER BY w.created_at DESC`,
    )
    .all() as (WaitlistDetailRow & { has_account: number })[];
  return rows.map((r) => ({
    state: "pending" as const,
    waitlist_id: r.id,
    full_name: r.full_name,
    email: r.email,
    phone: r.phone,
    created_at: r.created_at * 1000,
    has_account: r.has_account === 1,
    waitlist: toWaitlistDetail(r),
  }));
}

/** Load the identity fields of a planner_waitlist row by id. Used by the admin
 *  "send invite" action to (re)email an accepted applicant stuck on
 *  "Regisztrációra vár". Returns null if the id doesn't exist. */
export function getPlannerWaitlistById(
  id: number,
): { id: number; email: string; full_name: string } | null {
  return (
    (db.prepare("SELECT id, email, full_name FROM planner_waitlist WHERE id = ?").get(id) as
      | { id: number; email: string; full_name: string }
      | undefined) ?? null
  );
}

/** Admin sets a planner's plan tier; keeps `planner_max_clients` in lockstep. */
export function updatePlannerPlan(userId: number, plan: PlannerPlan): void {
  db.prepare(
    "UPDATE users SET planner_plan = ?, planner_max_clients = ?, updated_at = ? WHERE id = ?",
  ).run(plan, plannerPlanMaxClients(plan), now(), userId);
}

/** Admin grants or revokes a planner's trust badge (users.planner_verified).
 *  Surfaced to couples in the planner directory; purely editorial. */
export function setPlannerVerified(userId: number, verified: boolean): void {
  db.prepare("UPDATE users SET planner_verified = ?, updated_at = ? WHERE id = ?").run(
    verified ? 1 : 0,
    now(),
    userId,
  );
}

// ─── Planner price packages (árajánlat) ───────────────────────────────────────
//
// Mirror of listing_packages for vendors (domain/listings.ts): up to
// MAX_LISTING_PACKAGES named price tiers per planner, each with an optional
// free-text price, description and attached price-list PDF. Keyed by the
// planner's user id. Couples read these on the planner detail page.

interface PlannerPackageRow {
  id: number;
  name: string;
  price_text: string | null;
  description: string | null;
  pdf_url: string | null;
  pdf_name: string | null;
}

function toPlannerPackage(row: PlannerPackageRow): ListingPackage {
  return {
    id: row.id,
    name: row.name,
    price_text: row.price_text,
    description: row.description,
    pdf_url: row.pdf_url,
    pdf_name: row.pdf_name,
  };
}

const PLANNER_PACKAGE_COLS = "id, name, price_text, description, pdf_url, pdf_name";

export function listPlannerPackages(userId: number): ListingPackage[] {
  const rows = db
    .prepare(
      `SELECT ${PLANNER_PACKAGE_COLS} FROM planner_packages WHERE planner_user_id = ? ORDER BY id ASC`,
    )
    .all(userId) as PlannerPackageRow[];
  return rows.map(toPlannerPackage);
}

export function countPlannerPackages(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM planner_packages WHERE planner_user_id = ?")
    .get(userId) as { n: number };
  return row.n;
}

export function addPlannerPackage(
  userId: number,
  input: { name: string; price_text: string | null; description: string | null },
): ListingPackage {
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO planner_packages (planner_user_id, name, price_text, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, input.name, input.price_text, input.description, ts, ts);
  return {
    id: Number(res.lastInsertRowid),
    name: input.name,
    price_text: input.price_text,
    description: input.description,
    pdf_url: null,
    pdf_name: null,
  };
}

export function getPlannerPackage(userId: number, packageId: number): ListingPackage | null {
  const row = db
    .prepare(
      `SELECT ${PLANNER_PACKAGE_COLS} FROM planner_packages WHERE id = ? AND planner_user_id = ?`,
    )
    .get(packageId, userId) as PlannerPackageRow | undefined;
  return row ? toPlannerPackage(row) : null;
}

/** Partial update of a package's text fields — only present keys are applied,
 *  scoped by planner_user_id so a stray id from another planner is a no-op. */
export function updatePlannerPackage(
  userId: number,
  packageId: number,
  patch: { name?: string; price_text?: string | null; description?: string | null },
): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.price_text !== undefined) {
    sets.push("price_text = ?");
    vals.push(patch.price_text);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  db.prepare(
    `UPDATE planner_packages SET ${sets.join(", ")} WHERE id = ? AND planner_user_id = ?`,
  ).run(...vals, now(), packageId, userId);
}

export function setPlannerPackagePdf(
  userId: number,
  packageId: number,
  pdfUrl: string,
  pdfName: string,
): void {
  db.prepare(
    "UPDATE planner_packages SET pdf_url = ?, pdf_name = ?, updated_at = ? WHERE id = ? AND planner_user_id = ?",
  ).run(pdfUrl, pdfName, now(), packageId, userId);
}

export function clearPlannerPackagePdf(userId: number, packageId: number): void {
  db.prepare(
    "UPDATE planner_packages SET pdf_url = NULL, pdf_name = NULL, updated_at = ? WHERE id = ? AND planner_user_id = ?",
  ).run(now(), packageId, userId);
}

export function deletePlannerPackage(userId: number, packageId: number): void {
  db.prepare("DELETE FROM planner_packages WHERE id = ? AND planner_user_id = ?").run(
    packageId,
    userId,
  );
}

// ─── Planner availability (blocked dates) ─────────────────────────────────────
//
// Mirror of vendor_unavailable_dates (domain/supplier_bookings.ts) but whole-day
// only — a planner runs one wedding a day, so there is no partial-hour concept.
// Couples see blocked days as booked on the planner detail busy calendar.

/** Every blocked day, sorted ascending. */
export function listPlannerBlockedDates(userId: number): string[] {
  const rows = db
    .prepare(
      `SELECT blocked_date FROM planner_unavailable_dates
        WHERE planner_user_id = ?
        ORDER BY blocked_date ASC`,
    )
    .all(userId) as Array<{ blocked_date: string }>;
  return rows.map((r) => r.blocked_date);
}

/** Block a whole day. Upserts, so re-blocking an already-blocked day (e.g. to
 *  refresh the reason) is a no-op success rather than a duplicate-key error. */
export function blockPlannerDate(userId: number, date: string, reason: string | null): void {
  db.prepare(
    `INSERT INTO planner_unavailable_dates (planner_user_id, blocked_date, reason, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(planner_user_id, blocked_date) DO UPDATE SET reason = excluded.reason`,
  ).run(userId, date, reason, now());
}

/** Unblock a day. Returns true when a row was removed (idempotent otherwise). */
export function unblockPlannerDate(userId: number, date: string): boolean {
  const info = db
    .prepare("DELETE FROM planner_unavailable_dates WHERE planner_user_id = ? AND blocked_date = ?")
    .run(userId, date);
  return info.changes > 0;
}

/** Earliest 'YYYY-MM-DD' (>= today, UTC) with no block. Scans 365 days forward;
 *  null when the whole window is blocked. Matches nextAvailableDate for vendors. */
export function plannerNextAvailable(userId: number): string | null {
  const blocked = new Set(listPlannerBlockedDates(userId));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!blocked.has(iso)) return iso;
  }
  return null;
}

/** Validate + normalise an inbound block/unblock date: a real 'YYYY-MM-DD' that
 *  is not in the past (UTC). Throws a plain Error the route maps to a 400. */
export function requireBlockableDate(raw: unknown): string {
  const date = typeof raw === "string" ? raw.trim() : "";
  if (!isIsoDate(date)) throw new Error("date must be a valid YYYY-MM-DD");
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (date < todayUtc.toISOString().slice(0, 10)) throw new Error("cannot block a past date");
  return date;
}
