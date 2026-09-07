// Per-user "time actually spent in the app", fed by POST /api/activity/heartbeat
// (routes/activity.ts) and surfaced on the admin users/couples lists (shared/types.ts
// AdminUserActivity.total_active_seconds). See schema.sql's user_activity_daily for
// why the credited amount is a fixed server constant rather than a client-reported
// duration.

import { ACTIVITY_HEARTBEAT_INTERVAL_S } from "@shared/activity";
import { db, now } from "../db";

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Credits one heartbeat's worth of active time to the caller's UTC-day bucket. */
export function recordActivityHeartbeat(userId: number): void {
  const ts = now();
  db.prepare(
    `INSERT INTO user_activity_daily (user_id, day, active_seconds, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       active_seconds = active_seconds + excluded.active_seconds,
       updated_at = excluded.updated_at`,
  ).run(userId, utcDay(ts), ACTIVITY_HEARTBEAT_INTERVAL_S, ts);
}

/** All-time total per user, one query for everyone — used by the admin users
 *  list so a per-row lookup doesn't turn into N+1 reads. */
export function totalActiveSecondsByUserId(): Map<number, number> {
  const rows = db
    .prepare(
      "SELECT user_id, SUM(active_seconds) AS total FROM user_activity_daily GROUP BY user_id",
    )
    .all() as { user_id: number; total: number }[];
  return new Map(rows.map((r) => [r.user_id, r.total]));
}

/** Workspace total = sum across every member's own account, for the admin
 *  couples table (one query per couple, matching toAdminCouple's existing
 *  per-row aggregate queries in routes/admin_users.ts). */
export function totalActiveSecondsForCouple(coupleId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(uad.active_seconds), 0) AS total
         FROM couple_members cm
         JOIN user_activity_daily uad ON uad.user_id = cm.user_id
        WHERE cm.couple_id = ?`,
    )
    .get(coupleId) as { total: number };
  return row.total;
}
