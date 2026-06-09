// Vendor subscription / billing contract. Vendors are a DIFFERENT aggregate
// from couples (a vendor_accounts row owned by a users.role='vendor', not a
// couple) with a different lifecycle: no "partner B joins" trigger, no
// wedding-day free window. So vendor billing lives in its own table
// (vendor_subscriptions) with its own constants — but it REUSES the couple
// side's pure entitlement machinery (computeEntitlement) verbatim, because
// "given a status + timestamps, may you edit right now?" is identical math.
//
// Founding offer: the first VENDOR_FOUNDING_CAP vendors to activate get the
// platform free for one year, no card on file. Once the cohort fills, new
// vendors go on a short trial → paid (3490 Ft / 10 € per month). The billing
// itself (Stripe Checkout/Portal/webhook) is a fast-follow — the founding 100
// never touch Stripe in year one.

import { type BillingReason, computeEntitlement, type SubscriptionStatus } from "./billing";
import type { Currency, UnixMs } from "./types";

export { computeEntitlement };
export type { BillingReason, SubscriptionStatus };

/** First N vendors to activate get a free founding year. Counted by granted
 *  badge (is_founding_member = 1); a slot is spent permanently on grant, so an
 *  expired year never frees it back up (mirrors the couples FOUNDING_CAP). */
export const VENDOR_FOUNDING_CAP = 100;

/** Founding free window length: one year from activation. */
export const VENDOR_FOUNDING_DURATION_MS = 1000 * 60 * 60 * 24 * 365;

/** Trial length for vendor 101+ (cohort full): a short no-card window before
 *  the soft paywall. */
export const VENDOR_TRIAL_DURATION_MS = 1000 * 60 * 60 * 24 * 14;

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
  subscription_status: SubscriptionStatus;
  /** Epoch ms — end of the trial (vendor 101+). Null unless trialing. */
  trial_ends_at: UnixMs | null;
  /** Epoch ms — end of the 1-year founding window. Null when not founding. */
  founding_until: UnixMs | null;
  /** Among the first VENDOR_FOUNDING_CAP vendors → holds the founding badge. */
  is_founding_member: boolean;
  /** Epoch ms — paid period end from Stripe. Null when not a paying sub. */
  current_period_end: UnixMs | null;
  currency: Currency;
  /** Computed: does the vendor have edit/publish access right now? When false
   *  the editor is read-only and the public listing is hidden. */
  entitled: boolean;
  reason: BillingReason;
}

/** Response of GET /api/vendor/billing/status — everything the vendor billing
 *  surface needs. */
export interface VendorBillingStatus {
  /** Whether vendor Stripe billing is wired server-side. False during the
   *  founding-only phase — checkout is unavailable and the page says so. */
  enabled: boolean;
  billing: VendorBilling;
  currency: Currency;
  price: number;
  /** Remaining founding slots (CAP − granted badges), clamped >= 0. Drives the
   *  public "N of 100 spots left" line. */
  founding_spots_left: number;
}
