// Couple ↔ vendor message thread contract.
//
// A THREAD is anchored on a supplier_bookings row, not on a couple: the same
// couple can reach the same vendor twice (a second inquiry after the first was
// confirmed or declined opens a second booking), and those are two separate
// conversations with two separate event dates. `booking_id` is therefore the
// thread id on both sides of the wire.
//
// Before this module the "conversation" was a single TEXT blob on
// supplier_bookings.notes, follow-ups appended with a "\n\n—\n\n" separator and
// the front trimmed at 8000 chars. That blob is migrated into rows once at
// boot and is no longer written; `inquiry_message` on VendorClientDetail stays
// as the read-only legacy view of it.
//
// DELIVERY STATUS is derived from timestamps, never stored: a `status` column
// and the timestamps it summarises are the same fact recorded twice, and they
// drift. `sent` is the insert, `delivered` is stamped when the RECIPIENT's
// client first fetched the thread, `seen` when the recipient actually had it
// open. Both stamps are first-wins (COALESCE), so re-reading an old thread
// never rewrites history.

import type { UnixMs } from "./types";

/** Who wrote a message. The counterparty is resolved per reader, so a thread
 *  renders from either side without a second query. */
export type MessageSenderKind = "vendor" | "couple";

/** Derived from (created_at, delivered_at, seen_at) by `messageStatus`. Maps to
 *  the one/two/two-highlighted tick ladder in the UI. */
export type MessageDeliveryStatus = "sent" | "delivered" | "seen";

/** A file hanging off one message. `download_url` is an AUTHENTICATED app route,
 *  never a public /uploads URL, these carry contracts and quotes. */
export interface BookingMessageAttachment {
  id: number;
  message_id: number;
  /** Original filename, sanitised for display only. */
  file_name: string;
  /** 'application/pdf' | 'image/jpeg'. */
  mime: string;
  size_bytes: number;
  download_url: string;
}

export interface BookingMessage {
  id: number;
  booking_id: number;
  sender_kind: MessageSenderKind;
  body: string;
  /** Derived, not stored. See the module header. */
  status: MessageDeliveryStatus;
  sent_at: UnixMs;
  delivered_at: UnixMs | null;
  seen_at: UnixMs | null;
  attachments: BookingMessageAttachment[];
}

/** One full conversation, from the READER's point of view. */
export interface BookingThread {
  booking_id: number;
  /** The other party's name: the couple's display name when a vendor reads,
   *  the listing name when a couple reads. */
  counterparty_name: string;
  /** The booking's directory supplier id — the couple's link target for the
   *  vendor's card. Present on both sides (it is the booking's own column); the
   *  vendor already knows their own listing and ignores it. */
  supplier_id: string;
  /** Directory category key of the vendor's card (`photo_video`, …). Null on a
   *  VENDOR's read, whose counterparty is a couple, and null when the listing
   *  no longer resolves in the directory — see `linkableListingCategory`, which
   *  makes non-null double as "there is a card at /app/suppliers/<id> to open". */
  counterparty_category: string | null;
  /** The vendor's published phone, on a COUPLE's read and only once BOTH sides
   *  have written on this thread — see `bookingHasCorrespondence`. Null on a
   *  vendor's read (their counterparty is a couple, not a listing), null while
   *  the vendor has not answered, and null when the listing publishes no
   *  number at all. Non-null is what the thread renders its call affordance
   *  from, so it doubles as "this couple has earned the number". */
  counterparty_phone: string | null;
  /** ISO 'YYYY-MM-DD', or "" when the couple had no date at inquiry time. */
  event_date: string;
  messages: BookingMessage[];
}

/** A row in the couple's list of vendor conversations (/app/vendors inbox). */
export interface CoupleVendorThreadPreview {
  booking_id: number;
  supplier_id: string;
  vendor_name: string;
  event_date: string;
  last_body: string;
  last_at: UnixMs;
  last_sender_kind: MessageSenderKind;
  /** Vendor-written messages this couple has not seen. */
  unread_count: number;
  /** Directory category key of the vendor's card, null when the listing no
   *  longer resolves. Same "non-null means linkable" contract as
   *  `BookingThread.counterparty_category`. */
  vendor_category: string | null;
}

/** A vendor's reusable canned reply. */
export interface VendorMessageTemplate {
  id: number;
  title: string;
  body: string;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export const MESSAGE_BODY_MAX_LEN = 4000;
export const TEMPLATE_TITLE_MAX_LEN = 80;
export const TEMPLATE_BODY_MAX_LEN = 4000;
/** Per vendor account. A canned-reply list past this stops being a shortcut. */
export const TEMPLATES_PER_VENDOR_MAX = 30;

export const MESSAGE_ATTACHMENTS_MAX = 3;
/** Deliberately BELOW the server's 8 MB maxRequestBodySize rather than equal to
 *  it: at 8 MB Bun refuses the request before the handler runs, so the friendly
 *  `file_too_large` 413 could never fire and the vendor would get a bare
 *  connection error instead. Multipart framing eats a few bytes on top, too. */
export const MESSAGE_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;

/** The only two accepted types, keyed by SNIFFED mime, the client's declared
 *  Content-Type is never trusted. JPG and PDF only: a quote and a photo are
 *  what a vendor actually sends. */
export const MESSAGE_ATTACHMENT_EXT: Record<string, "pdf" | "jpg"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
};

/** Template placeholders are LOCALE-INDEPENDENT tokens, deliberately not the
 *  Hungarian {ügyfél_neve} the brief sketched: a template is stored text, so a
 *  vendor who writes one in Hungarian and later flips the interface to English
 *  would be left with placeholders that no longer substitute. The UI shows
 *  localised labels for these keys and inserts the token. */
export const TEMPLATE_VARS = ["client_name", "event_date", "vendor_name"] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

/** Substitute `{client_name}`-style tokens. Unknown tokens are left verbatim
 *  rather than blanked, a vendor who typed `{price}` meant to type it. */
export function applyTemplateVars(
  body: string,
  vars: Partial<Record<TemplateVar, string>>,
): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key as TemplateVar];
    return value === undefined || value === "" ? whole : value;
  });
}

/** The one place the tick ladder is decided. */
export function messageStatus(m: {
  delivered_at: UnixMs | null;
  seen_at: UnixMs | null;
}): MessageDeliveryStatus {
  if (m.seen_at !== null) return "seen";
  if (m.delivered_at !== null) return "delivered";
  return "sent";
}
