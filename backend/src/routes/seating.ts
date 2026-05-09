// Seating tables, seat assignments, conflict tracker. Couple-scoped.

import type { SeatAssignment, SeatingConflict, SeatingTable, TableShape } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface TableRow {
  id: number;
  couple_id: number;
  label: string;
  shape: string;
  seats: number;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  length_mm: number;
  created_at: number;
  updated_at: number;
}

interface AssignRow {
  id: number;
  table_id: number;
  seat_index: number;
  guest_id: number;
}

interface ConflictRow {
  id: number;
  couple_id: number;
  guest_a_id: number;
  guest_b_id: number;
  kind: string;
  note: string | null;
  created_at: number;
}

const VALID_SHAPES: ReadonlySet<TableShape> = new Set(["round", "long", "square"]);

function toTable(r: TableRow): SeatingTable {
  return {
    id: r.id,
    couple_id: r.couple_id,
    label: r.label,
    shape: (VALID_SHAPES.has(r.shape as TableShape) ? r.shape : "round") as TableShape,
    seats: r.seats,
    x_mm: r.x_mm,
    y_mm: r.y_mm,
    width_mm: r.width_mm,
    length_mm: r.length_mm,
    created_at: r.created_at,
  };
}

function toAssignment(r: AssignRow): SeatAssignment {
  return { id: r.id, table_id: r.table_id, seat_index: r.seat_index, guest_id: r.guest_id };
}

function toConflict(r: ConflictRow): SeatingConflict {
  return {
    id: r.id,
    couple_id: r.couple_id,
    guest_a_id: r.guest_a_id,
    guest_b_id: r.guest_b_id,
    kind: r.kind === "split" ? "split" : "avoid",
    note: r.note,
    created_at: r.created_at,
  };
}

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, coupleId: couple.id };
}

interface PlanResponse {
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  conflicts: SeatingConflict[];
}

function handleGetPlan(ctx: Ctx): Response {
  const { coupleId } = requireCouple(ctx);
  const tables = (
    db
      .prepare("SELECT * FROM seating_tables WHERE couple_id = ? ORDER BY id ASC")
      .all(coupleId) as TableRow[]
  ).map(toTable);
  const tableIds = tables.map((t) => t.id);
  const assignments =
    tableIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM seat_assignments WHERE table_id IN (${tableIds.map(() => "?").join(",")})`,
            )
            .all(...tableIds) as AssignRow[]
        ).map(toAssignment);
  const conflicts = (
    db
      .prepare("SELECT * FROM seating_conflicts WHERE couple_id = ? ORDER BY id ASC")
      .all(coupleId) as ConflictRow[]
  ).map(toConflict);
  const plan: PlanResponse = { tables, assignments, conflicts };
  return json(plan);
}

interface UpsertTableBody {
  label?: unknown;
  shape?: unknown;
  seats?: unknown;
  x_mm?: unknown;
  y_mm?: unknown;
  width_mm?: unknown;
  length_mm?: unknown;
}

// Hard caps on dimensions: a single table over 10m is almost certainly a typo
// and would blow the canvas/PDF layout. 100mm is below any real banquet table.
const MIN_DIM_MM = 100;
const MAX_DIM_MM = 10_000;

function parseTableBody(body: UpsertTableBody) {
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 100) throw new HttpError(400, "label required (≤100 chars)");
  const shapeRaw = typeof body.shape === "string" ? body.shape : "round";
  const shape: TableShape = VALID_SHAPES.has(shapeRaw as TableShape)
    ? (shapeRaw as TableShape)
    : "round";
  const seatsNum = Number(body.seats ?? 8);
  if (!Number.isFinite(seatsNum) || seatsNum < 1 || seatsNum > 40) {
    throw new HttpError(400, "seats must be 1–40");
  }
  const seats = Math.round(seatsNum);
  const xRaw = Number(body.x_mm ?? 0);
  const yRaw = Number(body.y_mm ?? 0);
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
    throw new HttpError(400, "x_mm/y_mm must be finite");
  }

  // Defaults if the client didn't send dimensions: 1500mm round/square is a
  // typical 8-seat banquet; 2400×900 is a typical long table.
  const defaultWidth = shape === "long" ? 900 : 1500;
  const defaultLength = shape === "long" ? 2400 : 1500;
  let width = Math.round(Number(body.width_mm ?? defaultWidth));
  let length = Math.round(Number(body.length_mm ?? defaultLength));
  if (!Number.isFinite(width) || !Number.isFinite(length)) {
    throw new HttpError(400, "width_mm/length_mm must be finite");
  }
  if (width < MIN_DIM_MM || width > MAX_DIM_MM || length < MIN_DIM_MM || length > MAX_DIM_MM) {
    throw new HttpError(400, `dimensions must be ${MIN_DIM_MM}–${MAX_DIM_MM} mm`);
  }
  // Round and square always have equal sides; collapse to the larger dim so
  // resizing one updates both regardless of which the UI sends.
  if (shape !== "long") {
    const side = Math.max(width, length);
    width = side;
    length = side;
  }

  return {
    label,
    shape,
    seats,
    x_mm: Math.round(xRaw),
    y_mm: Math.round(yRaw),
    width_mm: width,
    length_mm: length,
  };
}

async function handleCreateTable(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<UpsertTableBody>(ctx.req);
  const parsed = parseTableBody(body);
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO seating_tables (couple_id, label, shape, seats, x_mm, y_mm, width_mm, length_mm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.label,
      parsed.shape,
      parsed.seats,
      parsed.x_mm,
      parsed.y_mm,
      parsed.width_mm,
      parsed.length_mm,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "table.create",
    target_kind: "seating_table",
    target_id: id,
    after: parsed,
  });
  const row = db.prepare("SELECT * FROM seating_tables WHERE id = ?").get(id) as TableRow;
  return json({ table: toTable(row) }, { status: 201 });
}

async function handleUpdateTable(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = db
    .prepare("SELECT * FROM seating_tables WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as TableRow | undefined;
  if (!existing) throw new HttpError(404, "Table not found");

  const body = await readJson<UpsertTableBody>(ctx.req);
  const parsed = parseTableBody(body);
  const ts = now();
  db.prepare(
    `UPDATE seating_tables SET label = ?, shape = ?, seats = ?, x_mm = ?, y_mm = ?,
       width_mm = ?, length_mm = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.label,
    parsed.shape,
    parsed.seats,
    parsed.x_mm,
    parsed.y_mm,
    parsed.width_mm,
    parsed.length_mm,
    ts,
    id,
    coupleId,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "table.update",
    target_kind: "seating_table",
    target_id: id,
    after: parsed,
  });
  const row = db.prepare("SELECT * FROM seating_tables WHERE id = ?").get(id) as TableRow;
  return json({ table: toTable(row) });
}

function handleDeleteTable(ctx: Ctx): Response {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const result = db
    .prepare("DELETE FROM seating_tables WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  if (result.changes === 0) throw new HttpError(404, "Table not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "table.delete",
    target_kind: "seating_table",
    target_id: id,
  });
  return json({ ok: true });
}

interface AssignBody {
  table_id?: unknown;
  seat_index?: unknown;
  guest_id?: unknown;
}

async function handleAssignSeat(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<AssignBody>(ctx.req);
  const tableId = Number(body.table_id);
  const seatIndex = Number(body.seat_index);
  const guestId = Number(body.guest_id);
  if (![tableId, seatIndex, guestId].every((n) => Number.isFinite(n))) {
    throw new HttpError(400, "table_id / seat_index / guest_id required");
  }

  // Verify the table + guest both belong to this couple — tightest scoping check.
  const table = db
    .prepare("SELECT * FROM seating_tables WHERE id = ? AND couple_id = ?")
    .get(tableId, coupleId) as TableRow | undefined;
  if (!table) throw new HttpError(404, "Table not found");
  if (seatIndex < 0 || seatIndex >= table.seats)
    throw new HttpError(400, "seat_index out of range");
  const guestOk = db
    .prepare("SELECT 1 FROM guests WHERE id = ? AND couple_id = ?")
    .get(guestId, coupleId);
  if (!guestOk) throw new HttpError(404, "Guest not in this couple");

  // UPSERT — guest_id is UNIQUE, so re-assigning a guest moves them to the new seat.
  // We delete any existing assignment for this guest first, plus any existing
  // assignment for the target seat (in case we're swapping).
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM seat_assignments WHERE guest_id = ?").run(guestId);
    db.prepare("DELETE FROM seat_assignments WHERE table_id = ? AND seat_index = ?").run(
      tableId,
      seatIndex,
    );
    db.prepare(
      "INSERT INTO seat_assignments (table_id, seat_index, guest_id) VALUES (?, ?, ?)",
    ).run(tableId, seatIndex, guestId);
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "seat.assign",
    target_kind: "seat_assignment",
    target_id: guestId,
    after: { table_id: tableId, seat_index: seatIndex },
  });
  return json({ ok: true });
}

interface UnassignParams {
  guest_id?: unknown;
}

async function handleUnassignSeat(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<UnassignParams>(ctx.req);
  const guestId = Number(body.guest_id);
  if (!Number.isFinite(guestId)) throw new HttpError(400, "guest_id required");
  const guestOk = db
    .prepare("SELECT 1 FROM guests WHERE id = ? AND couple_id = ?")
    .get(guestId, coupleId);
  if (!guestOk) throw new HttpError(404, "Guest not in this couple");

  db.prepare("DELETE FROM seat_assignments WHERE guest_id = ?").run(guestId);
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "seat.unassign",
    target_kind: "seat_assignment",
    target_id: guestId,
  });
  return json({ ok: true });
}

interface ConflictBody {
  guest_a_id?: unknown;
  guest_b_id?: unknown;
  kind?: unknown;
  note?: unknown;
}

async function handleCreateConflict(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<ConflictBody>(ctx.req);
  const a = Number(body.guest_a_id);
  const b = Number(body.guest_b_id);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    throw new HttpError(400, "Two distinct guest ids required");
  }
  const kind = body.kind === "split" ? "split" : body.kind === "avoid" ? "avoid" : null;
  if (!kind) throw new HttpError(400, "kind must be 'split' or 'avoid'");
  const note =
    typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  // Ensure both guests belong to this couple.
  const ok = db
    .prepare("SELECT COUNT(*) AS c FROM guests WHERE id IN (?, ?) AND couple_id = ?")
    .get(a, b, coupleId) as { c: number };
  if (ok.c !== 2) throw new HttpError(404, "Guests not in this couple");

  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO seating_conflicts (couple_id, guest_a_id, guest_b_id, kind, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(coupleId, a, b, kind, note, ts);
  const id = Number(result.lastInsertRowid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "conflict.create",
    target_kind: "seating_conflict",
    target_id: id,
    after: { kind, a, b },
  });
  const row = db.prepare("SELECT * FROM seating_conflicts WHERE id = ?").get(id) as ConflictRow;
  return json({ conflict: toConflict(row) }, { status: 201 });
}

function handleDeleteConflict(ctx: Ctx): Response {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const r = db
    .prepare("DELETE FROM seating_conflicts WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  if (r.changes === 0) throw new HttpError(404, "Conflict not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "conflict.delete",
    target_kind: "seating_conflict",
    target_id: id,
  });
  return json({ ok: true });
}

export function registerSeatingRoutes(router: Router) {
  router.get("/api/seating/plan", handleGetPlan, true);
  router.post("/api/seating/tables", handleCreateTable, true);
  router.patch("/api/seating/tables/:id", handleUpdateTable, true);
  router.delete("/api/seating/tables/:id", handleDeleteTable, true);
  router.post("/api/seating/assign", handleAssignSeat, true);
  router.post("/api/seating/unassign", handleUnassignSeat, true);
  router.post("/api/seating/conflicts", handleCreateConflict, true);
  router.delete("/api/seating/conflicts/:id", handleDeleteConflict, true);
}
