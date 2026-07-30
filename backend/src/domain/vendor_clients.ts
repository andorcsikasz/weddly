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
import { unreadCount, unreadCountsByBooking, vendorUnreadTotal } from "./booking_messages";
import { countListingPackages, countListingPhotos, getListingByVendorAccountId } from "./listings";
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
 *  `unread` is passed in by the list path, which resolves the whole set in one
 *  query; the single-row callers let it default. */
export function toVendorClientView(row: BookingRow, unread?: number): VendorClientView {
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
    unread_count: unread ?? unreadCount(row.id, "vendor"),
  };
}

/** Map a booking row to the full PRO CRM detail (notes + contact + schedule). */
export function toVendorClientDetail(row: BookingRow): VendorClientDetail {
  const base = toVendorClientView(row);
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
  // NOT rows.map(toVendorClientView): Array.map passes the index as the second
  // argument, which would land in `unread` and badge every row with its own
  // position.
  const unread = unreadCountsByBooking(
    rows.map((r) => r.id),
    "vendor",
  );
  return rows.map((r) => toVendorClientView(r, unread.get(r.id) ?? 0));
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
const YEAR_MS = 1000 * 60 * 60 * 24 * 365;

/** The vendor's listing-setup checklist. The RULES live in
 *  `listingChecklistFor` (shared/), so the dashboard ring, the listing-editor
 *  chip and this payload can't drift; all this adds is the two DB counts. A
 *  vendor with no listing yet has every step undone. */
export function listingChecklist(listing: Listing | null): VendorListingStep[] {
  return listingChecklistFor({
    category: listing?.category ?? null,
    hero_image_url: listing?.hero_image_url ?? null,
    blurb_hu: listing?.blurb_hu ?? null,
    blurb_en: listing?.blurb_en ?? null,
    city: listing?.city ?? null,
    contact_email: listing?.contact_email ?? null,
    contact_phone: listing?.contact_phone ?? null,
    price_band: listing?.price_band ?? null,
    capacity_min: listing?.capacity_min ?? null,
    capacity_max: listing?.capacity_max ?? null,
    photo_count: listing ? countListingPhotos(listing.id) : 0,
    package_count: listing ? countListingPackages(listing.id) : 0,
  });
}

/** Percent (0..100) of the checklist a vendor has completed. */
export function listingCompleteness(listing: Listing | null): number {
  if (!listing) return 0;
  return listingCompletenessFor(listingChecklist(listing));
}

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
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
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
