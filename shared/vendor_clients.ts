// Vendor "clients" + lightweight payment tracking contract.
//
// A vendor CLIENT is a couple that reached this vendor THROUGH Weddly — one
// row in `supplier_bookings` (couple_id + vendor_account_id + event_date +
// status). Vendors manage only these Weddly-sourced inquiries; there is no
// manual lead entry. Privacy: the vendor sees the couple display name, the
// event date, and the inquiry status; couple contact details are surfaced
// only because the couple initiated the inquiry.
//
// PAYMENTS are lightweight, in-app-only money tracking per client — NO real
// money movement, no Stripe Connect. Each booking carries a contract value,
// a deposit paid, a computed balance, a stage, and a payment SCHEDULE of
// labelled installments (due_date + paid flag). Money is integer minor units;
// the currency comes from the vendor's subscription (HUF | EUR).

import type { Currency, UnixMs } from "./types";
import type { VendorBilling } from "./vendor_billing";

/** Row in a vendor's client list — the basic view available on the FREE tier
 *  (display name + event date + status). Money fields are populated but the
 *  PRO-gated CRM detail screen is where they're edited. */
export interface VendorClientView {
  /** supplier_bookings.id — the client's stable id across the vendor surfaces. */
  id: number;
  couple_id: number;
  /** couples.display_name ("Allie & Noah"). */
  couple_display_name: string;
  /** ISO 'YYYY-MM-DD'. */
  event_date: string;
  /** BookingStatus ('requested' | 'vendor_seen' | 'confirmed' | …). */
  status: string;
  /** Free-form pipeline stage the vendor assigns (PRO). Null until set. */
  stage: string | null;
  /** Agreed total, integer minor units. Null until the vendor records it. */
  contract_value: number | null;
  /** Deposit received so far, integer minor units. Null until recorded. */
  deposit_paid: number | null;
  /** contract_value − deposit_paid when contract_value is set, else null. */
  balance: number | null;
  created_at: UnixMs;
}

/** One labelled installment in a client's payment schedule. */
export interface VendorClientPayment {
  id: number;
  booking_id: number;
  label: string;
  /** Integer minor units. */
  amount: number;
  /** ISO 'YYYY-MM-DD' or null (no fixed due date). */
  due_date: string | null;
  paid: boolean;
  paid_at: UnixMs | null;
}

/** Full client CRM detail (PRO). Extends the list view with the vendor's
 *  private notes, the couple's inquiry-contact email, and the payment
 *  schedule. */
export interface VendorClientDetail extends VendorClientView {
  vendor_notes: string | null;
  couple_contact_email: string | null;
  payments: VendorClientPayment[];
}

/** One step of the vendor's listing-setup checklist. The key doubles as the
 *  i18n suffix (`vendor.setup.step_<key>`) and as the deep-link anchor on the
 *  listing editor (`/vendor/listing#vendor-section-<key>`), so adding a step
 *  means adding a section id and two locale strings — nothing else. */
export type VendorListingStepKey =
  | "cover"
  | "gallery"
  | "description"
  | "contact"
  | "pricing"
  | "capacity"
  | "packages";

/** A checklist row: which step, and whether the vendor has done it. */
export interface VendorListingStep {
  key: VendorListingStepKey;
  done: boolean;
}

/** The listing facts the checklist scores. Deliberately a flat bag rather than
 *  `Listing`, so the backend can pass DB counts and the frontend can pass the
 *  arrays it already holds without either side re-deriving the rules. */
export interface VendorListingChecklistInput {
  hero_image_url: string | null;
  blurb_hu: string | null;
  blurb_en: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  price_band: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  photo_count: number;
  package_count: number;
}

/** The vendor's listing-setup checklist, in the order they should work through
 *  it: the cover photo first (it's what a couple sees on the card), then the
 *  rest of the public sections.
 *
 *  Gallery and packages are scored even though earlier versions skipped them —
 *  leaving them out let the ring read 100% on a listing with no photos beyond
 *  the cover and no price offers, which is exactly the "finished-looking but
 *  empty" card the nudge exists to prevent.
 *
 *  Single-sourced here so the dashboard ring, the listing-editor chip and the
 *  server's `listing_completeness` can never drift apart. */
export function listingChecklistFor(input: VendorListingChecklistInput): VendorListingStep[] {
  return [
    { key: "cover", done: Boolean(input.hero_image_url) },
    { key: "gallery", done: input.photo_count > 0 },
    { key: "description", done: Boolean(input.blurb_hu) || Boolean(input.blurb_en) },
    { key: "contact", done: Boolean(input.contact_email) || Boolean(input.contact_phone) },
    { key: "pricing", done: input.price_band != null },
    { key: "capacity", done: input.capacity_min != null || input.capacity_max != null },
    { key: "packages", done: input.package_count > 0 },
  ];
}

/** Percent (0..100) of the checklist completed. Always derived from the steps,
 *  never counted separately. */
export function listingCompletenessFor(steps: VendorListingStep[]): number {
  if (steps.length === 0) return 0;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}

/** Vendor dashboard / stats payload. Basic counts are FREE; the advanced
 *  breakdowns are surfaced behind the PRO gate by the frontend. */
export interface VendorStats {
  inquiries_total: number;
  inquiries_30d: number;
  /** Count per BookingStatus. */
  by_status: Record<string, number>;
  /** Confirmed/upcoming events, soonest first. */
  upcoming: { id: number; couple_display_name: string; event_date: string }[];
  /** Sparse daily inquiry counts (booking created_at) for the last 365 days,
   *  oldest first; days with zero inquiries are omitted. Powers the stats
   *  trend chart + range filter. */
  inquiries_by_day: { date: string; count: number }[];
  blocked_dates_count: number;
  /** Published, non-deleted reviews on the vendor's listing from the last 30
   *  days. Feeds the header bell's "new review" row; the bell's own per-device
   *  seen-watermark decides whether that counts as unread. */
  reviews_recent: number;
  /** 0..100 — how complete the public listing is. Derived from `listing_steps`,
   *  so the ring and the checklist can never disagree. */
  listing_completeness: number;
  /** Per-step setup checklist behind the completeness ring, in the order the
   *  vendor should work through it. */
  listing_steps: VendorListingStep[];
  /** Sum of recorded deposits received (money in), integer minor units. */
  revenue_tracked: number;
  /** Vendor billing currency. Superset of the contract's 'HUF'|'EUR' so it
   *  assigns cleanly from VendorBilling.currency. */
  currency: Currency;
  billing: VendorBilling;
}
