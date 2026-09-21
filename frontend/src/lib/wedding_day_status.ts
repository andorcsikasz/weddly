// What a vendor's published calendar says about THIS couple's wedding date.
//
// The one question a couple has on a vendor page is "are you free on our day?",
// and the calendar grid answers it only if they hunt for the right month. This
// reduces the same payload to one verdict so the header and the booking card
// can say it outright.
//
// Deliberately conservative, because a wrong "free" costs a couple a booking:
//   - Unclaimed listings, vendors without an entitled calendar (`bookable`
//     false) and vendors who publish no calendar at all answer NULL. Their
//     payload is empty because Weddly does not know, not because the diary is
//     clear, and "free" would be a promise nobody made.
//   - A past wedding date answers NULL: there is nothing to book.
//   - "busy" covers both a blocked date and a weekday the vendor does not work.
//     The public payload carries the weekly pattern but not a hand-opened
//     exception, so the copy says "not available" rather than "booked".

import { isoWeekday } from "@shared/vendor_availability";
import type { SupplierAvailability } from "@shared/suppliers";

export type WeddingDayStatus = "free" | "partial" | "busy";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function weddingDayStatus(
  availability: SupplierAvailability | null,
  weddingDate: string | null,
  today: Date = new Date(),
): WeddingDayStatus | null {
  if (!availability || !weddingDate) return null;
  if (!availability.bookable || !availability.calendar_public) return null;

  const iso = weddingDate.slice(0, 10);
  if (!ISO_DATE.test(iso)) return null;

  const t = today;
  const todayIso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate(),
  ).padStart(2, "0")}`;
  if (iso < todayIso) return null;

  if (availability.unavailable_dates.includes(iso)) return "busy";
  if (availability.partial_dates.includes(iso)) return "partial";

  const weekdays = availability.available_weekdays;
  if (weekdays && !weekdays.includes(isoWeekday(iso))) return "busy";
  return "free";
}
