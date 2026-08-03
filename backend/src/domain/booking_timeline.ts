// The projector behind the unified booking timeline.
//
// The contract, and the reasoning for deriving every event rather than logging
// it, lives in `shared/booking_timeline.ts`. What this module owns is the SQL:
// one function per source table, each naming the stamp it reads, and one merge.
//
// Rules worth not re-deriving:
//
//   * NOTHING here writes. This module is a read of five tables the app already
//     keeps, and it must stay that way. The moment a mutation site starts
//     recording an event, there are two histories and they begin to disagree.
//
//   * The AUDIENCE FILTER IS THE LAST STEP, always, and it is the shared
//     `filterTimelineFor`. Every source is gathered whatever the reader is, so
//     a query that quietly stops running can never be mistaken for a privacy
//     rule; the one gate is the map in the shared module.
//
//   * `supplier_bookings` keeps NO per-status stamp. `first_response_at` is
//     write-once, so the vendor's FIRST reaction is exact; a terminal status
//     (confirmed / declined / cancelled) has only `updated_at`, i.e. the last
//     time anything on the row moved. That is the honest ceiling available, and
//     it is deliberately preferred to the alternatives: a per-status column is a
//     schema change, and an event row written at the mutation site is the
//     failure this whole feature is built to avoid. The one case we can do
//     better on is an ACCEPTED QUOTE, because accepting is what confirms the
//     booking (`acceptQuote` calls `updateBookingStatus` in the same
//     transaction), so `accepted_at` IS the confirmation moment and is used in
//     preference. If a per-status stamp ever lands, `bookingEvents` is the one
//     function that changes.

import {
  type BookingTimelineEvent,
  type TimelineAudience,
  type TimelineEventKind,
  filterTimelineFor,
  sortTimeline,
} from "@shared/booking_timeline";
import { quoteTotal } from "@shared/booking_quotes";
import { holdState } from "@shared/date_holds";
import type { Currency } from "@shared/types";
import { db } from "../db";
import type { BookingRow } from "./supplier_bookings";

/** The additive CRM columns are not on `BookingRow` (they are added by
 *  `addColumnIfMissing` in db.ts), so they are read off a widened row, the same
 *  way `vendor_clients.ts` reads `vendor_seen_at`. */
type TimelineBookingRow = BookingRow & {
  first_response_at?: number | null;
  vendor_seen_at?: number | null;
};

interface MessageEventRow {
  id: number;
  sender_kind: string;
  created_at: number;
  /** 1 when a `vendor_automation_runs` row claims this message. */
  automated: number;
}

interface QuoteEventRow {
  id: number;
  currency: string;
  title: string;
  sent_at: number | null;
  viewed_at: number | null;
  accepted_at: number | null;
  declined_at: number | null;
  withdrawn_at: number | null;
}

interface HoldEventRow {
  id: number;
  event_date: string;
  hold_until: number;
  released_at: number | null;
  created_at: number;
}

interface PaymentEventRow {
  id: number;
  label: string | null;
  amount: number;
  currency: string;
  due_date: string | null;
  paid: number;
  paid_at: number | null;
  created_at: number;
}

interface AutomationEventRow {
  id: number;
  automation_key: string;
  created_at: number;
}

function event(
  kind: TimelineEventKind,
  sourceId: number,
  at: number,
  actor: BookingTimelineEvent["actor"],
  payload: BookingTimelineEvent["payload"] = {},
): BookingTimelineEvent {
  return { id: `${kind}:${sourceId}`, kind, at, actor, payload };
}

/** The booking's own four stamps. See the module header for why a terminal
 *  status is timestamped the way it is. */
function bookingEvents(
  booking: TimelineBookingRow,
  confirmedAt: number | null,
): BookingTimelineEvent[] {
  const out: BookingTimelineEvent[] = [];
  // Always first, and always present: an inquiry with nothing else on it is a
  // one-event timeline rather than an empty panel.
  out.push(
    event("inquiry_sent", booking.id, booking.created_at, "couple", {
      date: booking.event_date,
    }),
  );
  const seenAt = booking.vendor_seen_at ?? null;
  if (seenAt !== null) out.push(event("vendor_opened", booking.id, seenAt, "vendor"));
  const respondedAt = booking.first_response_at ?? null;
  if (respondedAt !== null) out.push(event("vendor_responded", booking.id, respondedAt, "vendor"));

  switch (booking.status) {
    case "confirmed":
      out.push(event("booking_confirmed", booking.id, confirmedAt ?? booking.updated_at, "vendor"));
      break;
    case "declined":
      out.push(event("booking_declined", booking.id, booking.updated_at, "vendor"));
      break;
    case "cancelled":
      out.push(event("booking_cancelled", booking.id, booking.updated_at, "vendor"));
      break;
    case "expired":
      // Nobody types this one: it is a deadline passing, so the actor is us.
      out.push(event("booking_expired", booking.id, booking.updated_at, "system"));
      break;
    default:
      // 'requested' / 'vendor_seen' are not a change worth a line of their own:
      // the first is how an inquiry arrives, the second is already carried by
      // `vendor_responded` above, which has an exact stamp.
      break;
  }
  return out;
}

/** One row per message, carrying only the id: the panel already holds the
 *  bodies and attachments, and a second copy on the wire would be the same text
 *  twice in one payload. */
function messageEvents(bookingId: number): BookingTimelineEvent[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_kind AS sender_kind, m.created_at AS created_at,
              EXISTS(SELECT 1 FROM vendor_automation_runs r WHERE r.message_id = m.id) AS automated
         FROM booking_messages m
        WHERE m.booking_id = ?
        ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all(bookingId) as MessageEventRow[];
  return rows.map((r) =>
    event("message", r.id, r.created_at, r.sender_kind === "vendor" ? "vendor" : "couple", {
      message_id: r.id,
      automated: r.automated === 1,
    }),
  );
}

/** Every quote stamp that actually happened. A draft has none of them and so
 *  contributes nothing, which is right: a draft is the vendor thinking aloud
 *  and the couple has not been shown it. */
function quoteEvents(bookingId: number): {
  events: BookingTimelineEvent[];
  acceptedAt: number | null;
} {
  const rows = db
    .prepare(
      `SELECT id, currency, title, sent_at, viewed_at, accepted_at, declined_at, withdrawn_at
         FROM booking_quotes WHERE booking_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(bookingId) as QuoteEventRow[];
  if (rows.length === 0) return { events: [], acceptedAt: null };

  // Totals through `quoteTotal`, never a SQL SUM: the quote's arithmetic has
  // exactly one definition and this is not a second one.
  const lineRows = db
    .prepare(
      `SELECT l.quote_id AS quote_id, l.unit_amount AS unit_amount, l.qty AS qty
         FROM booking_quote_lines l
         JOIN booking_quotes q ON q.id = l.quote_id
        WHERE q.booking_id = ?`,
    )
    .all(bookingId) as { quote_id: number; unit_amount: number; qty: number }[];
  const linesByQuote = new Map<number, { unit_amount: number; qty: number }[]>();
  for (const l of lineRows) {
    const list = linesByQuote.get(l.quote_id) ?? [];
    list.push({ unit_amount: l.unit_amount, qty: l.qty });
    linesByQuote.set(l.quote_id, list);
  }

  const events: BookingTimelineEvent[] = [];
  let acceptedAt: number | null = null;
  for (const row of rows) {
    const money = {
      amount: quoteTotal(linesByQuote.get(row.id) ?? []),
      currency: row.currency as Currency,
      label: row.title,
    };
    if (row.sent_at !== null)
      events.push(event("quote_sent", row.id, row.sent_at, "vendor", money));
    if (row.viewed_at !== null) {
      events.push(event("quote_viewed", row.id, row.viewed_at, "couple", money));
    }
    if (row.accepted_at !== null) {
      events.push(event("quote_accepted", row.id, row.accepted_at, "couple", money));
      // Newest acceptance wins: it is the one that confirmed the booking.
      if (acceptedAt === null || row.accepted_at > acceptedAt) acceptedAt = row.accepted_at;
    }
    if (row.declined_at !== null) {
      events.push(event("quote_declined", row.id, row.declined_at, "couple", money));
    }
    if (row.withdrawn_at !== null) {
      events.push(event("quote_withdrawn", row.id, row.withdrawn_at, "vendor", money));
    }
  }
  return { events, acceptedAt };
}

/** The hold is ONE row per booking, and its three events come out of the same
 *  two columns everything else derives its state from. `hold_expired` needs
 *  nothing to have run: the deadline simply passed and the read says so. */
function holdEvents(bookingId: number, at: number): BookingTimelineEvent[] {
  const row = db
    .prepare(
      "SELECT id, event_date, hold_until, released_at, created_at FROM booking_date_holds WHERE booking_id = ?",
    )
    .get(bookingId) as HoldEventRow | undefined;
  if (!row) return [];
  const out: BookingTimelineEvent[] = [
    event("hold_placed", row.id, row.created_at, "vendor", { date: row.event_date }),
  ];
  const state = holdState({ hold_until: row.hold_until, released_at: row.released_at }, at);
  if (state === "released" && row.released_at !== null) {
    out.push(event("hold_released", row.id, row.released_at, "vendor", { date: row.event_date }));
  } else if (state === "expired") {
    out.push(event("hold_expired", row.id, row.hold_until, "system", { date: row.event_date }));
  }
  return out;
}

/** The vendor's own money tracking. Two stamps per installment: when it went on
 *  the schedule, and when it was marked paid. */
function paymentEvents(bookingId: number): BookingTimelineEvent[] {
  const rows = db
    .prepare(
      `SELECT id, label, amount, currency, due_date, paid, paid_at, created_at
         FROM vendor_client_payments WHERE booking_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(bookingId) as PaymentEventRow[];
  const out: BookingTimelineEvent[] = [];
  for (const row of rows) {
    const money = {
      amount: row.amount,
      currency: row.currency as Currency,
      label: row.label ?? "",
    };
    out.push(
      event("payment_scheduled", row.id, row.created_at, "vendor", {
        ...money,
        ...(row.due_date === null ? {} : { date: row.due_date }),
      }),
    );
    if (row.paid === 1 && row.paid_at !== null) {
      out.push(event("payment_paid", row.id, row.paid_at, "vendor", money));
    }
  }
  return out;
}

/** Automation bookkeeping: the runs that wrote NO message. One that did is
 *  already on the timeline as that message, flagged `automated`, and a second
 *  line about it would be the same fact twice. */
function automationEvents(bookingId: number): BookingTimelineEvent[] {
  const rows = db
    .prepare(
      `SELECT id, automation_key, created_at FROM vendor_automation_runs
        WHERE booking_id = ? AND message_id IS NULL
        ORDER BY created_at ASC, id ASC`,
    )
    .all(bookingId) as AutomationEventRow[];
  return rows.map((r) =>
    event("automation_ran", r.id, r.created_at, "system", { value: r.automation_key }),
  );
}

/**
 * The whole log for one booking, from ONE reader's point of view.
 *
 * Sources are pushed in a fixed order (booking, messages, quotes, holds,
 * payments, automations) and the sort is stable, so two events sharing a
 * millisecond keep that order: an inquiry lands before the message that carried
 * its text, which is the only reading of that pair that makes sense.
 */
export function buildBookingTimeline(args: {
  booking: BookingRow;
  audience: TimelineAudience;
  at?: number;
}): BookingTimelineEvent[] {
  const at = args.at ?? Date.now();
  const bookingId = args.booking.id;
  const quotes = quoteEvents(bookingId);
  const all = [
    ...bookingEvents(args.booking as TimelineBookingRow, quotes.acceptedAt),
    ...messageEvents(bookingId),
    ...quotes.events,
    ...holdEvents(bookingId, at),
    ...paymentEvents(bookingId),
    ...automationEvents(bookingId),
  ];
  // Filter LAST, and through the shared verdict. See the module header.
  return filterTimelineFor(sortTimeline(all), args.audience);
}
