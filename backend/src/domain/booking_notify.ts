// Fan-out for what happens on a booking thread, a new message and a priced
// quote: the in-app signal plus the email that reaches whoever is not
// currently logged in.
//
// DEBOUNCE, and it belongs to the MESSAGE pair only: a thread is a
// conversation, and a conversation arrives in bursts.
// If the recipient already has an unseen message from this same sender on this
// thread, we have told them and they have not looked yet, so the in-app signal
// updates (it is a count, it is free) and the email is SKIPPED. Without this,
// four lines typed in a row are four emails, which is how a product teaches
// people to filter it. A quote is deliberately outside it (see
// `notifyCoupleOfVendorQuote`).
//
// Every send here is fire-and-forget: a mail provider hiccup must never fail
// the write that already landed in the database, or the sender retypes a
// message the recipient can already read, and a vendor's quote fails to save
// because Resend was slow.

import type { BookingQuote } from "@shared/booking_quotes";
import { db } from "../db";
import { log } from "../lib/logger";
import { sendKind } from "./emails/send";
import { insertCoupleNotification } from "./notifications";
import type { BookingRow } from "./supplier_bookings";

/** Unseen messages from `senderKind` on this thread, excluding the one just
 *  inserted. Non-zero means the recipient has been notified already. */
function pendingUnseenBefore(bookingId: number, senderKind: string, messageId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM booking_messages
        WHERE booking_id = ? AND sender_kind = ? AND seen_at IS NULL AND id != ?`,
    )
    .get(bookingId, senderKind, messageId) as { n: number };
  return row.n;
}

/** The couple workspace owner, the address the inquiry was sent from, so the
 *  address the vendor's answer belongs at. */
function coupleOwner(
  coupleId: number,
): { id: number; email: string; full_name: string } | undefined {
  return db
    .prepare(
      `SELECT u.id AS id, u.email AS email, COALESCE(u.full_name, '') AS full_name
         FROM couples c JOIN users u ON u.id = c.partner_a_id
        WHERE c.id = ?`,
    )
    .get(coupleId) as { id: number; email: string; full_name: string } | undefined;
}

function vendorOwner(
  vendorAccountId: number,
): { id: number; email: string; full_name: string } | undefined {
  return db
    .prepare(
      `SELECT u.id AS id, u.email AS email, COALESCE(u.full_name, '') AS full_name
         FROM vendor_accounts v JOIN users u ON u.id = v.owner_user_id
        WHERE v.id = ?`,
    )
    .get(vendorAccountId) as { id: number; email: string; full_name: string } | undefined;
}

/** Vendor wrote to the couple: bell row + email. */
export function notifyCoupleOfVendorMessage(args: {
  booking: BookingRow;
  messageId: number;
  body: string;
  vendorName: string;
  attachmentCount: number;
}): void {
  const { booking } = args;
  if (pendingUnseenBefore(booking.id, "vendor", args.messageId) > 0) return;

  insertCoupleNotification({
    couple_id: booking.couple_id,
    kind: "vendor_message",
    data: { vendorName: args.vendorName },
    link: `/app/messages/${booking.id}`,
  });

  const owner = coupleOwner(booking.couple_id);
  if (!owner) return;
  void sendKind(
    "vendor_message",
    {
      vendorName: args.vendorName,
      bodyText: args.body,
      attachmentCount: args.attachmentCount,
      threadUrl: `/app/messages/${booking.id}`,
    },
    { user: owner, couple_id: booking.couple_id },
  ).catch((e) => log.error("booking_message.couple_mail_failed", e, { booking_id: booking.id }));
}

/** Couple wrote to the vendor: email only. The vendor's unread count comes off
 *  booking_messages directly (VendorStats.unread_messages), so there is no
 *  stored notification row to write, there is no vendor notification table,
 *  and the bell has always derived its counters from stats. */
export function notifyVendorOfCoupleMessage(args: {
  booking: BookingRow;
  messageId: number;
  body: string;
  coupleName: string;
}): void {
  const { booking } = args;
  if (booking.vendor_account_id === null) return;
  if (pendingUnseenBefore(booking.id, "couple", args.messageId) > 0) return;

  const owner = vendorOwner(booking.vendor_account_id);
  if (!owner) return;
  void sendKind(
    "couple_message",
    {
      coupleName: args.coupleName,
      bodyText: args.body,
      threadUrl: `/vendor/clients/${booking.id}`,
    },
    { user: owner, couple_id: booking.couple_id },
  ).catch((e) => log.error("booking_message.vendor_mail_failed", e, { booking_id: booking.id }));
}

/** Vendor priced the inquiry: bell row + email to the couple.
 *
 *  NO BURST DEBOUNCE HERE, on purpose. `pendingUnseenBefore` exists because
 *  four lines typed in a row are one conversation, and telling somebody about
 *  it four times is how a product teaches people to filter it. A second QUOTE
 *  is not the next line of anything: it is a new commercial offer, with its own
 *  number and its own deadline, and the previous one has been retired to send
 *  it. A couple who is never told the price changed is answering a question
 *  nobody asked them, so every quote is announced.
 *
 *  `totalText` arrives ALREADY FORMATTED from the call site, which is the only
 *  place that knows the workspace's currency and the recipient's locale, so
 *  neither this function nor the template does currency math. */
export function notifyCoupleOfVendorQuote(args: {
  booking: BookingRow;
  quote: BookingQuote;
  vendorName: string;
  totalText: string;
  quoteUrl: string;
}): void {
  const { booking, quote } = args;

  insertCoupleNotification({
    couple_id: booking.couple_id,
    kind: "vendor_quote",
    data: { vendorName: args.vendorName, title: quote.title },
    link: `/app/messages/${booking.id}`,
  });

  const owner = coupleOwner(booking.couple_id);
  if (!owner) return;
  void sendKind(
    "vendor_quote",
    {
      vendorName: args.vendorName,
      title: quote.title,
      totalText: args.totalText,
      validUntil: quote.valid_until,
      quoteUrl: args.quoteUrl,
    },
    { user: owner, couple_id: booking.couple_id },
  ).catch((e) =>
    log.error("booking_quote.couple_mail_failed", e, {
      booking_id: booking.id,
      quote_id: quote.id,
    }),
  );
}

/** Couple answered the offer: email only, for the same reason
 *  `notifyVendorOfCoupleMessage` is email only, there is no vendor
 *  notification table and the vendor's own counters come off the rows.
 *
 *  Anything other than `accepted` is mailed as a decline. The status is derived
 *  (`quoteStatus`), so a quote that was answered any other way, withdrawn or
 *  expired under the couple's hand, is still news the vendor has to hear, and
 *  "they did not take it" is true of every one of those. */
export function notifyVendorOfQuoteResponse(args: {
  booking: BookingRow;
  quote: BookingQuote;
  coupleName: string;
  totalText: string;
  quoteUrl: string;
}): void {
  const { booking, quote } = args;
  if (booking.vendor_account_id === null) return;

  const owner = vendorOwner(booking.vendor_account_id);
  if (!owner) return;
  const accepted = quote.status === "accepted";
  void sendKind(
    "quote_response",
    {
      coupleName: args.coupleName,
      title: quote.title,
      totalText: args.totalText,
      accepted,
      declineReason: accepted ? null : quote.decline_reason,
      quoteUrl: args.quoteUrl,
    },
    { user: owner, couple_id: booking.couple_id },
  ).catch((e) =>
    log.error("booking_quote.vendor_mail_failed", e, {
      booking_id: booking.id,
      quote_id: quote.id,
    }),
  );
}
