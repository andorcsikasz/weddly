// Payment schedule for a couple's priced DIY/booked supplier
// (couple_suppliers). When a supplier has any installments, they are the
// source of truth for "how much is actually paid":
//   - the mirrored budget line's actual_huf = SUM(amount_huf WHERE paid)
//   - couple_suppliers.paid is derived (fully settled)
// With zero installments the legacy all-or-nothing `paid` toggle on the
// supplier still governs the budget line — see domain/couple_suppliers.ts.
//
// This module reads the couple_suppliers + budget_lines tables directly (raw
// SQL) rather than importing domain/couple_suppliers, so the dependency stays
// one-directional (couple_suppliers imports from here, never the reverse).

import type {
  CreateInstallmentInput,
  SupplierInstallment,
  UpdateInstallmentInput,
} from "@shared/couple_suppliers";
import { db, now } from "../db";

interface InstallmentRow {
  id: number;
  couple_id: number;
  supplier_id: string;
  label: string | null;
  amount_huf: number;
  due_date: string | null;
  paid_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toInstallment(r: InstallmentRow): SupplierInstallment {
  return {
    id: r.id,
    supplier_id: r.supplier_id,
    label: r.label,
    amount_huf: r.amount_huf,
    due_date: r.due_date,
    paid: r.paid_at !== null,
    paid_at: r.paid_at,
    sort_order: r.sort_order,
  };
}

/** Ordered by sort_order, then dated-before-undated, then due date, then id —
 *  so the schedule reads top-to-bottom the way a couple pays it. */
export function listForSupplier(supplierId: string): SupplierInstallment[] {
  const rows = db
    .prepare(
      `SELECT * FROM supplier_installments
        WHERE supplier_id = ?
        ORDER BY sort_order ASC, (due_date IS NULL) ASC, due_date ASC, id ASC`,
    )
    .all(supplierId) as InstallmentRow[];
  return rows.map(toInstallment);
}

/** Recompute the supplier's paid flag + mirrored budget line actual_huf from
 *  its installments. Idempotent. Called after every installment mutation and
 *  from couple_suppliers.update(). When the supplier has installments they win;
 *  when it has none we fall back to the manual `paid` toggle so deleting the
 *  last installment cleanly reverts to legacy behaviour. */
export function recomputePaidState(coupleId: number, supplierId: string, ts: number = now()): void {
  const sup = db
    .prepare(
      "SELECT price_huf, budget_line_id, paid FROM couple_suppliers WHERE id = ? AND couple_id = ?",
    )
    .get(supplierId, coupleId) as
    | { price_huf: number | null; budget_line_id: number | null; paid: number }
    | undefined;
  if (!sup) return;

  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount_huf ELSE 0 END), 0) AS paid_sum
         FROM supplier_installments WHERE supplier_id = ?`,
    )
    .get(supplierId) as { n: number; paid_sum: number };

  const price = sup.price_huf ?? 0;
  let actual: number;
  let paidFlag: number;
  if (agg.n > 0) {
    // Schedule is the source of truth: actual = paid installments, fully-paid
    // when the paid sum covers the contracted price.
    actual = agg.paid_sum;
    paidFlag = price > 0 && agg.paid_sum >= price ? 1 : 0;
  } else {
    // No schedule — fall back to the manual all-or-nothing toggle.
    paidFlag = sup.paid;
    actual = sup.paid === 1 ? price : 0;
  }

  if (sup.budget_line_id !== null) {
    // On a supplier-mirrored line `actual_huf` IS the paid-so-far figure, so the
    // budget "Paid" column mirrors it (paid_huf = actual). These lines are
    // read-only on /app/budget, so this is the only writer of their paid_huf.
    db.prepare(
      "UPDATE budget_lines SET actual_huf = ?, paid_huf = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
    ).run(actual, actual, ts, sup.budget_line_id, coupleId);
  }
  if (paidFlag !== sup.paid) {
    db.prepare(
      "UPDATE couple_suppliers SET paid = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
    ).run(paidFlag, ts, supplierId, coupleId);
  }
}

export function createInstallment(
  coupleId: number,
  supplierId: string,
  input: CreateInstallmentInput,
): SupplierInstallment {
  const ts = now();
  const created = db.transaction(() => {
    const nextOrder =
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(sort_order), -1) AS m FROM supplier_installments WHERE supplier_id = ?",
          )
          .get(supplierId) as { m: number }
      ).m + 1;
    const r = db
      .prepare(
        `INSERT INTO supplier_installments
           (couple_id, supplier_id, label, amount_huf, due_date, paid_at, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        coupleId,
        supplierId,
        input.label ?? null,
        input.amount_huf,
        input.due_date ?? null,
        input.paid ? ts : null,
        nextOrder,
        ts,
        ts,
      );
    const id = Number(r.lastInsertRowid);
    recomputePaidState(coupleId, supplierId, ts);
    return db.prepare("SELECT * FROM supplier_installments WHERE id = ?").get(id) as InstallmentRow;
  })();
  return toInstallment(created);
}

export function updateInstallment(
  coupleId: number,
  supplierId: string,
  installmentId: number,
  input: UpdateInstallmentInput,
): SupplierInstallment | null {
  const ts = now();
  const result = db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT * FROM supplier_installments WHERE id = ? AND supplier_id = ? AND couple_id = ?",
      )
      .get(installmentId, supplierId, coupleId) as InstallmentRow | undefined;
    if (!existing) return null;

    const label = input.label !== undefined ? input.label : existing.label;
    const amount = input.amount_huf !== undefined ? input.amount_huf : existing.amount_huf;
    const dueDate = input.due_date !== undefined ? input.due_date : existing.due_date;
    // Toggling paid: stamp now when flipping to paid, keep the original stamp
    // if it was already paid, clear it when flipping to unpaid.
    let paidAt = existing.paid_at;
    if (input.paid !== undefined) {
      paidAt = input.paid ? (existing.paid_at ?? ts) : null;
    }

    db.prepare(
      `UPDATE supplier_installments
          SET label = ?, amount_huf = ?, due_date = ?, paid_at = ?, updated_at = ?
        WHERE id = ? AND supplier_id = ? AND couple_id = ?`,
    ).run(label, amount, dueDate, paidAt, ts, installmentId, supplierId, coupleId);

    recomputePaidState(coupleId, supplierId, ts);
    return db
      .prepare("SELECT * FROM supplier_installments WHERE id = ?")
      .get(installmentId) as InstallmentRow;
  })();
  return result ? toInstallment(result) : null;
}

export function deleteInstallment(
  coupleId: number,
  supplierId: string,
  installmentId: number,
): boolean {
  const ts = now();
  return db.transaction(() => {
    const r = db
      .prepare(
        "DELETE FROM supplier_installments WHERE id = ? AND supplier_id = ? AND couple_id = ?",
      )
      .run(installmentId, supplierId, coupleId);
    if (r.changes === 0) return false;
    recomputePaidState(coupleId, supplierId, ts);
    return true;
  })();
}
