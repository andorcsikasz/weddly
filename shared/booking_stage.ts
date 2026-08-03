// Where one inquiry has got to, as a LADDER of named stages.
//
// The vendor portal already answers "what should I do next" (`vendor_next_
// action.ts`) and "what is this worth" (`vendor_revenue.ts`). This is the third
// question, and the one nothing answered: how far along is this couple. It is
// deliberately NOT a percentage. A booking is not 60% done; it is quoted and
// waiting, or booked with the deposit still out. A bar with a number on it says
// the same nothing about every client, which is exactly the generic-admin look
// this exists to replace.
//
// Rules worth not re-deriving:
//
//   * IT IS A LADDER, so a rung reached implies every rung below it. A vendor
//     who never sent a quote through Weddly and simply marked the booking
//     confirmed has still, in real life, priced the job. Drawing a hole in the
//     middle of their rail would read as a bug in the app rather than as a fact
//     about the booking.
//
//   * NOTHING IS INFERRED FROM ABSENCE. Every rung is reached by a POSITIVE
//     fact that already exists on the booking: a quote that left the vendor's
//     hands, a status the vendor set, a number they typed, a date that has
//     passed. Missing data (a FREE vendor cannot read the payment schedule, a
//     quote fetch failed) leaves the fact `null` and the ladder simply stops
//     lower, rather than guessing.
//
//   * A CLOSED LEAD HAS NO PLACE ON THE LADDER. `declined` / `cancelled` /
//     `expired` return `closed`, with no current stage at all, for the same
//     reason `vendorNextAction` returns `none` for them: a rail reading "2 of 5"
//     over a lead the vendor closed last month is an invitation to finish work
//     nobody wants finished.
//
//   * A DATE HOLD IS NOT A RUNG, it is a condition on the current one. A vendor
//     can place one before quoting, after quoting, or never (most never do), so
//     a hold rung would leave the majority of rails looking like they skipped a
//     step. It rides alongside as `hold_live` instead.
//
//   * A QUOTE THE COUPLE ACCEPTED IS A BOOKING even while the status still says
//     `vendor_seen`. The couple said yes in the app; the status is admin the
//     vendor may not have got to yet, and the rail should not be the last thing
//     to know.

import type { QuoteStatus } from "./booking_quotes";
import type { DateHoldState } from "./date_holds";
import type { UnixMs } from "./types";
import { daysUntilDate } from "./vendor_next_action";

/** The rungs, in order. Named after what happened, not after a percentage. */
export type BookingStageKey =
  /** The couple wrote in. Every live booking has reached this. */
  | "inquiry"
  /** A price left the vendor's hands: a quote was sent, or a contract value
   *  was recorded by hand. */
  | "quoted"
  /** The job is theirs: status `confirmed`, or the couple accepted the quote. */
  | "booked"
  /** Money has arrived against it. */
  | "deposit"
  /** The wedding happened. */
  | "done";

/** In ladder order. The index in this array IS the rung's position, so the rail
 *  and the derivation can never disagree about which way is forward. */
export const BOOKING_STAGES: readonly BookingStageKey[] = [
  "inquiry",
  "quoted",
  "booked",
  "deposit",
  "done",
] as const;

/** Statuses the vendor has closed. Same set as `vendor_next_action.ts` keeps,
 *  and for the same reason: a closed lead is not work in progress. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["declined", "cancelled", "expired"]);

/** Quote states that mean a price genuinely reached the couple. `draft` is the
 *  one that does not: it is the only editable state, and nobody outside the
 *  vendor's own screen has ever seen it. `withdrawn` and `expired` DO count,
 *  because both were sent before they were retired. */
const QUOTE_SENT_STATES: ReadonlySet<QuoteStatus> = new Set<QuoteStatus>([
  "sent",
  "viewed",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
]);

/** Everything the ladder reads. Flat and primitive on purpose, so the rail, a
 *  drawer holding only the list row, and a test with six literals can all build
 *  one without a database. Every field a caller cannot see is `null`, which is
 *  a real answer here: it stops the ladder rather than moving it. */
export interface BookingStageFacts {
  /** BookingStatus off `supplier_bookings.status`. */
  status: string;
  /** ISO 'YYYY-MM-DD'. */
  event_date: string;
  /** The newest quote's derived status, or null when there is none (or the
   *  caller never asked for it). */
  quote_status: QuoteStatus | null;
  /** The live/expired/released verdict on this booking's date hold, or null
   *  when the vendor never placed one. */
  hold_state: DateHoldState | null;
  /** Whole units. Null until the vendor records it, and null on FREE. */
  contract_value: number | null;
  /** Whole units received. Null until recorded, and null on FREE. */
  deposit_paid: number | null;
}

export interface BookingStageView {
  /** The furthest rung reached, or null when the lead is closed. */
  key: BookingStageKey | null;
  /** Its index in `BOOKING_STAGES`, or -1 when closed. Everything at or below
   *  this index is reached. */
  index: number;
  /** The vendor closed this lead. There is no current rung, by design. */
  closed: boolean;
  /** Which closing status it was ('declined' | 'cancelled' | 'expired'), so the
   *  rail can say which rather than just going grey. Null when open. */
  closed_status: string | null;
  /** A date hold is on this booking right now. Rides alongside the ladder
   *  rather than being a rung of it. */
  hold_live: boolean;
}

/** True when `key` is at or below the reached rung. The one place a caller
 *  should ask "is this step done", so the ladder rule lives here and not in
 *  every renderer. Always false while the lead is closed. */
export function isStageReached(view: BookingStageView, key: BookingStageKey): boolean {
  if (view.closed) return false;
  return BOOKING_STAGES.indexOf(key) <= view.index;
}

/** How far along the ladder each quote state argues the booking is. A vendor
 *  can have several quotes on one inquiry (a revision retires its predecessor),
 *  so the rail has to pick ONE, and the honest pick is the furthest the couple
 *  ever got with any of them: a fresh draft written after they already accepted
 *  the last one does not un-book the job. */
const QUOTE_RANK: Record<QuoteStatus, number> = {
  draft: 0,
  withdrawn: 1,
  expired: 1,
  declined: 1,
  sent: 2,
  viewed: 2,
  accepted: 3,
};

/** The quote status the ladder should read, out of every quote on one booking.
 *  Null for an empty list, which is also what a caller that never fetched them
 *  passes, and the two mean the same thing to `bookingStage`: no evidence. */
export function pickStageQuoteStatus(
  quotes: ReadonlyArray<{ status: QuoteStatus; created_at: UnixMs }>,
): QuoteStatus | null {
  let best: { status: QuoteStatus; created_at: UnixMs } | null = null;
  for (const q of quotes) {
    if (best === null) {
      best = q;
      continue;
    }
    const rank = QUOTE_RANK[q.status] - QUOTE_RANK[best.status];
    if (rank > 0 || (rank === 0 && q.created_at > best.created_at)) best = q;
  }
  return best?.status ?? null;
}

/** How far this booking has got. Total: every input produces exactly one
 *  verdict, and an unknown status lands on `inquiry` rather than throwing,
 *  because a new booking state must never blank a vendor's screen. */
export function bookingStage(facts: BookingStageFacts, nowMs: UnixMs): BookingStageView {
  const holdLive = facts.hold_state === "live";

  if (CLOSED_STATUSES.has(facts.status)) {
    return { key: null, index: -1, closed: true, closed_status: facts.status, hold_live: holdLive };
  }

  const at = (key: BookingStageKey): BookingStageView => ({
    key,
    index: BOOKING_STAGES.indexOf(key),
    closed: false,
    closed_status: null,
    hold_live: holdLive,
  });

  const accepted = facts.quote_status === "accepted";
  const booked = facts.status === "confirmed" || accepted;

  if (booked) {
    // The wedding is behind them. Checked before the deposit rung because it is
    // further along the ladder, and the ladder rule fills in what is under it.
    const days = daysUntilDate(facts.event_date, nowMs);
    if (days !== null && days < 0) return at("done");
    if ((facts.deposit_paid ?? 0) > 0) return at("deposit");
    return at("booked");
  }

  // A price the couple has seen, or a number the vendor wrote down. Either is
  // the same fact from the ladder's point of view: this stopped being a cold
  // inquiry the moment somebody named an amount.
  const quoted =
    (facts.quote_status !== null && QUOTE_SENT_STATES.has(facts.quote_status)) ||
    facts.contract_value !== null;
  if (quoted) return at("quoted");

  return at("inquiry");
}
