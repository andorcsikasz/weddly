// The unified booking timeline: one chronological log per inquiry, readable
// from either side, with the system's own events sitting inline among the
// messages.
//
// EVERY EVENT IS DERIVED. There is no timeline table, and nothing writes an
// event row at a mutation site. Every fact this log renders already has a row
// with a timestamp on it somewhere: a quote's `sent_at` / `accepted_at`, a
// hold's `hold_until` / `released_at`, an installment's `paid_at`, a booking's
// `created_at` / `first_response_at`, a message's `created_at`. The projector
// (`backend/src/domain/booking_timeline.ts`) reads those and merges them.
//
// That is the whole design, and it is a decision this codebase has already paid
// to learn twice. The reminder email kept its own definition of "unfinished
// listing" beside `listingChecklist` and the two disagreed in both directions;
// `supplier_reviews.supplier_id` recorded a vendor id a second way and half the
// reviews landed on a row nobody read. A second recording of the same fact
// drifts from the first, and a drifted history is worse than no history,
// because it is read as evidence. So the derivation is single-sourced and the
// only way to add an event is to point at a stamp that already exists.
//
// The corollary is the honest one: a fact with NO stamp of its own cannot be on
// this timeline at all. The vendor's private notes and their pipeline `stage`
// are exactly that (both live on `supplier_bookings` and move only
// `updated_at`), so neither is projected. Giving them one would mean writing an
// event at the mutation site, which is the thing this module exists not to do.

import type { Currency, UnixMs } from "./types";

/** Who the reader is. Also the audience declaration each event kind carries. */
export type TimelineAudience = "vendor" | "couple";

/** Who did the thing. `system` is Weddly itself: a deadline lapsing, an
 *  automation firing, a status nobody typed. It is deliberately NOT a third
 *  party in the conversation, and a system event is context, never a bubble. */
export type TimelineActor = "vendor" | "couple" | "system";

/** One kind of thing that can happen to a booking.
 *
 *  Adding a kind means adding an entry to `TIMELINE_AUDIENCE` below (a missing
 *  one is a compile error, which is the point), one copy key per locale, and a
 *  branch in the projector that names the STAMP it derives from. */
export type TimelineEventKind =
  /** A message on the thread, either direction. The only kind that renders as a
   *  bubble rather than a quiet line. */
  | "message"
  /** The inquiry itself. Every booking has one, which is what makes a bare
   *  inquiry a one-event timeline rather than an empty screen. */
  | "inquiry_sent"
  /** `supplier_bookings.vendor_seen_at`: the vendor OPENED the lead. */
  | "vendor_opened"
  /** `supplier_bookings.first_response_at`: the vendor's first status change,
   *  write-once, so this stamp is exact. */
  | "vendor_responded"
  | "booking_confirmed"
  | "booking_declined"
  | "booking_cancelled"
  | "booking_expired"
  | "quote_sent"
  /** The couple opened the offer. A read receipt ON the couple. */
  | "quote_viewed"
  | "quote_accepted"
  | "quote_declined"
  /** The vendor pulled the offer back, or a revision retired it. */
  | "quote_withdrawn"
  | "hold_placed"
  | "hold_released"
  /** `hold_until` has passed and nobody released it. Derived against the clock,
   *  so it appears with nothing having run. */
  | "hold_expired"
  /** An installment was put on the schedule. */
  | "payment_scheduled"
  | "payment_paid"
  /** An automation did something that wrote no message (a skip, a proposal).
   *  One that DID write a message is not repeated here: that message is already
   *  on the timeline, flagged `automated`. */
  | "automation_ran";

/**
 * WHO MAY READ EACH KIND. A total map, so a new kind cannot be added without
 * answering the question. The alternative (a deny-list, or "visible unless
 * listed") makes the safe answer the one you get by forgetting, and this
 * payload goes to a couple.
 *
 * `"both"` means the fact was addressed to, or done by, the couple as much as
 * the vendor. `"vendor"` means it is the vendor's own diary and the couple was
 * never told:
 *
 *   * `vendor_opened` is a read receipt the vendor never agreed to publish. The
 *     `vendor_seen` STATUS is the one the couple reads ("Megtekintve"); the
 *     stamp behind this event is only "I have looked at it", which is what the
 *     Ügyfelek badge counts (see the column's note in db.ts).
 *   * `quote_viewed` is the same thing pointing the other way, and a couple's
 *     own log telling them they opened an offer is noise besides.
 *   * A HOLD is a decision inside the vendor's diary, not a promise made in
 *     words. Publishing it would have Weddly commit the vendor to a date they
 *     never named, and, worse, a lapsing hold would then read to the couple
 *     as "they dropped your date", which is a message nobody sent. The vendor
 *     tells the couple about a hold by writing to them, and that message is on
 *     the timeline like any other.
 *   * The payment schedule is the vendor's own money tracking (it is why
 *     accepting a quote deliberately writes no payment row), and it is PRO.
 *   * `automation_ran` is bookkeeping.
 */
export const TIMELINE_AUDIENCE: Record<TimelineEventKind, "both" | "vendor"> = {
  message: "both",
  inquiry_sent: "both",
  vendor_opened: "vendor",
  vendor_responded: "both",
  booking_confirmed: "both",
  booking_declined: "both",
  booking_cancelled: "both",
  booking_expired: "both",
  quote_sent: "both",
  quote_viewed: "vendor",
  quote_accepted: "both",
  quote_declined: "both",
  quote_withdrawn: "both",
  hold_placed: "vendor",
  hold_released: "vendor",
  hold_expired: "vendor",
  payment_scheduled: "vendor",
  payment_paid: "vendor",
  automation_ran: "vendor",
};

/** The one visibility verdict. Every read path goes through it. */
export function isVisibleTo(kind: TimelineEventKind, audience: TimelineAudience): boolean {
  return TIMELINE_AUDIENCE[kind] === "both" || TIMELINE_AUDIENCE[kind] === audience;
}

/** Kinds the couple must never receive. Exported for the test that has to name
 *  them without re-deriving the map. */
export const VENDOR_PRIVATE_KINDS: readonly TimelineEventKind[] = (
  Object.keys(TIMELINE_AUDIENCE) as TimelineEventKind[]
).filter((k) => TIMELINE_AUDIENCE[k] === "vendor");

/**
 * The small typed bag the copy interpolates. Every field is optional because
 * each kind fills only what its sentence needs, and nothing here is free-form:
 * a payload is what the UI renders, not a place to smuggle a record through.
 */
export interface TimelineEventPayload {
  /** `message` only: which `booking_messages` row this event IS, so the panel
   *  renders the bubble it already holds rather than a second copy of the body. */
  message_id?: number;
  /** True when a `vendor_automation_runs` row claims this message. The vendor
   *  must never be surprised by words attributed to them, and the couple gets
   *  the same disclosure an out-of-office carries: the words are the vendor's,
   *  the timing was not. */
  automated?: boolean;
  /** WHOLE units of `currency`, like every amount in the app. */
  amount?: number;
  currency?: Currency;
  /** ISO 'YYYY-MM-DD'. An event date, a due date. */
  date?: string;
  /** A name the vendor or couple typed: a quote title, an installment label. */
  label?: string;
  /** An enum value the copy names: an automation key. Never free text. */
  value?: string;
}

export interface BookingTimelineEvent {
  /** `<kind>:<source row id>`. Unique within one timeline and stable across
   *  reads, so React can key on it and a test can name one. */
  id: string;
  kind: TimelineEventKind;
  at: UnixMs;
  actor: TimelineActor;
  payload: TimelineEventPayload;
}

/** The copy key for a kind. Derived, never written out per event, so a new kind
 *  cannot ship with the wrong sentence attached to it. */
export function timelineCopyKey(kind: TimelineEventKind): string {
  return `booking_timeline.event_${kind}`;
}

/**
 * Merge everything into one chronological list.
 *
 * Sorted by stamp alone, oldest first. Ties KEEP INSERTION ORDER (Array.sort is
 * stable by spec since ES2019), which is what the projector's source ordering
 * is for: an inquiry and the message that carried its text can share a
 * millisecond, and "the inquiry arrived, and here is what it said" is the only
 * reading of that pair that makes sense.
 */
export function sortTimeline(events: BookingTimelineEvent[]): BookingTimelineEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/** Drop everything this audience may not read. The LAST step of every
 *  projection, and the only place the verdict is applied. */
export function filterTimelineFor(
  events: readonly BookingTimelineEvent[],
  audience: TimelineAudience,
): BookingTimelineEvent[] {
  return events.filter((e) => isVisibleTo(e.kind, audience));
}
