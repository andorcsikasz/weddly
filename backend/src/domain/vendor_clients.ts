// Vendor "clients" + payment-tracking domain. A client is a couple that
// reached the vendor THROUGH Weddly — one `supplier_bookings` row owned by the
// vendor's account. This module owns the ownership guard every vendor-clients
// route shares, the FREE/PRO plan derivation, the booking→client mappers, and
// the lightweight (in-app-only) payment-schedule CRUD.
//
// Bodies here are deliberately small — the foundation ships a compiling,
// runnable contract; the feature agents flesh out richer privacy rules,
// validation, and stats. No real money moves through these tables.

import type {
  VendorClientDetail,
  VendorClientPayment,
  VendorClientView,
  VendorStats,
} from "@shared/vendor_clients";
import type { VendorPlan } from "@shared/vendor_plan";
import { vendorPlanFromEntitlement } from "@shared/vendor_plan";
import { VENDOR_FREE_LEAD_CREDITS } from "@shared/vendor_billing";
import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { type Ctx, HttpError, requireAuth } from "../lib/http";
import { getUserById } from "./users";
import { getVendorAccountByOwnerUserId, type VendorAccountRow } from "./vendor_accounts";
import { getVendorSub, toVendorBilling } from "./vendor_billing";
import { getBookingById, type BookingRow } from "./supplier_bookings";
import { getListingByVendorAccountId } from "./listings";
import type { Listing } from "@shared/listings";

/** Resolve `requireAuth(ctx)` to the calling vendor's account, or throw the
 *  right HTTP error. Shared by every vendor-clients / stats / billing route so
 *  the role + account-ownership gate lives in one place. */
export function resolveVendorAccount(ctx: Ctx): VendorAccountRow {
  const userId = requireAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(401, "User not found");
  if (user.role !== "vendor") {
    throw new HttpError(403, "Vendor role required", { code: "vendor_role_required" });
  }
  const account = getVendorAccountByOwnerUserId(userId);
  if (!account) {
    throw new HttpError(404, "No vendor account for this user", { code: "vendor_account_missing" });
  }
  return account;
}

/** Active FREE/PRO plan for a vendor account, derived from billing entitlement
 *  (no second source of truth). No sub row yet => not entitled => FREE. */
export function vendorPlanForAccount(accountId: number): VendorPlan {
  const sub = getVendorSub(accountId);
  const entitled = sub ? toVendorBilling(sub).entitled : false;
  return vendorPlanFromEntitlement(entitled);
}

/** The vendor billing currency (HUF | EUR), defaulting to EUR when unset. */
export function vendorCurrencyForAccount(accountId: number): Currency {
  const sub = getVendorSub(accountId);
  return (sub?.currency as Currency | undefined) ?? "EUR";
}

/** Throw 403 with a paywall code when the vendor is on the FREE tier. Used by
 *  the PRO-gated payment-tracking endpoints. */
export function requireVendorPro(accountId: number): void {
  if (vendorPlanForAccount(accountId) !== "pro") {
    throw new HttpError(403, "Pro plan required", { code: "vendor_pro_required" });
  }
}

function coupleDisplayName(coupleId: number): string {
  const row = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(coupleId) as
    | { display_name: string }
    | undefined;
  return row?.display_name ?? "";
}

function computeBalance(contractValue: number | null, depositPaid: number | null): number | null {
  if (contractValue == null) return null;
  return contractValue - (depositPaid ?? 0);
}

/** Map a booking row (owned by the vendor) to the basic client list view. */
export function toVendorClientView(row: BookingRow): VendorClientView {
  const contractValue =
    (row as BookingRow & { contract_value?: number | null }).contract_value ?? null;
  const depositPaid = (row as BookingRow & { deposit_paid?: number | null }).deposit_paid ?? null;
  const stage = (row as BookingRow & { stage?: string | null }).stage ?? null;
  return {
    id: row.id,
    couple_id: row.couple_id,
    couple_display_name: coupleDisplayName(row.couple_id),
    event_date: row.event_date,
    status: row.status,
    stage,
    contract_value: contractValue,
    deposit_paid: depositPaid,
    balance: computeBalance(contractValue, depositPaid),
    created_at: row.created_at,
  };
}

/** Map a booking row to the full PRO CRM detail (notes + contact + schedule). */
export function toVendorClientDetail(row: BookingRow): VendorClientDetail {
  const base = toVendorClientView(row);
  const vendorNotes = (row as BookingRow & { vendor_notes?: string | null }).vendor_notes ?? null;
  return {
    ...base,
    vendor_notes: vendorNotes,
    couple_contact_email: coupleContactEmail(row.couple_id),
    payments: listPaymentsForBooking(row.id),
  };
}

/** The couple's inquiry-contact email — the workspace owner's address. Surfaced
 *  to the vendor only because the couple initiated the inquiry. */
function coupleContactEmail(coupleId: number): string | null {
  const row = db
    .prepare(
      `SELECT u.email AS email
         FROM couples c
         JOIN users u ON u.id = c.partner_a_id
        WHERE c.id = ?`,
    )
    .get(coupleId) as { email: string } | undefined;
  return row?.email ?? null;
}

/** Fetch a booking and assert it belongs to the vendor account. Throws 404
 *  (not 403) on a foreign/absent booking so ids can't be enumerated. */
export function getOwnedBooking(accountId: number, bookingId: number): BookingRow {
  const row = getBookingById(bookingId);
  if (!row || row.vendor_account_id !== accountId) {
    throw new HttpError(404, "Client not found", { code: "client_not_found" });
  }
  return row;
}

// ── Payment schedule (in-app-only; no money movement) ───────────────────────

interface PaymentRow {
  id: number;
  booking_id: number;
  vendor_account_id: number;
  label: string | null;
  amount: number;
  currency: string;
  due_date: string | null;
  paid: number;
  paid_at: number | null;
  created_at: number;
  updated_at: number;
}

function toPayment(row: PaymentRow): VendorClientPayment {
  return {
    id: row.id,
    booking_id: row.booking_id,
    label: row.label ?? "",
    amount: row.amount,
    due_date: row.due_date,
    paid: row.paid === 1,
    paid_at: row.paid_at,
  };
}

export function listPaymentsForBooking(bookingId: number): VendorClientPayment[] {
  const rows = db
    .prepare(
      "SELECT * FROM vendor_client_payments WHERE booking_id = ? ORDER BY due_date IS NULL, due_date ASC, created_at ASC",
    )
    .all(bookingId) as PaymentRow[];
  return rows.map(toPayment);
}

export function getPaymentRow(paymentId: number): PaymentRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_client_payments WHERE id = ?").get(paymentId) as
      | PaymentRow
      | undefined) ?? null
  );
}

/** Fetch a payment and assert it belongs to the vendor account. Throws 404 on
 *  a foreign/absent payment. */
export function getOwnedPayment(accountId: number, paymentId: number): PaymentRow {
  const row = getPaymentRow(paymentId);
  if (!row || row.vendor_account_id !== accountId) {
    throw new HttpError(404, "Payment not found", { code: "payment_not_found" });
  }
  return row;
}

export interface CreatePaymentInput {
  bookingId: number;
  vendorAccountId: number;
  label: string;
  amount: number;
  dueDate: string | null;
  currency: Currency;
}

export function createPayment(input: CreatePaymentInput): VendorClientPayment {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO vendor_client_payments
         (booking_id, vendor_account_id, label, amount, currency, due_date, paid, paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(
      input.bookingId,
      input.vendorAccountId,
      input.label,
      input.amount,
      input.currency,
      input.dueDate,
      ts,
      ts,
    );
  const row = getPaymentRow(Number(info.lastInsertRowid));
  if (!row) throw new HttpError(500, "Payment create failed");
  return toPayment(row);
}

export interface UpdatePaymentInput {
  label?: string;
  amount?: number;
  dueDate?: string | null;
  paid?: boolean;
}

export function updatePayment(paymentId: number, patch: UpdatePaymentInput): VendorClientPayment {
  const current = getPaymentRow(paymentId);
  if (!current) throw new HttpError(404, "Payment not found", { code: "payment_not_found" });
  const ts = now();
  const label = patch.label ?? current.label;
  const amount = patch.amount ?? current.amount;
  const dueDate = patch.dueDate === undefined ? current.due_date : patch.dueDate;
  const paid = patch.paid === undefined ? current.paid : patch.paid ? 1 : 0;
  // paid_at follows the paid flag: stamp on transition to paid, clear on unpaid.
  const paidAt = paid === 1 ? (current.paid === 1 ? current.paid_at : ts) : null;
  db.prepare(
    `UPDATE vendor_client_payments
        SET label = ?, amount = ?, due_date = ?, paid = ?, paid_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(label, amount, dueDate, paid, paidAt, ts, paymentId);
  const row = getPaymentRow(paymentId);
  if (!row) throw new HttpError(500, "Payment update failed");
  return toPayment(row);
}

export function deletePayment(paymentId: number): void {
  db.prepare("DELETE FROM vendor_client_payments WHERE id = ?").run(paymentId);
}

export interface UpdateVendorClientInput {
  status?: string;
  stage?: string | null;
  vendorNotes?: string | null;
  contractValue?: number | null;
  depositPaid?: number | null;
}

/** Patch the vendor-managed CRM fields on a booking the vendor owns. Only the
 *  supplied fields are written. Caller must have asserted ownership. */
export function updateVendorClientFields(bookingId: number, patch: UpdateVendorClientInput): void {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.stage !== undefined) {
    sets.push("stage = ?");
    vals.push(patch.stage);
  }
  if (patch.vendorNotes !== undefined) {
    sets.push("vendor_notes = ?");
    vals.push(patch.vendorNotes);
  }
  if (patch.contractValue !== undefined) {
    sets.push("contract_value = ?");
    vals.push(patch.contractValue);
  }
  if (patch.depositPaid !== undefined) {
    sets.push("deposit_paid = ?");
    vals.push(patch.depositPaid);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(bookingId);
  db.prepare(`UPDATE supplier_bookings SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

/** List the vendor's clients (their owned bookings), newest first. */
export function listVendorClients(accountId: number): VendorClientView[] {
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE vendor_account_id = ? ORDER BY created_at DESC")
    .all(accountId) as BookingRow[];
  return rows.map(toVendorClientView);
}

/** Same list with the full CRM detail (notes + contact + payment schedule)
 *  per client — the data-export shape. */
export function listVendorClientDetails(accountId: number): VendorClientDetail[] {
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE vendor_account_id = ? ORDER BY created_at DESC")
    .all(accountId) as BookingRow[];
  return rows.map(toVendorClientDetail);
}

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

/** Number of key public-listing fields the completeness percentage scores. */
const LISTING_COMPLETENESS_FIELDS = 5;

/** Percent (0..100) of the key public-listing fields a vendor has filled in.
 *  Scores five buckets equally — blurb, contact, pricing, capacity, hero —
 *  so the dashboard can nudge the vendor toward a richer card. A vendor with
 *  no listing yet scores 0. */
export function listingCompleteness(listing: Listing | null): number {
  if (!listing) return 0;
  const filled = [
    Boolean(listing.blurb_hu) || Boolean(listing.blurb_en),
    Boolean(listing.contact_email) || Boolean(listing.contact_phone),
    listing.price_band != null,
    listing.capacity_min != null || listing.capacity_max != null,
    Boolean(listing.hero_image_url),
  ].filter(Boolean).length;
  return Math.round((filled / LISTING_COMPLETENESS_FIELDS) * 100);
}

/** Build the vendor dashboard / stats payload. Counts come from the vendor's
 *  bookings, tracked revenue from the deposits they've recorded, listing
 *  completeness from their public card, and billing from the subscription. */
export function buildVendorStats(account: VendorAccountRow): VendorStats {
  const accountId = account.id;
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE vendor_account_id = ?")
    .all(accountId) as BookingRow[];
  const nowMs = now();
  const byStatus: Record<string, number> = {};
  let revenue = 0;
  let inquiries30d = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (nowMs - r.created_at <= THIRTY_DAYS_MS) inquiries30d += 1;
    // Tracked revenue = deposits actually recorded against the vendor's
    // bookings (money in), not the agreed contract totals.
    const dp = (r as BookingRow & { deposit_paid?: number | null }).deposit_paid;
    if (typeof dp === "number") revenue += dp;
  }
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((r) => r.event_date >= today && r.status === "confirmed")
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .map((r) => ({
      id: r.id,
      couple_display_name: coupleDisplayName(r.couple_id),
      event_date: r.event_date,
    }));
  const blocked = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_unavailable_dates WHERE vendor_account_id = ?")
    .get(accountId) as { n: number };
  const sub = getVendorSub(accountId);
  const billing = sub
    ? toVendorBilling(sub)
    : {
        subscription_status: "trialing" as const,
        trial_ends_at: null,
        founding_until: null,
        is_founding_member: false,
        current_period_end: null,
        card_on_file: false,
        lead_credits_used: 0,
        lead_credits_total: VENDOR_FREE_LEAD_CREDITS,
        billing_starts_at: null,
        currency: "EUR" as Currency,
        entitled: false,
        reason: "none" as const,
      };
  return {
    inquiries_total: rows.length,
    inquiries_30d: inquiries30d,
    by_status: byStatus,
    upcoming,
    blocked_dates_count: blocked.n,
    listing_completeness: listingCompleteness(getListingByVendorAccountId(accountId)),
    revenue_tracked: revenue,
    currency: billing.currency,
    billing,
  };
}
