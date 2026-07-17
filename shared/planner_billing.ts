// Planner subscription / billing contract. Planners are a DIFFERENT aggregate
// from couples and vendors: a `users` row with user_type='planner', priced by
// TIER (starter/pro/premium) rather than a single flat plan. So planner billing
// lives in its own table (planner_subscriptions) with its own constants — but it
// REUSES the couple side's pure entitlement machinery (computeEntitlement)
// verbatim, because "given a status + timestamps, may you edit right now?" is
// identical math.
//
// Model (decided with the product owner):
//  - ALL THREE tiers are paid (no permanently-free tier).
//  - Founding offer: the first PLANNER_FOUNDING_CAP planners get their chosen
//    tier free for two years, no card on file.
//  - Once the cohort fills, new planners get a short 3-day trial → paid.
//  - Lapse/cancel → hard read-only gate (402), like couples + vendors.

import { type BillingReason, computeEntitlement, type SubscriptionStatus } from "./billing";
import { type BillingCurrency, toBillingCurrency } from "./currency";
import type { Currency, PlannerPlan, UnixMs } from "./types";

export { computeEntitlement };
export type { BillingReason, SubscriptionStatus };

/** First N planners to activate get a free founding window. Counted by granted
 *  badge (is_founding_member = 1); a slot is spent permanently on grant, so an
 *  expired window never frees it back up (mirrors the couples FOUNDING_CAP). */
export const PLANNER_FOUNDING_CAP = 25;

/** Founding free window length: two years from activation. */
export const PLANNER_FOUNDING_DURATION_MS = 1000 * 60 * 60 * 24 * 365 * 2;

/** Trial length for planner 26+ (cohort full): a short no-card window before the
 *  read-only gate. */
export const PLANNER_TRIAL_DURATION_MS = 1000 * 60 * 60 * 24 * 3;

/** Monthly price per tier per display currency (integer, minor-unit-less). HUF
 *  has no minor unit; EUR is shown without cents. Keep in sync with the Stripe
 *  planner Price objects (backend/scripts/stripe_setup_planner.ts). */
export const PLANNER_TIER_PRICE: Record<PlannerPlan, Record<BillingCurrency, number>> = {
  starter: { HUF: 6900, EUR: 19, USD: 19 },
  pro: { HUF: 11900, EUR: 29, USD: 29 },
  premium: { HUF: 19900, EUR: 49, USD: 49 },
};

/** HU planners are billed in HUF, everyone else in EUR — mirrors the couple
 *  currency-follows-locale rule. Pinned once at activation. */
export function plannerCurrencyForLocale(locale: string | null | undefined): Currency {
  return locale === "hu" ? "HUF" : "EUR";
}

/** The monthly price for a tier on this currency. */
export function plannerPrice(tier: PlannerPlan, currency: Currency): number {
  return PLANNER_TIER_PRICE[tier][toBillingCurrency(currency)];
}

/** Billing snapshot attached to the planner's billing surface + onboarding. */
export interface PlannerBilling {
  subscription_status: SubscriptionStatus;
  /** The tier this planner is on (source of truth: users.planner_plan). */
  tier: PlannerPlan;
  /** Epoch ms — end of the trial (planner 26+). Null unless trialing. */
  trial_ends_at: UnixMs | null;
  /** Epoch ms — end of the 2-year founding window. Null when not founding. */
  founding_until: UnixMs | null;
  /** Among the first PLANNER_FOUNDING_CAP planners → holds the founding badge. */
  is_founding_member: boolean;
  /** Epoch ms — paid period end from Stripe. Null when not a paying sub. */
  current_period_end: UnixMs | null;
  currency: Currency;
  /** Computed: does the planner have edit access right now? When false the
   *  planner workspace goes read-only (402 on mutations). */
  entitled: boolean;
  reason: BillingReason;
}

/** Response of GET /api/planner/billing — everything the planner billing surface
 *  needs. */
export interface PlannerBillingStatus {
  /** Whether planner Stripe billing is wired server-side. False before the
   *  Stripe prices are configured — checkout is unavailable and the page says so. */
  enabled: boolean;
  billing: PlannerBilling;
  currency: Currency;
  /** Per-tier monthly price in `currency`, for rendering the plan cards. */
  prices: Record<PlannerPlan, number>;
  /** Remaining founding slots (CAP − granted badges), clamped >= 0. Drives the
   *  "N of 25 free spots left" line. */
  founding_spots_left: number;
}
