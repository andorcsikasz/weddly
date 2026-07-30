// Fan-out for a new message on a booking thread: the in-app signal plus the
// email that reaches whoever is not currently logged in.
//
// DEBOUNCE: a thread is a conversation, and a conversation arrives in bursts.
// If the recipient already has an unseen message from this same sender on this
// thread, we have told them and they have not looked yet, so the in-app signal
// updates (it is a count, it is free) and the email is SKIPPED. Without this,
// four lines typed in a row are four emails, which is how a product teaches
// people to filter it.
//
// Both sends are fire-and-forget: a mail provider hiccup must never fail the
// send that already landed in the database, or the sender retypes a message the
// recipient can already read.

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
