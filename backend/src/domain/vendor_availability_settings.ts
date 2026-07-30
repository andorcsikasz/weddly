// Vendor availability SETTINGS: the recurring weekly layer beneath the
// per-date exceptions in `vendor_unavailable_dates`.
//
// Two shapes of the same thing:
//   * `vendor_working_hours` holds the intervals (Monday 09:00-13:00), which is
//     what the vendor edits and what the slot maths reads.
//   * `vendor_availability_settings.weekdays` is the DERIVED day-level mirror,
//     which is what every couple-facing read already used (public availability,
//     next-free date, directory date filter).
//
// `setVendorSchedule` is the ONLY writer of either, so the mirror cannot drift.
// A vendor with no interval rows has never opened the hour editor: their
// schedule is synthesized from `weekdays` as whole days, which is lossless and
// is why hours needed no migration.
//
// Deliberately thin: the resolution RULES live in shared/vendor_availability.ts
// so the vendor calendar, the public busy calendar and the server all answer
// "is this vendor free on X" identically.

import { db, now } from "../db";
import {
  ALL_WEEKDAYS,
  emptyWeeklyHours,
  hoursFromWeekdays,
  MAX_SCHEDULE_NAME_LEN,
  normalizeWeeklyHours,
  parseWeekdays,
  serializeWeekdays,
  type VendorAvailabilitySettings,
  type Weekday,
  type WeeklyHours,
  weekdaysFromHours,
} from "@shared/vendor_availability";

interface SettingsRow {
  vendor_account_id: number;
  weekdays: string | null;
  schedule_name: string | null;
}

/** The vendor's weekly working pattern, or null for "every day". Null is both
 *  the unset default and the explicit full-week value: `serializeWeekdays`
 *  collapses a 7-day set to null so there's one representation. */
export function getVendorWeekdays(vendorAccountId: number): Weekday[] | null {
  const row = db
    .prepare("SELECT weekdays FROM vendor_availability_settings WHERE vendor_account_id = ?")
    .get(vendorAccountId) as Pick<SettingsRow, "weekdays"> | undefined;
  return parseWeekdays(row?.weekdays ?? null);
}

/** The stored intervals, or null when the vendor has none on file (which means
 *  "never opened the hour editor", NOT "works no hours"). */
function readStoredHours(vendorAccountId: number): WeeklyHours | null {
  const rows = db
    .prepare(
      `SELECT weekday, start_min, end_min FROM vendor_working_hours
        WHERE vendor_account_id = ?
        ORDER BY weekday ASC, start_min ASC`,
    )
    .all(vendorAccountId) as Array<{ weekday: number; start_min: number; end_min: number }>;
  if (rows.length === 0) return null;
  const hours = emptyWeeklyHours();
  for (const r of rows) {
    const day = ALL_WEEKDAYS.find((d) => d === r.weekday);
    if (day === undefined) continue; // defensive: a corrupt weekday can't crash the read
    hours[day].push({ start_min: r.start_min, end_min: r.end_min });
  }
  return normalizeWeeklyHours(hours);
}

/** The full schedule the editor and the calendar read. Falls back to the
 *  day-level pattern (whole days) for a vendor with no interval rows. */
export function getVendorSchedule(vendorAccountId: number): VendorAvailabilitySettings {
  const row = db
    .prepare(
      "SELECT weekdays, schedule_name FROM vendor_availability_settings WHERE vendor_account_id = ?",
    )
    .get(vendorAccountId) as Pick<SettingsRow, "weekdays" | "schedule_name"> | undefined;
  const weekdays = parseWeekdays(row?.weekdays ?? null);
  return {
    weekdays,
    schedule_name: row?.schedule_name ?? "",
    working_hours: readStoredHours(vendorAccountId) ?? hoursFromWeekdays(weekdays),
  };
}

/** Replace the whole schedule: the intervals, the derived weekday mirror and the
 *  name, in one transaction. Replace rather than diff because a week is at most
 *  a couple of dozen rows and a partial write here would leave the mirror and
 *  the intervals disagreeing, which is the one failure this file exists to make
 *  impossible.
 *
 *  An all-empty week is refused by the route (it would mean "never available"
 *  and hide the listing from every search); this function trusts its caller. */
export function setVendorSchedule(
  vendorAccountId: number,
  input: { hours: WeeklyHours; scheduleName?: string | null },
): void {
  const hours = normalizeWeeklyHours(input.hours);
  const weekdays = weekdaysFromHours(hours);
  const name = (input.scheduleName ?? "").trim().slice(0, MAX_SCHEDULE_NAME_LEN);
  const ts = now();

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO vendor_availability_settings
         (vendor_account_id, weekdays, schedule_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(vendor_account_id) DO UPDATE SET
         weekdays      = excluded.weekdays,
         schedule_name = excluded.schedule_name,
         updated_at    = excluded.updated_at`,
    ).run(vendorAccountId, serializeWeekdays(weekdays), name, ts, ts);

    db.prepare("DELETE FROM vendor_working_hours WHERE vendor_account_id = ?").run(vendorAccountId);
    const insert = db.prepare(
      `INSERT INTO vendor_working_hours (vendor_account_id, weekday, start_min, end_min, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const d of ALL_WEEKDAYS) {
      for (const iv of hours[d]) insert.run(vendorAccountId, d, iv.start_min, iv.end_min, ts);
    }
  });
  write();
}
