// Planning items — one table backs the three tabs on /app/planning:
// tasks (checklist), ideas (free-form notes), schedule (wedding-day timeline).
// All queries take a coupleId; the caller is responsible for scoping to the
// authenticated couple via getCoupleForUser.

import type { PlanningItem, PlanningKind } from "@shared/types";
import { db } from "../db";

const VALID_KINDS: ReadonlySet<PlanningKind> = new Set(["task", "idea", "schedule"]);

export function isPlanningKind(s: string): s is PlanningKind {
  return VALID_KINDS.has(s as PlanningKind);
}

export interface PlanningItemRow {
  id: number;
  couple_id: number;
  kind: string;
  title: string;
  body: string | null;
  done: number;
  due_date: string | null;
  scheduled_time: string | null;
  assignee: string | null;
  suggested_by_user_id: number | null;
  start_date: string | null;
  supplier_id: string | null;
  /** 0 = no flag, 1 = important ("!"), 2 = SOS ("!!"). Tasks only. */
  priority: number;
  position: number;
  created_at: number;
  updated_at: number;
}

/** Listing rows carry the resolved suggester name via LEFT JOIN on users.
 *  Single-row fetchers (`getPlanningItemScoped`) read without the join, so
 *  callers wrapping a write should hit `getPlanningItemJoined` to surface the
 *  display name in the response. */
export interface PlanningItemJoinedRow extends PlanningItemRow {
  suggested_by_name: string | null;
}

export function toPlanningItem(row: PlanningItemJoinedRow): PlanningItem {
  return {
    id: row.id,
    couple_id: row.couple_id,
    kind: (isPlanningKind(row.kind) ? row.kind : "task") as PlanningKind,
    title: row.title,
    body: row.body,
    done: Boolean(row.done),
    due_date: row.due_date,
    scheduled_time: row.scheduled_time,
    assignee: row.assignee,
    suggested_by_user_id: row.suggested_by_user_id,
    suggested_by_name: row.suggested_by_name,
    start_date: row.start_date,
    supplier_id: row.supplier_id,
    priority: row.priority === 1 || row.priority === 2 ? (row.priority as 1 | 2) : 0,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const LIST_SELECT = `
  SELECT pi.*, u.full_name AS suggested_by_name
    FROM planning_items pi
    LEFT JOIN users u ON u.id = pi.suggested_by_user_id
`;

export function listPlanningItemsByCouple(coupleId: number): PlanningItem[] {
  // Order: schedule entries by scheduled_time (then position) — the others
  // by position then created_at, so newest stays at the bottom of the list.
  const rows = db
    .prepare(
      `${LIST_SELECT}
         WHERE pi.couple_id = ?
         ORDER BY
           CASE WHEN pi.kind = 'schedule' AND pi.scheduled_time IS NOT NULL THEN 0 ELSE 1 END,
           pi.scheduled_time ASC,
           pi.position ASC,
           pi.created_at ASC,
           pi.id ASC`,
    )
    .all(coupleId) as PlanningItemJoinedRow[];
  return rows.map(toPlanningItem);
}

export function getPlanningItemScoped(id: number, coupleId: number): PlanningItemRow | null {
  return (
    (db.prepare("SELECT * FROM planning_items WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | PlanningItemRow
      | undefined) ?? null
  );
}

/** Re-fetch after a write so the response carries the up-to-date
 *  `suggested_by_name` join. */
export function getPlanningItemJoined(id: number, coupleId: number): PlanningItemJoinedRow | null {
  return (
    (db.prepare(`${LIST_SELECT} WHERE pi.id = ? AND pi.couple_id = ?`).get(id, coupleId) as
      | PlanningItemJoinedRow
      | undefined) ?? null
  );
}
