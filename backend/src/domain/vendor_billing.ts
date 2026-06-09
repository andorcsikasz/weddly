// Vendor billing domain: founding-cohort eligibility, the activation grant, and
// the entitlement snapshot used by the vendor edit gate + onboarding. The state
// machine + entitlement rules are shared with couples (shared/billing.ts) —
// only the table and the cohort/price constants differ (shared/vendor_billing.ts).
//
// Stripe wiring (Checkout/Portal/webhook) is a fast-follow: the founding 100
// are free for a year with no card, so account creation never depends on Stripe
// being configured. `applyVendorSubscriptionState` is the seam the future
// webhook will call.

import {
  type BillingReason,
  computeEntitlement,
  type SubscriptionStatus,
  type VendorBilling,
  VENDOR_FOUNDING_CAP,
  VENDOR_FOUNDING_DURATION_MS,
  VENDOR_TRIAL_DURATION_MS,
} from "@shared/vendor_billing";
import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { getVendorAccountByOwnerUserId } from "./vendor_accounts";

export interface VendorSubRow {
  vendor_account_id: number;
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

export function getVendorSub(vendorAccountId: number): VendorSubRow | null {
  return (
    (db
      .prepare("SELECT * FROM vendor_subscriptions WHERE vendor_account_id = ?")
      .get(vendorAccountId) as VendorSubRow | undefined) ?? null
  );
}

// ── Founding-cohort eligibility ─────────────────────────────────────────────
/** Granted founding badges so far. A slot is spent permanently when granted, so
 *  an expired year never frees it back up (mirrors couples' foundingSlotsUsed). */
export function vendorFoundingSlotsUsed(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_subscriptions WHERE is_founding_member = 1")
    .get() as { n: number };
  return row.n;
}

/** Remaining founding slots, clamped to >= 0 — the public "N of 100 left" line. */
export function vendorFoundingSpotsLeft(): number {
  return Math.max(0, VENDOR_FOUNDING_CAP - vendorFoundingSlotsUsed());
}

/** True while founding slots remain. Whether a SPECIFIC vendor gets one is
 *  decided at activation, first-come. */
export function isVendorFoundingEligible(): boolean {
  return vendorFoundingSlotsUsed() < VENDOR_FOUNDING_CAP;
}

// ── Activation grant ────────────────────────────────────────────────────────
/** Create the vendor's subscription row at activation. The eligibility check +
 *  the grant must be indivisible so the founding cohort can never overshoot the
 *  cap, so they run in one transaction (mirrors activatePartnerFreeWindow). The
 *  first VENDOR_FOUNDING_CAP vendors get a free founding year (no card); once
 *  the cohort is full, new vendors land on a short trial → paid. Idempotent: a
 *  vendor that already has a sub keeps it untouched. Returns the row. */
export function initVendorBilling(
  vendorAccountId: number,
  currency: Currency,
  nowMs: number = now(),
): VendorSubRow {
  const existing = getVendorSub(vendorAccountId);
  if (existing) return existing;

  const grant = db.transaction((): VendorSubRow => {
    const founding = isVendorFoundingEligible();
    const status: SubscriptionStatus = founding ? "founding" : "trialing";
    const foundingUntil = founding ? nowMs + VENDOR_FOUNDING_DURATION_MS : null;
    const trialEnds = founding ? null : nowMs + VENDOR_TRIAL_DURATION_MS;
    db.prepare(
      `INSERT INTO vendor_subscriptions
         (vendor_account_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      vendorAccountId,
      status,
      trialEnds,
      foundingUntil,
      founding ? 1 : 0,
      currency,
      nowMs,
      nowMs,
    );
    return getVendorSub(vendorAccountId) as VendorSubRow;
  });
  return grant();
}

// ── Entitlement snapshot ────────────────────────────────────────────────────
/** Map a stored vendor sub row to the billing DTO, COMPUTING entitlement from
 *  status + timestamps at read-time (reuses the couple-side pure function). */
export function toVendorBilling(row: VendorSubRow, nowMs: number = Date.now()): VendorBilling {
  const status = row.subscription_status as SubscriptionStatus;
  const { entitled, reason } = computeEntitlement(status, {
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    nowMs,
  });
  return {
    subscription_status: status,
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    is_founding_member: row.is_founding_member === 1,
    current_period_end: row.current_period_end,
    currency: row.currency as Currency,
    entitled,
    reason,
  };
}

/** True when the vendor (by account id) currently has edit/publish access. A
 *  vendor with no sub row yet is treated as not entitled (must activate). */
export function isVendorEntitled(vendorAccountId: number, nowMs: number = Date.now()): boolean {
  const sub = getVendorSub(vendorAccountId);
  if (!sub) return false;
  return toVendorBilling(sub, nowMs).entitled;
}

// ── Stripe linkage (fast-follow webhook seam) ───────────────────────────────
/** Apply a Stripe vendor subscription's state to the vendor sub row. The future
 *  vendor billing webhook funnels lifecycle events through here. Same Stripe →
 *  our-status mapping as the couple side. */
export function applyVendorSubscriptionState(
  vendorAccountId: number,
  opts: { subscriptionId: string | null; stripeStatus: string; currentPeriodEnd: number | null },
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
    `UPDATE vendor_subscriptions
        SET subscription_status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = ?
      WHERE vendor_account_id = ?`,
  ).run(mapped, opts.subscriptionId, opts.currentPeriodEnd, now(), vendorAccountId);
}

// ── Entitlement gate ────────────────────────────────────────────────────────
// Vendor EDIT surfaces. A mutating request (POST/PUT/PATCH/DELETE) to any of
// these is refused with 402 once the vendor's founding/trial window lapses and
// they aren't subscribed — the listing editor + availability go read-only.
// Deliberately EXCLUDED so a lapsed vendor can recover: /api/vendor/onboard/*,
// /api/vendor/claim/*, and (future) /api/vendor/billing/*.
const VENDOR_EDIT_PREFIXES: readonly string[] = [
  "/api/vendor/listing",
  "/api/vendor/availability",
];
const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Central read-only gate for the vendor workspace, called from the request
 *  pipeline alongside the couple gate. Returns the blocking billing reason when
 *  a lapsed vendor tries to edit, or null when the request should proceed. A
 *  vendor with no sub row yet (mid-activation) isn't gated here — the onboarding
 *  flow grants the sub before they reach an edit surface. */
export function vendorEntitlementBlock(
  method: string,
  pathname: string,
  userId: number | null,
): BillingReason | null {
  if (!userId || !MUTATING_METHODS.has(method)) return null;
  const onEditSurface = VENDOR_EDIT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!onEditSurface) return null;
  const account = getVendorAccountByOwnerUserId(userId);
  if (!account) return null; // not a vendor → nothing to gate
  const sub = getVendorSub(account.id);
  if (!sub) return null; // no sub yet (mid-onboarding) → don't gate
  const billing = toVendorBilling(sub);
  return billing.entitled ? null : billing.reason;
}
