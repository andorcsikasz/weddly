// Seating tables, seat assignments, conflict tracker. Couple-scoped.

import type { SeatAssignment, SeatingConflict, SeatingTable, TableShape } from "@shared/types";
import { defaultDimsForShape, maxSeatsForTable } from "@shared/seating";
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
  rotation_deg: number;
  disabled_seats_json: string;
  baby_seats_json: string;
  is_kids_table: number;
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

const VALID_SHAPES: ReadonlySet<TableShape> = new Set(["round", "long", "square", "head"]);

function toTable(r: TableRow): SeatingTable {
  // disabled_seats_json / baby_seats_json may be malformed (manual DB edit,
  // future schema change) — fall back to [] rather than crash the whole plan
  // response. After parsing, baby gets filtered to be disjoint with disabled
  // so a single seat can't be both.
  const parseSeatList = (raw: string, capN: number): number[] => {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < capN);
    } catch {
      return [];
    }
  };
  const disabled = parseSeatList(r.disabled_seats_json, r.seats);
  const babyRaw = parseSeatList(r.baby_seats_json, r.seats);
  const disabledSet = new Set(disabled);
  const baby = babyRaw.filter((n) => !disabledSet.has(n));
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
    rotation_deg: ((r.rotation_deg % 360) + 360) % 360,
    is_kids_table: Boolean(r.is_kids_table),
    disabled_seats: disabled,
    baby_seats: baby,
    created_at: r.created_at,
    updated_at: r.updated_at,
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
  rotation_deg?: unknown;
  disabled_seats?: unknown;
  baby_seats?: unknown;
  is_kids_table?: unknown;
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
  // Soft cap applied later once we know the dimensions — keep the raw
  // request here, clamp at the very end after width/length are settled.
  const seatsRequested = Math.round(seatsNum);
  const xRaw = Number(body.x_mm ?? 0);
  const yRaw = Number(body.y_mm ?? 0);
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
    throw new HttpError(400, "x_mm/y_mm must be finite");
  }

  // Defaults if the client didn't send dimensions — shared with the
  // frontend's shape-picker snap-to behaviour. Round Ø 1500, square
  // 1600×1600, long 800×1600 ("tégla asztal"), head 900×4000.
  const { width_mm: defaultWidth, length_mm: defaultLength } = defaultDimsForShape(shape);
  let width = Math.round(Number(body.width_mm ?? defaultWidth));
  let length = Math.round(Number(body.length_mm ?? defaultLength));
  if (!Number.isFinite(width) || !Number.isFinite(length)) {
    throw new HttpError(400, "width_mm/length_mm must be finite");
  }
  if (width < MIN_DIM_MM || width > MAX_DIM_MM || length < MIN_DIM_MM || length > MAX_DIM_MM) {
    throw new HttpError(400, `dimensions must be ${MIN_DIM_MM}–${MAX_DIM_MM} mm`);
  }
  // Round and square always have equal sides; collapse to the larger dim so
  // resizing one updates both regardless of which the UI sends. Long and
  // head tables keep length × width independent (head tables are usually
  // wider than they are deep, with chairs only on one long side).
  if (shape !== "long" && shape !== "head") {
    const side = Math.max(width, length);
    width = side;
    length = side;
  }

  // Rotation is optional and stored normalised to 0–359 degrees. Any integer
  // is accepted so a future "free rotate" UI can land without a schema bump.
  const rotRaw = Number(body.rotation_deg ?? 0);
  if (!Number.isFinite(rotRaw)) {
    throw new HttpError(400, "rotation_deg must be finite");
  }
  const rotation_deg = ((Math.round(rotRaw) % 360) + 360) % 360;

  // Soft cap on seats given the now-final dimensions. We treat the chair
  // pitch (80 cm) as the binding constraint — anything above is silently
  // clamped. This also protects against legacy rows that were created
  // before the cap existed; touching them through this endpoint normalises
  // the count.
  const seatsCap = maxSeatsForTable(shape, width, length);
  const seats = Math.min(seatsRequested, seatsCap);

  // Disabled-seat indices — filter to integers in the valid 0..seats-1 range
  // and dedupe. Anything else is silently dropped so a stale array from a
  // shrunken table never wedges the write.
  const normaliseSeatList = (raw: unknown, exclude?: Set<number>): number[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const v of raw) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n >= seats || seen.has(n)) continue;
      if (exclude?.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.sort((a, b) => a - b);
  };
  const disabled_seats = normaliseSeatList(body.disabled_seats);
  // Baby seats are independent of disabled seats but the two must be
  // disjoint — a chair that's been "removed for design" can't also need a
  // high-chair. Disabled wins.
  const baby_seats = normaliseSeatList(body.baby_seats, new Set(disabled_seats));

  const is_kids_table = body.is_kids_table === true || body.is_kids_table === 1 ? 1 : 0;

  return {
    label,
    shape,
    seats,
    /** The seats value the client actually asked for, before the geometry
     *  cap shrank it. Equals `seats` in the common case; differs when the
     *  request would overflow the chair-pitch budget of the table footprint.
     *  Routes use this to surface a `seats_clamped` signal so the UI can
     *  toast a "fits N chairs, not M" message instead of silently swallowing
     *  the mismatch. */
    seats_requested: seatsRequested,
    x_mm: Math.round(xRaw),
    y_mm: Math.round(yRaw),
    width_mm: width,
    length_mm: length,
    rotation_deg,
    disabled_seats,
    baby_seats,
    is_kids_table,
  };
}

async function handleCreateTable(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<UpsertTableBody>(ctx.req);
  const parsed = parseTableBody(body);
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO seating_tables (couple_id, label, shape, seats, x_mm, y_mm, width_mm, length_mm, rotation_deg, disabled_seats_json, baby_seats_json, is_kids_table, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      parsed.rotation_deg,
      JSON.stringify(parsed.disabled_seats),
      JSON.stringify(parsed.baby_seats),
      parsed.is_kids_table,
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
  // Surface the clamp diagnostic only when it fires — keeps the common-case
  // response identical to the pre-existing shape.
  const clamped = parsed.seats < parsed.seats_requested;
  const envelope = clamped
    ? { table: toTable(row), seats_clamped: true, seats_requested: parsed.seats_requested }
    : { table: toTable(row) };
  return json(envelope, { status: 201 });
}

/** PATCH /api/seating/tables/:id — partial update with optimistic concurrency.
 *  Clients may supply only the fields they're changing; any field they omit
 *  carries through from the existing row. `If-Match` carries the row's last
 *  `updated_at` — when present and stale, we return 409 and refuse the write
 *  so a second editor's tab doesn't silently blow away the first's changes. */
async function handleUpdateTable(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = db
    .prepare("SELECT * FROM seating_tables WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as TableRow | undefined;
  if (!existing) throw new HttpError(404, "Table not found");

  // If-Match guard. We accept the header verbatim and as a quoted ETag so the
  // frontend can use either form without ceremony.
  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(existing.updated_at)) {
      throw new HttpError(409, "Stale table — reload before saving", {
        code: "stale",
        current_updated_at: existing.updated_at,
      });
    }
  }

  const body = await readJson<UpsertTableBody>(ctx.req);
  // Merge partial fields with the existing row before validating. Anything
  // absent from `body` falls back to the existing value so PATCH semantics
  // stay clean.
  const parseStoredArray = (raw: string | null | undefined): number[] => {
    try {
      const v = JSON.parse(raw ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const existingDisabled = parseStoredArray(existing.disabled_seats_json);
  const existingBaby = parseStoredArray(existing.baby_seats_json);
  const merged: UpsertTableBody = {
    label: body.label ?? existing.label,
    shape: body.shape ?? existing.shape,
    seats: body.seats ?? existing.seats,
    x_mm: body.x_mm ?? existing.x_mm,
    y_mm: body.y_mm ?? existing.y_mm,
    width_mm: body.width_mm ?? existing.width_mm,
    length_mm: body.length_mm ?? existing.length_mm,
    rotation_deg: body.rotation_deg ?? existing.rotation_deg,
    disabled_seats: body.disabled_seats ?? existingDisabled,
    baby_seats: body.baby_seats ?? existingBaby,
    is_kids_table: body.is_kids_table ?? Boolean(existing.is_kids_table),
  };
  const parsed = parseTableBody(merged);

  // Orphan-safe shrink: if the new seat count is below an existing
  // occupied seat_index, refuse the write so we never silently delete a
  // guest's assignment. The frontend surfaces this as a "table too small"
  // toast; the couple needs to free a seat (or stand-down the resize)
  // first.
  if (parsed.seats < existing.seats) {
    const orphans = db
      .prepare("SELECT COUNT(*) AS c FROM seat_assignments WHERE table_id = ? AND seat_index >= ?")
      .get(id, parsed.seats) as { c: number };
    if (orphans.c > 0) {
      throw new HttpError(400, "Table too small — empty a seat first", {
        code: "table_too_small",
        occupied_count: orphans.c,
      });
    }
  }

  const ts = now();
  db.prepare(
    `UPDATE seating_tables SET label = ?, shape = ?, seats = ?, x_mm = ?, y_mm = ?,
       width_mm = ?, length_mm = ?, rotation_deg = ?, disabled_seats_json = ?,
       baby_seats_json = ?, is_kids_table = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.label,
    parsed.shape,
    parsed.seats,
    parsed.x_mm,
    parsed.y_mm,
    parsed.width_mm,
    parsed.length_mm,
    parsed.rotation_deg,
    JSON.stringify(parsed.disabled_seats),
    JSON.stringify(parsed.baby_seats),
    parsed.is_kids_table,
    ts,
    id,
    coupleId,
  );

  // No orphan-purge here — the orphan-safe check above refuses any shrink
  // that would lose an occupied seat. Empty seats above the new count are
  // simply not addressable any more; the table_id + seat_index never
  // referenced them, so there's nothing to clean.

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "table.update",
    target_kind: "seating_table",
    target_id: id,
    before: { label: existing.label },
    after: parsed,
  });
  const row = db.prepare("SELECT * FROM seating_tables WHERE id = ?").get(id) as TableRow;
  // Mirror the create handler: only emit the clamp diagnostic when the cap
  // actually shrank the request. A PATCH that didn't touch `seats` (so the
  // merged value equals the stored one) never trips this branch — `merged`
  // carries `existing.seats` forward and `seats_requested` matches.
  const clamped = parsed.seats < parsed.seats_requested;
  const envelope = clamped
    ? { table: toTable(row), seats_clamped: true, seats_requested: parsed.seats_requested }
    : { table: toTable(row) };
  return json(envelope);
}

function handleDeleteTable(ctx: Ctx): Response {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = db
    .prepare("SELECT label FROM seating_tables WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as { label: string } | undefined;
  if (!existing) throw new HttpError(404, "Table not found");

  db.prepare("DELETE FROM seating_tables WHERE id = ? AND couple_id = ?").run(id, coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "table.delete",
    target_kind: "seating_table",
    target_id: id,
    before: { label: existing.label },
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
  // Reject assignments to seats the couple has X'd out in the editor.
  // Parsed defensively — malformed JSON just means no disabled seats here.
  try {
    const disabled = JSON.parse(table.disabled_seats_json ?? "[]");
    if (Array.isArray(disabled) && disabled.includes(seatIndex)) {
      throw new HttpError(400, "seat is disabled");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
  const guestRow = db
    .prepare("SELECT full_name FROM guests WHERE id = ? AND couple_id = ?")
    .get(guestId, coupleId) as { full_name: string } | undefined;
  if (!guestRow) throw new HttpError(404, "Guest not in this couple");

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
    after: {
      table_id: tableId,
      seat_index: seatIndex,
      guest_name: guestRow.full_name,
      table_label: table.label,
    },
  });
  return json({ ok: true });
}

interface SwapBody {
  guest_a_id?: unknown;
  guest_b_id?: unknown;
}

/** Atomic seat swap between two assigned guests. Replaces the 3-call
 *  `unassign → unassign → assign × 2` dance the frontend used to do, which
 *  could leave the plan in a half-swapped state if one of the writes failed
 *  or the second editor changed something in between. */
async function handleSwapSeats(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<SwapBody>(ctx.req);
  const a = Number(body.guest_a_id);
  const b = Number(body.guest_b_id);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    throw new HttpError(400, "Two distinct guest ids required");
  }

  // Both guests must belong to this couple.
  const guestRows = db
    .prepare("SELECT id, full_name FROM guests WHERE id IN (?, ?) AND couple_id = ?")
    .all(a, b, coupleId) as { id: number; full_name: string }[];
  if (guestRows.length !== 2) throw new HttpError(404, "Guests not in this couple");
  const guestAName = guestRows.find((g) => g.id === a)?.full_name ?? null;
  const guestBName = guestRows.find((g) => g.id === b)?.full_name ?? null;

  // Both guests must currently be seated (otherwise this is a regular assign).
  const assignA = db
    .prepare(
      `SELECT sa.id, sa.table_id, sa.seat_index FROM seat_assignments sa
       JOIN seating_tables st ON st.id = sa.table_id
       WHERE sa.guest_id = ? AND st.couple_id = ?`,
    )
    .get(a, coupleId) as { id: number; table_id: number; seat_index: number } | undefined;
  const assignB = db
    .prepare(
      `SELECT sa.id, sa.table_id, sa.seat_index FROM seat_assignments sa
       JOIN seating_tables st ON st.id = sa.table_id
       WHERE sa.guest_id = ? AND st.couple_id = ?`,
    )
    .get(b, coupleId) as { id: number; table_id: number; seat_index: number } | undefined;
  if (!assignA || !assignB) throw new HttpError(400, "Both guests must already be seated");

  // Swap in a transaction. Drop both rows then re-insert with crossed targets
  // — the UNIQUE constraints on (guest_id) and (table_id, seat_index) only
  // care about the final state, but doing it in two steps means the
  // intermediate doesn't trip them.
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM seat_assignments WHERE id IN (?, ?)").run(assignA.id, assignB.id);
    const insert = db.prepare(
      "INSERT INTO seat_assignments (table_id, seat_index, guest_id) VALUES (?, ?, ?)",
    );
    insert.run(assignA.table_id, assignA.seat_index, b);
    insert.run(assignB.table_id, assignB.seat_index, a);
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "seat.swap",
    target_kind: "seat_assignment",
    target_id: a,
    after: {
      guest_a_id: a,
      guest_b_id: b,
      guest_a_name: guestAName,
      guest_b_name: guestBName,
      a_to: { table_id: assignB.table_id, seat_index: assignB.seat_index },
      b_to: { table_id: assignA.table_id, seat_index: assignA.seat_index },
    },
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
  const guestRow = db
    .prepare("SELECT full_name FROM guests WHERE id = ? AND couple_id = ?")
    .get(guestId, coupleId) as { full_name: string } | undefined;
  if (!guestRow) throw new HttpError(404, "Guest not in this couple");

  // Capture the seat we're vacating so the audit feed can name the table.
  const prevSeat = db
    .prepare(
      `SELECT st.label AS table_label FROM seat_assignments sa
       JOIN seating_tables st ON st.id = sa.table_id
       WHERE sa.guest_id = ? AND st.couple_id = ?`,
    )
    .get(guestId, coupleId) as { table_label: string } | undefined;

  db.prepare("DELETE FROM seat_assignments WHERE guest_id = ?").run(guestId);
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "seat.unassign",
    target_kind: "seat_assignment",
    target_id: guestId,
    before: { guest_name: guestRow.full_name, table_label: prevSeat?.table_label ?? null },
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

/** Standalone list endpoint for couple-defined seating conflicts. The same
 *  rows already ship inside `GET /api/seating/plan` for the canvas; this
 *  surface mirrors the POST/DELETE pair so anyone exploring the API gets a
 *  RESTful triplet instead of "POST yes, DELETE yes, GET nope, 404". */
function handleListConflicts(ctx: Ctx): Response {
  const { coupleId } = requireCouple(ctx);
  const conflicts = (
    db
      .prepare("SELECT * FROM seating_conflicts WHERE couple_id = ? ORDER BY id ASC")
      .all(coupleId) as ConflictRow[]
  ).map(toConflict);
  return json({ conflicts });
}

export function registerSeatingRoutes(router: Router) {
  router.get("/api/seating/plan", handleGetPlan, true);
  router.post("/api/seating/tables", handleCreateTable, true);
  router.patch("/api/seating/tables/:id", handleUpdateTable, true);
  router.delete("/api/seating/tables/:id", handleDeleteTable, true);
  router.post("/api/seating/assign", handleAssignSeat, true);
  router.post("/api/seating/unassign", handleUnassignSeat, true);
  router.post("/api/seating/swap", handleSwapSeats, true);
  router.get("/api/seating/conflicts", handleListConflicts, true);
  router.post("/api/seating/conflicts", handleCreateConflict, true);
  router.delete("/api/seating/conflicts/:id", handleDeleteConflict, true);
}
