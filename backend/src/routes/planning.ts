// Planning items CRUD. Backs /app/planning's three tabs (tasks / ideas /
// schedule). Couple-scoped; every endpoint requires auth.

import type { PlanningKind, PlanningTopic } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  getPlanningItemJoined,
  getPlanningItemScoped,
  isPlanningKind,
  isPlanningTopic,
  listPlanningItemsByCouple,
  toPlanningItem,
} from "../domain/planning";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

const MAX_TITLE = 200;
const MAX_BODY = 5000;
const MAX_ASSIGNEE = 80;
const MAX_SUPPLIER_ID = 64;
// HH:MM, 00:00..23:59. Anchored regex — no leading/trailing whitespace.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// YYYY-MM-DD. Loose check; we don't validate calendar validity (Feb 30 sneaks
// through), but anything outside the shape is rejected.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface UpsertBody {
  kind?: unknown;
  topic?: unknown;
  title?: unknown;
  body?: unknown;
  done?: unknown;
  due_date?: unknown;
  scheduled_time?: unknown;
  assignee?: unknown;
  start_date?: unknown;
  supplier_id?: unknown;
  priority?: unknown;
  position?: unknown;
}

function parseTopic(raw: unknown): PlanningTopic | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "topic must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isPlanningTopic(trimmed)) {
    throw new HttpError(400, "topic must be 'wedding' or 'honeymoon'");
  }
  return trimmed;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "title required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "title required");
  if (trimmed.length > MAX_TITLE) throw new HttpError(400, `title too long (max ${MAX_TITLE})`);
  return trimmed;
}

function parseBody(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "body must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_BODY) throw new HttpError(400, `body too long (max ${MAX_BODY})`);
  return trimmed;
}

function parseAssignee(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "assignee must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ASSIGNEE) {
    throw new HttpError(400, `assignee too long (max ${MAX_ASSIGNEE})`);
  }
  return trimmed;
}

function parseDueDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "due_date must be YYYY-MM-DD");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!DATE_RE.test(trimmed)) throw new HttpError(400, "due_date must be YYYY-MM-DD");
  return trimmed;
}

function parseStartDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "start_date must be YYYY-MM-DD");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!DATE_RE.test(trimmed)) throw new HttpError(400, "start_date must be YYYY-MM-DD");
  return trimmed;
}

function parseSupplierId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "supplier_id must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SUPPLIER_ID) {
    throw new HttpError(400, `supplier_id too long (max ${MAX_SUPPLIER_ID})`);
  }
  return trimmed;
}

/** SOS / important flag. 0 = none, 1 = "!", 2 = "!!". Anything else is a
 *  client bug and gets rejected. Booleans and strings are NOT coerced — pass
 *  a number. */
function parsePriority(raw: unknown): 0 | 1 | 2 {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 2) {
    throw new HttpError(400, "priority must be 0, 1, or 2");
  }
  return raw as 0 | 1 | 2;
}

function parseScheduledTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "scheduled_time must be HH:MM");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!TIME_RE.test(trimmed)) throw new HttpError(400, "scheduled_time must be HH:MM");
  return trimmed;
}

function parseKind(raw: unknown): PlanningKind {
  if (typeof raw !== "string" || !isPlanningKind(raw)) {
    throw new HttpError(400, "kind must be 'task' | 'idea' | 'schedule'");
  }
  return raw;
}

function parsePosition(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < -1_000_000 || n > 1_000_000) {
    throw new HttpError(400, "position out of range");
  }
  return n;
}

function handleList(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ items: listPlanningItemsByCouple(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertBody>(ctx.req);
  const kind = parseKind(body.kind);
  const title = parseTitle(body.title);
  const bodyText = parseBody(body.body);
  const done = body.done === true ? 1 : 0;
  // Only tasks may carry a due_date; only schedule entries may carry a
  // scheduled_time. We don't reject the wrong-kind variants — silently null
  // them so an inadvertent client send doesn't 400.
  const dueDate = kind === "task" ? parseDueDate(body.due_date) : null;
  const scheduledTime = kind === "schedule" ? parseScheduledTime(body.scheduled_time) : null;
  const assignee = kind === "task" ? parseAssignee(body.assignee) : null;
  // Gantt fields are tasks-only. Mirror the assignee branch: silently null on
  // idea/schedule rather than 400'ing a misdirected payload.
  const startDate = kind === "task" ? parseStartDate(body.start_date) : null;
  const supplierId = kind === "task" ? parseSupplierId(body.supplier_id) : null;
  const priority = kind === "task" ? parsePriority(body.priority) : 0;
  // Ideas auto-stamp the authoring partner so "— Anna javasolta" can render
  // on every idea row, even ones created through the wand / dice helpers.
  // Other kinds leave it null (the schedule/task author isn't surfaced).
  const suggestedBy = kind === "idea" ? userId : null;
  const position = parsePosition(body.position, 0);
  const topic = parseTopic(body.topic);
  const ts = now();

  const result = db
    .prepare(
      `INSERT INTO planning_items
        (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
         suggested_by_user_id, start_date, supplier_id, priority, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      couple.id,
      kind,
      topic,
      title,
      bodyText,
      done,
      dueDate,
      scheduledTime,
      assignee,
      suggestedBy,
      startDate,
      supplierId,
      priority,
      position,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "planning.create",
    target_kind: "planning_item",
    target_id: id,
    after: { kind, title },
  });

  const row = getPlanningItemJoined(id, couple.id);
  if (!row) throw new HttpError(500, "Planning item missing after insert");
  return json({ item: toPlanningItem(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = getPlanningItemScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Planning item not found");

  const body = await readJson<UpsertBody>(ctx.req);
  // PATCH semantics: omitted fields keep the existing value. The kind itself
  // is immutable — flipping a task into a schedule would scramble the
  // (kind, scheduled_time) invariant.
  const title = body.title === undefined ? existing.title : parseTitle(body.title);
  const bodyText = body.body === undefined ? existing.body : parseBody(body.body);
  const done =
    body.done === undefined ? existing.done : body.done === true ? 1 : body.done === false ? 0 : 0;
  const dueDate =
    body.due_date === undefined
      ? existing.due_date
      : existing.kind === "task"
        ? parseDueDate(body.due_date)
        : null;
  const scheduledTime =
    body.scheduled_time === undefined
      ? existing.scheduled_time
      : existing.kind === "schedule"
        ? parseScheduledTime(body.scheduled_time)
        : null;
  const assignee =
    body.assignee === undefined
      ? existing.assignee
      : existing.kind === "task"
        ? parseAssignee(body.assignee)
        : null;
  const startDate =
    body.start_date === undefined
      ? existing.start_date
      : existing.kind === "task"
        ? parseStartDate(body.start_date)
        : null;
  const supplierId =
    body.supplier_id === undefined
      ? existing.supplier_id
      : existing.kind === "task"
        ? parseSupplierId(body.supplier_id)
        : null;
  const priority =
    body.priority === undefined
      ? existing.priority
      : existing.kind === "task"
        ? parsePriority(body.priority)
        : 0;
  const position = parsePosition(body.position, existing.position);
  const ts = now();

  db.prepare(
    `UPDATE planning_items SET
        title = ?, body = ?, done = ?, due_date = ?, scheduled_time = ?,
        assignee = ?, start_date = ?, supplier_id = ?, priority = ?, position = ?, updated_at = ?
       WHERE id = ? AND couple_id = ?`,
  ).run(
    title,
    bodyText,
    done,
    dueDate,
    scheduledTime,
    assignee,
    startDate,
    supplierId,
    priority,
    position,
    ts,
    id,
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "planning.update",
    target_kind: "planning_item",
    target_id: id,
    before: { title: existing.title, done: existing.done },
    after: { title, done },
  });

  const row = getPlanningItemJoined(id, couple.id);
  if (!row) throw new HttpError(500, "Planning item missing after update");
  return json({ item: toPlanningItem(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = getPlanningItemScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Planning item not found");

  db.prepare("DELETE FROM planning_items WHERE id = ? AND couple_id = ?").run(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "planning.delete",
    target_kind: "planning_item",
    target_id: id,
    before: { kind: existing.kind, title: existing.title },
  });
  return json({ ok: true });
}

export function registerPlanningRoutes(router: Router) {
  router.get("/api/planning", handleList, true);
  router.post("/api/planning", handleCreate, true);
  router.patch("/api/planning/:id", handleUpdate, true);
  router.delete("/api/planning/:id", handleDelete, true);
}
