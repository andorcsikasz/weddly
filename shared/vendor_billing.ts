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
// Free-window ladder at activation (see `vendorOfferForSlots`):
//
//   vendors     1..100   founding cohort → 1 year free, founding badge
//   vendors  101..400    early cohort    → 3 months free, no badge
//   vendors    401+      3-day trial → the freemium funnel above
//
// Both cohorts ride `subscription_status='founding'` + `founding_until`, so the
// entitlement math is untouched; the two are told apart by which badge column
// the grant stamps (is_founding_member vs is_early_member), which is also what
// each cap counts.

import { type BillingReason, computeEntitlement, type SubscriptionStatus } from "./billing";
import { type BillingCurrency, toBillingCurrency } from "./currency";
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

/** Second free cohort: the next N vendors after the founding 100 get three
 *  months free instead of the 3-day trial. Counted by its own badge column
 *  (is_early_member = 1) on the same permanently-spent-on-grant rule, so the
 *  two cohorts never contend for the same slots. */
export const VENDOR_EARLY_CAP = 300;

/** Early-cohort free window length: three months from activation. */
export const VENDOR_EARLY_DURATION_MS = 1000 * 60 * 60 * 24 * 90;

/** Trial length once BOTH free cohorts are full: a short no-card tryout before
 *  the card wall. Full PRO access while it runs. */
export const VENDOR_TRIAL_DURATION_MS = 1000 * 60 * 60 * 24 * 3;

/** Which free window a vendor activating right now would receive. `trial` is
 *  the terminal tier: both cohorts full, everyone lands on the 3-day tryout.
 *  `spots_left` / `cap` are 0 there because a trial isn't a limited offer. */
export interface VendorOffer {
  tier: "founding" | "early" | "trial";
  /** Length of the free window the grant would stamp. */
  duration_ms: number;
  /** Slots still open in this tier. Drives the "N of 300 left" scarcity line. */
  spots_left: number;
  cap: number;
}

/** Pure tier resolution: given how many slots each cohort has already spent,
 *  which offer is live? Shared so the activation grant, the vendor billing
 *  surface, the claim-campaign email copy and the admin console can never
 *  disagree about what is currently being offered. */
export function vendorOfferForSlots(foundingUsed: number, earlyUsed: number): VendorOffer {
  if (foundingUsed < VENDOR_FOUNDING_CAP) {
    return {
      tier: "founding",
      duration_ms: VENDOR_FOUNDING_DURATION_MS,
      spots_left: VENDOR_FOUNDING_CAP - foundingUsed,
      cap: VENDOR_FOUNDING_CAP,
    };
  }
  if (earlyUsed < VENDOR_EARLY_CAP) {
    return {
      tier: "early",
      duration_ms: VENDOR_EARLY_DURATION_MS,
      spots_left: VENDOR_EARLY_CAP - earlyUsed,
      cap: VENDOR_EARLY_CAP,
    };
  }
  return { tier: "trial", duration_ms: VENDOR_TRIAL_DURATION_MS, spots_left: 0, cap: 0 };
}

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
export const VENDOR_MONTHLY_PRICE: Record<BillingCurrency, number> = {
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
  return VENDOR_MONTHLY_PRICE[toBillingCurrency(currency)];
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
  /** In the second free cohort (three months free). Never true at the same
   *  time as `is_founding_member`, a grant stamps exactly one badge. */
  is_early_member: boolean;
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
  /** Remaining second-cohort slots, same shape. Only meaningful once the
   *  founding 100 are gone; before that it is still the full VENDOR_EARLY_CAP. */
  early_spots_left: number;
  /** The free window a vendor activating right now would get. Prefer this over
   *  reading the two counters, it already encodes which tier is live. */
  offer: VendorOffer;
}

/** Response of GET /api/public/vendor-stats: the three honest numbers the
 *  public /vendors recruitment page quotes. No auth, no PII, all derived from
 *  live rows, so the marketing copy can never drift from reality (a hardcoded
 *  "47 vendors already signed up" is exactly the claim we refuse to make).
 *  Every consumer must self-hide a counter it considers too small to show
 *  rather than dress the number up. */
export interface PublicVendorStats {
  /** Public page visits over the last 28 days: wedding-site views, RSVP-page
   *  opens and guest-portal views summed from `growth_events`. The honest
   *  read of "how much traffic flows through Weddly" — real people on
   *  Weddly-hosted pages, counted as visits (not deduped to unique people,
   *  since the UA hash collapses browsers). No marketing-page pageview log
   *  exists yet, so this is guest-facing traffic only. */
  visits_28d: number;
  /** Inquiry emails actually delivered to vendors in the last 30 days. This is
   *  the demand signal a vendor cares about, so it counts SENT messages only. */
  inquiries_30d: number;
  /** Which free window is live right now, and how many slots it still has.
   *  Same shape (and same source) the authed vendor billing surface quotes. */
  offer: VendorOffer;
}
