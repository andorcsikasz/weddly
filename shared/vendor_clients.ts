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
  /** 0..100 — how complete the public listing is. */
  listing_completeness: number;
  /** Sum of recorded deposits received (money in), integer minor units. */
  revenue_tracked: number;
  /** Vendor billing currency. Superset of the contract's 'HUF'|'EUR' so it
   *  assigns cleanly from VendorBilling.currency. */
  currency: Currency;
  billing: VendorBilling;
}
