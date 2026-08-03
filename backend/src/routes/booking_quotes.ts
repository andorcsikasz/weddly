// Vendor quotes (árajánlat), both sides.
//
// The vendor writes and sends a priced offer against one inquiry; the couple
// reads it in the same thread they already talk in, and answers. The invariants
// (one live quote per inquiry, a sent quote is frozen, accepting is what writes
// the contract value and confirms the date) live in domain/booking_quotes.ts.
//
// Gating, and it is deliberately asymmetric:
//   * WRITING a quote is PRO, like sending a message and like the payment
//     schedule. `requireVendorPro` per handler, not the 402 middleware, which
//     is the same choice the rest of the vendor CRM made.
//   * READING one is free on both sides, and so is the couple's ANSWER. A
//     vendor whose subscription lapsed must still be able to see the offer a
//     couple accepted, and a couple can never be asked to pay to reply to an
//     offer that was made to them. That is why the couple routes sit outside
//     the couple's own edit gate too, exactly like the message thread.

import {
  QUOTE_AMOUNT_MAX,
  QUOTE_DECLINE_REASON_MAX,
  QUOTE_LINE_LABEL_MAX,
  QUOTE_LINES_MAX,
  QUOTE_MESSAGE_MAX,
  QUOTE_QTY_MAX,
  QUOTE_TITLE_MAX,
  type QuoteLineInput,
} from "@shared/booking_quotes";
import type { Currency } from "@shared/types";
import { CONFIG } from "../config";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import {
  acceptQuote,
  createQuote,
  declineQuote,
  deleteQuote,
  getQuoteWithBooking,
  listQuotesForBooking,
  markThreadQuotesViewed,
  type QuoteRow,
  sendQuote,
  updateQuoteDraft,
  withdrawQuote,
} from "../domain/booking_quotes";
import { notifyCoupleOfVendorQuote, notifyVendorOfQuoteResponse } from "../domain/booking_notify";
import type { BookingRow } from "../domain/supplier_bookings";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import {
  getOwnedBooking,
  requireVendorPro,
  resolveVendorAccount,
  vendorCurrencyForAccount,
} from "../domain/vendor_clients";
import { coupleDisplayName, getCoupleBooking, vendorDisplayName } from "./booking_messages";

function parseId(raw: string | undefined, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

/** Whole units in the quote's own currency. Mirrors `formatEnvelopeAmount`:
 *  a HUF figure reads as Hungarian, everything else as en-GB. The email
 *  templates never see a raw number, so they can't guess a currency wrong. */
function formatQuoteMoney(amount: number, currency: Currency): string {
  const locale = currency === "HUF" ? "hu-HU" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function quoteUrlForCouple(bookingId: number): string {
  return `${CONFIG.frontendBaseUrl}/app/messages/${bookingId}`;
}

function quoteUrlForVendor(bookingId: number): string {
  return `${CONFIG.frontendBaseUrl}/vendor/clients/${bookingId}`;
}

function requireTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Title is required", { code: "bad_title" });
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new HttpError(400, "Title is required", { code: "bad_title" });
  if (trimmed.length > QUOTE_TITLE_MAX) {
    throw new HttpError(400, `Title is longer than ${QUOTE_TITLE_MAX}`, { code: "bad_title" });
  }
  return trimmed;
}

/** `undefined` = key absent = leave alone; null / "" = clear. The partial-patch
 *  contract the admin listing editor established. */
function optionalText(raw: unknown, max: number, code: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, "Invalid text", { code });
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new HttpError(400, `Text is longer than ${max}`, { code });
  return trimmed;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalIsoDate(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) {
    throw new HttpError(400, "Invalid date", { code: "bad_valid_until" });
  }
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    throw new HttpError(400, "Invalid date", { code: "bad_valid_until" });
  }
  return raw;
}

function optionalAmount(raw: unknown, code: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > QUOTE_AMOUNT_MAX) {
    throw new HttpError(400, "Invalid amount", { code });
  }
  return n;
}

/** A quote with no priced row has no total, so there is nothing to accept. */
function parseLines(raw: unknown): QuoteLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "At least one line is required", { code: "bad_lines" });
  }
  if (raw.length > QUOTE_LINES_MAX) {
    throw new HttpError(400, `At most ${QUOTE_LINES_MAX} lines`, { code: "too_many_lines" });
  }
  return raw.map((entry) => {
    const line = entry as { label?: unknown; unit_amount?: unknown; qty?: unknown };
    if (typeof line.label !== "string" || line.label.trim().length === 0) {
      throw new HttpError(400, "Line label is required", { code: "bad_lines" });
    }
    const label = line.label.trim();
    if (label.length > QUOTE_LINE_LABEL_MAX) {
      throw new HttpError(400, "Line label is too long", { code: "bad_lines" });
    }
    const unitAmount = typeof line.unit_amount === "number" ? line.unit_amount : NaN;
    if (!Number.isInteger(unitAmount) || unitAmount < 0 || unitAmount > QUOTE_AMOUNT_MAX) {
      throw new HttpError(400, "Invalid line amount", { code: "bad_lines" });
    }
    const qty = typeof line.qty === "number" ? line.qty : NaN;
    if (!Number.isInteger(qty) || qty < 1 || qty > QUOTE_QTY_MAX) {
      throw new HttpError(400, "Invalid line quantity", { code: "bad_lines" });
    }
    return { label, unit_amount: unitAmount, qty };
  });
}

/** Resolve a quote the CALLING VENDOR owns, via the inquiry it hangs off. 404
 *  on anything else so quote ids can't be probed. */
function getOwnedQuote(
  accountId: number,
  quoteId: number,
): { quote: QuoteRow; booking: BookingRow } {
  const found = getQuoteWithBooking(quoteId);
  if (found === null || found.booking.vendor_account_id !== accountId) {
    throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  }
  return found;
}

/** The couple's mirror of the same lookup, routed through the single-sourced
 *  couple guard so both sides agree about who may see a thread. */
function getCoupleQuote(ctx: Ctx, quoteId: number): { quote: QuoteRow; booking: BookingRow } {
  const found = getQuoteWithBooking(quoteId);
  if (found === null) throw new HttpError(404, "Quote not found", { code: "quote_not_found" });
  getCoupleBooking(ctx, found.booking.id);
  return found;
}

// ───────────────────────────────────────────────────────────── vendor handlers

function handleVendorList(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id, "client id");
  getOwnedBooking(account.id, bookingId);
  return json({ quotes: listQuotesForBooking(bookingId) });
}

async function handleVendorCreate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const quote = createQuote({
    bookingId,
    vendorAccountId: account.id,
    currency: vendorCurrencyForAccount(account.id),
    title: requireTitle(body.title),
    message: optionalText(body.message, QUOTE_MESSAGE_MAX, "bad_message") ?? null,
    validUntil: optionalIsoDate(body.valid_until) ?? null,
    depositAmount: optionalAmount(body.deposit_amount, "bad_deposit") ?? null,
    lines: parseLines(body.lines),
  });
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_quote.created",
    target_kind: "booking_quote",
    target_id: quote.id,
    after: { booking_id: bookingId, total: quote.total },
  });
  return json({ quote }, { status: 201 });
}

async function handleVendorPatch(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row } = getOwnedQuote(account.id, quoteId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const quote = updateQuoteDraft(row, {
    ...(body.title === undefined ? {} : { title: requireTitle(body.title) }),
    message: optionalText(body.message, QUOTE_MESSAGE_MAX, "bad_message"),
    validUntil: optionalIsoDate(body.valid_until),
    depositAmount: optionalAmount(body.deposit_amount, "bad_deposit"),
    ...(body.lines === undefined ? {} : { lines: parseLines(body.lines) }),
  });
  return json({ quote });
}

function handleVendorSend(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row, booking } = getOwnedQuote(account.id, quoteId);
  const quote = sendQuote(row);
  notifyCoupleOfVendorQuote({
    booking,
    quote,
    vendorName: vendorDisplayName(booking.supplier_id),
    totalText: formatQuoteMoney(quote.total, quote.currency),
    quoteUrl: quoteUrlForCouple(booking.id),
  });
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_quote.sent",
    target_kind: "booking_quote",
    target_id: quote.id,
    after: { total: quote.total, valid_until: quote.valid_until },
  });
  return json({ quote });
}

function handleVendorWithdraw(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row, booking } = getOwnedQuote(account.id, quoteId);
  const quote = withdrawQuote(row);
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_quote.withdrawn",
    target_kind: "booking_quote",
    target_id: quote.id,
  });
  return json({ quote });
}

function handleVendorDelete(ctx: Ctx): Response {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row } = getOwnedQuote(account.id, quoteId);
  deleteQuote(row);
  return json({ ok: true });
}

// ───────────────────────────────────────────────────────────── couple handlers

/** Loading the thread's offers is what stamps them viewed, exactly like
 *  fetching a message thread stamps delivery. Drafts are filtered out here
 *  rather than in the domain: a draft is the vendor thinking aloud, and it has
 *  no business leaving their side. */
function handleCoupleList(ctx: Ctx): Response {
  const bookingId = parseId(ctx.params.bookingId, "booking id");
  const { booking } = getCoupleBooking(ctx, bookingId);
  // Stamp first, then read: the stamp is what turns "sent" into "viewed", and
  // the couple should be handed the state their own visit just produced.
  markThreadQuotesViewed(booking.id);
  return json({ quotes: listQuotesForBooking(booking.id).filter((q) => q.status !== "draft") });
}

function handleCoupleAccept(ctx: Ctx): Response {
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row, booking } = getCoupleQuote(ctx, quoteId);
  const quote = acceptQuote(row);
  markVendorCalendarDirty(booking.vendor_account_id);
  notifyVendorOfQuoteResponse({
    booking,
    quote,
    coupleName: coupleDisplayName(booking.couple_id),
    totalText: formatQuoteMoney(quote.total, quote.currency),
    quoteUrl: quoteUrlForVendor(booking.id),
  });
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_quote.accepted",
    target_kind: "booking_quote",
    target_id: quote.id,
    after: { total: quote.total },
  });
  return json({ quote });
}

async function handleCoupleDecline(ctx: Ctx): Promise<Response> {
  const quoteId = parseId(ctx.params.quoteId, "quote id");
  const { quote: row, booking } = getCoupleQuote(ctx, quoteId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const reason = optionalText(body.reason, QUOTE_DECLINE_REASON_MAX, "bad_reason") ?? null;
  const quote = declineQuote(row, reason);
  notifyVendorOfQuoteResponse({
    booking,
    quote,
    coupleName: coupleDisplayName(booking.couple_id),
    totalText: formatQuoteMoney(quote.total, quote.currency),
    quoteUrl: quoteUrlForVendor(booking.id),
  });
  addAuditLog({
    actor_user_id: ctx.userId,
    couple_id: booking.couple_id,
    action: "vendor_quote.declined",
    target_kind: "booking_quote",
    target_id: quote.id,
  });
  return json({ quote });
}

export function registerBookingQuoteRoutes(router: Router) {
  // Literal sub-paths before parameterised siblings, per Router.match being
  // first-match-wins in registration order.
  router.get("/api/vendor/clients/:id/quotes", handleVendorList, true);
  router.post("/api/vendor/clients/:id/quotes", handleVendorCreate, true);
  router.post("/api/vendor/quotes/:quoteId/send", handleVendorSend, true);
  router.post("/api/vendor/quotes/:quoteId/withdraw", handleVendorWithdraw, true);
  router.patch("/api/vendor/quotes/:quoteId", handleVendorPatch, true);
  router.delete("/api/vendor/quotes/:quoteId", handleVendorDelete, true);

  router.get("/api/messages/threads/:bookingId/quotes", handleCoupleList, true);
  router.post("/api/quotes/:quoteId/accept", handleCoupleAccept, true);
  router.post("/api/quotes/:quoteId/decline", handleCoupleDecline, true);
}
