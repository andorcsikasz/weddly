// Revenue Pulse: the FORWARD-looking half of a vendor's money.
//
// `VendorStats.revenue_tracked` answers "what has already arrived": it sums
// every deposit the vendor ever recorded. That is a lifetime ledger, and a
// ledger cannot answer the two questions a vendor actually acts on, "how much
// work is in flight right now" and "what lands in the next month". Revenue
// Pulse is that answer, derived from the facts already on `supplier_bookings`:
// status, contract value, deposit paid, event date, created_at. No new column,
// no new table, and no database in this file at all.
//
// Rules worth not re-deriving:
//
//   * MONEY IS A WHOLE UNIT OF THE CURRENCY, never minor units, exactly as in
//     `shared/vendor_clients.ts`. A contract value of 1500 is fifteen hundred
//     euros. Every figure here is therefore rounded to a whole unit before it
//     leaves, because a fractional euro is not a thing a vendor can be paid.
//
//   * THE PROBABILITIES ARE NAMED CONSTANTS WITH A RATIONALE, never a magic
//     number inline, and `weighted` is labelled an ESTIMATE everywhere it is
//     rendered. A forecast presented as fact is worse than no forecast: the
//     vendor makes a capacity or pricing decision on it and finds out later
//     that the confidence was invented by a developer.
//
//   * A LEAD WITH NO RECORDED CONTRACT VALUE IS NOT WORTH A GUESS. It is left
//     out of `pipeline` entirely and counted in `pipeline_unpriced` instead.
//     Inventing an amount (an average, a price band midpoint, anything) would
//     put money in the forecast that nobody ever quoted, and the vendor has no
//     way to see that it is fictional. A count they can read is honest and it
//     also tells them what to do about it: go and record the value.
//
//   * ARCHIVED MEANS ARCHIVED, the same rule `vendor_next_action.ts` keeps:
//     `declined` / `cancelled` / `expired` contribute nothing to any figure.
//     Not to booked, not to pipeline, and not to collected either, a deposit
//     sitting on a cancelled booking is money that was very likely refunded,
//     and it is certainly not part of a live book of business.
//
//   * `collected` IS THEREFORE NOT `revenue_tracked`, on purpose. This module
//     is about the live book; the stats rollup is about the lifetime ledger.
//     They differ exactly when a booking that took a deposit later died, which
//     is the one case where the two questions have two different answers.
//
//   * THE UPCOMING WINDOWS ARE NESTED, NOT DISJOINT. `upcoming_60` INCLUDES
//     everything in `upcoming_30`. That is how the cash-flow question is asked
//     ("what lands in the next 60 days"), and it is why the three must never be
//     summed.

import type { Currency, UnixMs } from "./types";
import { daysUntilDate } from "./vendor_next_action";

/** Probability that an OPEN lead at this status becomes a confirmed booking.
 *
 *  Two deliberate design choices sit in this map:
 *
 *  1. The numbers are CONSERVATIVE. A `requested` inquiry is the weakest thing
 *     a vendor owns: couples write to several vendors on the same evening, so
 *     one in five is already a generous reading of an inbox nobody has answered
 *     yet. `vendor_seen` means the vendor has opened it and a conversation is
 *     live, which roughly doubles the odds and still leaves it a minority, an
 *     opened inquiry is triage, not agreement. Erring low is the right side to
 *     err on: a vendor who turns work away because a forecast promised money
 *     that never came pays far more than one who is pleasantly surprised.
 *
 *  2. They are FLAT, not learned per vendor. A rate computed from one vendor's
 *     handful of decided leads swings wildly (one win in three reads 33%, the
 *     next lead drops it to 25%) so the forecast would move for reasons that
 *     have nothing to do with their week, and a vendor with no history would
 *     have no rate at all. Their REAL conversion is reported separately as
 *     `win_rate`, right next to the estimate, so they can judge the discount
 *     themselves instead of having a silent one applied to their money.
 *
 *  A status absent from this map is not an open lead, which is what makes this
 *  map the single definition of "in the pipeline". */
export const PIPELINE_PROBABILITY: Readonly<Record<string, number>> = {
  requested: 0.2,
  vendor_seen: 0.35,
};

/** Statuses the vendor has closed. Same set as `vendor_next_action.ts`, and the
 *  same rule: they contribute nothing, anywhere, ever. */
const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["declined", "cancelled", "expired"]);

/** The trailing window `average_booking_value` and `win_rate` are measured
 *  over, by booking creation. A year rather than a quarter because wedding work
 *  is seasonal: a 90-day window measured in February would describe a vendor's
 *  off-season and call it their business. */
export const REVENUE_TRAILING_DAYS = 365;

/** The three cash-flow horizons, nearest first. Nested, not disjoint. */
export const UPCOMING_WINDOWS = [30, 60, 90] as const;

const DAY_MS = 86_400_000;

/** Everything the arithmetic needs about one client. Flat and primitive so the
 *  whole derivation is testable without a database, same shape rule as
 *  `VendorClientSignals`. */
export interface VendorRevenueFact {
  /** BookingStatus off `supplier_bookings.status`. */
  status: string;
  /** Agreed total in WHOLE units of the vendor's currency, or null while the
   *  vendor has not recorded one. */
  contract_value: number | null;
  /** Deposit recorded so far, whole units, or null. */
  deposit_paid: number | null;
  /** ISO 'YYYY-MM-DD'. */
  event_date: string;
  /** When the inquiry landed. The trailing window is measured on this. */
  created_at: UnixMs;
}

/** The forward-looking money picture. Every amount is a whole unit of the
 *  vendor's currency. */
export interface VendorRevenuePulse {
  /** Contract value on CONFIRMED bookings. What the vendor has actually won. */
  booked: number;
  /** Deposits recorded against those confirmed bookings. */
  collected: number;
  /** `booked` minus `collected`, floored at zero. Still to come in on work the
   *  vendor already has. */
  outstanding: number;
  /** Contract value on OPEN leads that HAVE a recorded value. A fact, not a
   *  forecast: this is what has been quoted and is undecided. */
  pipeline: number;
  /** `pipeline` discounted by `PIPELINE_PROBABILITY`. AN ESTIMATE, and every
   *  surface that renders it must say so. Always strictly below `pipeline`
   *  whenever `pipeline` is non-zero. */
  weighted: number;
  /** Open leads left OUT of `pipeline` because no contract value is recorded.
   *  Shipped so the number explains itself rather than quietly understating. */
  pipeline_unpriced: number;
  /** Confirmed bookings with no contract value, for the same reason: `booked`
   *  understates by exactly these, and the vendor should be able to see it. */
  booked_unpriced: number;
  /** Outstanding balance on confirmed bookings whose event falls inside the
   *  next 30 / 60 / 90 days. NESTED: `upcoming_60` contains `upcoming_30`. */
  upcoming_30: number;
  upcoming_60: number;
  upcoming_90: number;
  /** Mean contract value of confirmed bookings created in the trailing window,
   *  or null when there are none. NEVER 0: an unknown average and an average of
   *  nothing are different answers, and printing 0 reads as "your bookings are
   *  worthless". Same rule as the stats funnel's conversion rate. */
  average_booking_value: number | null;
  /** Percent (0..100) of DECIDED leads in the trailing window that were won, or
   *  null when nothing has been decided yet. */
  win_rate: number | null;
  /** Denominator behind `win_rate`, so a 100% built on one lead can be read as
   *  what it is. */
  decided_count: number;
}

/** The API payload: the pulse plus the currency it is denominated in and the
 *  window the trailing figures were measured over. */
export interface VendorRevenuePulseView extends VendorRevenuePulse {
  currency: Currency;
  trailing_days: number;
}

/** True when this status is a live, undecided lead. Derived from the
 *  probability map so the two can never drift. */
export function isPipelineStatus(status: string): boolean {
  return Object.hasOwn(PIPELINE_PROBABILITY, status);
}

/** Money is whole units, so every figure is rounded once at the END of its own
 *  sum rather than per row: rounding each weighted lead first would drift by a
 *  unit per lead, which on a busy vendor is real money. */
function whole(amount: number): number {
  return Math.round(amount);
}

/** Compute the whole pulse. Pure: same facts plus same `nowMs` give the same
 *  answer, forever, with no clock and no database of its own. */
export function vendorRevenuePulse(
  facts: readonly VendorRevenueFact[],
  nowMs: UnixMs,
): VendorRevenuePulse {
  let booked = 0;
  let collected = 0;
  let pipeline = 0;
  let weightedRaw = 0;
  let pipelineUnpriced = 0;
  let bookedUnpriced = 0;
  const upcoming = new Map<number, number>(UPCOMING_WINDOWS.map((w) => [w, 0]));

  let trailingValueSum = 0;
  let trailingValueCount = 0;
  let won = 0;
  let lost = 0;
  const trailingFrom = nowMs - REVENUE_TRAILING_DAYS * DAY_MS;

  for (const f of facts) {
    // Archived first, before anything reads a number off the row.
    if (ARCHIVED_STATUSES.has(f.status)) {
      if (f.created_at >= trailingFrom) lost += 1;
      continue;
    }

    const inTrailingWindow = f.created_at >= trailingFrom;

    if (f.status === "confirmed") {
      if (f.contract_value === null) {
        bookedUnpriced += 1;
      } else {
        booked += f.contract_value;
        if (inTrailingWindow) {
          trailingValueSum += f.contract_value;
          trailingValueCount += 1;
        }
      }
      if (f.deposit_paid !== null) collected += f.deposit_paid;
      if (inTrailingWindow) won += 1;

      // Cash-flow horizons. The balance still owed is what LANDS; a booking
      // already paid in full lands nothing, and a date that has gone is not
      // upcoming at all (it is a collection problem, which is the attention
      // queue's job, not the forecast's).
      const balance = Math.max(0, (f.contract_value ?? 0) - (f.deposit_paid ?? 0));
      const days = daysUntilDate(f.event_date, nowMs);
      if (balance > 0 && days !== null && days >= 0) {
        for (const w of UPCOMING_WINDOWS) {
          if (days <= w) upcoming.set(w, (upcoming.get(w) ?? 0) + balance);
        }
      }
      continue;
    }

    const probability = PIPELINE_PROBABILITY[f.status];
    if (probability === undefined) {
      // An unknown status is not an invitation to guess at a workflow, and it
      // is certainly not an invitation to guess at money.
      continue;
    }
    if (f.contract_value === null) {
      pipelineUnpriced += 1;
      continue;
    }
    pipeline += f.contract_value;
    weightedRaw += f.contract_value * probability;
  }

  const bookedWhole = whole(booked);
  const collectedWhole = whole(collected);
  const decided = won + lost;

  return {
    booked: bookedWhole,
    collected: collectedWhole,
    // Floored at zero: a vendor who recorded a deposit larger than the contract
    // (a typo, or a value they never went back and updated) is not owed money
    // backwards, and a negative "still to collect" is unreadable.
    outstanding: Math.max(0, bookedWhole - collectedWhole),
    pipeline: whole(pipeline),
    weighted: whole(weightedRaw),
    pipeline_unpriced: pipelineUnpriced,
    booked_unpriced: bookedUnpriced,
    upcoming_30: whole(upcoming.get(30) ?? 0),
    upcoming_60: whole(upcoming.get(60) ?? 0),
    upcoming_90: whole(upcoming.get(90) ?? 0),
    average_booking_value:
      trailingValueCount === 0 ? null : whole(trailingValueSum / trailingValueCount),
    // A lead still open is undecided and belongs on NEITHER side: counting it as
    // a loss would make every vendor's win rate fall simply for having a busy
    // inbox this week.
    win_rate: decided === 0 ? null : Math.round((won / decided) * 100),
    decided_count: decided,
  };
}

/** True when the pulse has nothing worth drawing. A vendor with no money on any
 *  row gets no panel rather than a wall of zeroes pretending to be analysis. */
export function isRevenuePulseEmpty(p: VendorRevenuePulse): boolean {
  return (
    p.booked === 0 &&
    p.collected === 0 &&
    p.pipeline === 0 &&
    p.pipeline_unpriced === 0 &&
    p.booked_unpriced === 0
  );
}
