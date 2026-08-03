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
  coerceBufferMin,
  defaultBuffersForCategory,
  emptyWeeklyHours,
  hoursFromWeekdays,
  MAX_SCHEDULE_NAME_LEN,
  normalizeWeeklyHours,
  parseWeekdays,
  serializeWeekdays,
  type VendorAvailabilitySettings,
  type VendorBuffers,
  type Weekday,
  type WeeklyHours,
  weekdaysFromHours,
} from "@shared/vendor_availability";

interface SettingsRow {
  vendor_account_id: number;
  weekdays: string | null;
  schedule_name: string | null;
  buffer_before_min: number | null;
  buffer_after_min: number | null;
  calendar_public: number;
}

/** The listing category this vendor's buffer defaults come from. A vendor owns
 *  one listing; a missing one just means no category-specific suggestion. */
function categoryForVendor(vendorAccountId: number): string | null {
  const row = db
    .prepare("SELECT category FROM listings WHERE vendor_account_id = ? LIMIT 1")
    .get(vendorAccountId) as { category: string | null } | undefined;
  return row?.category ?? null;
}

/** Resolved setup/teardown padding: the vendor's own numbers, or their
 *  category's suggestion while both are still NULL. Resolved TOGETHER on
 *  purpose: setting only "after" would otherwise leave "before" following the
 *  category, so the pair would come from two different decisions. */
export function getVendorBuffers(vendorAccountId: number): VendorBuffers & { is_default: boolean } {
  const row = db
    .prepare(
      "SELECT buffer_before_min, buffer_after_min FROM vendor_availability_settings WHERE vendor_account_id = ?",
    )
    .get(vendorAccountId) as
    | Pick<SettingsRow, "buffer_before_min" | "buffer_after_min">
    | undefined;
  const before = row?.buffer_before_min ?? null;
  const after = row?.buffer_after_min ?? null;
  if (before === null && after === null) {
    return { ...defaultBuffersForCategory(categoryForVendor(vendorAccountId)), is_default: true };
  }
  return { before_min: before ?? 0, after_min: after ?? 0, is_default: false };
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
      "SELECT weekdays, schedule_name, calendar_public FROM vendor_availability_settings WHERE vendor_account_id = ?",
    )
    .get(vendorAccountId) as
    | Pick<SettingsRow, "weekdays" | "schedule_name" | "calendar_public">
    | undefined;
  const weekdays = parseWeekdays(row?.weekdays ?? null);
  const buffers = getVendorBuffers(vendorAccountId);
  return {
    weekdays,
    schedule_name: row?.schedule_name ?? "",
    working_hours: readStoredHours(vendorAccountId) ?? hoursFromWeekdays(weekdays),
    buffer_before_min: buffers.before_min,
    buffer_after_min: buffers.after_min,
    buffer_is_default: buffers.is_default,
    calendar_public: isVendorCalendarPublic(vendorAccountId),
  };
}

/** Whether couples may see this vendor's availability. A vendor with no
 *  settings row has never answered, and the answer everyone starts on is yes —
 *  the same default the column carries, kept here too so a read that predates
 *  the row does not have to know that. */
export function isVendorCalendarPublic(vendorAccountId: number): boolean {
  const row = db
    .prepare("SELECT calendar_public FROM vendor_availability_settings WHERE vendor_account_id = ?")
    .get(vendorAccountId) as Pick<SettingsRow, "calendar_public"> | undefined | null;
  return (row?.calendar_public ?? 1) !== 0;
}

/** Publish or unpublish the vendor's availability. Its own writer rather than a
 *  field on `setVendorSchedule`, because it decides whether the schedule is
 *  SHOWN, not what the schedule is: a vendor who hides their calendar keeps
 *  every working hour and every blocked date they have entered, and gets all of
 *  it back the moment they turn it on again. */
export function setVendorCalendarPublic(vendorAccountId: number, isPublic: boolean): void {
  const ts = now();
  db.prepare(
    `INSERT INTO vendor_availability_settings
       (vendor_account_id, weekdays, calendar_public, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?)
     ON CONFLICT(vendor_account_id) DO UPDATE SET
       calendar_public = excluded.calendar_public,
       updated_at      = excluded.updated_at`,
  ).run(vendorAccountId, isPublic ? 1 : 0, ts, ts);
}

/** Store the vendor's own buffers. Passing null for BOTH clears back to the
 *  category default; passing one number pins the pair (the other resolves to
 *  what was showing), so the vendor can never end up half-defaulted. */
export function setVendorBuffers(
  vendorAccountId: number,
  input: { beforeMin: number | null; afterMin: number | null },
): void {
  const before = coerceBufferMin(input.beforeMin);
  const after = coerceBufferMin(input.afterMin);
  const ts = now();
  if (before === null && after === null) {
    db.prepare(
      `UPDATE vendor_availability_settings
          SET buffer_before_min = NULL, buffer_after_min = NULL, updated_at = ?
        WHERE vendor_account_id = ?`,
    ).run(ts, vendorAccountId);
    return;
  }
  const current = getVendorBuffers(vendorAccountId);
  db.prepare(
    `INSERT INTO vendor_availability_settings
       (vendor_account_id, weekdays, buffer_before_min, buffer_after_min, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?)
     ON CONFLICT(vendor_account_id) DO UPDATE SET
       buffer_before_min = excluded.buffer_before_min,
       buffer_after_min  = excluded.buffer_after_min,
       updated_at        = excluded.updated_at`,
  ).run(vendorAccountId, before ?? current.before_min, after ?? current.after_min, ts, ts);
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
