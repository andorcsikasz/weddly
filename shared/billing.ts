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
 *  their partner enters the grace window below, then goes read-only unless they
 *  subscribe. Couples who DID invite their partner are free until their wedding
 *  day instead (see `partnerFreeWindowEnd`). Drives the "invite your partner"
 *  nudge banner copy.
 *
 *  END OF AUGUST 2026: this is the instant August ends (2026-09-01 UTC
 *  midnight), not a day inside it, so a couple has the whole of the 31st. Moved
 *  out from 2026-08-01 on 2026-08-03 per the owner; the db.ts backfill carries
 *  the already-stamped trials forward with it, or 112 couples would keep an end
 *  date a month behind the promise. */
export const PAID_LAUNCH_DATE = Date.UTC(2026, 8, 1);

/** How long a couple keeps editing AFTER their trial ends. The `trial_ended`
 *  mail goes out at the boundary offering two ways on (invite your partner, or
 *  add payment details), and this is the window it names. Access is real during
 *  it — a notice that says "seven days" while the workspace is already frozen
 *  would be a lie the couple reads before the first word. */
export const TRIAL_GRACE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** When a trial's grace window closes. Pure so the entitlement verdict, the
 *  mail's deadline line and the banner countdown quote one number.
 *
 *  The week runs from whichever came LATER: the trial ending, or the wall
 *  appearing. Those are usually the same moment, but they are not on go-live
 *  day: the freeze has been deferred since launch, so most couples' trials
 *  lapsed months before there was anything to be warned about. Counting from
 *  the trial end alone would freeze them the instant the switch is flipped,
 *  having sent them nothing, which is exactly the week of notice this whole
 *  mechanism exists to give. `enforcementStartedAt` is null while the freeze is
 *  deferred (there is no wall yet) and after any date already past, harmless. */
export function trialGraceEndsAt(
  trialEndsAt: number,
  enforcementStartedAt?: number | null,
): number {
  const from = Math.max(trialEndsAt, enforcementStartedAt ?? 0);
  return from + TRIAL_GRACE_MS;
}

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
  /** Entitled: the trial is over but the 7-day grace window is still open. The
   *  couple can edit; the banner and the `trial_ended` mail are what tell them
   *  the clock is running and name the two ways to keep going. */
  | "trial_grace"
  | "founding"
  | "subscribed"
  | "trial_expired"
  | "founding_expired"
  | "canceled"
  | "none"
  /** Planner-managed couple, viewer mode: the couple member may not edit (the
   *  planner does), except their own guest page when the add-on is on. */
  | "planner_managed_viewer";

/** Single source of truth for "can this owner edit right now?". Pure +
 *  time-based so it can run on the server (gate writes) and the client
 *  (read-only UI) and agree.
 *
 *  Shared by all THREE aggregates (couples, vendors, planners), which is why the
 *  post-trial grace is an OPT-IN `trialGraceMs` rather than a constant baked in
 *  here. It is a couples-side product decision; defaulting it on silently turned
 *  the vendor 3-day trial into ten days and the planner trial likewise, moving
 *  two freemium funnels nobody asked to change. Callers that want it pass it
 *  (see `toCoupleBilling`); everyone else gets the old hard boundary. */
export function computeEntitlement(
  status: SubscriptionStatus,
  opts: {
    trial_ends_at: number | null;
    founding_until: number | null;
    nowMs: number;
    /** Extra editable window after `trial_ends_at`. 0 (the default) is a hard
     *  boundary, which is what vendors and planners want. */
    trialGraceMs?: number;
    /** When the paywall was switched on, if it is on. The grace week never
     *  starts before this, so a trial that lapsed while the freeze was deferred
     *  still gets its full week of warning from go-live day. */
    enforcementStartedAt?: number | null;
  },
): { entitled: boolean; reason: BillingReason } {
  const { trial_ends_at, founding_until, nowMs } = opts;
  const trialGraceMs = opts.trialGraceMs ?? 0;
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
    // The grace window, only for callers that asked for one. A trial with no end
    // date at all never had a boundary to grace, so it falls straight through
    // rather than being handed extra days off a NULL.
    if (
      trialGraceMs > 0 &&
      trial_ends_at &&
      nowMs < Math.max(trial_ends_at, opts.enforcementStartedAt ?? 0) + trialGraceMs
    ) {
      return { entitled: true, reason: "trial_grace" };
    }
    return { entitled: false, reason: "trial_expired" };
  }
  if (status === "canceled") return { entitled: false, reason: "canceled" };
  return { entitled: false, reason: "none" };
}
