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

// ── Weekly working HOURS ────────────────────────────────────────────────────
//
// The hour-granular half of the weekly layer, added on top of the day-level
// `weekdays` set above rather than replacing it. Both exist on purpose:
//
//   * `weekdays` is what the COUPLE-facing surfaces read (public availability,
//     next-free date, the directory's date filter). A wedding vendor takes one
//     wedding a day, so "which days do you work" is the whole question there.
//   * `working_hours` is what the VENDOR's own calendar and the slot maths read:
//     which hours of a working day are actually theirs.
//
// `weekdays` is therefore a DERIVED MIRROR of the intervals: a weekday with at
// least one interval is a working day. Every write goes through
// `setVendorSchedule`, which recomputes it, so the two can never disagree and
// nothing downstream of `weekdays` had to change.

/** Minutes from midnight, `end_min` exclusive. 0 = 00:00, 1440 = 24:00. */
export interface WorkInterval {
  start_min: number;
  end_min: number;
}

/** One interval list per ISO weekday. An empty list = the vendor does not work
 *  that day, which is exactly what drops the day out of the derived `weekdays`. */
export type WeeklyHours = Record<Weekday, WorkInterval[]>;

export const DAY_MINUTES = 1440;
/** The step the editor offers. Half hours, because that is the finest grain a
 *  wedding vendor has ever needed and a 15-minute select is 96 options long. */
export const SLOT_MINUTES = 30;
/** Seed for a day the vendor has just switched on. */
export const DEFAULT_WORK_START = 9 * 60;
export const DEFAULT_WORK_END = 17 * 60;
/** Unnamed schedule. The default label is LOCALISED, so the empty string is the
 *  stored value and the editor renders the placeholder in the vendor's language
 *  rather than baking one language's "Alap munkarend" into every account. */
export const UNNAMED_SCHEDULE = "";
export const MAX_SCHEDULE_NAME_LEN = 60;
/** Ceiling per day. Guards the storage and the UI against a pathological paste;
 *  no real week needs more than a morning and an evening block per day. */
export const MAX_INTERVALS_PER_DAY = 6;

export function emptyWeeklyHours(): WeeklyHours {
  return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
}

/** Clean one day's intervals: clamp to the day, drop the empty and inverted,
 *  sort, then MERGE anything overlapping or touching. Merging matters beyond
 *  tidiness: "09:00-12:00 + 11:00-17:00" and "09:00-17:00" have to store
 *  identically, otherwise the same week has two representations and the buffer
 *  maths in phase 3 would count the overlap twice. */
export function normalizeIntervals(list: readonly WorkInterval[]): WorkInterval[] {
  const clean = list
    .map((i) => ({
      start_min: Math.max(0, Math.min(DAY_MINUTES, Math.round(i.start_min))),
      end_min: Math.max(0, Math.min(DAY_MINUTES, Math.round(i.end_min))),
    }))
    .filter((i) => Number.isFinite(i.start_min) && Number.isFinite(i.end_min))
    .filter((i) => i.end_min > i.start_min)
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);

  const out: WorkInterval[] = [];
  for (const iv of clean) {
    const last = out[out.length - 1];
    if (last && iv.start_min <= last.end_min) {
      last.end_min = Math.max(last.end_min, iv.end_min);
    } else {
      out.push({ ...iv });
    }
  }
  return out.slice(0, MAX_INTERVALS_PER_DAY);
}

export function normalizeWeeklyHours(hours: WeeklyHours): WeeklyHours {
  const out = emptyWeeklyHours();
  for (const d of ALL_WEEKDAYS) out[d] = normalizeIntervals(hours[d]);
  return out;
}

/** The day-level mirror: weekdays with at least one interval. Collapses to null
 *  through `serializeWeekdays`' rule (all seven = "every day"), so a vendor who
 *  works every day stores the same null as one who never opened the editor. */
export function weekdaysFromHours(hours: WeeklyHours): Weekday[] | null {
  const days = ALL_WEEKDAYS.filter((d) => hours[d].length > 0);
  return days.length > 0 && days.length < 7 ? [...days] : null;
}

/** True when a day is covered end to end. The legacy day-level pattern reads as
 *  exactly this, so the editor can show "egész nap" instead of "00:00-24:00". */
export function isFullDay(intervals: readonly WorkInterval[]): boolean {
  const first = intervals[0];
  return (
    intervals.length === 1 &&
    first !== undefined &&
    first.start_min === 0 &&
    first.end_min === DAY_MINUTES
  );
}

/** Synthesize hours from a day-only pattern: every working day covered whole.
 *  This is what a vendor who set their pattern before hours existed sees, and
 *  it is lossless in both directions (`weekdaysFromHours` gives the set back). */
export function hoursFromWeekdays(weekdays: readonly Weekday[] | null): WeeklyHours {
  const out = emptyWeeklyHours();
  for (const d of ALL_WEEKDAYS) {
    if (!weekdays || weekdays.includes(d)) out[d] = [{ start_min: 0, end_min: DAY_MINUTES }];
  }
  return out;
}

/** True when the vendor works at all, any day. An all-empty week would mean
 *  "never available" and is refused at the boundary for the same reason an empty
 *  weekday set is: it silently hides the listing from every search. */
export function hasAnyWorkingDay(hours: WeeklyHours): boolean {
  return ALL_WEEKDAYS.some((d) => hours[d].length > 0);
}

/** 'HH:MM', 24:00 included so a full day reads honestly at both ends. */
export function minutesToLabel(min: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Inverse of `minutesToLabel`; null for anything unparseable. */
export function parseMinutes(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || min > 59) return null;
  const total = h * 60 + min;
  return total >= 0 && total <= DAY_MINUTES ? total : null;
}

/** Boundary guard for an inbound weekly-hours object. Returns null (rather than
 *  throwing) for anything unusable, so a caller decides whether that means "no
 *  change" or "400". Unknown keys are ignored; each day is normalized. */
export function coerceWeeklyHours(raw: unknown): WeeklyHours | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out = emptyWeeklyHours();
  for (const d of ALL_WEEKDAYS) {
    const list = src[String(d)];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return null;
    const parsed: WorkInterval[] = [];
    for (const item of list) {
      if (item === null || typeof item !== "object") return null;
      const iv = item as Record<string, unknown>;
      const start = iv.start_min;
      const end = iv.end_min;
      if (typeof start !== "number" || typeof end !== "number") return null;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      parsed.push({ start_min: start, end_min: end });
    }
    out[d] = normalizeIntervals(parsed);
  }
  return out;
}

/** The vendor's recurring availability policy. Its own resource (and its own
 *  endpoint) rather than a field on the blocked-dates view, because it is
 *  settings rather than data, and because this is where the rest of the
 *  scheduling controls will land (minimum notice, booking horizon, buffers). */
export interface VendorAvailabilitySettings {
  /** ISO weekday numbers the vendor generally works; null = every day.
   *  DERIVED from `working_hours` on every write. */
  weekdays: Weekday[] | null;
  /** The schedule's own label, empty string = unnamed (the UI shows a default). */
  schedule_name: string;
  /** Working hours per ISO weekday. */
  working_hours: WeeklyHours;
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
