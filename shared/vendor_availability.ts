// Vendor availability resolution — the single source of truth for "is this
// vendor free on date X", shared by the backend (public availability payload,
// next-free date, Google Calendar sync) and the frontend (vendor calendar,
// public busy calendar).
//
// TWO LAYERS, deliberately:
//
//   1. A recurring WEEKLY PATTERN — which weekdays the vendor generally works
//      (e.g. only Fri/Sat/Sun). This is the general default, so a vendor who
//      never works Mondays doesn't have to block 52 Mondays a year by hand.
//   2. Per-date EXCEPTIONS on top, in both directions: a blocked day (whole or
//      partial hours) on a day the pattern says yes, and an "exceptionally
//      working" day on one the pattern says no.
//
// Day granularity, NOT hour granularity, for the weekly layer. A wedding vendor
// takes one wedding per day; an hour-level weekly schedule (the Calendly model)
// is built for back-to-back meetings and would be mostly unused complexity here.
// Hours still exist, but only as a per-date exception ("busy 09:00-13:00").
//
// BACK-COMPAT: a null pattern means "available every day", which is exactly the
// behaviour before this existed. Every pre-existing vendor therefore keeps
// working unchanged with no migration.

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ALL_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** ISO weekday for a 'YYYY-MM-DD' string. Parsed as UTC midnight so the weekday
 *  can't shift under a negative timezone offset. */
export function isoWeekday(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`);
  const js = d.getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

/** Parse a stored weekday set. `null`/empty/corrupt → null, meaning "no pattern
 *  set, available every day". Note the deliberate asymmetry with blocked hours:
 *  a corrupt hour list degrades to MORE restrictive (whole day blocked), but a
 *  corrupt weekday set degrades to LESS restrictive (every day available) —
 *  because the safe failure here is a vendor who looks bookable and declines,
 *  not one who silently vanishes from every search. */
export function parseWeekdays(raw: string | null): Weekday[] | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const days = parsed
      .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    const unique = [...new Set(days)] as Weekday[];
    // An explicitly empty set would mean "never available", which no vendor
    // wants and which would silently hide their listing. Treat it as unset.
    return unique.length > 0 ? unique : null;
  } catch {
    return null;
  }
}

/** Serialize a weekday set for storage. A full week (or null) stores as null,
 *  so "works every day" has exactly one representation. */
export function serializeWeekdays(days: readonly Weekday[] | null): string | null {
  if (!days || days.length === 0 || days.length >= 7) return null;
  return JSON.stringify([...new Set(days)].sort((a, b) => a - b));
}

/** How a single day reads. `partial` still counts as bookable — the vendor has
 *  only marked some hours busy. */
export type DayAvailability = "available" | "partial" | "unavailable";

/** A per-date exception. `available: true` is the "exceptionally working"
 *  direction; `available: false` is a block, where `hours === null` means the
 *  whole day and a non-empty list means only those hours. */
export interface AvailabilityException {
  available: boolean;
  hours: number[] | null;
}

/** Resolve one day. Order matters: a confirmed booking beats everything (the
 *  date is genuinely taken), then explicit per-date exceptions, then the weekly
 *  pattern, then the "available by default" fallback. */
export function resolveDayAvailability(input: {
  /** The vendor already has a confirmed wedding this day. */
  hasConfirmedBooking: boolean;
  /** The per-date exception for this day, if any. */
  exception?: AvailabilityException | null;
  /** The weekly pattern; null = every day. */
  weekdays: readonly Weekday[] | null;
  date: string;
}): DayAvailability {
  if (input.hasConfirmedBooking) return "unavailable";

  const ex = input.exception;
  if (ex) {
    if (ex.available) return "available";
    return ex.hours && ex.hours.length > 0 ? "partial" : "unavailable";
  }

  if (input.weekdays && !input.weekdays.includes(isoWeekday(input.date))) {
    return "unavailable";
  }
  return "available";
}

/** True when a day can still take a booking (free, or only partly blocked). */
export function isBookableDay(a: DayAvailability): boolean {
  return a !== "unavailable";
}

/** The vendor's recurring availability policy. Its own resource (and its own
 *  endpoint) rather than a field on the blocked-dates view, because it is
 *  settings rather than data — and because this is where the rest of the
 *  scheduling controls will land (minimum notice, booking horizon, buffers). */
export interface VendorAvailabilitySettings {
  /** ISO weekday numbers the vendor generally works; null = every day. */
  weekdays: Weekday[] | null;
}

/** Validate an inbound weekday list. Throws-free: returns null for anything
 *  that isn't a usable set, which the caller treats as "every day". */
export function coerceWeekdays(raw: unknown): Weekday[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const days = raw.filter(
    (d): d is Weekday => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7,
  );
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length > 0 && unique.length < 7 ? unique : null;
}
