// Revenue Pulse: gathering half. The arithmetic lives in
// `shared/vendor_revenue.ts` and nowhere else; this module only turns a vendor
// account into the flat facts that module eats, in ONE query, following the
// batching idiom `clientSignalsForBookings` established: a vendor's whole
// booking set is resolved in a fixed number of statements regardless of how
// many clients they have.
//
// Nothing new is stored. Every input (status, contract value, deposit paid,
// event date, created_at) is already a column on `supplier_bookings`, so this
// feature needed no schema change and cannot drift from the CRM screens that
// write those columns.

import type { VendorRevenueFact, VendorRevenuePulseView } from "@shared/vendor_revenue";
import { REVENUE_TRAILING_DAYS, vendorRevenuePulse } from "@shared/vendor_revenue";
import { db, now } from "../db";
import type { VendorAccountRow } from "./vendor_accounts";
import { vendorCurrencyForAccount } from "./vendor_clients";

/** The additive CRM columns are not on the base `BookingRow` type (they were
 *  added via `addColumnIfMissing`), so the query names exactly what the pulse
 *  needs and types the result itself. */
interface RevenueRow {
  status: string;
  contract_value: number | null;
  deposit_paid: number | null;
  event_date: string;
  created_at: number;
}

/** Every booking the vendor account owns, as revenue facts. One statement. */
export function revenueFactsForAccount(accountId: number): VendorRevenueFact[] {
  const rows = db
    .prepare(
      `SELECT status, contract_value, deposit_paid, event_date, created_at
         FROM supplier_bookings
        WHERE vendor_account_id = ?`,
    )
    .all(accountId) as RevenueRow[];
  return rows.map((r) => ({
    status: r.status,
    // The columns are plain INTEGER and hand-editable, so a junk value is
    // treated as "not recorded" rather than dragged into a sum as NaN.
    contract_value: Number.isFinite(r.contract_value) ? (r.contract_value as number) : null,
    deposit_paid: Number.isFinite(r.deposit_paid) ? (r.deposit_paid as number) : null,
    event_date: r.event_date,
    created_at: r.created_at,
  }));
}

/** The Revenue Pulse payload for one vendor account. The currency comes from
 *  the vendor's subscription, exactly as `VendorStats.currency` does, so the
 *  two money surfaces are never denominated differently. */
export function buildVendorRevenuePulse(account: VendorAccountRow): VendorRevenuePulseView {
  const pulse = vendorRevenuePulse(revenueFactsForAccount(account.id), now());
  return {
    ...pulse,
    currency: vendorCurrencyForAccount(account.id),
    trailing_days: REVENUE_TRAILING_DAYS,
  };
}
