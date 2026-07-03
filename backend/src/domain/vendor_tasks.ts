// Vendor to-do board domain. Tasks are private to the vendor account (never
// shown to couples) and carry a kanban lane (`board_status`) the frontend
// drags cards between. Sorting mirrors the planner board: deadline first,
// undated tasks last, newest of those on top.

import type { VendorBoardStatus, VendorTask } from "@shared/vendor_tasks";
import { VENDOR_BOARD_STATUSES } from "@shared/vendor_tasks";
import { db, now } from "../db";

export const MAX_VENDOR_TASK_TITLE = 200;
/** Hard per-vendor cap so an abusive client can't grow the table unbounded. */
export const MAX_VENDOR_TASKS = 500;

export interface VendorTaskRow {
  id: number;
  vendor_account_id: number;
  title: string;
  due_date: string | null;
  board_status: string;
  created_at: number;
  updated_at: number;
}

export function toVendorTask(row: VendorTaskRow): VendorTask {
  return {
    id: row.id,
    title: row.title,
    due_date: row.due_date,
    board_status: isVendorBoardStatus(row.board_status) ? row.board_status : "todo",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function isVendorBoardStatus(v: unknown): v is VendorBoardStatus {
  return typeof v === "string" && (VENDOR_BOARD_STATUSES as readonly string[]).includes(v);
}

export function listVendorTasks(vendorAccountId: number): VendorTaskRow[] {
  return db
    .prepare(
      `SELECT * FROM vendor_tasks
        WHERE vendor_account_id = ?
        ORDER BY due_date IS NULL, due_date ASC, created_at DESC`,
    )
    .all(vendorAccountId) as VendorTaskRow[];
}

export function countVendorTasks(vendorAccountId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_tasks WHERE vendor_account_id = ?")
    .get(vendorAccountId) as { n: number };
  return row.n;
}

export function getVendorTaskById(id: number): VendorTaskRow | null {
  return (db.prepare("SELECT * FROM vendor_tasks WHERE id = ?").get(id) as VendorTaskRow) ?? null;
}

export function createVendorTask(
  vendorAccountId: number,
  input: { title: string; due_date: string | null; board_status: VendorBoardStatus },
): VendorTaskRow {
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO vendor_tasks (vendor_account_id, title, due_date, board_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(vendorAccountId, input.title, input.due_date, input.board_status, ts, ts);
  return getVendorTaskById(Number(res.lastInsertRowid)) as VendorTaskRow;
}

export function updateVendorTask(
  id: number,
  patch: { title?: string; due_date?: string | null; board_status?: VendorBoardStatus },
): VendorTaskRow {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title);
  }
  if (patch.due_date !== undefined) {
    sets.push("due_date = ?");
    values.push(patch.due_date);
  }
  if (patch.board_status !== undefined) {
    sets.push("board_status = ?");
    values.push(patch.board_status);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    values.push(now());
    db.prepare(`UPDATE vendor_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }
  return getVendorTaskById(id) as VendorTaskRow;
}

export function deleteVendorTask(id: number): boolean {
  return db.prepare("DELETE FROM vendor_tasks WHERE id = ?").run(id).changes > 0;
}
