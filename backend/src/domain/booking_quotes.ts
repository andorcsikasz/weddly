// Vendor quotes (árajánlat) — the priced offer a vendor makes against ONE
// inquiry, and the couple's answer to it.
//
// The contract, and the reasoning behind deriving the status rather than
// storing it, lives in shared/booking_quotes.ts. What this module owns is the
// invariants that a route cannot be trusted to remember:
//
//   * ONE live quote per inquiry. Sending a revision withdraws the number the
//     couple was looking at, because two live offers on one date is how a
//     vendor ends up honouring the cheaper one by accident.
//   * A SENT quote is frozen. Editing is a draft-only operation; changing an
//     offer somebody has already read is not an edit, it is a new offer, and
//     the couple has to see that it changed.
//   * Accepting is the ONLY thing that writes `contract_value`, and it also
//     confirms the booking. An accepted price with an unconfirmed date would
//     leave the vendor's calendar free for someone else to take.
//
// Every amount is a whole unit of the quote's currency (see `formatMoney`).

import {
  type BookingQuote,
  isQuoteAnswerable,
  isQuoteLive,
  type QuoteLine,
  type QuoteLineInput,
  type QuoteStatus,
  quoteStatus,
  quoteTotal,
} from "@shared/booking_quotes";
import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { type BookingRow, getBookingById, updateBookingStatus } from "./supplier_bookings";

export interface QuoteRow {
  id: number;
  booking_id: number;
  vendor_account_id: number | null;
  currency: string;
  title: string;
  message: string | null;
  valid_until: string | null;
  deposit_amount: number | null;
  sent_at: number | null;
  viewed_at: number | null;
  accepted_at: number | null;
  declined_at: number | null;
  withdrawn_at: number | null;
  decline_reason: string | null;
  created_at: number;
  updated_at: number;
}

interface LineRow {
  id: number;
  quote_id: number;
  label: string;
  unit_amount: number;
  qty: number;
  sort_order: number;
}

/** Today's CIVIL date in the deployment's timezone. Deliberately not
 *  `toISOString().slice(0, 10)`, which reports the UTC date and so expires a
 *  vendor's offer a day early for most of the evening east of Greenwich. Same
 *  reasoning as `nextAvailableDate`. */
export function todayIso(at: number = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLine(row: LineRow): QuoteLine {
  return {
    id: row.id,
    label: row.label,
    unit_amount: row.unit_amount,
    qty: row.qty,
    sort_order: row.sort_order,
  };
}

function toQuote(row: QuoteRow, lines: QuoteLine[], today: string): BookingQuote {
  return {
    id: row.id,
    booking_id: row.booking_id,
    currency: row.currency as Currency,
    title: row.title,
    message: row.message,
    valid_until: row.valid_until,
    deposit_amount: row.deposit_amount,
    lines,
    total: quoteTotal(lines),
    status: quoteStatus(row, today),
    sent_at: row.sent_at,
    viewed_at: row.viewed_at,
    accepted_at: row.accepted_at,
    declined_at: row.declined_at,
    withdrawn_at: row.withdrawn_at,
    decline_reason: row.decline_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function linesFor(quoteId: number): QuoteLine[] {
  return (
    db
      .prepare(
        `SELECT id, quote_id, label, unit_amount, qty, sort_order FROM booking_quote_lines
          WHERE quote_id = ? ORDER BY sort_order ASC, id ASC`,
      )
      .all(quoteId) as LineRow[]
  ).map(toLine);
}

export function getQuoteRow(quoteId: number): QuoteRow | null {
  const row = db.prepare("SELECT * FROM booking_quotes WHERE id = ?").get(quoteId) as
    | QuoteRow
    | undefined;
  return row ?? null;
}

/** Hydrate one row. Exported because every mutation ends by returning the fresh
 *  quote, and they should all agree about how it is built. */
export function hydrateQuote(row: QuoteRow, at: number = Date.now()): BookingQuote {
  return toQuote(row, linesFor(row.id), todayIso(at));
}

export function statusOf(row: QuoteRow, at: number = Date.now()): QuoteStatus {
  return quoteStatus(row, todayIso(at));
}

/** One inquiry's quotes, newest first. Both sides read this; the couple's route
 *  filters the drafts out, because a draft is the vendor thinking aloud. */
export function listQuotesForBooking(bookingId: number, at: number = Date.now()): BookingQuote[] {
  const rows = db
    .prepare("SELECT * FROM booking_quotes WHERE booking_id = ? ORDER BY created_at DESC, id DESC")
    .all(bookingId) as QuoteRow[];
  const today = todayIso(at);
  return rows.map((r) => toQuote(r, linesFor(r.id), today));
}

/** The quote plus the inquiry it belongs to, for the ownership checks both
 *  sides run. Returns null rather than throwing so each caller picks its own
 *  status code (both of them 404, so an id cannot be probed). */
export function getQuoteWithBooking(
  quoteId: number,
): { quote: QuoteRow; booking: BookingRow } | null {
  const quote = getQuoteRow(quoteId);
  if (quote === null) return null;
  const booking = getBookingById(quote.booking_id);
  if (booking === null) return null;
  return { quote, booking };
}

function writeLines(quoteId: number, lines: readonly QuoteLineInput[]): void {
  db.prepare("DELETE FROM booking_quote_lines WHERE quote_id = ?").run(quoteId);
  const insert = db.prepare(
    `INSERT INTO booking_quote_lines (quote_id, label, unit_amount, qty, sort_order)
      VALUES (?, ?, ?, ?, ?)`,
  );
  lines.forEach((line, i) => {
    insert.run(quoteId, line.label, line.unit_amount, line.qty, i);
  });
}

export interface CreateQuoteArgs {
  bookingId: number;
  vendorAccountId: number | null;
  currency: Currency;
  title: string;
  message: string | null;
  validUntil: string | null;
  depositAmount: number | null;
  lines: readonly QuoteLineInput[];
  at?: number;
}

/** Write a DRAFT. Nothing reaches the couple until `sendQuote`, which is what
 *  lets a vendor build an itemised offer over several sittings. */
export function createQuote(args: CreateQuoteArgs): BookingQuote {
  const ts = args.at ?? now();
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO booking_quotes
           (booking_id, vendor_account_id, currency, title, message, valid_until,
            deposit_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.bookingId,
        args.vendorAccountId,
        args.currency,
        args.title,
        args.message,
        args.validUntil,
        args.depositAmount,
        ts,
        ts,
      );
    const quoteId = Number(info.lastInsertRowid);
    writeLines(quoteId, args.lines);
    return quoteId;
  })();
  const row = getQuoteRow(id);
  if (row === null) throw new HttpError(500, "Quote insert failed");
  return hydrateQuote(row, ts);
}

export interface UpdateQuoteInput {
  title?: string;
  message?: string | null;
  validUntil?: string | null;
  depositAmount?: number | null;
  lines?: readonly QuoteLineInput[];
}

/** Partial patch of a DRAFT: an absent key means "leave it alone", the same
 *  contract the admin listing editor uses. Refuses anything already sent,
 *  because the couple has seen that number. */
export function updateQuoteDraft(
  row: QuoteRow,
  patch: UpdateQuoteInput,
  at: number = Date.now(),
): BookingQuote {
  if (statusOf(row, at) !== "draft") {
    throw new HttpError(409, "Only a draft can be edited", { code: "quote_not_draft" });
  }
  const ts = now();
  db.transaction(() => {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.message !== undefined) {
      sets.push("message = ?");
      values.push(patch.message);
    }
    if (patch.validUntil !== undefined) {
      sets.push("valid_until = ?");
      values.push(patch.validUntil);
    }
    if (patch.depositAmount !== undefined) {
      sets.push("deposit_amount = ?");
      values.push(patch.depositAmount);
    }
    sets.push("updated_at = ?");
    values.push(ts);
    db.prepare(`UPDATE booking_quotes SET ${sets.join(", ")} WHERE id = ?`).run(...values, row.id);
    if (patch.lines !== undefined) writeLines(row.id, patch.lines);
  })();
  const fresh = getQuoteRow(row.id);
  if (fresh === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  return hydrateQuote(fresh, at);
}

/** Send it. Any other live quote on the same inquiry is withdrawn in the SAME
 *  transaction, so the couple is never looking at two live prices for one
 *  wedding. */
export function sendQuote(row: QuoteRow, at: number = Date.now()): BookingQuote {
  const status = statusOf(row, at);
  if (status !== "draft") {
    throw new HttpError(409, "Only a draft can be sent", { code: "quote_not_draft" });
  }
  const ts = now();
  const today = todayIso(at);
  db.transaction(() => {
    const siblings = db
      .prepare("SELECT * FROM booking_quotes WHERE booking_id = ? AND id != ?")
      .all(row.booking_id, row.id) as QuoteRow[];
    for (const other of siblings) {
      if (!isQuoteLive(quoteStatus(other, today))) continue;
      db.prepare("UPDATE booking_quotes SET withdrawn_at = ?, updated_at = ? WHERE id = ?").run(
        ts,
        ts,
        other.id,
      );
    }
    db.prepare("UPDATE booking_quotes SET sent_at = ?, updated_at = ? WHERE id = ?").run(
      ts,
      ts,
      row.id,
    );
  })();
  const fresh = getQuoteRow(row.id);
  if (fresh === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  return hydrateQuote(fresh, at);
}

/** Pull a live offer back. An answered one stays answered: withdrawing a quote
 *  the couple already accepted would erase their side of the agreement. */
export function withdrawQuote(row: QuoteRow, at: number = Date.now()): BookingQuote {
  const status = statusOf(row, at);
  if (status === "accepted" || status === "declined") {
    throw new HttpError(409, "This quote has already been answered", {
      code: "quote_already_answered",
    });
  }
  const ts = now();
  db.prepare("UPDATE booking_quotes SET withdrawn_at = ?, updated_at = ? WHERE id = ?").run(
    ts,
    ts,
    row.id,
  );
  const fresh = getQuoteRow(row.id);
  if (fresh === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  return hydrateQuote(fresh, at);
}

/** Drafts only. A sent quote is part of the record between two parties, so it
 *  is withdrawn rather than deleted. */
export function deleteQuote(row: QuoteRow, at: number = Date.now()): void {
  if (statusOf(row, at) !== "draft") {
    throw new HttpError(409, "Only a draft can be deleted", { code: "quote_not_draft" });
  }
  db.prepare("DELETE FROM booking_quotes WHERE id = ?").run(row.id);
}

/** First-wins, and only while the offer is still open. Stamped when the couple
 *  loads the thread, exactly like message delivery: it records that the payload
 *  was served, which is the most anyone can honestly claim. */
export function markQuoteViewed(row: QuoteRow, at: number = Date.now()): void {
  if (row.viewed_at !== null) return;
  if (!isQuoteAnswerable(statusOf(row, at))) return;
  db.prepare("UPDATE booking_quotes SET viewed_at = ? WHERE id = ?").run(now(), row.id);
}

/** Stamp every offer on this inquiry that the couple can still answer. Called
 *  when they load the thread, which is the moment the payload actually reaches
 *  them. One pass over the rows, so a thread with three revisions is one query
 *  plus at most three tiny updates. */
export function markThreadQuotesViewed(bookingId: number, at: number = Date.now()): void {
  const rows = db
    .prepare("SELECT * FROM booking_quotes WHERE booking_id = ? AND viewed_at IS NULL")
    .all(bookingId) as QuoteRow[];
  for (const row of rows) markQuoteViewed(row, at);
}

/** The couple says yes. Three things happen and they belong together:
 *
 *   1. the quote is stamped and every sibling offer is withdrawn,
 *   2. the inquiry's `contract_value` becomes the accepted total, which is what
 *      finally puts a number in the vendor's CRM and in "Revenue tracked",
 *   3. the booking is CONFIRMED, so the date leaves the vendor's free calendar.
 *
 *  Step 3 goes through `updateBookingStatus` rather than a bare UPDATE, because
 *  that is the path that stamps `first_response_at` and emits the vendor-points
 *  events. It runs after the transaction commits: it writes to the points
 *  outbox, and an accepted quote must not be rolled back by a gamification
 *  hiccup. */
export function acceptQuote(row: QuoteRow, at: number = Date.now()): BookingQuote {
  const status = statusOf(row, at);
  if (!isQuoteAnswerable(status)) {
    throw new HttpError(409, "This quote can no longer be answered", {
      code: "quote_not_answerable",
    });
  }
  const ts = now();
  const today = todayIso(at);
  const total = quoteTotal(linesFor(row.id));
  db.transaction(() => {
    const siblings = db
      .prepare("SELECT * FROM booking_quotes WHERE booking_id = ? AND id != ?")
      .all(row.booking_id, row.id) as QuoteRow[];
    for (const other of siblings) {
      if (!isQuoteLive(quoteStatus(other, today))) continue;
      db.prepare("UPDATE booking_quotes SET withdrawn_at = ?, updated_at = ? WHERE id = ?").run(
        ts,
        ts,
        other.id,
      );
    }
    db.prepare("UPDATE booking_quotes SET accepted_at = ?, updated_at = ? WHERE id = ?").run(
      ts,
      ts,
      row.id,
    );
    db.prepare("UPDATE supplier_bookings SET contract_value = ?, updated_at = ? WHERE id = ?").run(
      total,
      ts,
      row.booking_id,
    );
  })();
  updateBookingStatus(row.booking_id, "confirmed");
  const fresh = getQuoteRow(row.id);
  if (fresh === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  return hydrateQuote(fresh, at);
}

/** The couple says no. The reason is optional and is the vendor's only way to
 *  learn why, which is the difference between a lost lead and a lesson. The
 *  booking's own status is deliberately left alone: a declined price is not a
 *  declined conversation, and the couple may well come back with a question. */
export function declineQuote(
  row: QuoteRow,
  reason: string | null,
  at: number = Date.now(),
): BookingQuote {
  if (!isQuoteAnswerable(statusOf(row, at))) {
    throw new HttpError(409, "This quote can no longer be answered", {
      code: "quote_not_answerable",
    });
  }
  const ts = now();
  db.prepare(
    "UPDATE booking_quotes SET declined_at = ?, decline_reason = ?, updated_at = ? WHERE id = ?",
  ).run(ts, reason, ts, row.id);
  const fresh = getQuoteRow(row.id);
  if (fresh === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  return hydrateQuote(fresh, at);
}
