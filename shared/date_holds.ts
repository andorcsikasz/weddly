// Live Date Hold — a vendor's temporary, self-expiring reservation of ONE date
// for ONE inquiry.
//
// The flow it serves is the one that already exists: read the inquiry, price it
// (`shared/booking_quotes.ts`), and hold the date so the couple is not deciding
// against a moving target while the vendor is not losing the Saturday to a
// promise nobody wrote down. A hold hangs off a `supplier_bookings` row for the
// same reason a quote does: a date held for nobody is just a blocked day, and
// the vendor already has one of those (`vendor_unavailable_dates`).
//
// STATE IS DERIVED, NEVER STORED — the same rule `quoteStatus` follows for the
// quote ladder and `toCoupleBilling` follows for entitlement. What the DB keeps
// is `hold_until` plus a `released_at`; live / expired / released is computed
// against now on every read. Three things follow, and together they are the
// whole design:
//
//   * a lapsing hold needs NO sweep. Nothing has to run at 03:00 for the date to
//     go back on the market; the next read simply says it did. Same reason as
//     the quote's expiry, and the same reason it matters here: the auto-decline
//     cron `supplier_bookings.ts` promised in v1 was never wired, so a feature
//     that depends on a job running is a feature that silently stops.
//   * extending UN-LAPSES it. Pushing `hold_until` forward on the same row is
//     the entire operation, so a vendor who missed their own deadline by an hour
//     has not lost the date, and there is no second "revive" concept to explain.
//   * releasing early is its OWN fact (`released_at`), not a rewind of
//     `hold_until`. "I let this go on Tuesday" and "it ran out on Tuesday" are
//     different things to have to explain to a couple three weeks later, and a
//     rewind would make them indistinguishable.
//
// HOURS, not days, are the unit. A hold is a promise measured against a
// decision, and "48 hours to think about it" is how a vendor says it out loud;
// a day-granular hold would also have to invent a time of day to expire at.

import type { UnixMs } from "./types";

/** The ladder both sides read. Derived from `hold_until` + `released_at` by
 *  `holdState`, never stored. */
export type DateHoldState =
  /** Placed, not released, and `hold_until` is still ahead. The only state that
   *  takes the date off anyone else's calendar. */
  | "live"
  /** `hold_until` has passed and nobody released it. Derived, so it needs no
   *  sweep, and extending turns it live again. */
  | "expired"
  /** The vendor let it go before it ran out. Terminal until they place a new
   *  one, which is the same row with a fresh `hold_until`. */
  | "released";

export interface DateHold {
  id: number;
  /** supplier_bookings.id — the inquiry this date is being held for. */
  booking_id: number;
  vendor_account_id: number;
  /** ISO 'YYYY-MM-DD'. Copied off the booking at place time so the hold reads
   *  on its own, and so moving a booking's date can never silently transplant a
   *  hold onto a day the vendor never agreed to hold. */
  event_date: string;
  hold_until: UnixMs;
  /** When the vendor let it go early, or null. */
  released_at: UnixMs | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  /** Derived on every read. */
  state: DateHoldState;
  /** Whole hours left while `live`, rounded UP so a hold with forty minutes on
   *  it reads "1 hour" rather than "0". Zero in every other state. */
  hours_remaining: number;
}

/** The two stored facts `holdState` reads. Kept structural so the DB row, the
 *  DTO and a hand-built pair in a test can all be passed to it. */
export interface DateHoldTimestamps {
  hold_until: UnixMs;
  released_at: UnixMs | null;
}

const HOUR_MS = 3_600_000;

/** Shortest hold worth writing down. An hour is the smallest promise a vendor
 *  can honestly make about a date over email. */
export const HOLD_MIN_HOURS = 1;
/** Ceiling. Past a month a "temporary" hold is a booking the vendor has not
 *  admitted to, and the date is off the market for a whole season of couples. */
export const HOLD_MAX_DAYS = 30;
export const HOLD_MAX_HOURS = HOLD_MAX_DAYS * 24;
/** What the button offers when the vendor does not choose: a week is long
 *  enough for a couple to talk it over and short enough to be a deadline. */
export const HOLD_DEFAULT_HOURS = 7 * 24;

/** The picker's rungs, in hours: a day, two days, three days, a week, two
 *  weeks. Deliberately coarse — a vendor choosing "37 hours" is a slider
 *  pretending to be a decision. */
export const HOLD_OPTIONS_HOURS: readonly number[] = [24, 48, 72, 168, 336];

/** How close to lapsing a live hold has to be before the vendor is asked to
 *  release or extend it. A day, because that is the last point at which they
 *  can still ring the couple before the date goes back on the market. */
export const HOLD_EXPIRING_SOON_HOURS = 24;

/** Derive the state. Order matters: a released hold stays released even after
 *  `hold_until` passes, because "I let it go" is what happened and "it ran out"
 *  is not. */
export function holdState(h: DateHoldTimestamps, nowMs: UnixMs): DateHoldState {
  if (h.released_at !== null) return "released";
  return h.hold_until > nowMs ? "live" : "expired";
}

/** True while the hold is actually taking the date off the market. The one
 *  question every availability read asks. */
export function isHoldLive(state: DateHoldState): boolean {
  return state === "live";
}

/** Whole hours left, rounded UP, never negative. */
export function holdHoursRemaining(holdUntil: UnixMs, nowMs: UnixMs): number {
  return Math.max(0, Math.ceil((holdUntil - nowMs) / HOUR_MS));
}

/** True when a LIVE hold runs out inside `withinHours`. Anything already
 *  expired or released is false: the deadline the vendor has to answer is the
 *  one that has not passed yet, and a lapsed hold is news, not a deadline. */
export function holdExpiresWithin(
  h: DateHoldTimestamps,
  nowMs: UnixMs,
  withinHours: number = HOLD_EXPIRING_SOON_HOURS,
): boolean {
  if (holdState(h, nowMs) !== "live") return false;
  return h.hold_until - nowMs <= withinHours * HOUR_MS;
}

/** Validate an inbound hold length. Returns null for anything unusable so the
 *  caller picks its own status code; whole hours only, because half an hour of
 *  a multi-day promise is noise. */
export function coerceHoldHours(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < HOLD_MIN_HOURS || n > HOLD_MAX_HOURS) return null;
  return n;
}

/** Where a hold placed now would end. Measured from NOW rather than from the
 *  current `hold_until`, so "hold it for another 48 hours" means what the vendor
 *  said and an extension of an already-lapsed hold starts a real window instead
 *  of a window that is already half gone. */
export function holdUntilFrom(nowMs: UnixMs, hours: number): UnixMs {
  return nowMs + hours * HOUR_MS;
}
