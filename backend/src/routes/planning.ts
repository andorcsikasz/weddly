// Planning items CRUD. Backs /app/planning's three tabs (tasks / ideas /
// schedule). Couple-scoped; every endpoint requires auth.

import type { PlanningKind } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  type PlanningItemRow,
  getPlanningItemScoped,
  isPlanningKind,
  listPlanningItemsByCouple,
  toPlanningItem,
} from "../domain/planning";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const MAX_TITLE = 200;
const MAX_BODY = 5000;
// HH:MM, 00:00..23:59. Anchored regex — no leading/trailing whitespace.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// YYYY-MM-DD. Loose check; we don't validate calendar validity (Feb 30 sneaks
// through), but anything outside the shape is rejected.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface UpsertBody {
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  done?: unknown;
  due_date?: unknown;
  scheduled_time?: unknown;
  position?: unknown;
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

function parseDueDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "due_date must be YYYY-MM-DD");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!DATE_RE.test(trimmed)) throw new HttpError(400, "due_date must be YYYY-MM-DD");
  return trimmed;
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
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ items: listPlanningItemsByCouple(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
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
  const position = parsePosition(body.position, 0);
  const ts = now();

  const result = db
    .prepare(
      `INSERT INTO planning_items
        (couple_id, kind, title, body, done, due_date, scheduled_time, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(couple.id, kind, title, bodyText, done, dueDate, scheduledTime, position, ts, ts);
  const id = Number(result.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "planning.create",
    target_kind: "planning_item",
    target_id: id,
    after: { kind, title },
  });

  const row = db.prepare("SELECT * FROM planning_items WHERE id = ?").get(id) as PlanningItemRow;
  return json({ item: toPlanningItem(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
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
  const position = parsePosition(body.position, existing.position);
  const ts = now();

  db.prepare(
    `UPDATE planning_items SET
        title = ?, body = ?, done = ?, due_date = ?, scheduled_time = ?,
        position = ?, updated_at = ?
       WHERE id = ? AND couple_id = ?`,
  ).run(title, bodyText, done, dueDate, scheduledTime, position, ts, id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "planning.update",
    target_kind: "planning_item",
    target_id: id,
    before: { title: existing.title, done: existing.done },
    after: { title, done },
  });

  const row = db.prepare("SELECT * FROM planning_items WHERE id = ?").get(id) as PlanningItemRow;
  return json({ item: toPlanningItem(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
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
