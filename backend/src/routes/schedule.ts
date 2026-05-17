// Day-of run-of-show CRUD. Couple-scoped — every endpoint goes through
// requireAuth and getCoupleForUser. PATCH honours `If-Match: <updated_at>`
// for optimistic concurrency, matching budget / seating.

import type { UpsertScheduleEventInput } from "@shared/schedule";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteScheduleEvent,
  getScheduleEventScoped,
  insertScheduleEvent,
  listScheduleEvents,
  parseUpsertCreate,
  parseUpsertPatch,
  toScheduleEvent,
  updateScheduleEvent,
} from "../domain/schedule";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ events: listScheduleEvents(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertScheduleEventInput>>(ctx.req);
  const parsed = parseUpsertCreate(body);
  const row = insertScheduleEvent(couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "schedule.event_create",
    target_kind: "schedule_event",
    target_id: row.id,
    after: {
      label: parsed.label,
      starts_at_minutes: parsed.starts_at_minutes,
      duration_minutes: parsed.duration_minutes,
    },
  });

  return json({ event: toScheduleEvent(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getScheduleEventScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Event not found");

  // Optional optimistic-concurrency guard: clients send the last-seen
  // `updated_at` as If-Match; a mid-air collision returns 409. Same shape
  // as budget / seating.
  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(existing.updated_at)) {
      throw new HttpError(409, "Stale schedule event — reload before saving", {
        code: "stale",
        current_updated_at: existing.updated_at,
      });
    }
  }

  const body = await readJson<Partial<UpsertScheduleEventInput>>(ctx.req);
  const parsed = parseUpsertPatch(body, existing);
  const row = updateScheduleEvent(id, couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "schedule.event_update",
    target_kind: "schedule_event",
    target_id: id,
    before: {
      label: existing.label,
      starts_at_minutes: existing.starts_at_minutes,
    },
    after: {
      label: parsed.label,
      starts_at_minutes: parsed.starts_at_minutes,
    },
  });

  return json({ event: toScheduleEvent(row) });
}

/** Clone an existing event with a " (copy)" label suffix, leaving every
 *  other field (time, location, duration, notes) intact. Frontend can PATCH
 *  the new row to a different time afterwards — but the common "almost the
 *  same as the welcome drink, just an hour later" flow no longer needs the
 *  user to retype location + duration. */
function handleDuplicate(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getScheduleEventScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Event not found");

  const COPY_SUFFIX = " (copy)";
  const baseLabel = existing.label.endsWith(COPY_SUFFIX)
    ? existing.label
    : existing.label + COPY_SUFFIX;
  const row = insertScheduleEvent(couple.id, {
    label: baseLabel,
    starts_at_minutes: existing.starts_at_minutes,
    duration_minutes: existing.duration_minutes,
    location: existing.location,
    notes: existing.notes,
    sort_order: existing.sort_order,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "schedule.event_duplicate",
    target_kind: "schedule_event",
    target_id: row.id,
    after: { source_id: id, label: baseLabel },
  });

  return json({ event: toScheduleEvent(row) }, { status: 201 });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getScheduleEventScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Event not found");

  deleteScheduleEvent(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "schedule.event_delete",
    target_kind: "schedule_event",
    target_id: id,
    before: { label: existing.label },
  });

  return json({ ok: true });
}

export function registerScheduleRoutes(router: Router) {
  router.get("/api/schedule", handleList, true);
  router.post("/api/schedule", handleCreate, true);
  router.post("/api/schedule/:id/duplicate", handleDuplicate, true);
  router.patch("/api/schedule/:id", handleUpdate, true);
  router.delete("/api/schedule/:id", handleDelete, true);
}
