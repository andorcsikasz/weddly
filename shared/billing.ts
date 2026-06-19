// Subscription / billing contract shared by both sides.
//
// Money model recap (see CLAUDE.md): every couple has a `currency` (HUF for
// HU signups, EUR otherwise). The standard plan is a flat monthly price in
// that currency — 1 990 Ft / month or 5 € / month — billed through Stripe.
//
// The state machine lives on the couple, in `subscription_status` plus three
// timestamps. Entitlement (does this couple have edit access right now?) is
// COMPUTED from those at read-time so a lapsed trial flips to read-only
// without a background job having to run first. We never mutate the couple's
// `status` for billing — that field drives the unrelated pause-to-DELETE
// countdown — so a non-paying couple's data is always preserved.

import type { Currency, UnixMs } from "./types";

export type SubscriptionStatus =
  /** 14-day in-app free trial, no card on file. Set at onboarding. */
  | "trialing"
  /** Founding member: free for 18 months. Granted when partner B joins a
   *  couple that is among the first 200 created. No card on file. */
  | "founding"
  /** Paying Stripe subscriber, current period not yet ended. */
  | "active"
  /** Stripe payment failed; in dunning. Kept entitled during the grace. */
  | "past_due"
  /** Subscription ended / canceled and the paid period has lapsed. */
  | "canceled"
  /** Never subscribed and the trial expired. Read-only until they subscribe. */
  | "none";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "founding",
  "active",
  "past_due",
  "canceled",
  "none",
];

/** In-app free trial length for non-founding couples. */
export const TRIAL_DURATION_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
/** Founding-member free window once both partners have joined. */
export const FOUNDING_DURATION_MS = 1000 * 60 * 60 * 24 * 30 * 18; // ~18 months
/** How many of the earliest couples can claim a founding slot. */
export const FOUNDING_CAP = 200;

/** The day the platform stops being free for solo (one-partner) workspaces.
 *  Until this date everyone can edit; after it, a couple that never invited
 *  their partner goes read-only unless they subscribe. Couples who DID invite
 *  their partner are free until their wedding day instead (see
 *  `partnerFreeWindowEnd`). Drives the "invite your partner" nudge banner copy.
 *  UTC midnight 2026-08-01. */
export const PAID_LAUNCH_DATE = Date.UTC(2026, 7, 1);

/** End of the free window granted when partner B joins: free until the wedding
 *  day. Falls back to the generous 18-month founding window when the date is
 *  unknown or already in the past, so a couple is never instantly locked out.
 *  Pure + time-based so the domain grant and any test agree. */
export function partnerFreeWindowEnd(weddingMs: number | null, nowMs: number): number {
  if (weddingMs != null && weddingMs > nowMs) return weddingMs;
  return nowMs + FOUNDING_DURATION_MS;
}

/** Standard monthly price, in integer minor-less units of each currency
 *  (Forint has no minor unit; EUR shown without cents on the card). These are
 *  the display/forecast figures — the charged amount comes from the Stripe
 *  Price object, which must be kept in sync. */
export const MONTHLY_PRICE: Record<Currency, number> = {
  HUF: 990,
  EUR: 5,
  USD: 5,
};

/** Billing snapshot attached to the Couple DTO. */
export interface CoupleBilling {
  subscription_status: SubscriptionStatus;
  /** Epoch ms — end of the 14-day in-app trial. Null when never started. */
  trial_ends_at: UnixMs | null;
  /** Epoch ms — end of the 18-month founding window. Null when not founding. */
  founding_until: UnixMs | null;
  /** Among the first 200 couples → eligible to become a founding member once
   *  the partner joins. Stays true even after the window ends (historical). */
  is_founding_member: boolean;
  /** Epoch ms — paid period end from Stripe. Null when not a paying sub. */
  current_period_end: UnixMs | null;
  /** Computed: does the couple currently have edit access? When false the
   *  workspace is read-only and edits return 402. */
  entitled: boolean;
  /** Computed reason the couple is (not) entitled — drives the UI banner. */
  reason: BillingReason;
}

/** Response of GET /api/billing/status — everything the billing page needs. */
export interface BillingStatusResponse {
  /** Whether Stripe is configured server-side. When false, checkout/portal
   *  are unavailable and the page shows a "billing not live yet" note. */
  enabled: boolean;
  billing: CoupleBilling;
  /** The couple's display currency and the monthly price in that currency. */
  currency: Currency;
  price: number;
  /** False when partner B hasn't joined yet (solo workspace). Drives the
   *  "invite your partner, free until your wedding day" nudge banner. */
  has_partner: boolean;
  /** Remaining founding slots (FOUNDING_CAP minus live founding members),
   *  clamped to >= 0. Drives the "N spots left" line. */
  founding_spots_left: number;
}

export type BillingReason =
  | "trialing"
  | "founding"
  | "subscribed"
  | "trial_expired"
  | "founding_expired"
  | "canceled"
  | "none";

/** Single source of truth for "can this couple edit right now?". Pure +
 *  time-based so it can run on the server (gate writes) and the client
 *  (read-only UI) and agree. */
export function computeEntitlement(
  status: SubscriptionStatus,
  opts: { trial_ends_at: number | null; founding_until: number | null; nowMs: number },
): { entitled: boolean; reason: BillingReason } {
  const { trial_ends_at, founding_until, nowMs } = opts;
  // Paying subscribers (and the dunning grace) always have access.
  if (status === "active" || status === "past_due") {
    return { entitled: true, reason: "subscribed" };
  }
  if (status === "founding") {
    if (founding_until && nowMs < founding_until) return { entitled: true, reason: "founding" };
    return { entitled: false, reason: "founding_expired" };
  }
  if (status === "trialing") {
    if (trial_ends_at && nowMs < trial_ends_at) return { entitled: true, reason: "trialing" };
    return { entitled: false, reason: "trial_expired" };
  }
  if (status === "canceled") return { entitled: false, reason: "canceled" };
  return { entitled: false, reason: "none" };
}
