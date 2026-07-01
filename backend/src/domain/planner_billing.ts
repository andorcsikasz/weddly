// Planner billing domain: founding-cohort eligibility, the activation grant, the
// entitlement snapshot, and the read-only gate for the planner workspace. The
// state machine + entitlement rules are shared with couples (shared/billing.ts) —
// only the table, the tier pricing, and the cohort constants differ
// (shared/planner_billing.ts).
//
// Tier is NOT stored on the subscription row: users.planner_plan is the single
// source of truth, kept in lockstep with users.planner_max_clients by
// updatePlannerPlan. The webhook maps a Stripe price → tier → updatePlannerPlan.

import {
  type BillingReason,
  computeEntitlement,
  type PlannerBilling,
  PLANNER_FOUNDING_CAP,
  PLANNER_FOUNDING_DURATION_MS,
  PLANNER_TRIAL_DURATION_MS,
  plannerCurrencyForLocale,
  type SubscriptionStatus,
} from "@shared/planner_billing";
import type { Currency, PlannerPlan } from "@shared/types";
import { CONFIG } from "../config";
import { billingEnforcementOn, db, now } from "../db";
import { HttpError } from "../lib/http";
import { isPlannerPlan, updatePlannerPlan } from "./planner";

export interface PlannerSubRow {
  user_id: number;
  subscription_status: string;
  trial_ends_at: number | null;
  founding_until: number | null;
  is_founding_member: number;
  current_period_end: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  currency: string;
  created_at: number;
  updated_at: number;
}

export function getPlannerSub(userId: number): PlannerSubRow | null {
  return (
    (db.prepare("SELECT * FROM planner_subscriptions WHERE user_id = ?").get(userId) as
      | PlannerSubRow
      | undefined) ?? null
  );
}

/** The planner's current tier from users.planner_plan (source of truth). */
export function getPlannerTier(userId: number): PlannerPlan {
  const row = db.prepare("SELECT planner_plan FROM users WHERE id = ?").get(userId) as
    | { planner_plan: string | null }
    | undefined;
  return isPlannerPlan(row?.planner_plan) ? row.planner_plan : "starter";
}

// ── Founding-cohort eligibility ─────────────────────────────────────────────
/** Granted founding badges so far. A slot is spent permanently when granted, so
 *  an expired window never frees it back up (mirrors couples' foundingSlotsUsed). */
export function plannerFoundingSlotsUsed(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM planner_subscriptions WHERE is_founding_member = 1")
    .get() as { n: number };
  return row.n;
}

/** Remaining founding slots, clamped to >= 0 — the "N of 25 left" line. */
export function plannerFoundingSpotsLeft(): number {
  return Math.max(0, PLANNER_FOUNDING_CAP - plannerFoundingSlotsUsed());
}

/** True while founding slots remain. Whether a SPECIFIC planner gets one is
 *  decided at activation, first-come. */
export function isPlannerFoundingEligible(): boolean {
  return plannerFoundingSlotsUsed() < PLANNER_FOUNDING_CAP;
}

// ── Activation grant ────────────────────────────────────────────────────────
/** Create the planner's subscription row at account grant. The eligibility check
 *  + the grant run in one transaction so the founding cohort can never overshoot
 *  the cap (mirrors initVendorBilling). The first PLANNER_FOUNDING_CAP planners
 *  get a free founding window (no card); once full, new planners land on a short
 *  trial → paid. Idempotent: a planner that already has a sub keeps it untouched.
 *  Currency is pinned from the user's locale. Returns the row. */
export function initPlannerBilling(userId: number, nowMs: number = now()): PlannerSubRow {
  const existing = getPlannerSub(userId);
  if (existing) return existing;

  const localeRow = db.prepare("SELECT locale FROM users WHERE id = ?").get(userId) as
    | { locale: string | null }
    | undefined;
  const currency = plannerCurrencyForLocale(localeRow?.locale);

  const grant = db.transaction((): PlannerSubRow => {
    const founding = isPlannerFoundingEligible();
    const status: SubscriptionStatus = founding ? "founding" : "trialing";
    const foundingUntil = founding ? nowMs + PLANNER_FOUNDING_DURATION_MS : null;
    const trialEnds = founding ? null : nowMs + PLANNER_TRIAL_DURATION_MS;
    db.prepare(
      `INSERT INTO planner_subscriptions
         (user_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, status, trialEnds, foundingUntil, founding ? 1 : 0, currency, nowMs, nowMs);
    return getPlannerSub(userId) as PlannerSubRow;
  });
  return grant();
}

// ── Entitlement snapshot ────────────────────────────────────────────────────
/** Map a stored planner sub row to the billing DTO, COMPUTING entitlement from
 *  status + timestamps at read-time (reuses the couple-side pure function). While
 *  the global billing kill-switch is OFF, everyone is forced entitled — the
 *  paywall is deferred until an admin turns enforcement on (mirrors couples). */
export function toPlannerBilling(
  row: PlannerSubRow,
  tier: PlannerPlan,
  nowMs: number = Date.now(),
): PlannerBilling {
  const status = row.subscription_status as SubscriptionStatus;
  let { entitled, reason } = computeEntitlement(status, {
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    nowMs,
  });
  if (!entitled && !billingEnforcementOn()) {
    entitled = true;
    reason = "subscribed";
  }
  return {
    subscription_status: status,
    tier,
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    is_founding_member: row.is_founding_member === 1,
    current_period_end: row.current_period_end,
    currency: row.currency as Currency,
    entitled,
    reason,
  };
}

/** True when the planner currently has edit access. A planner with no sub row yet
 *  is treated as not entitled (must be granted first — normally at account grant). */
export function isPlannerEntitled(userId: number, nowMs: number = Date.now()): boolean {
  const sub = getPlannerSub(userId);
  if (!sub) return false;
  return toPlannerBilling(sub, getPlannerTier(userId), nowMs).entitled;
}

// ── Stripe linkage ───────────────────────────────────────────────────────────
export function getPlannerByStripeCustomer(customerId: string): number | null {
  const row = db
    .prepare("SELECT user_id FROM planner_subscriptions WHERE stripe_customer_id = ?")
    .get(customerId) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export function setPlannerStripeCustomerId(userId: number, customerId: string): void {
  db.prepare(
    "UPDATE planner_subscriptions SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ?",
  ).run(customerId, now(), userId);
}

/** The recurring Price id to charge a planner, picked by tier + display currency.
 *  Throws 503 (billing_price_missing) when the price isn't configured. */
export function priceIdForPlannerTier(tier: PlannerPlan, currency: Currency): string {
  const perTier = CONFIG.stripePricePlanner[tier];
  const id = currency === "HUF" ? perTier.HUF : perTier.EUR;
  if (!id) {
    throw new HttpError(503, "No Stripe planner price configured for this tier", {
      code: "billing_price_missing",
    });
  }
  return id;
}

/** Reverse map a Stripe price id back to a planner tier (for the webhook). Null
 *  when the price isn't one of the planner tiers. */
export function tierForPriceId(priceId: string): PlannerPlan | null {
  for (const tier of ["starter", "pro", "premium"] as const) {
    const perTier = CONFIG.stripePricePlanner[tier];
    if (priceId === perTier.EUR || priceId === perTier.HUF) return tier;
  }
  return null;
}

/** Apply a Stripe planner subscription's state to the sub row + sync the tier.
 *  Same Stripe → our-status mapping as the couple side; when a `tier` is resolved
 *  from the price, updatePlannerPlan keeps users.planner_plan + max_clients in
 *  lockstep. */
export function applyPlannerSubscriptionState(
  userId: number,
  opts: {
    subscriptionId: string | null;
    stripeStatus: string;
    currentPeriodEnd: number | null;
    tier: PlannerPlan | null;
  },
): void {
  let mapped: SubscriptionStatus;
  switch (opts.stripeStatus) {
    case "active":
    case "trialing":
      mapped = "active";
      break;
    case "past_due":
    case "unpaid":
      mapped = "past_due";
      break;
    case "canceled":
    case "incomplete_expired":
      mapped = "canceled";
      break;
    default:
      mapped = "past_due";
  }
  db.prepare(
    `UPDATE planner_subscriptions
        SET subscription_status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = ?
      WHERE user_id = ?`,
  ).run(mapped, opts.subscriptionId, opts.currentPeriodEnd, now(), userId);
  // Only move the tier for live subscriptions — a cancel shouldn't silently
  // change which tier the planner is remembered on (they revert to read-only,
  // not to a different plan).
  if (opts.tier && (mapped === "active" || mapped === "past_due")) {
    updatePlannerPlan(userId, opts.tier);
  }
}

// ── Entitlement gate ────────────────────────────────────────────────────────
// Planner workspace EDIT surfaces. A mutating request (POST/PUT/PATCH/DELETE) to
// any of these is refused with 402 once the planner's founding/trial window
// lapses and they aren't subscribed — the workspace goes read-only. Deliberately
// EXCLUDED so a lapsed planner can recover / pay: /api/planner/billing/*,
// onboarding, notify-plans, and all reads/exports.
const PLANNER_EDIT_PREFIXES: readonly string[] = [
  "/api/planner/clients",
  "/api/planner/messages",
  "/api/planner/events",
  "/api/planner/portfolio",
  "/api/planner/profile",
];
const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Central read-only gate for the planner workspace, called from the request
 *  pipeline alongside the couple + vendor gates. Returns the blocking billing
 *  reason when a lapsed planner tries to edit, or null when the request should
 *  proceed. A planner with no sub row yet isn't gated here. */
export function plannerEntitlementBlock(
  method: string,
  pathname: string,
  userId: number | null,
): BillingReason | null {
  if (!userId || !MUTATING_METHODS.has(method)) return null;
  const onEditSurface = PLANNER_EDIT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!onEditSurface) return null;
  const sub = getPlannerSub(userId);
  if (!sub) return null; // not a planner (or not yet granted) → nothing to gate
  const billing = toPlannerBilling(sub, getPlannerTier(userId));
  return billing.entitled ? null : billing.reason;
}
