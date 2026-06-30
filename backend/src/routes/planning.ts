// Planning items CRUD. Backs /app/planning's three tabs (tasks / ideas /
// schedule). Couple-scoped; every endpoint requires auth.

import {
  type ConditionTag,
  INTAKE_DIMENSIONS,
  type ManualTagAnswers,
  type PromptGroup,
  PROMPT_GROUPS,
  visiblePromptsForGroup,
} from "@shared/planning_prompts";
import type {
  CeremonyKind,
  DecisionStatus,
  IdeaStatus,
  IdeaTag,
  PlanningKind,
  PlanningTopic,
} from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { insertCoupleNotification } from "../domain/notifications";
import {
  getPlanningItemJoined,
  getPlanningItemScoped,
  isDecisionStatus,
  isIdeaStatus,
  isIdeaTag,
  isPlanningKind,
  isPlanningTopic,
  listPlanningItemsByCouple,
  promptGuestStats,
  toPlanningItem,
} from "../domain/planning";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const MAX_TITLE = 200;
const MAX_BODY = 5000;
const MAX_ASSIGNEE = 80;
const MAX_SUPPLIER_ID = 64;
const MAX_RESOLUTION = 2000;

const VALID_GROUP_KEYS = new Set<string>(PROMPT_GROUPS.map((g) => g.key));
const INTAKE_TAGS = new Set<string>(INTAKE_DIMENSIONS.map((d) => d.tag));
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
  decision_status?: unknown;
  resolution?: unknown;
  idea_status?: unknown;
  idea_tag?: unknown;
}

function parseDecisionStatus(raw: unknown): DecisionStatus | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !isDecisionStatus(raw)) {
    throw new HttpError(400, "decision_status must be open|decided|not_relevant|promoted");
  }
  return raw;
}

function parseIdeaStatus(raw: unknown): IdeaStatus | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !isIdeaStatus(raw)) {
    throw new HttpError(400, "idea_status must be doing|maybe|skip");
  }
  return raw;
}

function parseIdeaTag(raw: unknown): IdeaTag | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !isIdeaTag(raw)) {
    throw new HttpError(400, "idea_tag must be program|decor|surprise|keepsake|experience");
  }
  return raw;
}

function parseResolution(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "resolution must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_RESOLUTION) {
    throw new HttpError(400, `resolution too long (max ${MAX_RESOLUTION})`);
  }
  return trimmed;
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
  // Idea triage tag — validated enum, no kind-gating (per spec: don't
  // over-enforce). A non-idea row simply never sends it.
  const ideaTag = parseIdeaTag(body.idea_tag);
  const ts = now();

  const result = db
    .prepare(
      `INSERT INTO planning_items
        (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
         suggested_by_user_id, start_date, supplier_id, priority, position, idea_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ideaTag,
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

  // In-app "your partner added a to-do" event for the OTHER partner (the feed
  // hides a row from its own actor). Hour-bucketed dedupe collapses a burst —
  // the timeline generator creates ~20 tasks at once — into a single row, so
  // the partner sees "Anna added to-dos", not 20 pings.
  const actor = getUserById(userId);
  insertCoupleNotification({
    couple_id: couple.id,
    kind: "partner_task_added",
    actor_user_id: userId,
    data: { actorName: actor?.full_name?.trim() || "" },
    link: "/app/planning",
    dedupe_key: `task_added:${userId}:${Math.floor(ts / 3_600_000)}`,
  });

  const row = getPlanningItemJoined(id, couple.id);
  if (!row) throw new HttpError(500, "Planning item missing after insert");
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
  // Decision-prompt lifecycle (seed_key rows only). On a normal task/idea these
  // stay null; flipping them would be a client bug, so we silently keep null.
  const isPrompt = existing.seed_key != null;
  const decisionStatus =
    body.decision_status === undefined
      ? existing.decision_status
      : isPrompt
        ? parseDecisionStatus(body.decision_status)
        : null;
  const resolution =
    body.resolution === undefined
      ? existing.resolution
      : isPrompt
        ? parseResolution(body.resolution)
        : null;
  // Idea triage — validated enums, kept as-is when omitted. Not kind-gated
  // (spec: validate the enum, don't over-enforce).
  const ideaStatus =
    body.idea_status === undefined ? existing.idea_status : parseIdeaStatus(body.idea_status);
  const ideaTag = body.idea_tag === undefined ? existing.idea_tag : parseIdeaTag(body.idea_tag);
  const ts = now();

  db.prepare(
    `UPDATE planning_items SET
        title = ?, body = ?, done = ?, due_date = ?, scheduled_time = ?,
        assignee = ?, start_date = ?, supplier_id = ?, priority = ?, position = ?,
        decision_status = ?, resolution = ?, idea_status = ?, idea_tag = ?, updated_at = ?
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
    decisionStatus,
    resolution,
    ideaStatus,
    ideaTag,
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

// ─── decision-prompt intake profile ─────────────────────────────────────────
// The couple's manual answers to the conditional dimensions that aren't already
// derivable from couples.ceremony_kind / the guest list. Persisted as a small
// JSON blob on couples.planning_profile.

function readProfile(coupleId: number): ManualTagAnswers {
  const row = db.prepare("SELECT planning_profile FROM couples WHERE id = ?").get(coupleId) as
    | { planning_profile: string | null }
    | undefined;
  if (!row?.planning_profile) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.planning_profile);
  } catch {
    return {};
  }
  const out: ManualTagAnswers = {};
  if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (INTAKE_TAGS.has(k) && (v === "yes" || v === "no")) {
        out[k as ConditionTag] = v;
      }
    }
  }
  return out;
}

function handleGetProfile(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ tags: readProfile(couple.id) });
}

async function handlePutProfile(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<{ tags?: unknown }>(ctx.req);
  const raw = body.tags;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    throw new HttpError(400, "tags must be an object");
  }
  const tags: ManualTagAnswers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!INTAKE_TAGS.has(k)) continue;
    if (v === "yes" || v === "no") tags[k as ConditionTag] = v;
    else if (v !== null && v !== undefined && v !== "") {
      throw new HttpError(400, `tag ${k} must be "yes" | "no" | null`);
    }
  }
  db.prepare("UPDATE couples SET planning_profile = ? WHERE id = ?").run(
    JSON.stringify(tags),
    couple.id,
  );
  return json({ tags });
}

// ─── lazy decision-prompt generation ─────────────────────────────────────────
// When the couple opens a theme group, materialise the prompts that are visible
// for them and not already present (dedupe on seed_key). Returns the full
// planning list so the client refreshes in one round-trip.

async function handleGeneratePrompts(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<{ group?: unknown }>(ctx.req);
  if (typeof body.group !== "string" || !VALID_GROUP_KEYS.has(body.group)) {
    throw new HttpError(400, "group must be a valid prompt group");
  }
  const group = body.group as PromptGroup;

  const stats = promptGuestStats(couple.id);
  const visible = visiblePromptsForGroup(group, {
    ceremonyKind: (couple.ceremony_kind as CeremonyKind | null) ?? null,
    hasChildren: stats.hasChildren,
    guestCount: stats.guestCount,
    manual: readProfile(couple.id),
  });

  // Which of these seeds does the couple already have a row for?
  const existingKeys = new Set(
    (
      db
        .prepare("SELECT seed_key FROM planning_items WHERE couple_id = ? AND seed_key IS NOT NULL")
        .all(couple.id) as { seed_key: string }[]
    ).map((r) => r.seed_key),
  );

  const ts = now();
  const insert = db.prepare(
    `INSERT INTO planning_items
       (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
        suggested_by_user_id, start_date, supplier_id, priority, position,
        seed_key, decision_status, resolution, created_at, updated_at)
     VALUES (?, 'task', 'wedding', ?, NULL, 0, NULL, NULL, NULL,
        NULL, NULL, NULL, ?, ?, ?, 'open', NULL, ?, ?)`,
  );
  let created = 0;
  const tx = db.transaction(() => {
    for (let i = 0; i < visible.length; i++) {
      const seed = visible[i];
      if (!seed || existingKeys.has(seed.seed_key)) continue;
      insert.run(couple.id, seed.title.hu, seed.default_priority, i, seed.seed_key, ts, ts);
      created++;
    }
  });
  tx();

  if (created > 0) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "planning.prompts.generate",
      target_kind: "planning_item",
      target_id: null,
      after: { group, created },
    });
  }

  return json({ items: listPlanningItemsByCouple(couple.id), created });
}

export function registerPlanningRoutes(router: Router) {
  router.get("/api/planning", handleList, true);
  router.post("/api/planning", handleCreate, true);
  router.patch("/api/planning/:id", handleUpdate, true);
  router.delete("/api/planning/:id", handleDelete, true);
  router.get("/api/planning/prompts/profile", handleGetProfile, true);
  router.put("/api/planning/prompts/profile", handlePutProfile, true);
  router.post("/api/planning/prompts/generate", handleGeneratePrompts, true);
}
