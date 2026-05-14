// Day-of run-of-show ("Schedule") shared types. Kept in its own module because
// the cluster is self-contained and the page agents wire their own copies of
// these interfaces — keeping them out of types.ts avoids cross-feature noise.

import type { UnixMs } from "./types";

/** One row of the wedding-day timeline. Time is stored as minutes from
 *  the wedding-day's local midnight (0..2879 — two 24h spans, so an
 *  afternoon ceremony that runs into the small hours of the next morning
 *  can be expressed as 1440+ without wrapping). Deliberately *not* a full
 *  timestamp — the date itself may shift right up to D-1, and decoupling
 *  the timeline from `couples.wedding_date` means a date change doesn't
 *  rewrite every row. The UI renders 1440+ as HH:MM with a "next day"
 *  badge; sort order is the raw minutes value, so day-2 rows naturally
 *  follow day-1 rows. */
export interface ScheduleEvent {
  id: number;
  couple_id: number;
  label: string;
  /** Minutes from wedding-day-local midnight, 0..2879 (covers the day
   *  itself + the small hours of the next morning). */
  starts_at_minutes: number;
  /** Optional. Minutes the event runs for (1..1440). `null` = display the
   *  event as a single bullet with no end time. */
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
  /** Tiebreaker for events that share the same `starts_at_minutes`. Server
   *  returns rows ordered by (starts_at_minutes, sort_order, id). */
  sort_order: number;
  created_at: UnixMs;
  /** Used by the frontend as the `If-Match` value for optimistic concurrency
   *  guarding on PATCH. Server-set on every write. */
  updated_at: UnixMs;
}

/** Create payload. PATCH uses Partial<UpsertScheduleEventInput>. */
export interface UpsertScheduleEventInput {
  label: string;
  starts_at_minutes: number;
  duration_minutes?: number | null;
  location?: string | null;
  notes?: string | null;
  sort_order?: number;
}

/** Time bounds — exported so the page agents validate identically. Two-day
 *  ceiling so weddings that run past midnight can store post-midnight rows
 *  as 1440+ minutes instead of wrapping back to a day-1 clock value (which
 *  would break sort order on the schedule page + PDF). */
export const SCHEDULE_MAX_MINUTES = 2879;
/** First minute of the next calendar day. Used as the boundary that
 *  separates day-1 rows from day-2 rows when rendering badges. */
export const SCHEDULE_DAY_TWO_MINUTES = 1440;
export const SCHEDULE_MIN_DURATION = 1;
export const SCHEDULE_MAX_DURATION = 1440;
export const SCHEDULE_MAX_LABEL_LEN = 200;
export const SCHEDULE_MAX_LOCATION_LEN = 200;
export const SCHEDULE_MAX_NOTES_LEN = 2000;
