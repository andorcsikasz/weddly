// Vendor "clients" + payment-tracking API. A client is a couple that reached
// the vendor THROUGH Weddly (a supplier_bookings row owned by the vendor's
// account). Every endpoint is gated to the calling vendor's own account via
// resolveVendorAccount + getOwnedBooking / getOwnedPayment (404 on a foreign
// id so they can't be enumerated). The payment-tracking endpoints are PRO-gated
// (requireVendorPro); the basic client list/detail is available on FREE.
//
// Foundation skeleton: wires every contract path with real ownership guards
// and functional CRUD against the vendor_client_payments table + the booking
// CRM columns. Feature agents extend validation, privacy rules, and audit.

import type { VendorClientDetail, VendorClientPayment } from "@shared/vendor_clients";
import { addAuditLog } from "../lib/audit";
import type { BookingRow } from "../domain/supplier_bookings";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import {
  createPayment,
  deletePayment,
  getOwnedBooking,
  getOwnedPayment,
  listVendorClients,
  requireVendorPro,
  resolveVendorAccount,
  toVendorClientDetail,
  updatePayment,
  updateVendorClientFields,
  vendorCurrencyForAccount,
  vendorPlanForAccount,
} from "../domain/vendor_clients";

function parseId(raw: string | undefined, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

function parseOptionalString(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, "Expected a string or null");
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseOptionalInt(raw: unknown, label: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new HttpError(400, `${label} must be a non-negative integer or null`);
  }
  return raw;
}

/** The vendor-managed CRM columns on a booking, for audit before/after diffs.
 *  The additive columns aren't on the base BookingRow type, so read them off a
 *  widened view. */
function crmSnapshot(row: BookingRow): Record<string, string | number | null> {
  const r = row as BookingRow & {
    stage?: string | null;
    vendor_notes?: string | null;
    contract_value?: number | null;
    deposit_paid?: number | null;
  };
  return {
    status: r.status,
    stage: r.stage ?? null,
    vendor_notes: r.vendor_notes ?? null,
    contract_value: r.contract_value ?? null,
    deposit_paid: r.deposit_paid ?? null,
  };
}

/** couple_id behind a payment's booking, for GDPR-scoped audit rows. The
 *  booking is re-asserted as owned so a stray foreign id can't leak. */
function bookingCoupleId(accountId: number, bookingId: number): number {
  return getOwnedBooking(accountId, bookingId).couple_id;
}

/** The payment schedule is a PRO feature, so it must never reach the client
 *  detail surface on the FREE tier — not even for a vendor who recorded a
 *  schedule while PRO and later lapsed. Strips `payments` to [] off the PRO
 *  gate; the dedicated payment endpoints stay 403-gated by requireVendorPro. */
function redactDetailForPlan(accountId: number, detail: VendorClientDetail): VendorClientDetail {
  if (vendorPlanForAccount(accountId) !== "pro") detail.payments = [];
  return detail;
}

async function handleListClients(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  return json({ clients: listVendorClients(account.id) });
}

async function handleGetClient(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);
  return json(redactDetailForPlan(account.id, toVendorClientDetail(booking)));
}

async function handlePatchClient(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const bookingId = parseId(ctx.params.id, "client id");
  const before = getOwnedBooking(account.id, bookingId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  // `status` is the only field that's never nulled — an empty string clears a
  // status, which the booking state machine has no slot for, so coalesce to
  // undefined (no-op) instead.
  const patch = {
    status: parseOptionalString(body.status) ?? undefined,
    stage: parseOptionalString(body.stage),
    vendorNotes: parseOptionalString(body.vendor_notes),
    contractValue: parseOptionalInt(body.contract_value, "contract_value"),
    depositPaid: parseOptionalInt(body.deposit_paid, "deposit_paid"),
  };
  updateVendorClientFields(bookingId, patch);
  markVendorCalendarDirty(account.id);
  const refreshed = getOwnedBooking(account.id, bookingId);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: before.couple_id,
    action: "vendor_client.updated",
    target_kind: "supplier_booking",
    target_id: bookingId,
    before: crmSnapshot(before),
    after: crmSnapshot(refreshed),
  });
  const client: VendorClientDetail = redactDetailForPlan(
    account.id,
    toVendorClientDetail(refreshed),
  );
  return json({ client });
}

async function handleListPayments(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);
  const detail = toVendorClientDetail(booking);
  return json({ payments: detail.payments });
}

async function handleAddPayment(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const bookingId = parseId(ctx.params.id, "client id");
  const booking = getOwnedBooking(account.id, bookingId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const label = parseOptionalString(body.label) ?? "";
  const amount = parseOptionalInt(body.amount, "amount");
  if (amount == null) throw new HttpError(400, "amount is required");
  const dueDate = parseOptionalString(body.due_date) ?? null;
  const payment: VendorClientPayment = createPayment({
    bookingId,
    vendorAccountId: account.id,
    label,
    amount,
    dueDate,
    currency: vendorCurrencyForAccount(account.id),
  });
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: booking.couple_id,
    action: "vendor_client.payment_added",
    target_kind: "vendor_client_payment",
    target_id: payment.id,
    after: { booking_id: bookingId, label, amount, due_date: dueDate },
  });
  return json({ payment });
}

async function handlePatchPayment(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const paymentId = parseId(ctx.params.paymentId, "payment id");
  const existing = getOwnedPayment(account.id, paymentId);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const payment: VendorClientPayment = updatePayment(paymentId, {
    label: parseOptionalString(body.label) ?? undefined,
    amount: parseOptionalInt(body.amount, "amount") ?? undefined,
    dueDate: parseOptionalString(body.due_date),
    paid: typeof body.paid === "boolean" ? body.paid : undefined,
  });
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: bookingCoupleId(account.id, existing.booking_id),
    action: "vendor_client.payment_updated",
    target_kind: "vendor_client_payment",
    target_id: paymentId,
    before: { label: existing.label, amount: existing.amount, paid: existing.paid === 1 },
    after: { label: payment.label, amount: payment.amount, paid: payment.paid },
  });
  return json({ payment });
}

async function handleDeletePayment(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const paymentId = parseId(ctx.params.paymentId, "payment id");
  const existing = getOwnedPayment(account.id, paymentId);
  deletePayment(paymentId);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: bookingCoupleId(account.id, existing.booking_id),
    action: "vendor_client.payment_deleted",
    target_kind: "vendor_client_payment",
    target_id: paymentId,
    before: { booking_id: existing.booking_id, label: existing.label, amount: existing.amount },
  });
  return json({ ok: true });
}

export function registerVendorClientsRoutes(router: Router) {
  router.get("/api/vendor/clients", handleListClients, true);
  router.get("/api/vendor/clients/:id", handleGetClient, true);
  router.patch("/api/vendor/clients/:id", handlePatchClient, true);
  router.get("/api/vendor/clients/:id/payments", handleListPayments, true);
  router.post("/api/vendor/clients/:id/payments", handleAddPayment, true);
  router.patch("/api/vendor/payments/:paymentId", handlePatchPayment, true);
  router.delete("/api/vendor/payments/:paymentId", handleDeletePayment, true);
}
