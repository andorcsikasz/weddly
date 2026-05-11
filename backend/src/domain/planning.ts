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
  position: number;
  created_at: number;
  updated_at: number;
}

export function toPlanningItem(row: PlanningItemRow): PlanningItem {
  return {
    id: row.id,
    couple_id: row.couple_id,
    kind: (isPlanningKind(row.kind) ? row.kind : "task") as PlanningKind,
    title: row.title,
    body: row.body,
    done: Boolean(row.done),
    due_date: row.due_date,
    scheduled_time: row.scheduled_time,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listPlanningItemsByCouple(coupleId: number): PlanningItem[] {
  // Order: schedule entries by scheduled_time (then position) — the others
  // by position then created_at, so newest stays at the bottom of the list.
  const rows = db
    .prepare(
      `SELECT * FROM planning_items
         WHERE couple_id = ?
         ORDER BY
           CASE WHEN kind = 'schedule' AND scheduled_time IS NOT NULL THEN 0 ELSE 1 END,
           scheduled_time ASC,
           position ASC,
           created_at ASC,
           id ASC`,
    )
    .all(coupleId) as PlanningItemRow[];
  return rows.map(toPlanningItem);
}

export function getPlanningItemScoped(id: number, coupleId: number): PlanningItemRow | null {
  return (
    (db.prepare("SELECT * FROM planning_items WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | PlanningItemRow
      | undefined) ?? null
  );
}
