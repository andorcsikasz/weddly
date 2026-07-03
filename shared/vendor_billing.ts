// Vendor subscription / billing contract. Vendors are a DIFFERENT aggregate
// from couples (a vendor_accounts row owned by a users.role='vendor', not a
// couple) with a different lifecycle: no "partner B joins" trigger, no
// wedding-day free window. So vendor billing lives in its own table
// (vendor_subscriptions) with its own constants — but it REUSES the couple
// side's pure entitlement machinery (computeEntitlement) for the statuses the
// two aggregates share, because "given a status + timestamps, may you edit
// right now?" is identical math.
//
// Freemium lifecycle (vendor 101+, once the founding cohort is full):
//
//   trialing (3 days, no card)
//     → card on file → lead_window (full PRO, free until the first
//       VENDOR_FREE_LEAD_CREDITS couple inquiries have been delivered)
//     → 3rd inquiry lands → billing_starts_at = first day of the NEXT month;
//       the paid Stripe subscription is scheduled to start charging then
//     → active / past_due / canceled (driven by the Stripe webhook)
//
// A vendor who never adds a card (or lapses) falls to the FREE plan: the
// public listing stays live and editable, but the PRO features (direct
// inquiries from couples, the availability calendar, the client CRM) switch
// off (see shared/vendor_plan.ts).
//
// Founding offer: the first VENDOR_FOUNDING_CAP vendors to activate get the
// platform free for one year, no card on file, so they skip the freemium
// funnel entirely until that year ends.

import { type BillingReason, computeEntitlement, type SubscriptionStatus } from "./billing";
import type { Currency, UnixMs } from "./types";

export { computeEntitlement };
export type { BillingReason, SubscriptionStatus };

/** Vendor statuses = the shared set plus the vendor-only "lead_window": card
 *  on file, riding free until the first VENDOR_FREE_LEAD_CREDITS inquiries
 *  arrive (then until the scheduled first billing date). Stored in
 *  vendor_subscriptions.subscription_status; couples never see this value. */
export type VendorSubscriptionStatus = SubscriptionStatus | "lead_window";

/** Vendor reasons = the shared set plus the lead-window pair. */
export type VendorBillingReason =
  | BillingReason
  /** Entitled: inside the card-on-file free-leads window (or between the 3rd
   *  lead and the scheduled first billing date). */
  | "lead_window"
  /** Not entitled: the free leads are spent and the scheduled billing date
   *  passed without an active subscription taking over (payment failed or
   *  billing not wired), so the vendor is back on FREE until they subscribe. */
  | "leads_exhausted";

/** First N vendors to activate get a free founding year. Counted by granted
 *  badge (is_founding_member = 1); a slot is spent permanently on grant, so an
 *  expired year never frees it back up (mirrors the couples FOUNDING_CAP). */
export const VENDOR_FOUNDING_CAP = 100;

/** Founding free window length: one year from activation. */
export const VENDOR_FOUNDING_DURATION_MS = 1000 * 60 * 60 * 24 * 365;

/** Trial length for vendor 101+ (cohort full): a short no-card tryout before
 *  the card wall. Full PRO access while it runs. */
export const VENDOR_TRIAL_DURATION_MS = 1000 * 60 * 60 * 24 * 3;

/** Free direct inquiries a card-on-file vendor gets before billing starts.
 *  Each couple inquiry delivered while in the lead window spends one credit;
 *  the credit that hits this total schedules the first payment for the start
 *  of the NEXT calendar month. */
export const VENDOR_FREE_LEAD_CREDITS = 3;

/** First day of the calendar month AFTER `nowMs`, at UTC midnight: the
 *  "payment period starts next month" anchor. Pure so the domain trigger, the
 *  Stripe trial_end, the UI copy, and the tests all agree. */
export function startOfNextUtcMonth(nowMs: number): UnixMs {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Single source of truth for "does this vendor have PRO access right now?".
 *  Handles the vendor-only lead_window status, then defers to the shared
 *  computeEntitlement for everything else. Pure + time-based so the server
 *  gate and the client UI agree. */
export function computeVendorEntitlement(
  status: VendorSubscriptionStatus,
  opts: {
    trial_ends_at: number | null;
    founding_until: number | null;
    lead_credits_used: number;
    billing_starts_at: number | null;
    nowMs: number;
  },
): { entitled: boolean; reason: VendorBillingReason } {
  if (status === "lead_window") {
    if (opts.lead_credits_used < VENDOR_FREE_LEAD_CREDITS) {
      return { entitled: true, reason: "lead_window" };
    }
    // Credits spent: still free until the scheduled first billing date. Once
    // that passes the Stripe subscription should have flipped the status to
    // active; if it didn't (payment failed / billing unwired), fall to FREE.
    if (opts.billing_starts_at && opts.nowMs < opts.billing_starts_at) {
      return { entitled: true, reason: "lead_window" };
    }
    return { entitled: false, reason: "leads_exhausted" };
  }
  return computeEntitlement(status, {
    trial_ends_at: opts.trial_ends_at,
    founding_until: opts.founding_until,
    nowMs: opts.nowMs,
  });
}

/** Monthly plan price per display currency (integer, minor-unit-less). HUF has
 *  no minor unit; EUR is shown without cents. DISTINCT from the couples'
 *  MONTHLY_PRICE — vendors pay a different rate. Keep in sync with the Stripe
 *  vendor Price objects when billing goes live. */
export const VENDOR_MONTHLY_PRICE: Record<Currency, number> = {
  HUF: 3490,
  EUR: 10,
  USD: 10,
};

/** HU vendors are billed in HUF, everyone else in EUR — mirrors the couple
 *  currency-follows-locale rule. Pinned once at activation. */
export function vendorCurrencyForLocale(locale: string | null | undefined): Currency {
  return locale === "hu" ? "HUF" : "EUR";
}

/** The monthly price a vendor on this currency pays. */
export function vendorPrice(currency: Currency): number {
  return VENDOR_MONTHLY_PRICE[currency] ?? VENDOR_MONTHLY_PRICE.EUR;
}

/** Billing snapshot attached to the vendor's /vendor view + onboarding. */
export interface VendorBilling {
  subscription_status: VendorSubscriptionStatus;
  /** Epoch ms — end of the trial (vendor 101+). Null unless trialing. */
  trial_ends_at: UnixMs | null;
  /** Epoch ms — end of the 1-year founding window. Null when not founding. */
  founding_until: UnixMs | null;
  /** Among the first VENDOR_FOUNDING_CAP vendors → holds the founding badge. */
  is_founding_member: boolean;
  /** Epoch ms — paid period end from Stripe. Null when not a paying sub. */
  current_period_end: UnixMs | null;
  /** A payment card is saved with Stripe (checkout setup completed). */
  card_on_file: boolean;
  /** Free inquiries delivered so far while in the lead window (0..total). */
  lead_credits_used: number;
  /** VENDOR_FREE_LEAD_CREDITS, shipped so the UI never hardcodes the 3. */
  lead_credits_total: number;
  /** Epoch ms: scheduled first payment (start of the month after the last
   *  free lead landed). Null until the free credits are spent. */
  billing_starts_at: UnixMs | null;
  currency: Currency;
  /** Computed: does the vendor have PRO access right now? When false the
   *  vendor is on the FREE plan: listing stays live, PRO features lock. */
  entitled: boolean;
  reason: VendorBillingReason;
}

/** Response of GET /api/vendor/billing: everything the vendor billing
 *  surface needs. */
export interface VendorBillingStatus {
  /** Whether vendor Stripe billing is wired server-side. When false the
   *  card-collection / checkout / portal buttons are unavailable and the page
   *  says so. */
  enabled: boolean;
  billing: VendorBilling;
  currency: Currency;
  price: number;
  /** Remaining founding slots (CAP − granted badges), clamped >= 0. Drives the
   *  public "N of 100 spots left" line. */
  founding_spots_left: number;
}
