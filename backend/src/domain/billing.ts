// Subscription billing domain: Stripe client, founding-member eligibility, the
// trial/founding state transitions, and the entitlement guard used by write
// routes. Pure infra (the Stripe SDK) is wrapped here so routes stay thin.
//
// State machine + entitlement rules: shared/billing.ts.

import Stripe from "stripe";
import {
  type BillingReason,
  FOUNDING_CAP,
  FOUNDING_DURATION_MS,
  PAID_LAUNCH_DATE,
  partnerFreeWindowEnd,
  TRIAL_DURATION_MS,
} from "@shared/billing";
import type { Currency } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import { db, now } from "../db";
import { type Ctx, HttpError } from "../lib/http";
import { type CoupleRow, getCoupleById, getCoupleForUser, toCoupleBilling } from "./couples";

// ── Stripe client ─────────────────────────────────────────────────────────
let _stripe: Stripe | null = null;
/** Lazily build the Stripe client. Throws 503 when billing isn't configured so
 *  callers surface "billing not set up yet" instead of a crash. */
export function stripe(): Stripe {
  if (!STRIPE_ENABLED) {
    throw new HttpError(503, "Billing is not configured", { code: "billing_disabled" });
  }
  if (!_stripe) {
    // Pin the API version so dashboard upgrades can't change webhook payloads
    // under us. `apiVersion` accepts the dated release string.
    _stripe = new Stripe(CONFIG.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
  }
  return _stripe;
}

/** The recurring Price id to charge a couple, picked by its display currency.
 *  USD falls back to the EUR price (we only sell the plan in EUR/HUF for now). */
export function priceIdForCurrency(currency: Currency): string {
  const id = currency === "HUF" ? CONFIG.stripePriceHuf : CONFIG.stripePriceEur;
  if (!id) {
    throw new HttpError(503, "No Stripe price configured for this currency", {
      code: "billing_price_missing",
    });
  }
  return id;
}

// ── Founding-member eligibility ─────────────────────────────────────────────
/** Zero-based creation rank of a couple among the non-demo couples (how many
 *  real couples were created before it). Stable: earlier couples never shift. */
function foundingRank(coupleId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 0 AND id < ?")
    .get(coupleId) as { n: number };
  return row.n;
}

/** True when this couple is one of the first FOUNDING_CAP real couples. */
export function isFoundingEligible(coupleId: number): boolean {
  return foundingRank(coupleId) < FOUNDING_CAP;
}

/** Count of real couples that currently hold a live founding membership. Used
 *  by the public "spots left" counter and the admin planner. */
export function activeFoundingCount(nowMs: number = Date.now()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM couples
        WHERE is_demo = 0 AND is_founding_member = 1
          AND founding_until IS NOT NULL AND founding_until > ?`,
    )
    .get(nowMs) as { n: number };
  return row.n;
}

// ── Global enforcement switch ───────────────────────────────────────────────
/** Flip the global read-only paywall on or off. Off (default) defers the freeze
 *  so nobody is locked out; on makes lapsed couples read-only. Stamped with the
 *  admin who flipped it. The read side is `billingEnforcementOn()` in db.ts. */
export function setBillingEnforcement(on: boolean, adminUserId: number): void {
  db.prepare(
    `UPDATE billing_control
        SET enforcement_on = ?, enforced_at = ?, enforced_by_user_id = ?
      WHERE id = 1`,
  ).run(on ? 1 : 0, now(), adminUserId);
}

// ── State transitions ───────────────────────────────────────────────────────
/** Start the in-app trial. Called at onboarding for brand-new couples.
 *  The free window runs at least 14 days, but never ends before the public
 *  paid-launch date, so during the pre-launch period every solo workspace is
 *  free until then (the "free until Aug 1" promise on the nudge banner). After
 *  launch it degrades to the plain 14-day trial.
 *  Idempotent-ish: only writes when the couple is still in the default 'none'
 *  state so we never clobber a founding/active couple. */
export function startTrial(coupleId: number, nowMs: number = now()): void {
  const trialEnd = Math.max(nowMs + TRIAL_DURATION_MS, PAID_LAUNCH_DATE);
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'trialing', trial_ends_at = ?, updated_at = ?
      WHERE id = ? AND subscription_status = 'none'`,
  ).run(trialEnd, nowMs, coupleId);
}

/** Billing state for a brand-new couple at onboarding: the first 200 real
 *  couples become founding members (free 18 months) immediately; everyone past
 *  the cap gets the 14-day trial. Only writes from the default 'none' state. */
export function initBillingAtOnboarding(coupleId: number, nowMs: number = now()): void {
  if (isFoundingEligible(coupleId)) {
    // First 200: free until their wedding day (fallback 18 months when the date
    // is unknown or already past), per the founder's "first 200 free until your
    // wedding" promise. The badge stays reserved for the first 200.
    const couple = getCoupleById(coupleId);
    const until = partnerFreeWindowEnd(weddingMsOf(couple?.wedding_date ?? null), nowMs);
    db.prepare(
      `UPDATE couples
          SET subscription_status = 'founding',
              is_founding_member = 1,
              founding_until = ?,
              updated_at = ?
        WHERE id = ? AND subscription_status = 'none'`,
    ).run(until, nowMs, coupleId);
  } else {
    startTrial(coupleId, nowMs);
  }
}

/** Admin "free badge": comp a couple 18 months free regardless of the cap or
 *  partner state. Overwrites any current plan. NOT a first-200 founding member
 *  (`is_founding_member = 0`) so the admin list shows it as a plain comp
 *  ("Ingyenes"), distinct from the first-200 "free until wedding" cohort. */
export function grantFreeAccess(coupleId: number, nowMs: number = now()): void {
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'founding', is_founding_member = 0, founding_until = ?, updated_at = ?
      WHERE id = ?`,
  ).run(nowMs + FOUNDING_DURATION_MS, nowMs, coupleId);
}

/** Remove a comped free badge → no plan (workspace goes read-only until they
 *  subscribe). Used by the admin to revoke a manually-granted free badge. */
export function revokeFreeAccess(coupleId: number, nowMs: number = now()): void {
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'none', is_founding_member = 0, founding_until = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(nowMs, coupleId);
}

/** Parse a couple's stored wedding date (YYYY-MM-DD or null) to epoch ms, or
 *  null when unset/unparseable. */
function weddingMsOf(weddingDate: string | null): number | null {
  if (!weddingDate) return null;
  const ms = Date.parse(weddingDate);
  return Number.isNaN(ms) ? null : ms;
}

/** Grant the "free until your wedding day" window. Called when partner B joins
 *  a couple: inviting your partner is what unlocks the free platform. Applies
 *  to EVERY couple (not just the first 200): the founding-member badge stays
 *  reserved for the first 200 via `is_founding_member`, but the free entitlement
 *  window is granted to all. No-op for demo couples, couples already on a
 *  paid/founding plan, or a solo workspace. Returns whether it was granted. */
export function activatePartnerFreeWindow(coupleId: number, nowMs: number = now()): boolean {
  const couple = getCoupleById(coupleId);
  if (!couple || couple.is_demo) return false;
  // Don't downgrade a paying subscriber or re-stamp an existing founder.
  if (["founding", "active", "past_due"].includes(couple.subscription_status)) return false;
  if (couple.partner_b_id == null) return false; // both partners required

  const until = partnerFreeWindowEnd(weddingMsOf(couple.wedding_date), nowMs);
  const badge = isFoundingEligible(coupleId) ? 1 : 0;
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'founding',
            is_founding_member = ?,
            founding_until = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(badge, until, nowMs, coupleId);
  return true;
}

/** Keep a partner-granted free window pinned to the couple's wedding day when
 *  they change the date. Only touches couples on the partner reward
 *  (`founding` + NOT a first-200 badge holder) so the first-200 18-month window
 *  is never shortened. No-op otherwise. */
export function refreshPartnerFreeWindow(coupleId: number, nowMs: number = now()): void {
  const couple = getCoupleById(coupleId);
  if (!couple || couple.is_demo) return;
  if (couple.subscription_status !== "founding" || couple.is_founding_member) return;
  if (couple.partner_b_id == null) return;
  const until = partnerFreeWindowEnd(weddingMsOf(couple.wedding_date), nowMs);
  db.prepare("UPDATE couples SET founding_until = ?, updated_at = ? WHERE id = ?").run(
    until,
    nowMs,
    coupleId,
  );
}

// ── Stripe linkage lookups (used by the webhook) ────────────────────────────
export function getCoupleByStripeCustomer(customerId: string): CoupleRow | null {
  return (
    (db.prepare("SELECT * FROM couples WHERE stripe_customer_id = ?").get(customerId) as
      | CoupleRow
      | undefined) ?? null
  );
}

export function setStripeCustomerId(coupleId: number, customerId: string): void {
  db.prepare("UPDATE couples SET stripe_customer_id = ?, updated_at = ? WHERE id = ?").run(
    customerId,
    now(),
    coupleId,
  );
}

/** Apply a Stripe subscription's state to the couple. The webhook funnels
 *  every subscription lifecycle event through here. `status` is the Stripe
 *  status; we map the relevant ones onto our state machine. */
export function applySubscriptionState(
  coupleId: number,
  opts: {
    subscriptionId: string | null;
    stripeStatus: string;
    currentPeriodEnd: number | null; // epoch ms
  },
): void {
  let mapped: string;
  switch (opts.stripeStatus) {
    case "active":
    case "trialing": // Stripe-side trial → still a committed paying sub for us
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
      mapped = "past_due"; // incomplete / paused → treat as needs-attention
  }
  db.prepare(
    `UPDATE couples
        SET subscription_status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = ?
      WHERE id = ?`,
  ).run(mapped, opts.subscriptionId, opts.currentPeriodEnd, now(), coupleId);
}

// ── Entitlement guard ───────────────────────────────────────────────────────
/** Throw 402 when the couple may not edit (trial/founding lapsed, no sub). Use
 *  on write endpoints that should be read-only once billing lapses. Returns the
 *  couple row so callers can keep using it. */
export function requireEntitledCouple(ctx: Ctx): CoupleRow {
  if (!ctx.userId) throw new HttpError(401, "Not authenticated");
  const couple = getCoupleForUser(ctx.userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const billing = toCoupleBilling(couple);
  if (!billing.entitled) {
    throw new HttpError(402, "Subscription required", {
      code: "subscription_required",
      reason: billing.reason,
    });
  }
  return couple;
}

// Couple-workspace EDIT surfaces. A mutating request (POST/PUT/PATCH/DELETE) to
// any of these is refused with 402 once the couple's billing lapses, making the
// workspace read-only. Deliberately EXCLUDED so a read-only couple can still
// recover or wind down: auth/*, account/*, billing/*, couples/pause*,
// couples/invites*, couples/onboard, exports/* (read-only export is allowed),
// and every public/guest surface (rsvp/*, unsubscribe/*, suppliers/community).
const EDIT_PREFIXES: readonly string[] = [
  "/api/budget",
  "/api/guests",
  "/api/households",
  "/api/seating",
  "/api/schedule",
  "/api/planning",
  "/api/picks",
  "/api/couple-suppliers",
  "/api/couples/supplier-costs",
  "/api/accommodations",
  "/api/transfers",
  "/api/bookings",
  "/api/moodboard",
  "/api/couples/current",
];
const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Central read-only gate, called from the request pipeline. Returns the
 *  blocking billing reason when a lapsed couple tries to edit a workspace
 *  surface, or null when the request should proceed. Demo couples and couples
 *  still in trial/founding/active always proceed. */
export function entitlementBlock(
  method: string,
  pathname: string,
  userId: number | null,
): BillingReason | null {
  if (!userId || !MUTATING_METHODS.has(method)) return null;
  const onEditSurface = EDIT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!onEditSurface) return null;
  const couple = getCoupleForUser(userId);
  if (!couple) return null; // no workspace yet → nothing to gate
  const billing = toCoupleBilling(couple);
  return billing.entitled ? null : billing.reason;
}
