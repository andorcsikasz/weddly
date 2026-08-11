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
  VendorListingChecklistInput,
  VendorListingStep,
  VendorStats,
} from "@shared/vendor_clients";
import { listingChecklistFor, listingCompletenessFor } from "@shared/vendor_clients";
import type { VendorClientSignals } from "@shared/vendor_next_action";
import { vendorAttention, vendorNextAction } from "@shared/vendor_next_action";
import type { VendorPlan } from "@shared/vendor_plan";
import { vendorPlanFromEntitlement } from "@shared/vendor_plan";
import { VENDOR_FREE_LEAD_CREDITS } from "@shared/vendor_billing";
import { isCurrency } from "@shared/currency";
import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { type Ctx, HttpError, requireAuth } from "../lib/http";
import { getUserById } from "./users";
import { getVendorAccountByOwnerUserId, type VendorAccountRow } from "./vendor_accounts";
import { getVendorSub, toVendorBilling } from "./vendor_billing";
import { getBookingById, type BookingRow } from "./supplier_bookings";
import { holdSignalsFor } from "./date_holds";
import { unreadCount, unreadCountsByBooking, vendorUnreadTotal } from "./booking_messages";
import {
  countListingPackages,
  countListingPhotos,
  getListingByVendorAccountId,
  listingChecklist,
  listingCompleteness,
} from "./listings";
import { viewCountsForListings } from "./supplier_views";
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

/** The vendor billing currency, defaulting to EUR when unset or unrecognised.
 *  Guarded rather than cast: the column is plain TEXT, so a stale or hand-
 *  edited value would otherwise reach Intl as a bogus currency code. */
export function vendorCurrencyForAccount(accountId: number): Currency {
  const sub = getVendorSub(accountId);
  return isCurrency(sub?.currency) ? sub.currency : "EUR";
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

/** Map a booking row (owned by the vendor) to the basic client list view.
 *  `unread` and `signals` are passed in by the list path, which resolves the
 *  whole set in one query each; the single-row callers let them default and pay
 *  for their own lookup. */
export function toVendorClientView(
  row: BookingRow,
  unread?: number,
  signals?: VendorClientSignals,
): VendorClientView {
  const contractValue =
    (row as BookingRow & { contract_value?: number | null }).contract_value ?? null;
  const depositPaid = (row as BookingRow & { deposit_paid?: number | null }).deposit_paid ?? null;
  const stage = (row as BookingRow & { stage?: string | null }).stage ?? null;
  const facts = signals ?? clientSignalsForBooking(row);
  const nowMs = now();
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
    unread_count: unread ?? unreadCount(row.id, "vendor"),
    vendor_seen_at: vendorSeenAt(row),
    next_action: vendorNextAction(facts, nowMs),
    attention: vendorAttention(facts, nowMs),
    attention_snoozed_until: attentionSnoozedUntil(row),
  };
}

// ── Next Best Action signals ────────────────────────────────────────────────
//
// The rules themselves live in `shared/vendor_next_action.ts`; this half only
// GATHERS the facts. The list path resolves them for every booking in three
// queries regardless of how many clients the vendor has, because the per-row
// form is four lookups each and a busy vendor's list is the hot path.

function attentionSnoozedUntil(row: BookingRow): number | null {
  return (
    (row as BookingRow & { attention_snoozed_until?: number | null }).attention_snoozed_until ??
    null
  );
}

/** The listing ids a vendor account owns — the `supplier_id` values their
 *  reviews are keyed on. */
function listingIdsForAccount(accountId: number): string[] {
  return (
    db.prepare("SELECT id FROM listings WHERE vendor_account_id = ?").all(accountId) as {
      id: string;
    }[]
  ).map((r) => r.id);
}

/** Couples that have already written this vendor a review. Soft-deleted rows
 *  are excluded, unpublished ones are NOT: a review sitting in draft is still a
 *  review the couple wrote, and asking them for a second one would be wrong. */
function reviewedCoupleIds(accountId: number): Set<number> {
  const listingIds = listingIdsForAccount(accountId);
  if (listingIds.length === 0) return new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT couple_id FROM supplier_reviews
        WHERE supplier_id IN (${listingIds.map(() => "?").join(",")})
          AND couple_id IS NOT NULL AND deleted_at IS NULL`,
    )
    .all(...listingIds) as { couple_id: number }[];
  return new Set(rows.map((r) => r.couple_id));
}

interface MessageEdges {
  couple: number | null;
  vendor: number | null;
}

/** Newest message per (booking, sender) for a batch of bookings. */
function messageEdgesFor(bookingIds: number[]): Map<number, MessageEdges> {
  const out = new Map<number, MessageEdges>();
  if (bookingIds.length === 0) return out;
  // A message the AUTOMATION engine wrote is not a reply. An auto-acknowledgement
  // is a machine saying "we have this"; the couple is still waiting for a human,
  // and counting it would silence both `unanswered` and `going_cold` forever on
  // any vendor who armed one. Excluding it here rather than in the automation
  // module is what keeps the queue, the CTA and the reminder mail reading the
  // same fact, which is the whole point of a single derivation.
  const rows = db
    .prepare(
      `SELECT booking_id, sender_kind, MAX(created_at) AS last_at
         FROM booking_messages
        WHERE booking_id IN (${bookingIds.map(() => "?").join(",")})
          AND id NOT IN (
                SELECT message_id FROM vendor_automation_runs WHERE message_id IS NOT NULL
              )
        GROUP BY booking_id, sender_kind`,
    )
    .all(...bookingIds) as { booking_id: number; sender_kind: string; last_at: number }[];
  for (const r of rows) {
    const entry = out.get(r.booking_id) ?? { couple: null, vendor: null };
    if (r.sender_kind === "couple") entry.couple = r.last_at;
    else if (r.sender_kind === "vendor") entry.vendor = r.last_at;
    out.set(r.booking_id, entry);
  }
  return out;
}

interface PaymentEdges {
  count: number;
  next_unpaid_due: string | null;
}

/** Installment count + earliest unpaid due date per booking. */
function paymentEdgesFor(bookingIds: number[]): Map<number, PaymentEdges> {
  const out = new Map<number, PaymentEdges>();
  if (bookingIds.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT booking_id,
              COUNT(*) AS n,
              MIN(CASE WHEN paid = 0 AND due_date IS NOT NULL THEN due_date END) AS next_due
         FROM vendor_client_payments
        WHERE booking_id IN (${bookingIds.map(() => "?").join(",")})
        GROUP BY booking_id`,
    )
    .all(...bookingIds) as { booking_id: number; n: number; next_due: string | null }[];
  for (const r of rows) out.set(r.booking_id, { count: r.n, next_unpaid_due: r.next_due });
  return out;
}

/** The two raw hold columns, or the "no hold on file" pair. Raw on purpose:
 *  liveness is derived in `shared/vendor_next_action.ts` from the same
 *  `holdState` every availability read uses. */
interface HoldEdges {
  hold_until: number | null;
  released_at: number | null;
}

const NO_HOLD: HoldEdges = { hold_until: null, released_at: null };

function buildSignals(
  row: BookingRow,
  edges: MessageEdges,
  payments: PaymentEdges,
  reviewed: boolean,
  pro: boolean,
  hold: HoldEdges = NO_HOLD,
): VendorClientSignals {
  return {
    status: row.status,
    created_at: row.created_at,
    vendor_seen_at: vendorSeenAt(row),
    event_date: row.event_date,
    last_couple_message_at: edges.couple,
    last_vendor_message_at: edges.vendor,
    contract_value: (row as BookingRow & { contract_value?: number | null }).contract_value ?? null,
    payment_count: pro ? payments.count : 0,
    next_unpaid_due: pro ? payments.next_unpaid_due : null,
    reviewed,
    snoozed_until: attentionSnoozedUntil(row),
    hold_until: hold.hold_until,
    hold_released_at: hold.released_at,
    pro,
  };
}

/** Signals for a whole booking set, in three queries plus the plan lookup. */
export function clientSignalsForBookings(
  accountId: number,
  rows: BookingRow[],
): Map<number, VendorClientSignals> {
  const out = new Map<number, VendorClientSignals>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const pro = vendorPlanForAccount(accountId) === "pro";
  const edges = messageEdgesFor(ids);
  const payments = pro ? paymentEdgesFor(ids) : new Map<number, PaymentEdges>();
  const reviewed = reviewedCoupleIds(accountId);
  // One query for the whole set, same as the edges above. Fetched on FREE too:
  // the rule itself is skipped there, but a vendor who lapses with holds on
  // file keeps them, and the payload should not start lying about that.
  const holds = holdSignalsFor(ids);
  for (const row of rows) {
    out.set(
      row.id,
      buildSignals(
        row,
        edges.get(row.id) ?? { couple: null, vendor: null },
        payments.get(row.id) ?? { count: 0, next_unpaid_due: null },
        reviewed.has(row.couple_id),
        pro,
        holds.get(row.id) ?? NO_HOLD,
      ),
    );
  }
  return out;
}

/** Single-row form, for the detail paths. The account comes off the row itself
 *  so the mapper's signature stays as it was; a booking with no vendor account
 *  (a curated-listing inquiry) has no vendor to advise, so it derives as FREE
 *  with no reviews, which lands on the same open/reply ladder. */
export function clientSignalsForBooking(row: BookingRow): VendorClientSignals {
  const accountId = row.vendor_account_id;
  if (accountId === null) {
    return buildSignals(
      row,
      messageEdgesFor([row.id]).get(row.id) ?? { couple: null, vendor: null },
      { count: 0, next_unpaid_due: null },
      false,
      false,
    );
  }
  return (
    clientSignalsForBookings(accountId, [row]).get(row.id) ??
    buildSignals(
      row,
      { couple: null, vendor: null },
      { count: 0, next_unpaid_due: null },
      false,
      false,
    )
  );
}

/** Mute a client's attention row for `days`, or clear the mute with `null`.
 *  Returns the stamp now on the row. */
export function snoozeVendorClientAttention(bookingId: number, days: number | null): number | null {
  const until = days === null ? null : now() + days * 86_400_000;
  db.prepare("UPDATE supplier_bookings SET attention_snoozed_until = ? WHERE id = ?").run(
    until,
    bookingId,
  );
  return until;
}

/** `vendor_seen_at` off a widened row — the column is additive (db.ts) so it
 *  isn't on the base BookingRow type, same as the CRM columns above. */
function vendorSeenAt(row: BookingRow): number | null {
  return (row as BookingRow & { vendor_seen_at?: number | null }).vendor_seen_at ?? null;
}

/** Stamp "the vendor has opened this inquiry", first-wins, and return the stamp
 *  that is now on the row. Deliberately leaves `updated_at` and the booking
 *  STATUS alone: reading a lead is not a reply and not triage, and the couple
 *  reads the status. Idempotent, so a re-opened detail page can call it freely. */
export function markVendorClientSeen(bookingId: number): number {
  const ts = now();
  db.prepare(
    "UPDATE supplier_bookings SET vendor_seen_at = COALESCE(vendor_seen_at, ?) WHERE id = ?",
  ).run(ts, bookingId);
  const row = db
    .prepare("SELECT vendor_seen_at AS seen FROM supplier_bookings WHERE id = ?")
    .get(bookingId) as { seen: number | null } | undefined;
  return row?.seen ?? ts;
}

/** Map a booking row to the full PRO CRM detail (notes + contact + schedule). */
export function toVendorClientDetail(
  row: BookingRow,
  signals?: VendorClientSignals,
): VendorClientDetail {
  const base = toVendorClientView(row, undefined, signals);
  const vendorNotes = (row as BookingRow & { vendor_notes?: string | null }).vendor_notes ?? null;
  return {
    ...base,
    vendor_notes: vendorNotes,
    inquiry_message: row.notes,
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
  // NOT rows.map(toVendorClientView): Array.map passes the index as the second
  // argument, which would land in `unread` and badge every row with its own
  // position.
  const unread = unreadCountsByBooking(
    rows.map((r) => r.id),
    "vendor",
  );
  const signals = clientSignalsForBookings(accountId, rows);
  return rows.map((r) => toVendorClientView(r, unread.get(r.id) ?? 0, signals.get(r.id)));
}

/** Same list with the full CRM detail (notes + contact + payment schedule)
 *  per client — the data-export shape. */
export function listVendorClientDetails(accountId: number): VendorClientDetail[] {
  const rows = db
    .prepare("SELECT * FROM supplier_bookings WHERE vendor_account_id = ? ORDER BY created_at DESC")
    .all(accountId) as BookingRow[];
  const signals = clientSignalsForBookings(accountId, rows);
  return rows.map((r) => toVendorClientDetail(r, signals.get(r.id)));
}

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
const YEAR_MS = 1000 * 60 * 60 * 24 * 365;

/** Which of these listings have finished the whole setup checklist — the batch
 *  form of `listingCompleteness(...) === 100`, for the directory views that
 *  render a page of cards at once and decide per card whether the verified
 *  check is solid or hollow.
 *
 *  Three queries total regardless of how many ids come in (the columns, then
 *  the two counts grouped), because the per-listing form does two COUNTs each
 *  and a directory page is hundreds of cards.
 *
 *  Callers pass only CLAIMED listing ids: an unclaimed entry wears no badge, so
 *  its completeness is a question nobody asks, and skipping it keeps the
 *  placeholder list the size of the vendor roster rather than the catalogue. */
export function completeListingIds(ids: string[]): Set<string> {
  const complete = new Set<string>();
  if (ids.length === 0) return complete;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, category, hero_image_url, blurb_hu, blurb_en, city, contact_email,
              contact_phone, price_band, capacity_min, capacity_max
         FROM listings WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<
    { id: string } & Omit<VendorListingChecklistInput, "photo_count" | "package_count">
  >;
  if (rows.length === 0) return complete;
  const countBy = (table: "listing_photos" | "listing_packages") =>
    new Map(
      (
        db
          .prepare(
            `SELECT listing_id, COUNT(*) AS n FROM ${table}
              WHERE listing_id IN (${placeholders}) GROUP BY listing_id`,
          )
          .all(...ids) as Array<{ listing_id: string; n: number }>
      ).map((r) => [r.listing_id, r.n] as const),
    );
  const photos = countBy("listing_photos");
  const packages = countBy("listing_packages");
  for (const row of rows) {
    const steps = listingChecklistFor({
      ...row,
      photo_count: photos.get(row.id) ?? 0,
      package_count: packages.get(row.id) ?? 0,
    });
    if (listingCompletenessFor(steps) >= 100) complete.add(row.id);
  }
  return complete;
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
  // Still 'requested' AND never opened. The nav badge counts THIS rather than
  // by_status.requested, so a lead the vendor has read stops shouting even when
  // they never move the status along.
  let newInquiries = 0;
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "requested" && vendorSeenAt(r) === null) newInquiries += 1;
    if (nowMs - r.created_at <= THIRTY_DAYS_MS) inquiries30d += 1;
    if (nowMs - r.created_at <= YEAR_MS) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    // Tracked revenue = deposits actually recorded against the vendor's
    // bookings (money in), not the agreed contract totals.
    const dp = (r as BookingRow & { deposit_paid?: number | null }).deposit_paid;
    if (typeof dp === "number") revenue += dp;
  }
  const inquiriesByDay = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
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
  // EVERY listing the account owns (its own `v{N}` card plus anything it
  // claimed), because a vendor thinks in terms of "my profile", not one row per
  // directory source. Same rule the admin vendor row already used for its
  // counts, and the reason this list is resolved once here: the review counter
  // below used to take `getListingByVendorAccountId`, i.e. `ORDER BY updated_at
  // DESC LIMIT 1`, so a two-listing vendor was told about reviews on whichever
  // card they had most recently edited and silently not about the other.
  const listingIds = (
    db.prepare("SELECT id FROM listings WHERE vendor_account_id = ?").all(accountId) as {
      id: string;
    }[]
  ).map((r) => r.id);
  // Reviews land on the LISTING (supplier_reviews.supplier_id is the listing id),
  // so an account with no listing yet simply has none. Only published,
  // non-deleted rows count — a vendor should never be pinged about a review a
  // couple can't see.
  const reviewsRecent =
    listingIds.length === 0
      ? 0
      : (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM supplier_reviews
                WHERE supplier_id IN (${listingIds.map(() => "?").join(", ")})
                  AND published = 1 AND deleted_at IS NULL
                  AND created_at >= ?`,
            )
            .get(...listingIds, nowMs - THIRTY_DAYS_MS) as { n: number }
        ).n;
  const views = viewCountsForListings(listingIds);
  // The setup checklist is genuinely about ONE card, the profile the vendor
  // edits, so it keeps the single-listing lookup on purpose.
  const listing = getListingByVendorAccountId(accountId);
  const sub = getVendorSub(accountId);
  const billing = sub
    ? toVendorBilling(sub)
    : {
        subscription_status: "trialing" as const,
        trial_ends_at: null,
        founding_until: null,
        is_founding_member: false,
        is_early_member: false,
        current_period_end: null,
        past_due_since: null,
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
    new_inquiries: newInquiries,
    upcoming,
    inquiries_by_day: inquiriesByDay,
    views_total: views.total,
    views_30d: views.d30,
    views_7d: views.d7,
    blocked_dates_count: blocked.n,
    reviews_recent: reviewsRecent,
    unread_messages: vendorUnreadTotal(accountId),
    listing_completeness: listingCompleteness(listing),
    listing_steps: listingChecklist(listing),
    revenue_tracked: revenue,
    currency: billing.currency,
    billing,
  };
}
