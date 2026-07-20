// Vendor availability SETTINGS — the recurring weekly layer beneath the
// per-date exceptions in `vendor_unavailable_dates`.
//
// Deliberately thin: the resolution RULES live in shared/vendor_availability.ts
// so the vendor calendar, the public busy calendar and the server all answer
// "is this vendor free on X" identically. This file only reads and writes the
// stored pattern.

import { db, now } from "../db";
import { parseWeekdays, serializeWeekdays, type Weekday } from "@shared/vendor_availability";

interface SettingsRow {
  vendor_account_id: number;
  weekdays: string | null;
}

/** The vendor's weekly working pattern, or null for "every day". Null is both
 *  the unset default and the explicit full-week value — `serializeWeekdays`
 *  collapses a 7-day set to null so there's one representation. */
export function getVendorWeekdays(vendorAccountId: number): Weekday[] | null {
  const row = db
    .prepare("SELECT weekdays FROM vendor_availability_settings WHERE vendor_account_id = ?")
    .get(vendorAccountId) as Pick<SettingsRow, "weekdays"> | undefined;
  return parseWeekdays(row?.weekdays ?? null);
}

/** Set the weekly pattern. Passing null (or all seven days) clears it back to
 *  "available every day". */
export function setVendorWeekdays(vendorAccountId: number, days: readonly Weekday[] | null): void {
  const ts = now();
  db.prepare(
    `INSERT INTO vendor_availability_settings (vendor_account_id, weekdays, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(vendor_account_id) DO UPDATE SET
       weekdays   = excluded.weekdays,
       updated_at = excluded.updated_at`,
  ).run(vendorAccountId, serializeWeekdays(days), ts, ts);
}
