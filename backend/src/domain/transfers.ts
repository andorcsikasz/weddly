// Transfer trips between airport / lodging / venue. v1 is intentionally "basic":
// flat list + label + optional time/capacity. Couple-scoped CRUD; guest
// assignment lives on `guests.transfer_id`.

import type { Transfer, UpsertTransferInput } from "@shared/types";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

const MAX_LABEL_LEN = 120;
const MAX_DIRECTION_LEN = 60;
const MAX_NOTES_LEN = 2000;
const MAX_CAPACITY = 200;
const DEPART_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface TransferRow {
  id: number;
  couple_id: number;
  label: string;
  direction: string | null;
  depart_at: string | null;
  capacity: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function toTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    couple_id: row.couple_id,
    label: row.label,
    direction: row.direction,
    depart_at: row.depart_at,
    capacity: row.capacity,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseLabel(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "label required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "label required");
  if (trimmed.length > MAX_LABEL_LEN) {
    throw new HttpError(400, `label too long (max ${MAX_LABEL_LEN} chars)`);
  }
  return trimmed;
}

function parseOptionalString(raw: unknown, max: number, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `${field} too long (max ${max} chars)`);
  return trimmed;
}

function parseDepartAt(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !DEPART_AT_RE.test(raw)) {
    throw new HttpError(400, "depart_at must be 'YYYY-MM-DDTHH:MM'");
  }
  return raw;
}

function parseCapacity(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
    throw new HttpError(400, `capacity must be 1..${MAX_CAPACITY}`);
  }
  return n;
}

export interface ParsedTransfer {
  label: string;
  direction: string | null;
  depart_at: string | null;
  capacity: number | null;
  notes: string | null;
}

export function parseTransferCreate(body: Partial<UpsertTransferInput>): ParsedTransfer {
  return {
    label: parseLabel(body.label),
    direction: parseOptionalString(body.direction, MAX_DIRECTION_LEN, "direction"),
    depart_at: parseDepartAt(body.depart_at),
    capacity: parseCapacity(body.capacity),
    notes: parseOptionalString(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

export function parseTransferPatch(
  body: Partial<UpsertTransferInput>,
  existing: TransferRow,
): ParsedTransfer {
  return {
    label: body.label === undefined ? existing.label : parseLabel(body.label),
    direction:
      body.direction === undefined
        ? existing.direction
        : parseOptionalString(body.direction, MAX_DIRECTION_LEN, "direction"),
    depart_at: body.depart_at === undefined ? existing.depart_at : parseDepartAt(body.depart_at),
    capacity: body.capacity === undefined ? existing.capacity : parseCapacity(body.capacity),
    notes:
      body.notes === undefined
        ? existing.notes
        : parseOptionalString(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

export function listTransfers(coupleId: number): Transfer[] {
  const rows = db
    .prepare("SELECT * FROM transfers WHERE couple_id = ? ORDER BY created_at ASC, id ASC")
    .all(coupleId) as TransferRow[];
  return rows.map(toTransfer);
}

export function getTransferScoped(id: number, coupleId: number): TransferRow | null {
  return (
    (db.prepare("SELECT * FROM transfers WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | TransferRow
      | undefined) ?? null
  );
}

export function insertTransfer(coupleId: number, parsed: ParsedTransfer): TransferRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO transfers
         (couple_id, label, direction, depart_at, capacity, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.label,
      parsed.direction,
      parsed.depart_at,
      parsed.capacity,
      parsed.notes,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as TransferRow;
}

export function updateTransfer(
  id: number,
  coupleId: number,
  parsed: ParsedTransfer,
): TransferRow {
  const ts = now();
  db.prepare(
    `UPDATE transfers SET
       label = ?, direction = ?, depart_at = ?, capacity = ?, notes = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.label,
    parsed.direction,
    parsed.depart_at,
    parsed.capacity,
    parsed.notes,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as TransferRow;
}

export function deleteTransfer(id: number, coupleId: number): boolean {
  const result = db
    .prepare("DELETE FROM transfers WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}
