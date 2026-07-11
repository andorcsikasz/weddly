// Planner directory analytics — the planner-side twin of `supplier_views`.
// Records couple-facing card telemetry (impressions + click-throughs) keyed by
// the planner's user id, and aggregates lifetime + 30-day windows for the admin
// Szervezők list. Kept deliberately small: one scan over `planner_card_events`,
// no finer buckets until the metric earns them.

import type { PlannerAnalytics, PlannerEventInput, PlannerEventType } from "@shared/types";
import { db, now } from "../db";

const VALID_EVENT_TYPES: ReadonlySet<PlannerEventType> = new Set([
  "impression",
  "profile_click",
  "connect_click",
  "website_click",
]);

/** The set of planner user ids the directory can legitimately report on — every
 *  live planner `users` row. Drops events for anyone who isn't a planner so a
 *  malformed client payload can't poison the table. Recomputed per call; the
 *  planner population is small. */
function knownPlannerIds(): Set<number> {
  const rows = db
    .prepare("SELECT id FROM users WHERE user_type = 'planner'")
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** Insert a batch of planner card events. Silently drops entries with an
 *  unknown planner id or event type. Returns the number of rows persisted. */
export function recordPlannerEvents(
  events: PlannerEventInput[],
  userId: number | null,
  coupleId: number | null,
): number {
  if (events.length === 0) return 0;
  const validIds = knownPlannerIds();
  const ts = now();
  const insert = db.prepare(
    `INSERT INTO planner_card_events (planner_user_id, event_type, user_id, couple_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let written = 0;
  const tx = db.transaction((rows: PlannerEventInput[]) => {
    for (const e of rows) {
      if (!e || typeof e.planner_user_id !== "number" || typeof e.type !== "string") continue;
      if (!VALID_EVENT_TYPES.has(e.type)) continue;
      if (!validIds.has(e.planner_user_id)) continue;
      insert.run(e.planner_user_id, e.type, userId, coupleId, ts);
      written++;
    }
  });
  tx(events);
  return written;
}

export function emptyPlannerAnalytics(): PlannerAnalytics {
  return {
    views_total: 0,
    views_30d: 0,
    clicks_total: 0,
    clicks_30d: 0,
    connect_clicks_total: 0,
    last_event_at: null,
  };
}

/** Per-planner analytics keyed by planner user id. `impression` → views;
 *  every other type folds into clicks (with connect_click isolated too). One
 *  scan over `planner_card_events`; safe well past the embedded SQLite comfort zone. */
export function aggregatePlannerAnalytics(): Map<number, PlannerAnalytics> {
  const out = new Map<number, PlannerAnalytics>();
  const ts = now();
  const cut30 = ts - 30 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare("SELECT planner_user_id, event_type, created_at FROM planner_card_events")
    .all() as { planner_user_id: number; event_type: string; created_at: number }[];
  for (const r of rows) {
    const a = out.get(r.planner_user_id) ?? emptyPlannerAnalytics();
    if (r.event_type === "impression") {
      a.views_total++;
      if (r.created_at >= cut30) a.views_30d++;
    } else {
      a.clicks_total++;
      if (r.created_at >= cut30) a.clicks_30d++;
      if (r.event_type === "connect_click") a.connect_clicks_total++;
    }
    if (a.last_event_at === null || r.created_at > a.last_event_at) {
      a.last_event_at = r.created_at;
    }
    out.set(r.planner_user_id, a);
  }
  return out;
}
