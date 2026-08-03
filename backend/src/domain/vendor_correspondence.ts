// A couple EARNS a vendor's phone number by having a two-way conversation with
// them, and this module is the only place that verdict is spelled out.
//
// The standing rule is that the catalogue carries no contact values and the
// number comes one listing at a time from `/api/suppliers/:id/contact`, against
// a per-user quota (see `withVotes` in routes/suppliers.ts). That is the right
// default for browsing: a couple scrolling 500 cards has no relationship with
// any of them. It is the wrong default the moment a vendor has written back —
// at that point the two parties are already talking, the vendor chose to answer,
// and asking the couple to press "show number" on a card they have been
// corresponding with for a week is a lock on a door that is standing open.
//
// Rules worth not re-deriving:
//
//  - BOTH sides must have written. A couple's inquiry alone is not a
//    relationship, it is an unanswered ask, and handing over the number on the
//    strength of a message the vendor may never have read would make the
//    inquiry form a phone-number dispenser. The vendor's reply is the consent.
//  - The gate is the SENDER KIND, not the message count. `backfillLegacyBookingNotes`
//    synthesises rows from the legacy `supplier_bookings.notes` blob and stamps
//    every one of them `sender_kind:"couple"` on purpose (the blob has no
//    author), so no amount of backfilled history can fabricate the vendor half.
//  - This grants the PHONE and nothing else. The email address has no door at
//    all (owner rule, 2026-07-31) and correspondence is not one: a couple who
//    wants to write already has the thread they are writing in.
//  - It is derived on every read, never stored. Same reason as billing
//    entitlement and `quoteStatus`: a vendor whose thread is purged, or a
//    listing that stops resolving, must stop handing over the number without a
//    sweep having to run first.

import { db } from "../db";
import { resolveSupplierBase } from "./resolve_supplier";

const BOTH_SIDES_WROTE = `EXISTS (SELECT 1 FROM booking_messages m
                                   WHERE m.booking_id = b.id AND m.sender_kind = 'couple')
                          AND EXISTS (SELECT 1 FROM booking_messages m
                                       WHERE m.booking_id = b.id AND m.sender_kind = 'vendor')`;

/** Every directory listing this couple has a two-way correspondence with.
 *
 *  One query for the whole catalogue render, mirroring `clientSignalsForBookings`
 *  on the vendor side: the alternative is a message lookup per card, and the
 *  catalogue is the one response where that cost is multiplied by a thousand. */
export function correspondingListingIds(coupleId: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT b.supplier_id AS supplier_id
         FROM supplier_bookings b
        WHERE b.couple_id = ? AND ${BOTH_SIDES_WROTE}`,
    )
    .all(coupleId) as { supplier_id: string }[];
  return new Set(rows.map((r) => r.supplier_id));
}

/** The single-listing form, for a surface that already knows which vendor it is
 *  asking about (the message thread). Same verdict as the set above. */
export function hasCorrespondence(coupleId: number, supplierId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
         FROM supplier_bookings b
        WHERE b.couple_id = ? AND b.supplier_id = ? AND ${BOTH_SIDES_WROTE}
        LIMIT 1`,
    )
    .get(coupleId, supplierId) as { ok: number } | null;
  // Truthiness, not `!== undefined`: bun:sqlite answers a no-match `get()` with
  // NULL, so an identity check against undefined is true for every booking.
  return Boolean(row);
}

/** True once both sides have written on THIS booking specifically.
 *
 *  The thread asks this rather than `hasCorrespondence` so the number appears
 *  against the conversation that earned it: a couple with two inquiries to one
 *  vendor (a second event, a re-quote) should not see an answered thread's
 *  number sitting on top of one the vendor has ignored. */
export function bookingHasCorrespondence(bookingId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
         FROM supplier_bookings b
        WHERE b.id = ? AND ${BOTH_SIDES_WROTE}
        LIMIT 1`,
    )
    .get(bookingId) as { ok: number } | null;
  return Boolean(row);
}

/** WHICH number a listing hands over, in one place.
 *
 *  A listing can publish two lines and the couple wants a number, not a choice
 *  between two of them, so the primary wins and the alternate is the fallback —
 *  the same resolution the `PhoneReveal` button has always made client-side.
 *  `resolveSupplierBase` accepts every id shape a booking can carry (curated
 *  slug, `c{N}`, `v{N}`, pretty share form) and returns null for a listing that
 *  has since been hidden or removed, which correctly yields no number. */
export function publishedPhone(supplierId: string): string | null {
  const base = resolveSupplierBase(supplierId);
  if (!base) return null;
  return base.contact_phone || base.contact_phone_alt || null;
}

/** The thread's answer: the vendor's number once THIS conversation has run both
 *  ways, and null every other time. */
export function earnedBookingPhone(bookingId: number, supplierId: string): string | null {
  return bookingHasCorrespondence(bookingId) ? publishedPhone(supplierId) : null;
}
