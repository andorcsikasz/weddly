// Vendor to-do board. Private, vendor-scoped work items the vendor drags
// across the kanban lanes at /vendor/calendar?mode=tasks. Never visible to
// couples, so the whole surface stays on the FREE tier (unlike the PRO
// availability calendar).
//
//   GET    /api/vendor/tasks       - list every task (the board needs all lanes)
//   POST   /api/vendor/tasks       - create  { title, due_date?, board_status? }
//   PATCH  /api/vendor/tasks/:id   - edit    { title?, due_date?, board_status? }
//   DELETE /api/vendor/tasks/:id   - remove
//
// Authorisation: requireAuth + role 'vendor' + an owned vendor_account
// (resolveVendorAccount), deliberately NOT resolveVendorListing, so a vendor
// mid-onboarding without a listing can already plan their work.

import type { VendorBoardStatus } from "@shared/vendor_tasks";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { isIsoDate } from "../domain/supplier_bookings";
import { resolveVendorAccount } from "../domain/vendor_clients";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import {
  countVendorTasks,
  createVendorTask,
  deleteVendorTask,
  getVendorTaskById,
  isVendorBoardStatus,
  listVendorTasks,
  MAX_VENDOR_TASK_TITLE,
  MAX_VENDOR_TASKS,
  toVendorTask,
  updateVendorTask,
  type VendorTaskRow,
} from "../domain/vendor_tasks";

/** Parse + validate a task id path param. */
function taskIdParam(ctx: Ctx): number {
  const id = Number(ctx.params?.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "task id required");
  return id;
}

/** Load the task and enforce ownership. A foreign task reads as 404 (not
 *  403) so ids can't be probed across vendor accounts. */
function requireOwnTask(vendorAccountId: number, taskId: number): VendorTaskRow {
  const task = getVendorTaskById(taskId);
  if (!task || task.vendor_account_id !== vendorAccountId) {
    throw new HttpError(404, "Task not found");
  }
  return task;
}

function parseTitle(v: unknown): string {
  const title = typeof v === "string" ? v.trim() : "";
  if (title.length === 0) throw new HttpError(400, "title is required");
  if (title.length > MAX_VENDOR_TASK_TITLE) {
    throw new HttpError(400, `title must be at most ${MAX_VENDOR_TASK_TITLE} characters`);
  }
  return title;
}

/** Normalise an optional due date: undefined = not sent, null/'' = clear. */
function parseDueDate(v: unknown): string | null {
  if (v === null || v === "") return null;
  if (typeof v === "string" && isIsoDate(v.trim())) return v.trim();
  throw new HttpError(400, "due_date must be a valid YYYY-MM-DD or null");
}

function parseBoardStatus(v: unknown): VendorBoardStatus {
  if (!isVendorBoardStatus(v))
    throw new HttpError(400, "board_status must be one of todo|doing|done");
  return v;
}

async function handleList(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  return json({ tasks: listVendorTasks(account.id).map(toVendorTask) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const body = await readJson<{ title?: unknown; due_date?: unknown; board_status?: unknown }>(
    ctx.req,
  );
  const title = parseTitle(body.title);
  const due_date = body.due_date === undefined ? null : parseDueDate(body.due_date);
  const board_status =
    body.board_status === undefined ? "todo" : parseBoardStatus(body.board_status);

  if (countVendorTasks(account.id) >= MAX_VENDOR_TASKS) {
    throw new HttpError(409, "Task limit reached", { code: "vendor_task_limit" });
  }

  const task = createVendorTask(account.id, { title, due_date, board_status });
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.task_create",
    target_kind: "vendor_task",
    target_id: task.id,
    after: { title, due_date, board_status },
  });
  return json({ task: toVendorTask(task) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const before = requireOwnTask(account.id, taskIdParam(ctx));
  const body = await readJson<{ title?: unknown; due_date?: unknown; board_status?: unknown }>(
    ctx.req,
  );

  const patch: { title?: string; due_date?: string | null; board_status?: VendorBoardStatus } = {};
  if (body.title !== undefined) patch.title = parseTitle(body.title);
  if (body.due_date !== undefined) patch.due_date = parseDueDate(body.due_date);
  if (body.board_status !== undefined) patch.board_status = parseBoardStatus(body.board_status);

  const task = updateVendorTask(before.id, patch);
  markVendorCalendarDirty(account.id);
  if (patch.board_status !== undefined && patch.board_status !== before.board_status) {
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.task_board_move",
      target_kind: "vendor_task",
      target_id: task.id,
      before: { board_status: before.board_status },
      after: { board_status: patch.board_status },
    });
  }
  return json({ task: toVendorTask(task) });
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const task = requireOwnTask(account.id, taskIdParam(ctx));
  deleteVendorTask(task.id);
  markVendorCalendarDirty(account.id);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.task_delete",
    target_kind: "vendor_task",
    target_id: task.id,
    before: { title: task.title, board_status: task.board_status },
  });
  return json({ ok: true });
}

export function registerVendorTaskRoutes(router: Router) {
  router.get("/api/vendor/tasks", handleList);
  router.post("/api/vendor/tasks", handleCreate);
  router.patch("/api/vendor/tasks/:id", handleUpdate);
  router.delete("/api/vendor/tasks/:id", handleDelete);
}
