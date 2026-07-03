// Supplier booking inquiries + vendor blocked dates.
//
// v1 scope (from 5-agent debate Agent #4 verdict): CLAIMED-VENDORS-ONLY.
// Inquiries to unclaimed listings are intentionally not implemented — sending
// our domain's transactional mail to scraped contact_emails is a deliverability
// and GDPR Art. 6 hazard we won't accept this phase. Frontend falls back to a
// tracked "Visit website" redirect for unclaimed suppliers; click counts feed
// vendor-acquisition prioritisation.
//
// `event_date` is ISO 'YYYY-MM-DD' (day-granular). State machine:
//   requested → vendor_seen → (confirmed | declined) | cancelled | expired_14d
// Multiple `requested` bookings on the same day are allowed; vendor picks one
// to confirm and the rest auto-decline via a cron sweep (not yet wired).

import type { BookingStatus, SupplierBooking, SupplierAvailability } from "@shared/suppliers";
import { db, now } from "../db";
import { isVendorEntitled, recordVendorLeadCredit } from "./vendor_billing";

const VALID_STATUSES: ReadonlySet<BookingStatus> = new Set([
  "requested",
  "vendor_seen",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
]);

export interface BookingRow {
  id: number;
  supplier_id: string;
  couple_id: number;
  vendor_account_id: number | null;
  event_date: string;
  status: string;
  notes: string | null;
  amount_huf: number | null;
  created_at: number;
  updated_at: number;
}

export function toBooking(row: BookingRow): SupplierBooking {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    couple_id: row.couple_id,
    vendor_account_id: row.vendor_account_id,
    event_date: row.event_date,
    status: VALID_STATUSES.has(row.status as BookingStatus)
      ? (row.status as BookingStatus)
      : "requested",
    notes: row.notes,
    amount_huf: row.amount_huf,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  // Quick sanity: parse rejects 2026-02-30 because Date wraps to March, then
  // toISOString() won't match. Reject those silently.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

/** Returns the listings row keyed by the public supplier id. Used to find the
 *  vendor_account_id (claim status) for booking and availability lookups. */
export function getListingFor(
  supplierId: string,
): { id: string; vendor_account_id: number | null } | null {
  const row = db
    .prepare("SELECT id, vendor_account_id FROM listings WHERE id = ?")
    .get(supplierId) as { id: string; vendor_account_id: number | null } | undefined;
  return row ?? null;
}

export function listBlockedDates(vendorAccountId: number): string[] {
  const rows = db
    .prepare(
      `SELECT blocked_date FROM vendor_unavailable_dates
        WHERE vendor_account_id = ?
        ORDER BY blocked_date ASC`,
    )
    .all(vendorAccountId) as Array<{ blocked_date: string }>;
  return rows.map((r) => r.blocked_date);
}

export function blockDate(vendorAccountId: number, date: string, reason: string | null): void {
  const ts = now();
  db.prepare(
    `INSERT OR IGNORE INTO vendor_unavailable_dates
       (vendor_account_id, blocked_date, reason, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(vendorAccountId, date, reason, ts);
}

export function unblockDate(vendorAccountId: number, date: string): boolean {
  const info = db
    .prepare(
      "DELETE FROM vendor_unavailable_dates WHERE vendor_account_id = ? AND blocked_date = ?",
    )
    .run(vendorAccountId, date);
  return info.changes > 0;
}

/** Earliest YYYY-MM-DD (>= today) that has no block and no confirmed booking
 *  for this vendor. Scans up to 365 days forward; returns null when nothing
 *  in the window is free (or the vendor doesn't exist). */
export function nextAvailableDate(vendorAccountId: number): string | null {
  const blocked = new Set(listBlockedDates(vendorAccountId));
  const confirmedRows = db
    .prepare(
      `SELECT event_date FROM supplier_bookings
        WHERE vendor_account_id = ? AND status = 'confirmed'`,
    )
    .all(vendorAccountId) as Array<{ event_date: string }>;
  for (const r of confirmedRows) blocked.add(r.event_date);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!blocked.has(iso)) return iso;
  }
  return null;
}

export function getAvailability(supplierId: string): SupplierAvailability {
  const listing = getListingFor(supplierId);
  if (!listing || listing.vendor_account_id === null) {
    return { unavailable_dates: [], next_available: null, bookable: false };
  }
  // Direct inquiries + the busy calendar are PRO features (freemium): a
  // claimed listing whose vendor is on the FREE plan stays visible but is not
  // bookable, and the frontend falls back to the tracked website redirect, same
  // as an unclaimed listing.
  if (!isVendorEntitled(listing.vendor_account_id)) {
    return { unavailable_dates: [], next_available: null, bookable: false };
  }
  const unavailable = listBlockedDates(listing.vendor_account_id);
  return {
    unavailable_dates: unavailable,
    next_available: nextAvailableDate(listing.vendor_account_id),
    bookable: true,
  };
}

export interface CreateBookingArgs {
  supplierId: string;
  coupleId: number;
  eventDate: string;
  notes: string | null;
  amountHuf: number | null;
}

/** Insert a booking inquiry. Throws when the supplier is unclaimed (v1
 *  refuses to send mail to scraped contact addresses), the vendor is on the
 *  FREE plan (direct inquiries are PRO, freemium), or the date is past /
 *  malformed. Delivering the inquiry spends one of the vendor's free lead
 *  credits when they're inside the lead window (see domain/vendor_billing.ts).
 *  Caller is responsible for rate-limiting via lib/rate_limit. */
export function createBooking(args: CreateBookingArgs): SupplierBooking {
  if (!isIsoDate(args.eventDate)) {
    throw new Error("event_date must be valid YYYY-MM-DD");
  }
  const listing = getListingFor(args.supplierId);
  if (!listing || listing.vendor_account_id === null) {
    throw new Error("booking_unavailable: supplier is not claimed");
  }
  if (!isVendorEntitled(listing.vendor_account_id)) {
    throw new Error("booking_unavailable: vendor is not accepting direct inquiries");
  }
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO supplier_bookings
         (supplier_id, couple_id, vendor_account_id, event_date, status, notes, amount_huf, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?)`,
    )
    .run(
      args.supplierId,
      args.coupleId,
      listing.vendor_account_id,
      args.eventDate,
      args.notes,
      args.amountHuf,
      ts,
      ts,
    );
  const id = Number(info.lastInsertRowid);
  // The delivered inquiry is a generated lead: spend one free credit when the
  // vendor is inside the card-on-file lead window (3rd credit schedules the
  // first payment for the start of next month). The caller kicks off the
  // Stripe subscription via ensureVendorScheduledSubscription.
  recordVendorLeadCredit(listing.vendor_account_id, ts);
  const row = db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(id) as BookingRow;
  return toBooking(row);
}

export function getBookingById(id: number): BookingRow | null {
  const row = db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(id) as
    | BookingRow
    | undefined;
  return row ?? null;
}

export function listBookingsForSupplier(supplierId: string): SupplierBooking[] {
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE supplier_id = ? ORDER BY created_at DESC")
    .all(supplierId) as BookingRow[];
  return rows.map(toBooking);
}

export function listBookingsForCouple(coupleId: number): SupplierBooking[] {
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE couple_id = ? ORDER BY created_at DESC")
    .all(coupleId) as BookingRow[];
  return rows.map(toBooking);
}

export function updateBookingStatus(id: number, status: BookingStatus): SupplierBooking | null {
  if (!VALID_STATUSES.has(status)) return null;
  const ts = now();
  const info = db
    .prepare("UPDATE supplier_bookings SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, ts, id);
  if (info.changes === 0) return null;
  const row = db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(id) as BookingRow;
  return toBooking(row);
}

/** Build the body of an .ics calendar file for a confirmed booking. Day event
 *  (no time-of-day in v1). Bilingual summary so HU + EN recipients both
 *  understand the entry in their calendar app. */
export function buildIcsForBooking(args: {
  booking: SupplierBooking;
  supplierName: string;
  coupleDisplayName: string | null;
}): string {
  const stamp = args.booking.event_date.replace(/-/g, "");
  // Day-events use DTSTART;VALUE=DATE / DTEND;VALUE=DATE — DTEND exclusive.
  const startDate = stamp;
  const end = new Date(`${args.booking.event_date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endDate = end.toISOString().slice(0, 10).replace(/-/g, "");

  const couple = args.coupleDisplayName ?? "Weddly couple";
  const summary = `Wedding inquiry — ${args.supplierName} / ${couple}`;
  const uid = `weddly-booking-${args.booking.id}@weddly`;
  const nowStamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weddly//Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `SUMMARY:${summary}`,
    `STATUS:${args.booking.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
