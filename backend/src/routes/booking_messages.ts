// Couple ↔ vendor messaging API. Both sides of one thread live here so the
// ownership rules sit next to each other rather than drifting apart in two
// files.
//
// GATING (owner decision 2026-07-30): the vendor's SEND, their canned
// templates and attachments are PRO (403 vendor_pro_required, matching the
// payment-schedule precedent). READING a thread and marking it seen stay FREE,
// the client list and the couple's inquiry text are already FREE, and taking
// away the ability to read a lead you were given would be a regression.
//
// The couple's own send is deliberately NOT behind the couple 402 edit gate:
// /api/outreach isn't either, and answering a vendor who is waiting on you is a
// wind-down flow, not a workspace edit.

import {
  MESSAGE_ATTACHMENT_EXT,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENTS_MAX,
  type BookingMessageAttachment,
} from "@shared/booking_messages";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { keyFromUploadUrl, storage } from "../lib/storage";
import { sniffImageMime } from "../lib/image_sniff";
import { db } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { getBookingById, type BookingRow } from "../domain/supplier_bookings";
import {
  getOwnedBooking,
  requireVendorPro,
  resolveVendorAccount,
  vendorPlanForAccount,
} from "../domain/vendor_clients";
import {
  buildThread,
  createTemplate,
  deleteAttachmentRow,
  deleteMessage,
  deleteTemplate,
  getAttachmentWithBooking,
  getOwnedTemplate,
  insertAttachmentRow,
  insertMessage,
  listCoupleThreads,
  listMessages,
  listTemplates,
  markSeen,
  requireBody,
  requireTemplateFields,
  setAttachmentPath,
  unreadCount,
  updateTemplate,
} from "../domain/booking_messages";
import { notifyCoupleOfVendorMessage, notifyVendorOfCoupleMessage } from "../domain/booking_notify";
import { linkableListingCategory } from "../domain/listings";
import { earnedBookingPhone } from "../domain/vendor_correspondence";

function parseId(raw: string | undefined, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

/** The couple's display name, for the vendor's side of the thread header.
 *  Exported because the quote routes address the same two parties and a second
 *  copy of "what do we call them" would drift. */
export function coupleDisplayName(coupleId: number): string {
  const row = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(coupleId) as
    | { display_name: string | null }
    | undefined;
  return row?.display_name ?? "";
}

/** The listing name, for the couple's side of the thread header. */
export function vendorDisplayName(supplierId: string): string {
  const row = db.prepare("SELECT name FROM listings WHERE id = ?").get(supplierId) as
    | { name: string }
    | undefined;
  return row?.name ?? supplierId;
}

/** Resolve a booking the CALLING COUPLE owns. 404 on a foreign id, mirroring
 *  getOwnedBooking on the vendor side, so bookings can't be enumerated.
 *  Exported and single-sourced ON PURPOSE: the quote routes need the same
 *  verdict, and two copies of an authorisation check is one copy that can be
 *  quietly wrong. */
export function getCoupleBooking(
  ctx: Ctx,
  bookingId: number,
): { booking: BookingRow; coupleId: number } {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Couple workspace required", { code: "no_couple" });
  }
  const booking = getBookingById(bookingId);
  if (!booking || booking.couple_id !== couple.id) {
    throw new HttpError(404, "Thread not found", { code: "thread_not_found" });
  }
  return { booking, coupleId: couple.id };
}

// ------------------------------------------------------------- attachments IO

/** PDF magic bytes: %PDF. The declared Content-Type is attacker-controlled and
 *  is never what we key on (the budget_documents rule). */
function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

async function sniffAttachmentMime(file: File): Promise<"application/pdf" | "image/jpeg"> {
  // formData() has already buffered the file (bounded by maxRequestBodySize),
  // so reading it back for the header is cheap, the same reasoning as
  // sniffUploadedImage.
  const head = new Uint8Array(await file.arrayBuffer()).subarray(0, 12);
  if (isPdf(head)) return "application/pdf";
  if (sniffImageMime(head) === "image/jpeg") return "image/jpeg";
  throw new HttpError(415, "Only PDF and JPG files are accepted", { code: "unsupported_type" });
}

interface PreparedAttachment {
  file: File;
  mime: "application/pdf" | "image/jpeg";
  ext: "pdf" | "jpg";
  fileName: string;
}

/** Validate and sniff a file BEFORE anything is written. Every rejection this
 *  can raise (empty, too large, wrong type) has to happen before the message
 *  row exists, otherwise a refused attachment leaves the vendor's text sitting
 *  on the thread with no file, no notification and no audit row, and the vendor
 *  retypes a message the couple can already read. */
async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size <= 0) throw new HttpError(400, "Empty file", { code: "empty_file" });
  if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
    throw new HttpError(413, "File is too large", { code: "file_too_large" });
  }
  const mime = await sniffAttachmentMime(file);
  const ext = MESSAGE_ATTACHMENT_EXT[mime];
  if (!ext) throw new HttpError(415, "Unsupported type", { code: "unsupported_type" });
  return {
    file,
    mime,
    ext,
    fileName: file.name.replace(/^.*[\\/]/, "").slice(0, 200) || `file.${ext}`,
  };
}

/** Persist one already-validated file. The row is inserted first so its id can
 *  name the object, then the bytes land, then the path is stamped: the
 *  budget_documents order, which never leaves a named file with no row. */
async function storeAttachment(args: {
  messageId: number;
  coupleId: number;
  prepared: PreparedAttachment;
}): Promise<BookingMessageAttachment> {
  const { file, mime, ext, fileName } = args.prepared;
  const attachmentId = insertAttachmentRow({
    messageId: args.messageId,
    fileName,
    mime,
    sizeBytes: file.size,
  });
  // Keyed under couples/<id>/ so a GDPR purge of the couple takes the bytes
  // with it for free (domain/purge.ts deletes that whole prefix).
  const key = `couples/${args.coupleId}/booking-messages/${attachmentId}.${ext}`;
  try {
    await storage.write(key, file, mime);
  } catch (e) {
    deleteAttachmentRow(attachmentId);
    throw e;
  }
  setAttachmentPath(attachmentId, `/uploads/${key}`);
  return {
    id: attachmentId,
    message_id: args.messageId,
    file_name: fileName,
    mime,
    size_bytes: file.size,
    download_url: `/api/booking-messages/attachments/${attachmentId}/download`,
  };
}

// -------------------------------------------------------------- vendor routes

async function handleVendorListMessages(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);
  const thread = buildThread({
    booking,
    readerKind: "vendor",
    counterpartyName: coupleDisplayName(booking.couple_id),
  });
  return json({ thread, unread: unreadCount(bookingId, "vendor") });
}

async function handleVendorSendMessage(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);

  // Two content types on one route: JSON for a plain reply, multipart when the
  // composer has files. Splitting them into two endpoints would make "text plus
  // an attachment" two writes that can half-fail.
  const contentType = ctx.req.headers.get("content-type") ?? "";
  let body: string;
  const files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await ctx.req.formData().catch(() => {
      throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
    });
    for (const entry of form.getAll("file")) {
      if (entry instanceof File) files.push(entry);
    }
    if (files.length > MESSAGE_ATTACHMENTS_MAX) {
      throw new HttpError(400, "Too many attachments", { code: "too_many_attachments" });
    }
    // A file with no words is a legitimate message; text with no file is too.
    body = requireBody(form.get("body") ?? undefined, files.length > 0);
  } else {
    const parsed = await readJson<Record<string, unknown>>(ctx.req);
    body = requireBody(parsed.body, false);
  }

  // Every file is validated before the message row exists, so a refused
  // attachment cannot leave half a message on the thread.
  const prepared: PreparedAttachment[] = [];
  for (const file of files) prepared.push(await prepareAttachment(file));

  const messageId = insertMessage({
    bookingId,
    senderKind: "vendor",
    senderUserId: account.owner_user_id,
    body,
  });
  const attachments: BookingMessageAttachment[] = [];
  try {
    for (const p of prepared) {
      attachments.push(
        await storeAttachment({ messageId, coupleId: booking.couple_id, prepared: p }),
      );
    }
  } catch (e) {
    // Storage is down or full. Take the message with it (attachment rows
    // cascade) rather than delivering "here is the quote" with no quote.
    deleteMessage(messageId);
    throw e;
  }

  notifyCoupleOfVendorMessage({
    booking,
    messageId,
    body,
    vendorName: vendorDisplayName(booking.supplier_id),
    attachmentCount: attachments.length,
  });
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: booking.couple_id,
    action: "booking_message.vendor_sent",
    target_kind: "booking_message",
    target_id: messageId,
    after: { booking_id: bookingId, length: body.length, attachments: attachments.length },
  });
  const messages = listMessages(bookingId);
  return json({ message: messages[messages.length - 1] }, { status: 201 });
}

async function handleVendorMarkSeen(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id, "client id");
  getOwnedBooking(account.id, bookingId);
  return json({ seen_at: markSeen(bookingId, "vendor") });
}

async function handleListTemplates(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  // Templates are a PRO surface end to end: a FREE vendor who cannot send has
  // nothing to insert one into.
  requireVendorPro(account.id);
  return json({ templates: listTemplates(account.id) });
}

async function handleCreateTemplate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const raw = await readJson<Record<string, unknown>>(ctx.req);
  const { title, body } = requireTemplateFields(raw.title, raw.body);
  const template = createTemplate(account.id, title, body);
  return json({ template }, { status: 201 });
}

async function handlePatchTemplate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const templateId = parseId(ctx.params.templateId, "template id");
  getOwnedTemplate(account.id, templateId);
  const raw = await readJson<Record<string, unknown>>(ctx.req);
  const { title, body } = requireTemplateFields(raw.title, raw.body);
  return json({ template: updateTemplate(templateId, { title, body }) });
}

async function handleDeleteTemplate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const templateId = parseId(ctx.params.templateId, "template id");
  getOwnedTemplate(account.id, templateId);
  deleteTemplate(templateId);
  return json({ ok: true });
}

// -------------------------------------------------------------- couple routes

async function handleCoupleListThreads(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(403, "Couple workspace required", { code: "no_couple" });
  return json({ threads: listCoupleThreads(couple.id) });
}

async function handleCoupleGetThread(ctx: Ctx): Promise<Response> {
  const bookingId = parseId(ctx.params.bookingId, "thread id");
  const { booking } = getCoupleBooking(ctx, bookingId);
  const thread = buildThread({
    booking,
    readerKind: "couple",
    counterpartyName: vendorDisplayName(booking.supplier_id),
    counterpartyCategory: linkableListingCategory(booking.supplier_id),
    counterpartyPhone: earnedBookingPhone(booking.id, booking.supplier_id),
  });
  return json({ thread, unread: unreadCount(bookingId, "couple") });
}

async function handleCoupleSendMessage(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const bookingId = parseId(ctx.params.bookingId, "thread id");
  const { booking } = getCoupleBooking(ctx, bookingId);
  const raw = await readJson<Record<string, unknown>>(ctx.req);
  const body = requireBody(raw.body, false);
  const messageId = insertMessage({
    bookingId,
    senderKind: "couple",
    senderUserId: userId,
    body,
  });
  notifyVendorOfCoupleMessage({
    booking,
    messageId,
    body,
    coupleName: coupleDisplayName(booking.couple_id),
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: booking.couple_id,
    action: "booking_message.couple_sent",
    target_kind: "booking_message",
    target_id: messageId,
    after: { booking_id: bookingId, length: body.length },
  });
  const messages = listMessages(bookingId);
  return json({ message: messages[messages.length - 1] }, { status: 201 });
}

async function handleCoupleMarkSeen(ctx: Ctx): Promise<Response> {
  const bookingId = parseId(ctx.params.bookingId, "thread id");
  getCoupleBooking(ctx, bookingId);
  return json({ seen_at: markSeen(bookingId, "couple") });
}

// ------------------------------------------------------------------- download

/** One gated route for both readers. /uploads/* is public and this prefix is
 *  denylisted there, so this is the only way to the bytes. */
async function handleAttachmentDownload(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const attachmentId = parseId(ctx.params.attachmentId, "attachment id");
  const row = getAttachmentWithBooking(attachmentId);
  if (!row) throw new HttpError(404, "Attachment not found", { code: "attachment_not_found" });

  const couple = getCoupleForUser(userId);
  const isCoupleSide = couple !== null && couple.id === row.couple_id;
  let isVendorSide = false;
  if (!isCoupleSide && row.vendor_account_id !== null) {
    // resolveVendorAccount throws for non-vendors, which is the common case
    // here (a couple member who is not on this thread), not an error worth
    // surfacing, just "not your file".
    try {
      isVendorSide = resolveVendorAccount(ctx).id === row.vendor_account_id;
    } catch {
      isVendorSide = false;
    }
  }
  if (!isCoupleSide && !isVendorSide) {
    throw new HttpError(404, "Attachment not found", { code: "attachment_not_found" });
  }

  const key = keyFromUploadUrl(row.file_path);
  if (!key) throw new HttpError(404, "Attachment not found", { code: "attachment_not_found" });
  const served = await storage.serve(key);
  if (!served) throw new HttpError(404, "Attachment not found", { code: "attachment_not_found" });
  const headers = new Headers(served.headers);
  const safeName = row.file_name.replace(/[\r\n"\\]/g, "_").slice(0, 200) || "attachment";
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", row.mime);
  headers.set("Content-Disposition", `inline; filename="${safeName}"`);
  return new Response(served.body, { status: served.status, headers });
}

/** Surfaced on the vendor billing/feature payload consumers already read; kept
 *  here so the one definition of "can this vendor send" has a single home. */
export function vendorCanSendMessages(accountId: number): boolean {
  return vendorPlanForAccount(accountId) === "pro";
}

export function registerBookingMessageRoutes(router: Router) {
  // Literal sub-paths before the parameterised ones (first match wins).
  router.post("/api/vendor/clients/:id/messages/seen", handleVendorMarkSeen, true);
  router.get("/api/vendor/clients/:id/messages", handleVendorListMessages, true);
  router.post("/api/vendor/clients/:id/messages", handleVendorSendMessage, true);

  router.get("/api/vendor/message-templates", handleListTemplates, true);
  router.post("/api/vendor/message-templates", handleCreateTemplate, true);
  router.patch("/api/vendor/message-templates/:templateId", handlePatchTemplate, true);
  router.delete("/api/vendor/message-templates/:templateId", handleDeleteTemplate, true);

  router.get("/api/messages/threads", handleCoupleListThreads, true);
  router.post("/api/messages/threads/:bookingId/seen", handleCoupleMarkSeen, true);
  router.get("/api/messages/threads/:bookingId", handleCoupleGetThread, true);
  router.post("/api/messages/threads/:bookingId", handleCoupleSendMessage, true);

  router.get(
    "/api/booking-messages/attachments/:attachmentId/download",
    handleAttachmentDownload,
    true,
  );
}
