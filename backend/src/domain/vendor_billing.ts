// Vendor billing domain: founding-cohort eligibility, the activation grant,
// the freemium lead-window state machine, and the entitlement snapshot used by
// the vendor edit gate + onboarding. The entitlement rules live in
// shared/vendor_billing.ts (computeVendorEntitlement) so server and client
// agree; this file owns the vendor_subscriptions row transitions:
//
//   trialing (3 days) ──card saved──▶ lead_window ──3rd inquiry──▶
//   billing_starts_at stamped (next month start) ──Stripe webhook──▶ active
//
// `applyVendorSubscriptionState` is the seam the vendor billing webhook calls;
// `markVendorCardOnFile` + `recordVendorLeadCredit` are the freemium seams
// (called from the webhook and from inquiry creation respectively).

import {
  computeVendorEntitlement,
  startOfNextUtcMonth,
  type SubscriptionStatus,
  VENDOR_EARLY_CAP,
  VENDOR_FOUNDING_CAP,
  VENDOR_FREE_LEAD_CREDITS,
  type VendorBilling,
  type VendorBillingReason,
  type VendorOffer,
  vendorOfferForSlots,
  type VendorSubscriptionStatus,
} from "@shared/vendor_billing";
import type { Currency } from "@shared/types";
import { billingEnforcementOn, db, now } from "../db";
import { getVendorAccountByOwnerUserId } from "./vendor_accounts";

export interface VendorSubRow {
  vendor_account_id: number;
  subscription_status: string;
  trial_ends_at: number | null;
  founding_until: number | null;
  is_founding_member: number;
  is_early_member: number;
  current_period_end: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  card_on_file: number;
  card_added_at: number | null;
  lead_credits_used: number;
  billing_starts_at: number | null;
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

// ── Free-cohort eligibility ─────────────────────────────────────────────────
/** Granted founding badges so far. A slot is spent permanently when granted, so
 *  an expired year never frees it back up (mirrors couples' foundingSlotsUsed). */
export function vendorFoundingSlotsUsed(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_subscriptions WHERE is_founding_member = 1")
    .get() as { n: number };
  return row.n;
}

/** Granted early-cohort badges so far. Same spent-permanently rule. */
export function vendorEarlySlotsUsed(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_subscriptions WHERE is_early_member = 1")
    .get() as { n: number };
  return row.n;
}

/** Remaining founding slots, clamped to >= 0 — the public "N of 100 left" line. */
export function vendorFoundingSpotsLeft(): number {
  return Math.max(0, VENDOR_FOUNDING_CAP - vendorFoundingSlotsUsed());
}

/** Remaining early-cohort slots, clamped to >= 0, for the "N of 300 left" line. */
export function vendorEarlySpotsLeft(): number {
  return Math.max(0, VENDOR_EARLY_CAP - vendorEarlySlotsUsed());
}

/** The free window a vendor activating right now would receive. One read of
 *  each counter, then the shared pure tier resolution, so the grant, the
 *  billing surface and the campaign email always quote the same offer. */
export function currentVendorOffer(): VendorOffer {
  return vendorOfferForSlots(vendorFoundingSlotsUsed(), vendorEarlySlotsUsed());
}

/** True while founding slots remain. Whether a SPECIFIC vendor gets one is
 *  decided at activation, first-come. */
export function isVendorFoundingEligible(): boolean {
  return vendorFoundingSlotsUsed() < VENDOR_FOUNDING_CAP;
}

// ── Activation grant ────────────────────────────────────────────────────────
/** Create the vendor's subscription row at activation. The eligibility check +
 *  the grant must be indivisible so neither free cohort can overshoot its cap,
 *  so they run in one transaction (mirrors activatePartnerFreeWindow). The
 *  ladder: first VENDOR_FOUNDING_CAP vendors get a free year, the next
 *  VENDOR_EARLY_CAP get three months, everyone after lands on the short trial →
 *  paid. Both free tiers ride status='founding' + founding_until and differ only
 *  in which badge column is stamped. Idempotent: a vendor that already has a sub
 *  keeps it untouched. Returns the row. */
export function initVendorBilling(
  vendorAccountId: number,
  currency: Currency,
  nowMs: number = now(),
): VendorSubRow {
  const existing = getVendorSub(vendorAccountId);
  if (existing) return existing;

  const grant = db.transaction((): VendorSubRow => {
    // Re-resolved INSIDE the tx: the counters it reads are the same rows this
    // statement is about to add to, so reading them outside would let two
    // concurrent activations both see the last free slot.
    const offer = currentVendorOffer();
    const free = offer.tier !== "trial";
    const status: SubscriptionStatus = free ? "founding" : "trialing";
    db.prepare(
      `INSERT INTO vendor_subscriptions
         (vendor_account_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, is_early_member, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      vendorAccountId,
      status,
      free ? null : nowMs + offer.duration_ms,
      free ? nowMs + offer.duration_ms : null,
      offer.tier === "founding" ? 1 : 0,
      offer.tier === "early" ? 1 : 0,
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
 *  status + timestamps at read-time (the shared pure function). */
export function toVendorBilling(row: VendorSubRow, nowMs: number = Date.now()): VendorBilling {
  const status = row.subscription_status as VendorSubscriptionStatus;
  let { entitled, reason } = computeVendorEntitlement(status, {
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    lead_credits_used: row.lead_credits_used,
    billing_starts_at: row.billing_starts_at,
    nowMs,
  });
  // The global go-live switch, honoured here for the same reason the couple and
  // planner mappers honour it (couples.ts / planner_billing.ts): while the
  // freeze is deferred NOBODY is gated, so one flip starts all three aggregates
  // at the same instant instead of leaving vendors on a clock of their own.
  // Every gate downstream (vendorEntitlementBlock, vendorPlanForAccount and so
  // the whole FREE/PRO feature table) reads this verdict, which is what makes
  // the single check enough. A single indexed PK read, and it short-circuits on
  // the already-entitled path so the common case pays nothing.
  if (!entitled && !billingEnforcementOn()) {
    entitled = true;
    reason = "subscribed";
  }
  return {
    subscription_status: status,
    trial_ends_at: row.trial_ends_at,
    founding_until: row.founding_until,
    is_founding_member: row.is_founding_member === 1,
    is_early_member: row.is_early_member === 1,
    current_period_end: row.current_period_end,
    card_on_file: row.card_on_file === 1,
    lead_credits_used: row.lead_credits_used,
    lead_credits_total: VENDOR_FREE_LEAD_CREDITS,
    billing_starts_at: row.billing_starts_at,
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

// ── Freemium lead-window transitions ────────────────────────────────────────
/** Card saved with Stripe (checkout setup completed). Flips a no-card vendor
 *  (trialing, running or expired, or lapsed-to-none) into the lead_window:
 *  full PRO until the first VENDOR_FREE_LEAD_CREDITS inquiries arrive. A
 *  vendor already founding / on a paid sub / mid-lead-window just gets the
 *  card flag stamped, no free leads are (re)granted, so a canceled
 *  subscriber can't farm new free windows by re-adding a card. Idempotent. */
export function markVendorCardOnFile(vendorAccountId: number, nowMs: number = now()): void {
  const sub = getVendorSub(vendorAccountId);
  if (!sub) return;
  const status = sub.subscription_status as VendorSubscriptionStatus;
  const entersLeadWindow =
    (status === "trialing" || status === "none") && sub.stripe_subscription_id === null;
  db.prepare(
    `UPDATE vendor_subscriptions
        SET card_on_file = 1,
            card_added_at = COALESCE(card_added_at, ?),
            subscription_status = ?,
            updated_at = ?
      WHERE vendor_account_id = ?`,
  ).run(nowMs, entersLeadWindow ? "lead_window" : sub.subscription_status, nowMs, vendorAccountId);
}

/** A couple inquiry was delivered to this vendor. Spends one free lead credit
 *  when the vendor is inside the lead window; the credit that reaches
 *  VENDOR_FREE_LEAD_CREDITS stamps billing_starts_at = start of the NEXT
 *  month (the "we generated 3 direct sales → payment period starts next
 *  month" trigger). Returns true when this call just scheduled billing, so
 *  the caller can kick off the Stripe subscription. No-op for every other
 *  status (trial and founding inquiries are free and uncounted). */
export function recordVendorLeadCredit(vendorAccountId: number, nowMs: number = now()): boolean {
  const spend = db.transaction((): boolean => {
    const sub = getVendorSub(vendorAccountId);
    if (!sub || sub.subscription_status !== "lead_window") return false;
    if (sub.billing_starts_at !== null || sub.lead_credits_used >= VENDOR_FREE_LEAD_CREDITS) {
      return false;
    }
    const used = sub.lead_credits_used + 1;
    const startsBilling = used >= VENDOR_FREE_LEAD_CREDITS;
    db.prepare(
      `UPDATE vendor_subscriptions
          SET lead_credits_used = ?, billing_starts_at = ?, updated_at = ?
        WHERE vendor_account_id = ?`,
    ).run(used, startsBilling ? startOfNextUtcMonth(nowMs) : null, nowMs, vendorAccountId);
    return startsBilling;
  });
  return spend();
}

// ── Stripe linkage ──────────────────────────────────────────────────────────
export function setVendorStripeCustomerId(vendorAccountId: number, customerId: string): void {
  db.prepare(
    "UPDATE vendor_subscriptions SET stripe_customer_id = ?, updated_at = ? WHERE vendor_account_id = ?",
  ).run(customerId, now(), vendorAccountId);
}

/** Resolve a vendor account id from a Stripe customer id (webhook fallback
 *  when the subscription metadata is missing). */
export function getVendorByStripeCustomer(customerId: string): number | null {
  const row = db
    .prepare("SELECT vendor_account_id FROM vendor_subscriptions WHERE stripe_customer_id = ?")
    .get(customerId) as { vendor_account_id: number } | undefined;
  return row?.vendor_account_id ?? null;
}

/** Apply a Stripe vendor subscription's state to the vendor sub row. The
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
// Vendor PRO surfaces. A mutating request (POST/PUT/PATCH/DELETE) to any of
// these is refused with 402 once the vendor's window lapses and they aren't
// subscribed: the availability calendar goes read-only. The LISTING EDITOR is
// deliberately NOT here: the FREE plan keeps the public listing live and
// editable (freemium: only DMs / calendar / CRM are PRO). Also excluded so a
// lapsed vendor can recover: /api/vendor/onboard/*, /api/vendor/claim/*, and
// /api/vendor/billing/*.
const VENDOR_EDIT_PREFIXES: readonly string[] = ["/api/vendor/availability"];
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
): VendorBillingReason | null {
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
