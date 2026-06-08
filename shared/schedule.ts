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
  /** Run-sheet ("forgatókönyv") fields — who runs this beat on the day, and
   *  which booked supplier it belongs to. Free-text + a loose reference (no
   *  hard FK), mirroring planning_items.assignee / supplier_id. */
  responsible: string | null;
  /** Loose reference to `couple_suppliers.id`. Null = not tied to a supplier.
   *  Dangling ids (supplier later deleted) just render without a name. */
  couple_supplier_id: string | null;
  /** Tiebreaker for events that share the same `starts_at_minutes`. Server
   *  returns rows ordered by (starts_at_minutes, sort_order, id). */
  sort_order: number;
  /** Couple-flagged "headline beat" surfaced on the public wedding site's
   *  "A nap menete" row. At most `MAX_KEY_MOMENTS` per couple (server-enforced).
   *  When none are flagged the public site falls back to a heuristic default. */
  is_key_moment: boolean;
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
  responsible?: string | null;
  couple_supplier_id?: string | null;
  sort_order?: number;
  is_key_moment?: boolean;
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
export const SCHEDULE_MAX_RESPONSIBLE_LEN = 80;
export const SCHEDULE_MAX_SUPPLIER_ID_LEN = 64;

/** The public wedding site surfaces only the day's headline beats — at most
 *  this many — as a single tidy row, instead of the full internal run-sheet. */
export const MAX_KEY_MOMENTS = 4;

/** Minimal shape `pickKeyMoments` needs. `is_key_moment` is optional so the
 *  helper works against both the in-app `ScheduleEvent` and the public DTO,
 *  and degrades to the heuristic when the flag isn't carried yet. */
export interface KeyMomentCandidate {
  label: string;
  starts_at_minutes: number;
  is_key_moment?: boolean;
}

// Accent-folded keyword buckets for the default "headline beats" pick, in the
// order a wedding day reads: arrival -> ceremony -> dinner -> first dance. Both
// Hungarian and English stems are covered. Only consulted when the couple
// hasn't hand-picked any key moments of their own.
const KEY_MOMENT_BUCKETS: readonly (readonly string[])[] = [
  ["erkez", "arriv", "welcome", "gather"],
  ["szertart", "ceremon", "vows", "esku"],
  ["vacsor", "dinner", "feast", "supper"],
  ["tanc", "dance"],
];

function foldLabel(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Pick the day's headline beats for the public site, capped at
 *  `MAX_KEY_MOMENTS` and time-ordered. If the couple flagged any entries as key
 *  moments, those win verbatim. Otherwise fall back to the default
 *  arrival/ceremony/dinner/dance heuristic, padding with the earliest remaining
 *  entries so an unlabelled schedule still fills the row instead of showing
 *  one or two stragglers. */
export function pickKeyMoments<T extends KeyMomentCandidate>(entries: T[]): T[] {
  const byTime = [...entries].sort((a, b) => a.starts_at_minutes - b.starts_at_minutes);

  const flagged = byTime.filter((e) => e.is_key_moment);
  if (flagged.length > 0) return flagged.slice(0, MAX_KEY_MOMENTS);

  const chosen: T[] = [];
  const used = new Set<T>();
  for (const bucket of KEY_MOMENT_BUCKETS) {
    const hit = byTime.find(
      (e) => !used.has(e) && bucket.some((kw) => foldLabel(e.label).includes(kw)),
    );
    if (hit) {
      chosen.push(hit);
      used.add(hit);
    }
  }
  for (const e of byTime) {
    if (chosen.length >= MAX_KEY_MOMENTS) break;
    if (!used.has(e)) {
      chosen.push(e);
      used.add(e);
    }
  }
  return chosen.sort((a, b) => a.starts_at_minutes - b.starts_at_minutes);
}
