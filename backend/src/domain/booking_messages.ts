// Couple ↔ vendor message threads, anchored on a supplier_bookings row.
//
// This module owns three tables (booking_messages, booking_message_attachments,
// vendor_message_templates) and one migration: the legacy
// supplier_bookings.notes blob, which held the couple's inquiry text with
// follow-ups appended after a "\n\n—\n\n" separator, is split into real message
// rows once at boot.
//
// The read stamps are the subtle part. `delivered_at` is set when the RECIPIENT
// opens THAT THREAD; `seen_at` when they actually had it on screen. Listing the
// inbox deliberately stamps neither (`listCoupleThreads` never calls
// markDelivered): glancing at a list of names is not the message arriving. Both
// are first-wins via COALESCE, so re-reading a months-old thread cannot rewrite
// when it was delivered, and neither is ever stamped on the sender's own
// messages, since a vendor loading their own reply must not mark it read for
// the couple.

import type {
  BookingMessage,
  BookingMessageAttachment,
  BookingThread,
  CoupleVendorThreadPreview,
  MessageSenderKind,
  VendorMessageTemplate,
} from "@shared/booking_messages";
import {
  MESSAGE_BODY_MAX_LEN,
  TEMPLATE_BODY_MAX_LEN,
  TEMPLATE_TITLE_MAX_LEN,
  TEMPLATES_PER_VENDOR_MAX,
  messageStatus,
} from "@shared/booking_messages";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { linkableListingCategories } from "./listings";
// Type-only: supplier_bookings imports insertMessage from here, so a value
// import would be a runtime cycle.
import type { BookingRow } from "./supplier_bookings";

/** The separator the legacy notes blob used to join follow-up inquiries. */
const LEGACY_THREAD_SEPARATOR = "\n\n—\n\n";

interface MessageRow {
  id: number;
  booking_id: number;
  sender_kind: string;
  sender_user_id: number | null;
  body: string;
  delivered_at: number | null;
  seen_at: number | null;
  created_at: number;
}

interface AttachmentRow {
  id: number;
  message_id: number;
  file_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: number;
}

interface TemplateRow {
  id: number;
  vendor_account_id: number;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

/** The counterpart of a sender: who a message is addressed to. */
export function recipientOf(sender: MessageSenderKind): MessageSenderKind {
  return sender === "vendor" ? "couple" : "vendor";
}

function toAttachment(row: AttachmentRow): BookingMessageAttachment {
  return {
    id: row.id,
    message_id: row.message_id,
    file_name: row.file_name,
    mime: row.mime,
    size_bytes: row.size_bytes,
    // Never the raw /uploads path: these carry quotes and contracts, and
    // /uploads/* is served without auth.
    download_url: `/api/booking-messages/attachments/${row.id}/download`,
  };
}

function toMessage(row: MessageRow, attachments: BookingMessageAttachment[]): BookingMessage {
  return {
    id: row.id,
    booking_id: row.booking_id,
    sender_kind: row.sender_kind === "vendor" ? "vendor" : "couple",
    body: row.body,
    status: messageStatus({ delivered_at: row.delivered_at, seen_at: row.seen_at }),
    sent_at: row.created_at,
    delivered_at: row.delivered_at,
    seen_at: row.seen_at,
    attachments,
  };
}

/** Every message on a thread, oldest first, with attachments attached in one
 *  extra query rather than one per message. */
export function listMessages(bookingId: number): BookingMessage[] {
  const rows = db
    .prepare("SELECT * FROM booking_messages WHERE booking_id = ? ORDER BY created_at ASC, id ASC")
    .all(bookingId) as MessageRow[];
  if (rows.length === 0) return [];
  const attachments = db
    .prepare(
      `SELECT a.* FROM booking_message_attachments a
         JOIN booking_messages m ON m.id = a.message_id
        WHERE m.booking_id = ?
        ORDER BY a.id ASC`,
    )
    .all(bookingId) as AttachmentRow[];
  const byMessage = new Map<number, BookingMessageAttachment[]>();
  for (const a of attachments) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push(toAttachment(a));
    byMessage.set(a.message_id, list);
  }
  return rows.map((r) => toMessage(r, byMessage.get(r.id) ?? []));
}

export function insertMessage(args: {
  bookingId: number;
  senderKind: MessageSenderKind;
  senderUserId: number | null;
  body: string;
  at?: number;
}): number {
  const ts = args.at ?? now();
  const info = db
    .prepare(
      `INSERT INTO booking_messages
         (booking_id, sender_kind, sender_user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(args.bookingId, args.senderKind, args.senderUserId, args.body, ts);
  return Number(info.lastInsertRowid);
}

/** Roll back a message whose attachments could not be persisted. Attachment
 *  rows cascade off the FK. */
export function deleteMessage(messageId: number): void {
  db.prepare("DELETE FROM booking_messages WHERE id = ?").run(messageId);
}

/** Stamp `delivered_at` on everything the reader did NOT write. First-wins, so
 *  the second fetch of a thread changes nothing. */
export function markDelivered(bookingId: number, readerKind: MessageSenderKind): void {
  db.prepare(
    `UPDATE booking_messages
        SET delivered_at = COALESCE(delivered_at, ?)
      WHERE booking_id = ? AND sender_kind = ? AND delivered_at IS NULL`,
  ).run(now(), bookingId, recipientOf(readerKind));
}

/** Stamp `seen_at` (and `delivered_at`, since being seen implies arrival, a
 *  message read on a device that never reported delivery must not render as one
 *  tick forever). */
export function markSeen(bookingId: number, readerKind: MessageSenderKind): number {
  const ts = now();
  db.prepare(
    `UPDATE booking_messages
        SET seen_at = COALESCE(seen_at, ?), delivered_at = COALESCE(delivered_at, ?)
      WHERE booking_id = ? AND sender_kind = ? AND seen_at IS NULL`,
  ).run(ts, ts, bookingId, recipientOf(readerKind));
  return ts;
}

/** Messages addressed to `readerKind` on this thread that they have not seen. */
export function unreadCount(bookingId: number, readerKind: MessageSenderKind): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM booking_messages
        WHERE booking_id = ? AND sender_kind = ? AND seen_at IS NULL`,
    )
    .get(bookingId, recipientOf(readerKind)) as { n: number };
  return row.n;
}

/** Unread counts for a whole set of threads in one query, the clients list
 *  renders a badge per row and must not go N+1 over it. */
export function unreadCountsByBooking(
  bookingIds: readonly number[],
  readerKind: MessageSenderKind,
): Map<number, number> {
  const out = new Map<number, number>();
  if (bookingIds.length === 0) return out;
  const placeholders = bookingIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT booking_id, COUNT(*) AS n FROM booking_messages
        WHERE booking_id IN (${placeholders}) AND sender_kind = ? AND seen_at IS NULL
        GROUP BY booking_id`,
    )
    .all(...bookingIds, recipientOf(readerKind)) as { booking_id: number; n: number }[];
  for (const r of rows) out.set(r.booking_id, r.n);
  return out;
}

/** Total unseen couple messages across a vendor's whole client list, the
 *  header bell's counter. */
export function vendorUnreadTotal(accountId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM booking_messages m
         JOIN supplier_bookings b ON b.id = m.booking_id
        WHERE b.vendor_account_id = ? AND m.sender_kind = 'couple' AND m.seen_at IS NULL`,
    )
    .get(accountId) as { n: number };
  return row.n;
}

/** Build the thread payload for a reader. Fetching a thread is what stamps
 *  delivery; `seen` needs the explicit call the UI makes when the panel is
 *  actually on screen. */
export function buildThread(args: {
  booking: BookingRow;
  readerKind: MessageSenderKind;
  counterpartyName: string;
  /** Only the COUPLE's read has one — a vendor's counterparty is a couple, and
   *  a couple's is a directory card. Left out means "no card to open". */
  counterpartyCategory?: string | null;
}): BookingThread {
  markDelivered(args.booking.id, args.readerKind);
  return {
    booking_id: args.booking.id,
    counterparty_name: args.counterpartyName,
    supplier_id: args.booking.supplier_id,
    counterparty_category: args.counterpartyCategory ?? null,
    event_date: args.booking.event_date,
    messages: listMessages(args.booking.id),
  };
}

/** The couple's list of vendor conversations, newest activity first. Threads
 *  with no messages at all are omitted, an admin-created booking the couple
 *  never wrote to is not a conversation. */
export function listCoupleThreads(coupleId: number): CoupleVendorThreadPreview[] {
  const rows = db
    .prepare(
      `SELECT b.id AS booking_id,
              b.supplier_id AS supplier_id,
              b.event_date AS event_date,
              COALESCE(l.name, b.supplier_id) AS vendor_name,
              (SELECT m.body FROM booking_messages m
                WHERE m.booking_id = b.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
              (SELECT m.created_at FROM booking_messages m
                WHERE m.booking_id = b.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at,
              (SELECT m.sender_kind FROM booking_messages m
                WHERE m.booking_id = b.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender_kind,
              (SELECT COUNT(*) FROM booking_messages m
                WHERE m.booking_id = b.id AND m.sender_kind = 'vendor' AND m.seen_at IS NULL) AS unread_count
         FROM supplier_bookings b
         LEFT JOIN listings l ON l.id = b.supplier_id
        WHERE b.couple_id = ?
        ORDER BY last_at DESC`,
    )
    .all(coupleId) as {
    booking_id: number;
    supplier_id: string;
    event_date: string;
    vendor_name: string;
    last_body: string | null;
    last_at: number | null;
    last_sender_kind: string | null;
    unread_count: number;
  }[];
  const withMessages = rows.filter((r) => r.last_at !== null);
  // One batched hop for the categories rather than a join on this query: the
  // "can the couple open this card" verdict spans two tables and lives in
  // domain/listings.ts, so it is not re-spelled here.
  const categories = linkableListingCategories(withMessages.map((r) => r.supplier_id));
  return withMessages.map((r) => ({
    booking_id: r.booking_id,
    supplier_id: r.supplier_id,
    vendor_name: r.vendor_name,
    event_date: r.event_date,
    last_body: r.last_body ?? "",
    last_at: r.last_at ?? 0,
    last_sender_kind: r.last_sender_kind === "vendor" ? "vendor" : "couple",
    unread_count: r.unread_count,
    vendor_category: categories.get(r.supplier_id) ?? null,
  }));
}

// ---------------------------------------------------------------- attachments

export function insertAttachmentRow(args: {
  messageId: number;
  fileName: string;
  mime: string;
  sizeBytes: number;
}): number {
  // file_path is filled after the bytes land, so the row id can name the file.
  const info = db
    .prepare(
      `INSERT INTO booking_message_attachments
         (message_id, file_path, file_name, mime, size_bytes, created_at)
       VALUES (?, '', ?, ?, ?, ?)`,
    )
    .run(args.messageId, args.fileName, args.mime, args.sizeBytes, now());
  return Number(info.lastInsertRowid);
}

export function setAttachmentPath(attachmentId: number, filePath: string): void {
  db.prepare("UPDATE booking_message_attachments SET file_path = ? WHERE id = ?").run(
    filePath,
    attachmentId,
  );
}

export function deleteAttachmentRow(attachmentId: number): void {
  db.prepare("DELETE FROM booking_message_attachments WHERE id = ?").run(attachmentId);
}

export interface AttachmentWithBooking extends AttachmentRow {
  booking_id: number;
  couple_id: number;
  vendor_account_id: number | null;
}

/** An attachment plus the ownership facts a reader has to be checked against.
 *  Returns null rather than throwing so the caller decides the status code. */
export function getAttachmentWithBooking(attachmentId: number): AttachmentWithBooking | null {
  const row = db
    .prepare(
      `SELECT a.*, b.id AS booking_id, b.couple_id AS couple_id,
              b.vendor_account_id AS vendor_account_id
         FROM booking_message_attachments a
         JOIN booking_messages m ON m.id = a.message_id
         JOIN supplier_bookings b ON b.id = m.booking_id
        WHERE a.id = ?`,
    )
    .get(attachmentId) as AttachmentWithBooking | undefined;
  return row ?? null;
}

// ------------------------------------------------------------------ templates

function toTemplate(row: TemplateRow): VendorMessageTemplate {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listTemplates(accountId: number): VendorMessageTemplate[] {
  const rows = db
    .prepare(
      "SELECT * FROM vendor_message_templates WHERE vendor_account_id = ? ORDER BY created_at DESC",
    )
    .all(accountId) as TemplateRow[];
  return rows.map(toTemplate);
}

export function getOwnedTemplate(accountId: number, templateId: number): TemplateRow {
  const row = db.prepare("SELECT * FROM vendor_message_templates WHERE id = ?").get(templateId) as
    | TemplateRow
    | undefined;
  // 404 on a foreign id rather than 403, matching getOwnedBooking: a vendor
  // must not be able to enumerate another vendor's templates.
  if (!row || row.vendor_account_id !== accountId) {
    throw new HttpError(404, "Template not found", { code: "template_not_found" });
  }
  return row;
}

export function createTemplate(
  accountId: number,
  title: string,
  body: string,
): VendorMessageTemplate {
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_message_templates WHERE vendor_account_id = ?")
    .get(accountId) as { n: number };
  if (count.n >= TEMPLATES_PER_VENDOR_MAX) {
    throw new HttpError(400, "Template limit reached", { code: "template_limit" });
  }
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO vendor_message_templates (vendor_account_id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(accountId, title, body, ts, ts);
  return toTemplate(
    db
      .prepare("SELECT * FROM vendor_message_templates WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as TemplateRow,
  );
}

export function updateTemplate(
  templateId: number,
  patch: { title?: string; body?: string },
): VendorMessageTemplate {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title);
  }
  if (patch.body !== undefined) {
    sets.push("body = ?");
    values.push(patch.body);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    values.push(now());
    db.prepare(`UPDATE vendor_message_templates SET ${sets.join(", ")} WHERE id = ?`).run(
      ...values,
      templateId,
    );
  }
  return toTemplate(
    db
      .prepare("SELECT * FROM vendor_message_templates WHERE id = ?")
      .get(templateId) as TemplateRow,
  );
}

export function deleteTemplate(templateId: number): void {
  db.prepare("DELETE FROM vendor_message_templates WHERE id = ?").run(templateId);
}

// ------------------------------------------------------------------ validation

/** Shared body guard for both directions. Returns the trimmed text. */
export function requireBody(raw: unknown, allowEmpty: boolean): string {
  if (typeof raw !== "string") {
    if (allowEmpty && raw === undefined) return "";
    throw new HttpError(400, "body must be a string", { code: "bad_body" });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 && !allowEmpty) {
    throw new HttpError(400, "Message body is required", { code: "empty_body" });
  }
  if (trimmed.length > MESSAGE_BODY_MAX_LEN) {
    throw new HttpError(400, "Message is too long", { code: "body_too_long" });
  }
  return trimmed;
}

export function requireTemplateFields(
  rawTitle: unknown,
  rawBody: unknown,
): { title: string; body: string } {
  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
    throw new HttpError(400, "Template title is required", { code: "empty_title" });
  }
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    throw new HttpError(400, "Template body is required", { code: "empty_body" });
  }
  const title = rawTitle.trim().slice(0, TEMPLATE_TITLE_MAX_LEN);
  const body = rawBody.trim();
  if (body.length > TEMPLATE_BODY_MAX_LEN) {
    throw new HttpError(400, "Template body is too long", { code: "body_too_long" });
  }
  return { title, body };
}

// ------------------------------------------------------------------ migration

/** Split the legacy supplier_bookings.notes blob into couple-sent message rows,
 *  once. Every segment lands at the booking's created_at: the blob never
 *  recorded per-message times, and inventing plausible ones would be a lie the
 *  UI then renders as fact. Bookings that already have a message row are
 *  skipped, which is what makes this safe to re-run and safe against a live
 *  inquiry arriving between deploy and boot. */
export function backfillLegacyBookingNotes(): void {
  const rows = db
    .prepare(
      `SELECT b.id, b.notes, b.created_at
         FROM supplier_bookings b
        WHERE b.notes IS NOT NULL AND TRIM(b.notes) != ''
          AND NOT EXISTS (SELECT 1 FROM booking_messages m WHERE m.booking_id = b.id)`,
    )
    .all() as { id: number; notes: string; created_at: number }[];
  if (rows.length === 0) return;
  let messages = 0;
  const insert = db.transaction(() => {
    for (const row of rows) {
      const parts = row.notes
        .split(LEGACY_THREAD_SEPARATOR)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const part of parts) {
        insertMessage({
          bookingId: row.id,
          senderKind: "couple",
          // The blob has no author. Attributing it to the couple's owner would
          // be a guess; sender_kind carries everything the UI renders.
          senderUserId: null,
          body: part.slice(0, MESSAGE_BODY_MAX_LEN),
          at: row.created_at,
        });
        messages++;
      }
    }
  });
  insert();
  log.info("booking_messages.backfilled", { bookings: rows.length, messages });
}
