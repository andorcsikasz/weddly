// Money-in ledger (cash gifts, contributions). Standalone — not tied to
// suppliers or budget lines. The frontend pairs the total against the budget's
// actual spend for a "recovered vs spent" report. Couple-scoped; callers
// resolve the couple via getCoupleForUser.

import type { CoupleIncome, CreateCoupleIncomeInput, UpdateCoupleIncomeInput } from "@shared/types";
import { db, now } from "../db";

interface Row {
  id: number;
  couple_id: number;
  label: string;
  amount_huf: number;
  received_on: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

function toDto(r: Row): CoupleIncome {
  return {
    id: r.id,
    couple_id: r.couple_id,
    label: r.label,
    amount_huf: r.amount_huf,
    received_on: r.received_on,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listByCoupleId(coupleId: number): CoupleIncome[] {
  const rows = db
    .prepare(
      `SELECT * FROM couple_income WHERE couple_id = ?
        ORDER BY (received_on IS NULL) ASC, received_on DESC, id DESC`,
    )
    .all(coupleId) as Row[];
  return rows.map(toDto);
}

export function insert(coupleId: number, input: CreateCoupleIncomeInput): CoupleIncome {
  const ts = now();
  const r = db
    .prepare(
      `INSERT INTO couple_income (couple_id, label, amount_huf, received_on, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      input.label,
      input.amount_huf,
      input.received_on ?? null,
      input.notes ?? null,
      ts,
      ts,
    );
  const id = Number(r.lastInsertRowid);
  return toDto(db.prepare("SELECT * FROM couple_income WHERE id = ?").get(id) as Row);
}

export function update(
  id: number,
  coupleId: number,
  input: UpdateCoupleIncomeInput,
): CoupleIncome | null {
  const existing = db
    .prepare("SELECT * FROM couple_income WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as Row | undefined;
  if (!existing) return null;

  const ts = now();
  const label = input.label !== undefined ? input.label : existing.label;
  const amount = input.amount_huf !== undefined ? input.amount_huf : existing.amount_huf;
  const receivedOn = input.received_on !== undefined ? input.received_on : existing.received_on;
  const notes = input.notes !== undefined ? input.notes : existing.notes;

  db.prepare(
    `UPDATE couple_income SET label = ?, amount_huf = ?, received_on = ?, notes = ?, updated_at = ?
      WHERE id = ? AND couple_id = ?`,
  ).run(label, amount, receivedOn, notes, ts, id, coupleId);

  return toDto(db.prepare("SELECT * FROM couple_income WHERE id = ?").get(id) as Row);
}

export function deleteById(id: number, coupleId: number): boolean {
  const r = db
    .prepare("DELETE FROM couple_income WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return r.changes > 0;
}
