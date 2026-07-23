// Subscription / billing contract shared by both sides.
//
// Money model recap (see CLAUDE.md): every couple has a `currency` (HUF for
// HU signups, EUR otherwise). The standard plan is a flat monthly price in
// that currency — 2 490 Ft / month or 7 € / month — billed through Stripe.
//
// The state machine lives on the couple, in `subscription_status` plus three
// timestamps. Entitlement (does this couple have edit access right now?) is
// COMPUTED from those at read-time so a lapsed trial flips to read-only
// without a background job having to run first. We never mutate the couple's
// `status` for billing — that field drives the unrelated pause-to-DELETE
// countdown — so a non-paying couple's data is always preserved.

import { type BillingCurrency, toBillingCurrency } from "./currency";
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
 *  Price object, which must be kept in sync.
 *
 *  Keyed by BillingCurrency, not the couple's display Currency: a workspace
 *  budgeting in złoty or yen is charged the EUR price, so there is no PLN/JPY
 *  row to fill in. `monthlyPrice()` does the narrowing. */
export const MONTHLY_PRICE: Record<BillingCurrency, number> = {
  HUF: 2490,
  EUR: 7,
  USD: 7,
};

/** The monthly price shown to a couple on this display currency. */
export function monthlyPrice(currency: Currency): number {
  return MONTHLY_PRICE[toBillingCurrency(currency)];
}

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
   *  workspace is read-only and edits return 402. NOTE: for a planner-managed
   *  couple this reflects the COUPLE MEMBER's access — the managing planner
   *  always edits regardless (see domain/billing.ts entitlementBlock). */
  entitled: boolean;
  /** Computed reason the couple is (not) entitled — drives the UI banner. */
  reason: BillingReason;
  /** An active planner is managing this couple. When true and the couple's own
   *  free window has lapsed, couple members are viewer-only and the planner
   *  edits; the couple can buy back guest-page editing via the add-on. */
  planner_managed: boolean;
  /** The couple paid their 30% share (the 70%-off guest-page add-on checkout
   *  completed). Precondition for the planner to switch on `guest_page_addon`. */
  guest_page_prepaid: boolean;
  /** The guest-page (vendégoldal) edit add-on is switched on, so couple members
   *  can edit their own guest page / website even while viewer-only elsewhere. */
  guest_page_addon: boolean;
}

/** The card currently on file for the couple's Stripe customer, read-only.
 *  Brand/last-4/expiry only — never a full number, never a token. Sourced from
 *  Stripe on demand (GET /api/billing/payment-method); we store none of it. */
export interface PaymentMethodCard {
  /** Stripe card brand slug, e.g. "visa", "mastercard", "amex". */
  brand: string;
  /** Last four digits of the card number. */
  last4: string;
  /** Expiry month, 1-12. */
  exp_month: number;
  /** Expiry year, four digits. */
  exp_year: number;
}

/** Response of GET /api/billing/payment-method. `card` is null when Stripe is
 *  off, the couple has no Stripe customer yet (trial/founding), or no card is
 *  attached — the tab renders a neutral "no card on file" state in every case. */
export interface PaymentMethodResponse {
  card: PaymentMethodCard | null;
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
  | "none"
  /** Planner-managed couple, viewer mode: the couple member may not edit (the
   *  planner does), except their own guest page when the add-on is on. */
  | "planner_managed_viewer";

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
