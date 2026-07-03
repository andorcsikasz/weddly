// Vendor to-do board contract. A vendor task is a private, vendor-scoped
// work item (not tied to a couple or booking) that lives on the vendor's
// Trello-style board at /vendor/calendar?mode=tasks. Lanes mirror the planner
// board so the two pro workspaces read the same: todo → doing → done.

import type { UnixMs } from "./types";

/** Kanban lane of a vendor task. Order matters for the prev/next keyboard
 *  fallback on the board cards. */
export type VendorBoardStatus = "todo" | "doing" | "done";

export const VENDOR_BOARD_STATUSES: readonly VendorBoardStatus[] = ["todo", "doing", "done"];

/** One card on the vendor board. */
export interface VendorTask {
  id: number;
  title: string;
  /** ISO 'YYYY-MM-DD' or null (no deadline). */
  due_date: string | null;
  board_status: VendorBoardStatus;
  created_at: UnixMs;
  updated_at: UnixMs;
}

/** POST /api/vendor/tasks body. */
export interface VendorTaskCreateInput {
  title: string;
  due_date?: string | null;
  board_status?: VendorBoardStatus;
}

/** PATCH /api/vendor/tasks/:id body. All fields optional, only sent keys
 *  are applied. */
export interface VendorTaskUpdateInput {
  title?: string;
  due_date?: string | null;
  board_status?: VendorBoardStatus;
}
