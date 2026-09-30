// What moves when the wedding day moves.
//
// Two different answers, on purpose:
//   - The guest camera's reveal and shooting window are times ON the day, so
//     they follow it automatically (`shiftCameraWithWedding`). Nobody wants a
//     film that opens before the party.
//   - Open task deadlines are the couple's own plan, and some of them are pinned
//     to something other than the wedding (a venue's payment date, a dress
//     fitting). So those move only when the couple says yes
//     (`shiftOpenDeadlines`), and only the unticked ones: a finished task's date
//     is a record of when it was due, not a plan.

import { daysBetweenIso, shiftIsoDate } from "@shared/date_shift";
import { db, now } from "../db";
import { markCoupleCalendarDirty } from "./google_calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Open tasks that carry a date the shift would move. */
export function countShiftableDeadlines(coupleId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM planning_items
        WHERE couple_id = ? AND kind = 'task' AND done = 0
          AND (due_date IS NOT NULL OR start_date IS NOT NULL)`,
    )
    .get(coupleId) as { n: number };
  return row.n;
}

/** Move every open task's due (and start) date by `days`. Returns how many
 *  rows moved. */
export function shiftOpenDeadlines(coupleId: number, days: number, ts: number): number {
  if (days === 0) return 0;
  const rows = db
    .prepare(
      `SELECT id, due_date, start_date FROM planning_items
        WHERE couple_id = ? AND kind = 'task' AND done = 0
          AND (due_date IS NOT NULL OR start_date IS NOT NULL)`,
    )
    .all(coupleId) as Array<{ id: number; due_date: string | null; start_date: string | null }>;
  const update = db.prepare(
    "UPDATE planning_items SET due_date = ?, start_date = ?, updated_at = ? WHERE id = ?",
  );
  db.transaction(() => {
    for (const r of rows) {
      update.run(
        r.due_date ? shiftIsoDate(r.due_date, days) : null,
        r.start_date ? shiftIsoDate(r.start_date, days) : null,
        ts,
        r.id,
      );
    }
  })();
  if (rows.length > 0) markCoupleCalendarDirty(coupleId);
  return rows.length;
}

/** Slide the couple's guest-camera reveal + shooting window by the same number
 *  of days the wedding moved. Null when there was nothing to move. */
export function shiftCameraWithWedding(
  coupleId: number,
  from: string,
  to: string,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const days = daysBetweenIso(from, to);
  if (!days) return null;
  const albums = db
    .prepare(
      `SELECT id, reveal_at, event_ends_at FROM photo_albums
        WHERE couple_id = ? AND (reveal_at IS NOT NULL OR event_ends_at IS NOT NULL)`,
    )
    .all(coupleId) as Array<{ id: number; reveal_at: number | null; event_ends_at: number | null }>;
  if (albums.length === 0) return null;
  const deltaMs = days * DAY_MS;
  const update = db.prepare(
    "UPDATE photo_albums SET reveal_at = ?, event_ends_at = ?, updated_at = ? WHERE id = ?",
  );
  const ts = now();
  db.transaction(() => {
    for (const a of albums) {
      update.run(
        a.reveal_at === null ? null : a.reveal_at + deltaMs,
        a.event_ends_at === null ? null : a.event_ends_at + deltaMs,
        ts,
        a.id,
      );
    }
  })();
  return {
    before: {
      albums: albums.map((a) => ({
        id: a.id,
        reveal_at: a.reveal_at,
        event_ends_at: a.event_ends_at,
      })),
    },
    after: {
      days,
      albums: albums.map((a) => ({
        id: a.id,
        reveal_at: a.reveal_at === null ? null : a.reveal_at + deltaMs,
        event_ends_at: a.event_ends_at === null ? null : a.event_ends_at + deltaMs,
      })),
    },
  };
}
