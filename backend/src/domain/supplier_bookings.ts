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

import type { VendorBlockedDay } from "@shared/listings";
import { MESSAGE_BODY_MAX_LEN } from "@shared/booking_messages";
import { insertMessage } from "./booking_messages";
import type { BookingStatus, SupplierBooking, SupplierAvailability } from "@shared/suppliers";
import {
  type AvailabilityException,
  isBookableDay,
  resolveDayAvailability,
} from "@shared/vendor_availability";
import { db, now } from "../db";
import { isVendorEntitled, recordVendorLeadCredit } from "./vendor_billing";
import { emitVendorEvent } from "./vendor_points";
import { getVendorWeekdays } from "./vendor_availability_settings";

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

/** Parse a stored `blocked_hours` cell into a validated, sorted hour list, or
 *  null (= whole-day block). Bad/empty JSON degrades to a full-day block so a
 *  corrupt row is never silently "available". */
function parseBlockedHours(raw: string | null): number[] | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const hours = parsed
      .filter((h): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23)
      .sort((a, b) => a - b);
    return hours.length > 0 ? Array.from(new Set(hours)) : null;
  } catch {
    return null;
  }
}

/** Every blocked day (full or partial), sorted ascending. */
export function listBlockedDates(vendorAccountId: number): string[] {
  const rows = db
    .prepare(
      `SELECT blocked_date FROM vendor_unavailable_dates
        WHERE vendor_account_id = ? AND is_available = 0
        ORDER BY blocked_date ASC`,
    )
    .all(vendorAccountId) as Array<{ blocked_date: string }>;
  return rows.map((r) => r.blocked_date);
}

/** Every blocked day with its hour detail (null = whole day), sorted ascending. */
export function listBlockedDays(vendorAccountId: number): VendorBlockedDay[] {
  const rows = db
    .prepare(
      `SELECT blocked_date, blocked_hours FROM vendor_unavailable_dates
        WHERE vendor_account_id = ? AND is_available = 0
        ORDER BY blocked_date ASC`,
    )
    .all(vendorAccountId) as Array<{ blocked_date: string; blocked_hours: string | null }>;
  return rows.map((r) => ({ date: r.blocked_date, hours: parseBlockedHours(r.blocked_hours) }));
}

/** Listings we KNOW are taken on `date`, for the directory's date filter.
 *
 *  The inverse question ("who is free?") is unanswerable and would be dishonest
 *  to answer: an unclaimed curated entry has no calendar here, and a vendor who
 *  keeps theirs on paper looks identical to one with a genuinely empty diary. So
 *  this returns only the listings with a real reason on file — a whole-day block
 *  on that date, or a weekday the vendor has said they don't work — and the
 *  filter removes exactly those, leaving everything unknown in the list.
 *
 *  Vendors without the PRO entitlement are excluded for the same reason
 *  `getAvailability` blanks them: their calendar isn't a surface they're paying
 *  for, so we don't publish conclusions from it.
 *
 *  Both queries are keyed to one date, so this stays two small scans however big
 *  the catalogue gets. */
export function listingIdsUnavailableOn(date: string): string[] {
  // Candidates only: a vendor with nothing on file for this date and no weekly
  // pattern resolves to "available" by definition, so there is no reason to ask
  // about them. Three ways to be interesting — an exception row on the day, a
  // weekly pattern at all, or a confirmed wedding that day.
  const rows = db
    .prepare(
      `SELECT l.id AS id, l.vendor_account_id AS vendor_account_id
         FROM listings l
        WHERE l.vendor_account_id IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM vendor_unavailable_dates d
                     WHERE d.vendor_account_id = l.vendor_account_id AND d.blocked_date = ?)
            OR EXISTS (SELECT 1 FROM vendor_availability_settings s
                        WHERE s.vendor_account_id = l.vendor_account_id
                          AND s.weekdays IS NOT NULL AND s.weekdays != '')
            OR EXISTS (SELECT 1 FROM supplier_bookings b
                        WHERE b.vendor_account_id = l.vendor_account_id
                          AND b.event_date = ? AND b.status = 'confirmed')
          )`,
    )
    .all(date, date) as Array<{ id: string; vendor_account_id: number }>;

  const out: string[] = [];
  for (const row of rows) {
    if (!isVendorEntitled(row.vendor_account_id)) continue;
    const ex = db
      .prepare(
        `SELECT is_available, blocked_hours FROM vendor_unavailable_dates
          WHERE vendor_account_id = ? AND blocked_date = ?`,
      )
      .get(row.vendor_account_id, date) as
      | { is_available: number; blocked_hours: string | null }
      | undefined;
    const booked = db
      .prepare(
        `SELECT 1 FROM supplier_bookings
          WHERE vendor_account_id = ? AND event_date = ? AND status = 'confirmed'`,
      )
      .get(row.vendor_account_id, date);
    // The SAME resolver the vendor calendar and the public busy calendar use.
    // Re-deriving the order here is how a couple ends up being shown a day the
    // vendor's own calendar calls taken (or, worse, hidden from a day the
    // vendor opened by hand).
    const day = resolveDayAvailability({
      hasConfirmedBooking: booked !== undefined && booked !== null,
      exception: ex
        ? { available: ex.is_available === 1, hours: parseBlockedHours(ex.blocked_hours) }
        : null,
      weekdays: getVendorWeekdays(row.vendor_account_id),
      date,
    });
    if (!isBookableDay(day)) out.push(row.id);
  }
  return out;
}

/** Dates blocked for the WHOLE day (blocked_hours IS NULL) — the set that makes
 *  a day unavailable to couples and skipped by next-free. */
export function listFullyBlockedDates(vendorAccountId: number): string[] {
  const rows = db
    .prepare(
      `SELECT blocked_date FROM vendor_unavailable_dates
        WHERE vendor_account_id = ? AND blocked_hours IS NULL AND is_available = 0
        ORDER BY blocked_date ASC`,
    )
    .all(vendorAccountId) as Array<{ blocked_date: string }>;
  return rows.map((r) => r.blocked_date);
}

/** Dates blocked for only certain hours — the day still has open hours, so
 *  couples see a distinct "partly booked" marker but the day stays bookable. */
export function listPartialBlockedDates(vendorAccountId: number): string[] {
  const rows = db
    .prepare(
      `SELECT blocked_date FROM vendor_unavailable_dates
        WHERE vendor_account_id = ? AND blocked_hours IS NOT NULL AND is_available = 0
        ORDER BY blocked_date ASC`,
    )
    .all(vendorAccountId) as Array<{ blocked_date: string }>;
  return rows.map((r) => r.blocked_date);
}

/** Every per-date EXCEPTION, in both directions, keyed by date. A row is either
 *  a block (`available: false`, whole-day or partial hours) or an "exceptionally
 *  working" override (`available: true`) on a day the weekly pattern excludes. */
export function listAvailabilityExceptions(
  vendorAccountId: number,
): Map<string, AvailabilityException> {
  const rows = db
    .prepare(
      `SELECT blocked_date, blocked_hours, is_available FROM vendor_unavailable_dates
        WHERE vendor_account_id = ?`,
    )
    .all(vendorAccountId) as Array<{
    blocked_date: string;
    blocked_hours: string | null;
    is_available: number;
  }>;
  const out = new Map<string, AvailabilityException>();
  for (const r of rows) {
    out.set(r.blocked_date, {
      available: r.is_available === 1,
      hours: parseBlockedHours(r.blocked_hours),
    });
  }
  return out;
}

/** Block a day. `hours === null` blocks the whole day; a non-empty sorted hour
 *  list blocks only those hours. Upserts, so re-blocking a day switches it
 *  between full/partial (or updates the hour set) instead of being ignored.
 *
 *  `available: true` flips the row's meaning to the other direction: the vendor
 *  exceptionally WORKS this day even though the weekly pattern excludes that
 *  weekday. Hours are meaningless there and are stored as null. */
export function blockDate(
  vendorAccountId: number,
  date: string,
  hours: number[] | null,
  reason: string | null,
  available = false,
): void {
  const ts = now();
  const hoursJson = available || !hours || hours.length === 0 ? null : JSON.stringify(hours);
  db.prepare(
    `INSERT INTO vendor_unavailable_dates
       (vendor_account_id, blocked_date, blocked_hours, reason, is_available, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(vendor_account_id, blocked_date)
       DO UPDATE SET blocked_hours = excluded.blocked_hours,
                     reason        = excluded.reason,
                     is_available  = excluded.is_available`,
  ).run(vendorAccountId, date, hoursJson, reason, available ? 1 : 0, ts);
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
  // Resolution (weekly pattern + per-date exceptions + confirmed bookings) is
  // shared with the frontend so the vendor calendar, the public busy calendar
  // and this can't disagree about what "free" means. A partial-hour block still
  // leaves the day open for a booking.
  const weekdays = getVendorWeekdays(vendorAccountId);
  const exceptions = listAvailabilityExceptions(vendorAccountId);
  const confirmed = new Set(
    (
      db
        .prepare(
          `SELECT event_date FROM supplier_bookings
            WHERE vendor_account_id = ? AND status = 'confirmed'`,
        )
        .all(vendorAccountId) as Array<{ event_date: string }>
    ).map((r) => r.event_date),
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const state = resolveDayAvailability({
      hasConfirmedBooking: confirmed.has(iso),
      exception: exceptions.get(iso) ?? null,
      weekdays,
      date: iso,
    });
    if (isBookableDay(state)) return iso;
  }
  return null;
}

export function getAvailability(supplierId: string): SupplierAvailability {
  const listing = getListingFor(supplierId);
  if (!listing || listing.vendor_account_id === null) {
    return {
      unavailable_dates: [],
      partial_dates: [],
      next_available: null,
      bookable: false,
      available_weekdays: null,
    };
  }
  // Direct inquiries + the busy calendar are PRO features (freemium): a
  // claimed listing whose vendor is on the FREE plan stays visible but is not
  // bookable, and the frontend falls back to the tracked website redirect, same
  // as an unclaimed listing.
  if (!isVendorEntitled(listing.vendor_account_id)) {
    return {
      unavailable_dates: [],
      partial_dates: [],
      next_available: null,
      bookable: false,
      available_weekdays: null,
    };
  }
  return {
    // Only whole-day blocks read as "fully booked"; partial-hour blocks surface
    // as a distinct "partly booked" marker and keep the day bookable.
    unavailable_dates: listFullyBlockedDates(listing.vendor_account_id),
    partial_dates: listPartialBlockedDates(listing.vendor_account_id),
    next_available: nextAvailableDate(listing.vendor_account_id),
    bookable: true,
    // The recurring layer. Couples' calendars grey out the weekdays this vendor
    // doesn't work, without us enumerating an unbounded date set.
    available_weekdays: getVendorWeekdays(listing.vendor_account_id),
  };
}

export interface CreateBookingArgs {
  supplierId: string;
  coupleId: number;
  eventDate: string;
  notes: string | null;
  amountHuf: number | null;
  /** Record the inquiry even when the vendor is on the FREE plan. Set by the
   *  outreach path, where the couple's message has already gone out by email
   *  and dropping the row would delete a real lead rather than defer it. The
   *  admin booking route leaves it off: that surface represents "this couple
   *  booked", which genuinely is PRO. */
  allowUnentitled?: boolean;
  /** When the inquiry actually happened, defaulting to now. Set only by the
   *  replay, which delivers messages a couple sent before the vendor had an
   *  account: stamping those "now" would tell the vendor a two-week-old lead
   *  arrived this morning, and the age of a lead is how overdue a reply is. */
  at?: number;
}

/** Insert a booking inquiry. Throws when the supplier is unclaimed (v1
 *  refuses to send mail to scraped contact addresses), the vendor is on the
 *  FREE plan (direct inquiries are PRO, freemium), or the date is past /
 *  malformed. Delivering the inquiry spends one of the vendor's free lead
 *  credits when they're inside the lead window (see domain/vendor_billing.ts).
 *  Caller is responsible for rate-limiting via lib/rate_limit. */
export function createBooking(args: CreateBookingArgs): SupplierBooking {
  // "" is the explicit "no date picked yet" value — a couple whose
  // `wedding_date_goal` is a season or a year has no scalar `wedding_date`,
  // and refusing their inquiry over it would be worse than carrying the gap.
  // `event_date` is NOT NULL, and every consumer already treats a non-ISO
  // value as unknown (the CRM and dashboard render "no date yet", the Google
  // Calendar push and the upcoming list filter on ISO_DATE).
  if (args.eventDate !== "" && !isIsoDate(args.eventDate)) {
    throw new Error("event_date must be valid YYYY-MM-DD");
  }
  const listing = getListingFor(args.supplierId);
  if (!listing || listing.vendor_account_id === null) {
    throw new Error("booking_unavailable: supplier is not claimed");
  }
  if (!args.allowUnentitled && !isVendorEntitled(listing.vendor_account_id)) {
    throw new Error("booking_free_plan: vendor is not accepting direct inquiries");
  }
  const ts = args.at ?? now();
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

// ── Couple-initiated delivery (outreach → vendor inbox) ───────────────────

/** One inquiry the outreach send pipeline put in front of a real vendor
 *  account. `isNew` distinguishes a fresh lead from a follow-up appended to an
 *  inquiry that's already open, which is what keeps the route layer from
 *  re-running the first-lead billing hop on every message. */
export interface DeliveredInquiry {
  bookingId: number;
  vendorAccountId: number;
  supplierId: string;
  isNew: boolean;
}

/** Why a recipient's inquiry did or didn't reach their Weddly inbox. The couple
 *  is told this per recipient, so "sent" can never again mean four different
 *  things ("in their client list", "emailed only", "nobody home"). */
export type InquiryOutcome = "in_account" | "email_only";

/** How much of a couple's message thread we keep on the inquiry row. Long
 *  enough for a real back-and-forth, bounded so a scripted sender can't grow
 *  one row without limit. Trimmed from the FRONT so the newest message — the
 *  one the vendor is being notified about — always survives. */
const INQUIRY_NOTES_MAX_LEN = 8000;

/** Deliver a couple's outreach message into the vendor's Weddly inbox.
 *
 *  Returns null only when there is genuinely nothing to deliver INTO: an
 *  unclaimed listing, i.e. no Weddly account exists. Those still receive the
 *  outreach email, the same fallback the public profile uses.
 *
 *  It does NOT consult entitlement, and that is the point. It used to, and a
 *  FREE-plan vendor's lead was therefore never written down at all, not
 *  deferred but DESTROYED, unrecoverable even if they subscribed an hour later,
 *  while the couple was told "sent" and the vendor was mailed a link to a
 *  dashboard where the lead did not exist. The PRO gate belongs on `bookable`
 *  (the couple's date-picker booking, see `getAvailability`), not here: outreach
 *  is a message the couple is sending by email regardless, and the basic client
 *  list is FREE by design, so the vendor can actually read what arrives.
 *
 *  A second message to a vendor the couple already has an OPEN inquiry with
 *  appends to that inquiry instead of opening a new one. Two rows for one
 *  conversation would split the vendor's CRM thread, and — because every
 *  delivered inquiry spends one of the vendor's free lead credits — would
 *  charge them twice for the same couple. */
export function deliverInquiryFromOutreach(args: {
  supplierId: string;
  coupleId: number;
  /** ISO 'YYYY-MM-DD', or "" when the couple has no date yet. */
  eventDate: string;
  message: string;
  at: number;
}): DeliveredInquiry | null {
  const listing = getListingFor(args.supplierId);
  if (!listing || listing.vendor_account_id === null) return null;

  const open = db
    .prepare(
      `SELECT * FROM supplier_bookings
        WHERE couple_id = ? AND supplier_id = ? AND status IN ('requested', 'vendor_seen')
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(args.coupleId, args.supplierId) as BookingRow | undefined;

  if (open) {
    const thread = [open.notes ?? "", args.message]
      .filter((s) => s.trim().length > 0)
      .join("\n\n—\n\n");
    const notes =
      thread.length > INQUIRY_NOTES_MAX_LEN ? thread.slice(-INQUIRY_NOTES_MAX_LEN) : thread;
    // Backfill the date if the couple has since picked one; never overwrite a
    // date already on the row with a blank.
    const eventDate = args.eventDate !== "" ? args.eventDate : open.event_date;
    db.prepare(
      "UPDATE supplier_bookings SET notes = ?, event_date = ?, updated_at = ? WHERE id = ?",
    ).run(notes, eventDate, args.at, open.id);
    // The blob stays (it is what `inquiry_message` still reads), but the thread
    // is the live surface now, so every inquiry is also a message row.
    insertMessage({
      bookingId: open.id,
      senderKind: "couple",
      senderUserId: null,
      body: args.message.slice(0, MESSAGE_BODY_MAX_LEN),
      at: args.at,
    });
    return {
      bookingId: open.id,
      vendorAccountId: listing.vendor_account_id,
      supplierId: args.supplierId,
      isNew: false,
    };
  }

  const booking = createBooking({
    supplierId: args.supplierId,
    coupleId: args.coupleId,
    eventDate: args.eventDate,
    notes: args.message.slice(0, INQUIRY_NOTES_MAX_LEN),
    amountHuf: null,
    // A message the couple has already emailed gets recorded whatever the
    // vendor's plan. See this function's header.
    allowUnentitled: true,
    at: args.at,
  });
  insertMessage({
    bookingId: booking.id,
    senderKind: "couple",
    senderUserId: null,
    body: args.message.slice(0, MESSAGE_BODY_MAX_LEN),
    at: args.at,
  });
  return {
    bookingId: booking.id,
    vendorAccountId: listing.vendor_account_id,
    supplierId: args.supplierId,
    isNew: true,
  };
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
  // `first_response_at` is write-once: COALESCE keeps the original stamp, so a
  // vendor who later flips 'confirmed' → 'cancelled' can't reset the clock and
  // re-earn the fast-reply award. `updated_at` moves as it always did.
  const info = db
    .prepare(
      `UPDATE supplier_bookings
          SET status = ?, updated_at = ?, first_response_at = COALESCE(first_response_at, ?)
        WHERE id = ?`,
    )
    .run(status, ts, ts, id);
  if (info.changes === 0) return null;
  const row = db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(id) as BookingRow;
  // Two separate facts, two separate events: how fast the vendor reacted, and
  // whether this became a confirmed booking. The engine decides what each is
  // worth (and the fast-reply rule re-reads the timestamps server-side).
  emitVendorEvent(row.vendor_account_id, "booking.responded", { booking_id: id });
  if (status === "confirmed") {
    emitVendorEvent(row.vendor_account_id, "booking.confirmed", { booking_id: id });
  }
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
