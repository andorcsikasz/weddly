// Budget lines + saveable what-if snapshots. Couple-scoped.

import type { BudgetCategory, BudgetLine, BudgetSnapshot } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../lib/couples";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const VALID_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
]);

interface LineRow {
  id: number;
  couple_id: number;
  category: string;
  label: string;
  planned_huf: number;
  actual_huf: number;
  supplier_id: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

function toLine(r: LineRow): BudgetLine {
  return {
    id: r.id,
    couple_id: r.couple_id,
    category: (VALID_CATEGORIES.has(r.category as BudgetCategory)
      ? r.category
      : "other") as BudgetCategory,
    label: r.label,
    planned_huf: r.planned_huf,
    actual_huf: r.actual_huf,
    supplier_id: r.supplier_id,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function listLines(coupleId: number): BudgetLine[] {
  const rows = db
    .prepare("SELECT * FROM budget_lines WHERE couple_id = ? ORDER BY id ASC")
    .all(coupleId) as LineRow[];
  return rows.map(toLine);
}

interface SnapshotRow {
  id: number;
  couple_id: number;
  name: string;
  payload_json: string;
  created_at: number;
}

function toSnapshot(r: SnapshotRow): BudgetSnapshot {
  return {
    id: r.id,
    couple_id: r.couple_id,
    name: r.name,
    payload_json: r.payload_json,
    created_at: r.created_at,
  };
}

function handleListLines(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ lines: listLines(couple.id) });
}

interface UpsertLineBody {
  category?: unknown;
  label?: unknown;
  planned_huf?: unknown;
  actual_huf?: unknown;
  notes?: unknown;
}

function parseLineBody(body: UpsertLineBody, requireCategory = true) {
  const cat = typeof body.category === "string" ? body.category : null;
  if (requireCategory && (!cat || !VALID_CATEGORIES.has(cat as BudgetCategory))) {
    throw new HttpError(400, "Valid category required");
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 200) throw new HttpError(400, "label required (≤200 chars)");
  const planned = Number(body.planned_huf);
  const actual = Number(body.actual_huf ?? 0);
  if (!Number.isFinite(planned) || planned < 0 || planned > 10_000_000_000) {
    throw new HttpError(400, "planned_huf out of range");
  }
  if (!Number.isFinite(actual) || actual < 0 || actual > 10_000_000_000) {
    throw new HttpError(400, "actual_huf out of range");
  }
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;
  return {
    category: (cat ?? "other") as BudgetCategory,
    label,
    planned_huf: Math.round(planned),
    actual_huf: Math.round(actual),
    notes,
  };
}

async function handleCreateLine(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertLineBody>(ctx.req);
  const parsed = parseLineBody(body);
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO budget_lines (couple_id, category, label, planned_huf, actual_huf, supplier_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      couple.id,
      parsed.category,
      parsed.label,
      parsed.planned_huf,
      parsed.actual_huf,
      parsed.notes,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.line_create",
    target_kind: "budget_line",
    target_id: id,
    after: { label: parsed.label, planned_huf: parsed.planned_huf },
  });

  const row = db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(id) as LineRow;
  return json({ line: toLine(row) }, { status: 201 });
}

async function handleUpdateLine(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = db
    .prepare("SELECT * FROM budget_lines WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as LineRow | undefined;
  if (!existing) throw new HttpError(404, "Line not found");

  const body = await readJson<UpsertLineBody>(ctx.req);
  const parsed = parseLineBody(body, false);
  const ts = now();
  db.prepare(
    `UPDATE budget_lines SET label = ?, planned_huf = ?, actual_huf = ?, notes = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(parsed.label, parsed.planned_huf, parsed.actual_huf, parsed.notes, ts, id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.line_update",
    target_kind: "budget_line",
    target_id: id,
    before: { planned_huf: existing.planned_huf, actual_huf: existing.actual_huf },
    after: { planned_huf: parsed.planned_huf, actual_huf: parsed.actual_huf },
  });

  const row = db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(id) as LineRow;
  return json({ line: toLine(row) });
}

function handleDeleteLine(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const result = db
    .prepare("DELETE FROM budget_lines WHERE id = ? AND couple_id = ?")
    .run(id, couple.id);
  if (result.changes === 0) throw new HttpError(404, "Line not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.line_delete",
    target_kind: "budget_line",
    target_id: id,
  });
  return json({ ok: true });
}

interface CreateSnapshotBody {
  name?: unknown;
}

async function handleCreateSnapshot(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<CreateSnapshotBody>(ctx.req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) throw new HttpError(400, "name required (≤200 chars)");

  const lines = listLines(couple.id);
  const payload = lines.map((l) => ({
    category: l.category,
    label: l.label,
    planned_huf: l.planned_huf,
    actual_huf: l.actual_huf,
    notes: l.notes,
  }));
  const ts = now();
  const result = db
    .prepare(
      "INSERT INTO budget_snapshots (couple_id, name, payload_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(couple.id, name, JSON.stringify(payload), ts);
  const id = Number(result.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.snapshot_create",
    target_kind: "budget_snapshot",
    target_id: id,
    after: { name, line_count: payload.length },
  });

  const row = db.prepare("SELECT * FROM budget_snapshots WHERE id = ?").get(id) as SnapshotRow;
  return json({ snapshot: toSnapshot(row) }, { status: 201 });
}

function handleListSnapshots(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const rows = db
    .prepare("SELECT * FROM budget_snapshots WHERE couple_id = ? ORDER BY created_at DESC")
    .all(couple.id) as SnapshotRow[];
  return json({ snapshots: rows.map(toSnapshot) });
}

function handleDeleteSnapshot(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const result = db
    .prepare("DELETE FROM budget_snapshots WHERE id = ? AND couple_id = ?")
    .run(id, couple.id);
  if (result.changes === 0) throw new HttpError(404, "Snapshot not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.snapshot_delete",
    target_kind: "budget_snapshot",
    target_id: id,
  });
  return json({ ok: true });
}

export function registerBudgetRoutes(router: Router) {
  router.get("/api/budget/lines", handleListLines, true);
  router.post("/api/budget/lines", handleCreateLine, true);
  router.patch("/api/budget/lines/:id", handleUpdateLine, true);
  router.delete("/api/budget/lines/:id", handleDeleteLine, true);
  router.get("/api/budget/snapshots", handleListSnapshots, true);
  router.post("/api/budget/snapshots", handleCreateSnapshot, true);
  router.delete("/api/budget/snapshots/:id", handleDeleteSnapshot, true);
}
