// Budget lines + saveable what-if snapshots. Couple-scoped.

import type { BudgetCategory, BudgetLine, BudgetSnapshot } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

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
  couple_supplier_id: string | null;
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
    couple_supplier_id: r.couple_supplier_id,
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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

/** PATCH /api/budget/lines/:id — partial updates only + optimistic concurrency.
 *  Clients can send any subset of {label, planned_huf, actual_huf, notes};
 *  omitted fields keep their existing values. If the caller sends `If-Match`
 *  with the row's last `updated_at`, a mid-air collision returns 409. */
async function handleUpdateLine(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = db
    .prepare("SELECT * FROM budget_lines WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as LineRow | undefined;
  if (!existing) throw new HttpError(404, "Line not found");
  // DIY-supplier-mirrored lines are owned by the supplier card. Editing
  // here would race with the next supplier save and confuse the user.
  if (existing.couple_supplier_id) {
    throw new HttpError(409, "This line is managed by a DIY supplier entry", {
      code: "locked",
    });
  }

  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(existing.updated_at)) {
      throw new HttpError(409, "Stale budget line — reload before saving", {
        code: "stale",
        current_updated_at: existing.updated_at,
      });
    }
  }

  const body = await readJson<UpsertLineBody>(ctx.req);
  const parsed = parsePartialLine(body, existing);
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
    before: {
      label: existing.label,
      planned_huf: existing.planned_huf,
      actual_huf: existing.actual_huf,
    },
    after: {
      label: parsed.label,
      planned_huf: parsed.planned_huf,
      actual_huf: parsed.actual_huf,
    },
  });

  const row = db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(id) as LineRow;
  return json({ line: toLine(row) });
}

/** Partial-update parser. Each field defaults to the existing row's value
 *  when the body omits it (so PATCH can change just `actual_huf` without
 *  forcing the client to also re-send `label`). */
function parsePartialLine(body: UpsertLineBody, existing: LineRow) {
  let label = existing.label;
  if (body.label !== undefined) {
    if (typeof body.label !== "string") throw new HttpError(400, "label must be a string");
    const trimmed = body.label.trim();
    if (!trimmed || trimmed.length > 200) throw new HttpError(400, "label required (≤200 chars)");
    label = trimmed;
  }
  let planned = existing.planned_huf;
  if (body.planned_huf !== undefined) {
    const n = Number(body.planned_huf);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) {
      throw new HttpError(400, "planned_huf out of range");
    }
    planned = Math.round(n);
  }
  let actual = existing.actual_huf;
  if (body.actual_huf !== undefined) {
    const n = Number(body.actual_huf);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) {
      throw new HttpError(400, "actual_huf out of range");
    }
    actual = Math.round(n);
  }
  let notes = existing.notes;
  if (body.notes !== undefined) {
    notes =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;
  }
  return { label, planned_huf: planned, actual_huf: actual, notes };
}

function handleDeleteLine(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  // Refuse to delete a supplier-mirrored line directly. The supplier's
  // delete endpoint cleans up both sides; deleting here would orphan the
  // FK on couple_suppliers.
  const existing = db
    .prepare("SELECT * FROM budget_lines WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as LineRow | undefined;
  if (!existing) throw new HttpError(404, "Line not found");
  if (existing.couple_supplier_id) {
    throw new HttpError(409, "This line is managed by a DIY supplier entry", {
      code: "locked",
    });
  }

  db.prepare("DELETE FROM budget_lines WHERE id = ? AND couple_id = ?").run(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.line_delete",
    target_kind: "budget_line",
    target_id: id,
    before: { label: existing.label, planned_huf: existing.planned_huf },
  });
  return json({ ok: true });
}

interface CreateSnapshotBody {
  name?: unknown;
}

async function handleCreateSnapshot(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
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
    // Carried into the payload so `POST /snapshots/:id/restore` can decide
    // whether to skip a row (the live DIY supplier still owns it) or
    // re-insert it as a regular orphan.
    couple_supplier_id: l.couple_supplier_id,
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
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const rows = db
    .prepare("SELECT * FROM budget_snapshots WHERE couple_id = ? ORDER BY created_at DESC")
    .all(couple.id) as SnapshotRow[];
  return json({ snapshots: rows.map(toSnapshot) });
}

/** POST /api/budget/snapshots/:id/restore — replay a saved budget snapshot
 *  back over the live `budget_lines`. The supplier-mirrored rows (those
 *  with a `couple_supplier_id`) are the source of truth on the supplier
 *  side, so the restore:
 *    1. deletes all current non-DIY lines for the couple (rows with a
 *       `couple_supplier_id` survive untouched — those are owned by the
 *       /app/suppliers DIY card),
 *    2. inserts every line from the snapshot payload EXCEPT entries whose
 *       `couple_supplier_id` matches a still-live DIY supplier (live
 *       supplier wins, regardless of its current price — re-inserting a
 *       stale frozen price would be confusing), and
 *    3. bumps the couple's `updated_at` so concurrency-sensitive tabs
 *       reload.
 *  Wrapped in `db.transaction()` — a partial restore would be terrible. */
interface RestoreLinePayload {
  category?: unknown;
  label?: unknown;
  planned_huf?: unknown;
  actual_huf?: unknown;
  notes?: unknown;
  couple_supplier_id?: unknown;
}

function parseSnapshotPayload(raw: string): RestoreLinePayload[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is RestoreLinePayload => typeof x === "object" && x !== null);
}

function coerceCategory(c: unknown): BudgetCategory {
  return typeof c === "string" && VALID_CATEGORIES.has(c as BudgetCategory)
    ? (c as BudgetCategory)
    : "other";
}

function coerceMoney(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 10_000_000_000) return 0;
  return Math.round(v);
}

function coerceLabel(l: unknown): string {
  if (typeof l !== "string") return "";
  const trimmed = l.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

function coerceNotes(n: unknown): string | null {
  if (typeof n !== "string") return null;
  const trimmed = n.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

function handleRestoreSnapshot(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  // Verify the snapshot exists AND belongs to this couple. Cross-couple
  // access → 404 (never reveal existence).
  const snapshotRow = db
    .prepare("SELECT * FROM budget_snapshots WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as SnapshotRow | undefined;
  if (!snapshotRow) throw new HttpError(404, "Snapshot not found");

  const payload = parseSnapshotPayload(snapshotRow.payload_json);
  const ts = now();

  // Every DIY supplier still in the couple's workspace is the source of
  // truth for its mirrored row. We skip any snapshot entry whose
  // `couple_supplier_id` matches a live supplier — even if its price was
  // cleared since the snapshot (in which case the mirrored line is
  // intentionally absent and we mustn't resurrect a stale price). When a
  // supplier was outright deleted between snapshot + restore, its
  // couple_supplier_id is *not* in this set and the row gets re-inserted
  // as an orphan-but-categorized line; that's the safer fallback than
  // silently dropping the entry.
  const surviving = db
    .prepare("SELECT id FROM couple_suppliers WHERE couple_id = ?")
    .all(couple.id) as { id: string }[];
  const survivingIds = new Set(surviving.map((r) => r.id));

  let restoredCount = 0;

  const tx = db.transaction(() => {
    // 1. Wipe non-DIY lines. DIY-mirrored rows survive — the supplier
    //    auto-recreates them, and nuking them silently would orphan the
    //    /app/suppliers DIY entry without a path to re-link.
    db.prepare("DELETE FROM budget_lines WHERE couple_id = ? AND couple_supplier_id IS NULL").run(
      couple.id,
    );

    // 2. Insert the snapshot payload. Skip rows whose couple_supplier_id is
    //    still owned by a live supplier — the supplier card holds the
    //    truth there.
    const insertStmt = db.prepare(
      `INSERT INTO budget_lines
         (couple_id, category, label, planned_huf, actual_huf, supplier_id,
          couple_supplier_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    );
    for (const raw of payload) {
      const cspId = typeof raw.couple_supplier_id === "string" ? raw.couple_supplier_id : null;
      if (cspId && survivingIds.has(cspId)) {
        // Live DIY supplier still owns its mirrored line. Skip — the
        // snapshot's frozen price would just be overwritten on the next
        // supplier save anyway.
        continue;
      }
      const label = coerceLabel(raw.label);
      if (!label) continue;
      insertStmt.run(
        couple.id,
        coerceCategory(raw.category),
        label,
        coerceMoney(raw.planned_huf),
        coerceMoney(raw.actual_huf),
        cspId,
        coerceNotes(raw.notes),
        ts,
        ts,
      );
      restoredCount += 1;
    }

    // 3. Bump the couple's updated_at so a second tab using If-Match
    //    realises the world has shifted.
    db.prepare("UPDATE couples SET updated_at = ? WHERE id = ?").run(ts, couple.id);
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.snapshot_restore",
    target_kind: "budget_snapshot",
    target_id: id,
    note: `restored ${restoredCount} lines`,
    after: { name: snapshotRow.name, restored_count: restoredCount },
  });

  return json({ restored_count: restoredCount, snapshot: toSnapshot(snapshotRow) });
}

function handleDeleteSnapshot(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  router.post("/api/budget/snapshots/:id/restore", handleRestoreSnapshot, true);
  router.delete("/api/budget/snapshots/:id", handleDeleteSnapshot, true);
}
