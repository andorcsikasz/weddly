// Day-of run-of-show ("Schedule") shared types. Kept in its own module because
// the cluster is self-contained and the page agents wire their own copies of
// these interfaces — keeping them out of types.ts avoids cross-feature noise.

import type { UnixMs } from "./types";

/** One row of the wedding-day timeline. Time is stored as minutes from
 *  midnight (0..1439) in wedding-day-local time, deliberately *not* a full
 *  timestamp — the date itself may shift right up to D-1, and decoupling the
 *  timeline from `couples.wedding_date` means a date change doesn't rewrite
 *  every row. */
export interface ScheduleEvent {
  id: number;
  couple_id: number;
  label: string;
  /** Minutes from midnight, 0..1439. */
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

/** Time bounds — exported so the page agents validate identically. */
export const SCHEDULE_MAX_MINUTES = 1439;
export const SCHEDULE_MIN_DURATION = 1;
export const SCHEDULE_MAX_DURATION = 1440;
export const SCHEDULE_MAX_LABEL_LEN = 200;
export const SCHEDULE_MAX_LOCATION_LEN = 200;
export const SCHEDULE_MAX_NOTES_LEN = 2000;
