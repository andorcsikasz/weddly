// Vendor quote (árajánlat) contract — the offer a vendor sends a couple
// against ONE inquiry.
//
// A quote hangs off a `supplier_bookings` row, exactly like the message thread
// and the payment schedule do, because an offer with no inquiry behind it has
// nobody to send to. It is deliberately a different object from the listing
// PACKAGE (`shared/listing_packages.ts`): a package is a shop window, its price
// is free text on purpose ("250 000 Ft-tól", "€900 / nap"), and no two vendors
// mean the same thing by it. A quote is the moment a vendor commits to a NUMBER
// for one couple on one date, which is what makes it acceptable, and what makes
// it able to fill the contract value the vendor's own CRM was drawing as "-".
//
// STATUS IS DERIVED, NEVER STORED — the same rule `messageStatus` follows for
// the delivery ticks and `toCoupleBilling` follows for entitlement. What the DB
// keeps is the six timestamps that actually happened plus `valid_until`; the
// ladder the two sides read is computed from them on every read. That is what
// makes expiry need no cron sweep: a quote whose date has passed reads as
// expired the next time anyone looks, rather than waiting on a job that (see
// `supplier_bookings.ts`'s own auto-decline note) may never be wired.
//
// Money is a WHOLE unit of `currency`, like everywhere else in the app
// (`formatMoney` takes the amount as-is in the currency's base unit). A line's
// `unit_amount` is per unit; the total is derived by `quoteTotal`, never stored,
// so a quote cannot disagree with its own arithmetic.

import type { Currency, UnixMs } from "./types";

/** The ladder both sides read. Derived from timestamps by `quoteStatus`. */
export type QuoteStatus =
  /** Written, not sent. Only the vendor can see it, and it is the ONLY state in
   *  which a quote can still be edited. */
  | "draft"
  /** Sent, the couple has not opened the thread since. */
  | "sent"
  /** The couple has loaded it. Not "read": nobody can prove reading, only that
   *  the payload was served. */
  | "viewed"
  | "accepted"
  | "declined"
  /** The vendor pulled it back. A superseded quote lands here too, because
   *  sending a revision has to retire the number the couple was looking at. */
  | "withdrawn"
  /** `valid_until` is in the past and nobody answered. Derived, so it needs no
   *  sweep and it un-expires by itself if the vendor extends the date. */
  | "expired";

/** One priced row of the offer. */
export interface QuoteLine {
  id: number;
  label: string;
  /** Whole units of `BookingQuote.currency` PER unit, not the row total. */
  unit_amount: number;
  qty: number;
  sort_order: number;
}

/** A line as the vendor's editor submits it, before it has an id. */
export interface QuoteLineInput {
  label: string;
  unit_amount: number;
  qty: number;
}

export interface BookingQuote {
  id: number;
  /** supplier_bookings.id — the inquiry this offer answers. */
  booking_id: number;
  currency: Currency;
  title: string;
  /** The vendor's covering note. Not the thread: a quote has to still make
   *  sense on its own when it is read three weeks later. */
  message: string | null;
  /** ISO YYYY-MM-DD, or null for an offer with no deadline. */
  valid_until: string | null;
  /** What the vendor asks up front, in whole units. Part of the OFFER TEXT and
   *  nothing else: accepting does not create a payment row, because the payment
   *  schedule is the vendor's own money-tracking tool and a row appearing in it
   *  behind their back would be a write nobody asked for. */
  deposit_amount: number | null;
  lines: QuoteLine[];
  /** Sum of `qty * unit_amount`. Derived on read, never stored. */
  total: number;
  status: QuoteStatus;
  sent_at: UnixMs | null;
  viewed_at: UnixMs | null;
  accepted_at: UnixMs | null;
  declined_at: UnixMs | null;
  withdrawn_at: UnixMs | null;
  /** What the couple typed when declining, if anything. The vendor's only way
   *  to learn WHY, which is the difference between a lost lead and a lesson. */
  decline_reason: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export const QUOTE_TITLE_MAX = 80;
export const QUOTE_MESSAGE_MAX = 2000;
export const QUOTE_LINE_LABEL_MAX = 120;
export const QUOTE_DECLINE_REASON_MAX = 500;
/** Enough for a venue itemising a whole wedding, short of a spreadsheet. */
export const QUOTE_LINES_MAX = 25;
/** A quantity, not money: guests, hours, people. */
export const QUOTE_QTY_MAX = 9999;
/** A ceiling that stops a typo becoming a headline, in whole units. High enough
 *  for a HUF venue (tens of millions is ordinary there). */
export const QUOTE_AMOUNT_MAX = 1_000_000_000;

/** The timestamps `quoteStatus` reads. Kept structural so the DB row, the DTO
 *  and a half-built draft in a test can all be passed to it. */
export interface QuoteTimestamps {
  sent_at: UnixMs | null;
  viewed_at: UnixMs | null;
  accepted_at: UnixMs | null;
  declined_at: UnixMs | null;
  withdrawn_at: UnixMs | null;
  valid_until: string | null;
}

/** Derive the ladder. Order matters: an answered quote keeps its answer even
 *  after `valid_until` passes, because "they said yes, then the date lapsed" is
 *  not an expired offer, it is a booking. */
export function quoteStatus(q: QuoteTimestamps, today: string): QuoteStatus {
  if (q.withdrawn_at !== null) return "withdrawn";
  if (q.accepted_at !== null) return "accepted";
  if (q.declined_at !== null) return "declined";
  if (q.sent_at === null) return "draft";
  if (q.valid_until !== null && q.valid_until < today) return "expired";
  return q.viewed_at !== null ? "viewed" : "sent";
}

/** Sum of the lines, in whole units. */
export function quoteTotal(lines: ReadonlyArray<{ unit_amount: number; qty: number }>): number {
  return lines.reduce((sum, l) => sum + l.unit_amount * l.qty, 0);
}

/** True while the quote is still the vendor's live offer on this inquiry, i.e.
 *  sending a new one has to retire it first. An expired quote counts: the
 *  vendor can extend its date instead of writing a second one. */
export function isQuoteLive(status: QuoteStatus): boolean {
  return status === "draft" || status === "sent" || status === "viewed" || status === "expired";
}

/** True when the couple can still answer it. Deliberately excludes `draft` (they
 *  cannot see it) and `expired` (the vendor's own deadline has to mean
 *  something, or there was no point printing it). */
export function isQuoteAnswerable(status: QuoteStatus): boolean {
  return status === "sent" || status === "viewed";
}
