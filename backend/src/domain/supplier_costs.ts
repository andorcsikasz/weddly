// Per-couple cost tracking against directory suppliers. The directory itself
// is global (curated entries in code + community submissions in DB), but each
// couple has their own planned + actual figure per supplier they care about.

import { db, now } from "../db";

export interface CoupleSupplierCostRow {
  id: number;
  couple_id: number;
  supplier_id: string;
  planned_huf: number;
  actual_huf: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface CoupleSupplierCost {
  supplier_id: string;
  planned_huf: number;
  actual_huf: number;
  notes: string | null;
  updated_at: number;
}

export function toCoupleSupplierCost(row: CoupleSupplierCostRow): CoupleSupplierCost {
  return {
    supplier_id: row.supplier_id,
    planned_huf: row.planned_huf,
    actual_huf: row.actual_huf,
    notes: row.notes,
    updated_at: row.updated_at,
  };
}

export function listCoupleSupplierCosts(coupleId: number): CoupleSupplierCostRow[] {
  return db
    .prepare("SELECT * FROM couple_supplier_costs WHERE couple_id = ? ORDER BY updated_at DESC")
    .all(coupleId) as CoupleSupplierCostRow[];
}

export function getCoupleSupplierCost(
  coupleId: number,
  supplierId: string,
): CoupleSupplierCostRow | null {
  return (
    (db
      .prepare("SELECT * FROM couple_supplier_costs WHERE couple_id = ? AND supplier_id = ?")
      .get(coupleId, supplierId) as CoupleSupplierCostRow | undefined) ?? null
  );
}

export interface UpsertCostInput {
  planned_huf: number;
  actual_huf: number;
  notes: string | null;
}

export function upsertCoupleSupplierCost(
  coupleId: number,
  supplierId: string,
  input: UpsertCostInput,
): CoupleSupplierCostRow {
  const ts = now();
  db.prepare(
    `INSERT INTO couple_supplier_costs
       (couple_id, supplier_id, planned_huf, actual_huf, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(couple_id, supplier_id) DO UPDATE SET
       planned_huf = excluded.planned_huf,
       actual_huf = excluded.actual_huf,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
  ).run(coupleId, supplierId, input.planned_huf, input.actual_huf, input.notes, ts, ts);
  const row = getCoupleSupplierCost(coupleId, supplierId);
  if (!row) throw new Error("Failed to read upserted supplier cost row");
  return row;
}

export function deleteCoupleSupplierCost(coupleId: number, supplierId: string): void {
  db.prepare("DELETE FROM couple_supplier_costs WHERE couple_id = ? AND supplier_id = ?").run(
    coupleId,
    supplierId,
  );
}
