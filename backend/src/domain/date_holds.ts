// Live Date Holds — a vendor's temporary, self-expiring reservation of one date
// for one inquiry.
//
// The contract, and the reasoning behind deriving the state rather than storing
// it, lives in shared/date_holds.ts. What this module owns is the invariants a
// route cannot be trusted to remember, and one product decision that is easy to
// get wrong and expensive to get wrong quietly.
//
// ONE HOLD PER INQUIRY, one row, forever. Placing, extending, releasing and
// re-placing all write the SAME row (`UNIQUE(booking_id)`). Two rows would be
// two promises about one date, and the second one would win by accident of
// ordering.
//
// A HAND-TYPED BLOCK STILL OUTRANKS IT. The hold sits exactly where the
// external Google calendar sits in `resolveDayAvailability`: below an explicit
// per-date exception, above the "available by default" fallback. A vendor who
// blocked the day by hand keeps it blocked, and one who OPENED the day by hand
// keeps it open, because the app must never silently disagree with an explicit
// statement about a date. Same precedence, same reason.
//
// ── What a hold means to a couple who is not the one it is for ───────────────
//
// A live hold reads as BUSY on every couple-facing surface: the public busy
// calendar, `next_available`, and the directory's date filter. That is a
// deliberate choice against the more obviously "correct" one ("busy for
// everyone except the couple who owns it"), and the reason is that the public
// availability payload has no couple in it. `getAvailability(supplierId)` is
// keyed on the LISTING and is read by anonymous visitors and by every couple
// alike, so a per-viewer answer would mean either a payload that varies by
// reader (and a directory filter that cannot be computed once per date) or a
// marker that says WHOSE date it is. Publishing "held for someone else" is a
// worse leak than the marker is worth: it tells a stranger that this vendor is
// mid-negotiation on that Saturday, which is the couple's business and the
// vendor's.
//
// So the marker is public and the EXEMPTION lives one layer down, in the only
// path that turns a date into a commitment: `createBooking` refuses a date
// another couple is holding and lets the holding couple straight through. The
// couple the hold is for therefore loses nothing they can act on — they can
// still inquire, still accept the quote, still confirm the date — and what they
// lose is a calendar marker their vendor has already explained to them
// personally, which is what the hold was for in the first place.
//
// Two things deliberately do NOT change with a hold:
//   * a lapsed (FREE) vendor keeps every hold row. Their calendar simply stops
//     being published (`getAvailability` blanks it, `listingIdsUnavailableOn`
//     skips them) exactly as it already did, and every hold comes back the
//     moment they are entitled again. Nothing here deletes anything.
//   * a CONFIRMED booking's own date is already unavailable through
//     `hasConfirmedBooking`, so a hold left standing on it changes no verdict.

import {
  type DateHold,
  type DateHoldState,
  HOLD_MAX_HOURS,
  HOLD_MIN_HOURS,
  holdHoursRemaining,
  holdState,
  holdUntilFrom,
  isHoldLive,
} from "@shared/date_holds";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

export interface DateHoldRow {
  id: number;
  booking_id: number;
  vendor_account_id: number;
  event_date: string;
  hold_until: number;
  released_at: number | null;
  created_at: number;
  updated_at: number;
}

export function stateOf(row: DateHoldRow, at: number = Date.now()): DateHoldState {
  return holdState(row, at);
}

/** Hydrate one row. Exported because every mutation ends by returning the fresh
 *  hold, and they should all agree about how it is built. */
export function toDateHold(row: DateHoldRow, at: number = Date.now()): DateHold {
  const state = holdState(row, at);
  return {
    id: row.id,
    booking_id: row.booking_id,
    vendor_account_id: row.vendor_account_id,
    event_date: row.event_date,
    hold_until: row.hold_until,
    released_at: row.released_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    state,
    hours_remaining: state === "live" ? holdHoursRemaining(row.hold_until, at) : 0,
  };
}

export function getHoldRowForBooking(bookingId: number): DateHoldRow | null {
  const row = db.prepare("SELECT * FROM booking_date_holds WHERE booking_id = ?").get(bookingId) as
    | DateHoldRow
    | undefined;
  return row ?? null;
}

/** The hold on one inquiry, in whatever state it is in, or null when the vendor
 *  has never placed one. Returned to the vendor as-is: an expired hold is worth
 *  showing, because "this lapsed on Tuesday" is the thing they need to know. */
export function getHoldForBooking(bookingId: number, at: number = Date.now()): DateHold | null {
  const row = getHoldRowForBooking(bookingId);
  return row === null ? null : toDateHold(row, at);
}

export interface PlaceHoldArgs {
  bookingId: number;
  vendorAccountId: number;
  /** ISO 'YYYY-MM-DD', taken off the booking by the caller. */
  eventDate: string;
  hours: number;
  at?: number;
}

/** Place a hold, or extend the one that is already there. ONE operation on
 *  purpose: from the vendor's side "hold this for another two days" is the same
 *  sentence whether the current hold is live, lapsed or was let go, and giving
 *  each of those its own endpoint would only invite them to disagree.
 *
 *  `released_at` is cleared, which is what makes re-placing work without a
 *  second row; `hold_until` is measured from NOW (see `holdUntilFrom`), so a
 *  hold that lapsed an hour ago gets a real window rather than one that is
 *  already half gone. */
export function placeHold(args: PlaceHoldArgs): DateHold {
  if (!Number.isInteger(args.hours) || args.hours < HOLD_MIN_HOURS || args.hours > HOLD_MAX_HOURS) {
    throw new HttpError(400, "Invalid hold length", { code: "bad_hold_hours" });
  }
  const ts = args.at ?? now();
  const until = holdUntilFrom(ts, args.hours);
  db.prepare(
    `INSERT INTO booking_date_holds
       (booking_id, vendor_account_id, event_date, hold_until, released_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(booking_id) DO UPDATE SET
       event_date  = excluded.event_date,
       hold_until  = excluded.hold_until,
       released_at = NULL,
       updated_at  = excluded.updated_at`,
  ).run(args.bookingId, args.vendorAccountId, args.eventDate, until, ts, ts);
  const row = getHoldRowForBooking(args.bookingId);
  if (row === null) throw new HttpError(500, "Hold insert failed");
  return toDateHold(row, ts);
}

/** Let a hold go before it runs out. Stamps rather than rewinds `hold_until`,
 *  so the record still says how long the date WAS being held for; re-releasing
 *  an already-released hold keeps the first stamp, since the moment the date
 *  went back on the market only happened once. */
export function releaseHold(row: DateHoldRow, at: number = Date.now()): DateHold {
  if (row.released_at === null) {
    const ts = now();
    db.prepare("UPDATE booking_date_holds SET released_at = ?, updated_at = ? WHERE id = ?").run(
      ts,
      ts,
      row.id,
    );
  }
  const fresh = getHoldRowForBooking(row.booking_id);
  if (fresh === null) throw new HttpError(404, "Hold not found", { code: "hold_not_found" });
  return toDateHold(fresh, at);
}

/** Every hold this vendor has ever placed that is still LIVE, soonest date
 *  first. What their own calendar draws. */
export function listLiveHoldsForVendor(
  vendorAccountId: number,
  at: number = Date.now(),
): DateHold[] {
  const rows = db
    .prepare(
      `SELECT * FROM booking_date_holds
        WHERE vendor_account_id = ? AND released_at IS NULL AND hold_until > ?
        ORDER BY event_date ASC, id ASC`,
    )
    .all(vendorAccountId, at) as DateHoldRow[];
  return rows.map((r) => toDateHold(r, at));
}

/** Dates this vendor is holding right now. Built once per availability scan,
 *  because `nextAvailableDate` walks 365 days and a per-date query would be 365
 *  of them. */
export function liveHoldDatesForVendor(
  vendorAccountId: number,
  at: number = Date.now(),
): Set<string> {
  const rows = db
    .prepare(
      `SELECT event_date FROM booking_date_holds
        WHERE vendor_account_id = ? AND released_at IS NULL AND hold_until > ?`,
    )
    .all(vendorAccountId, at) as Array<{ event_date: string }>;
  return new Set(rows.map((r) => r.event_date));
}

/** Whether this vendor is holding this exact date right now. */
export function hasLiveHoldOn(
  vendorAccountId: number,
  date: string,
  at: number = Date.now(),
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM booking_date_holds
        WHERE vendor_account_id = ? AND event_date = ?
          AND released_at IS NULL AND hold_until > ? LIMIT 1`,
    )
    .get(vendorAccountId, date, at) as { ok: number } | undefined | null;
  // `!= null` rather than `!== undefined`: bun:sqlite answers null for a
  // missing row, and the loose comparison is the only one that covers both.
  return row != null;
}

/** The live hold standing between a COUPLE and a date, or null when there is
 *  none in their way. The couple the hold was placed for is not in their own
 *  way, which is the exemption the module header describes: the marker is
 *  public, the refusal is not. */
export function blockingHoldFor(args: {
  vendorAccountId: number;
  date: string;
  coupleId: number;
  at?: number;
}): DateHoldRow | null {
  const at = args.at ?? Date.now();
  const row = db
    .prepare(
      `SELECT h.* FROM booking_date_holds h
         JOIN supplier_bookings b ON b.id = h.booking_id
        WHERE h.vendor_account_id = ? AND h.event_date = ?
          AND h.released_at IS NULL AND h.hold_until > ?
          AND b.couple_id != ?
        LIMIT 1`,
    )
    .get(args.vendorAccountId, args.date, at, args.coupleId) as DateHoldRow | undefined;
  return row ?? null;
}

/** The hold facts the Next Best Action derivation reads, for a batch of
 *  bookings. RAW on purpose — liveness is derived in
 *  `shared/vendor_next_action.ts` from the same two columns everything else
 *  derives it from, so there is no second definition of "still holding". */
export function holdSignalsFor(
  bookingIds: number[],
): Map<number, { hold_until: number; released_at: number | null }> {
  const out = new Map<number, { hold_until: number; released_at: number | null }>();
  if (bookingIds.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT booking_id, hold_until, released_at FROM booking_date_holds
        WHERE booking_id IN (${bookingIds.map(() => "?").join(",")})`,
    )
    .all(...bookingIds) as Array<{
    booking_id: number;
    hold_until: number;
    released_at: number | null;
  }>;
  for (const r of rows) {
    out.set(r.booking_id, { hold_until: r.hold_until, released_at: r.released_at });
  }
  return out;
}

/** Re-export so a caller that already has a hold row does not have to reach
 *  into the shared module for the one predicate it needs. */
export { isHoldLive };
