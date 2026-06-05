// "Csinálom magam" supplier entries — couple-private. Owns its own price
// field and mirrors a positive value into a paired `budget_lines` row so
// /app/budget reflects DIY costs alongside booked vendors. The supplier
// row is the source of truth; the budget line is read-only and disappears
// when the price is cleared or the supplier is deleted.
//
// Loop C₂ fix: a DIY price is "planned" by default — actual_huf stays at 0
// until the couple ticks the `paid` toggle on the supplier card. Before
// this fix every DIY price was double-mirrored to both planned_huf and
// actual_huf on insert, which made the dashboard claim the couple had
// already spent the money on Mom's cooking. Existing rows (created before
// this column landed) keep their old actual_huf — we don't retroactively
// zero it out. That'd silently overwrite intentional data. The fix is
// forward-looking only.

import { randomBytes } from "node:crypto";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import { SUPPLIER_TO_BUDGET, type SupplierCategory } from "@shared/suppliers";
import { db, now } from "../db";
import { listForSupplier, recomputePaidState } from "./supplier_installments";

interface Row {
  id: string;
  couple_id: number;
  name: string;
  category: string;
  notes: string | null;
  price_huf: number | null;
  paid: number;
  budget_line_id: number | null;
  created_at: number;
  updated_at: number;
}

function toDto(r: Row): CoupleSupplier {
  return {
    id: r.id,
    source: "self",
    name: r.name,
    category: r.category as SupplierCategory,
    notes: r.notes,
    price_huf: r.price_huf,
    paid: r.paid === 1,
    budget_line_id: r.budget_line_id,
    installments: listForSupplier(r.id),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listByCoupleId(coupleId: number): CoupleSupplier[] {
  const rows = db
    .prepare("SELECT * FROM couple_suppliers WHERE couple_id = ? ORDER BY created_at DESC")
    .all(coupleId) as Row[];
  return rows.map(toDto);
}

export function getById(id: string, coupleId: number): CoupleSupplier | null {
  const row = db
    .prepare("SELECT * FROM couple_suppliers WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as Row | undefined;
  return row ? toDto(row) : null;
}

/** Inserts a budget line that mirrors a DIY supplier's price. Returns the
 *  new line id. Idempotent caller — invoked only when `price > 0`.
 *  `paid` decides whether `actual_huf` matches the price (true) or stays
 *  at 0 (false, the default — planned-only). */
function insertBudgetLine(
  coupleId: number,
  supplierId: string,
  category: SupplierCategory,
  label: string,
  priceHuf: number,
  paid: boolean,
  ts: number,
): number {
  const r = db
    .prepare(
      `INSERT INTO budget_lines
         (couple_id, category, label, planned_huf, actual_huf, notes,
          couple_supplier_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      SUPPLIER_TO_BUDGET[category],
      label,
      priceHuf,
      paid ? priceHuf : 0,
      null,
      supplierId,
      ts,
      ts,
    );
  return Number(r.lastInsertRowid);
}

function updateBudgetLine(
  lineId: number,
  coupleId: number,
  category: SupplierCategory,
  label: string,
  priceHuf: number,
  paid: boolean,
  ts: number,
): void {
  db.prepare(
    `UPDATE budget_lines
        SET category = ?, label = ?, planned_huf = ?, actual_huf = ?, updated_at = ?
      WHERE id = ? AND couple_id = ?`,
  ).run(SUPPLIER_TO_BUDGET[category], label, priceHuf, paid ? priceHuf : 0, ts, lineId, coupleId);
}

function deleteBudgetLine(lineId: number, coupleId: number): void {
  db.prepare("DELETE FROM budget_lines WHERE id = ? AND couple_id = ?").run(lineId, coupleId);
}

interface InsertInput {
  name: string;
  category: SupplierCategory;
  notes: string | null;
  price_huf: number | null;
  paid: boolean;
}

export function insert(coupleId: number, input: InsertInput): CoupleSupplier {
  const ts = now();
  const id = randomBytes(8).toString("hex");

  // The budget_lines mirror and the couple_suppliers source-of-truth must
  // commit together — a partial failure would orphan a money-bearing budget
  // line whose supplier card never existed (and which the budget UI locks
  // against deletion). Wrap both writes in one transaction.
  db.transaction(() => {
    let budgetLineId: number | null = null;
    if (input.price_huf !== null && input.price_huf > 0) {
      budgetLineId = insertBudgetLine(
        coupleId,
        id,
        input.category,
        input.name,
        input.price_huf,
        input.paid,
        ts,
      );
    }

    db.prepare(
      `INSERT INTO couple_suppliers
       (id, couple_id, name, category, notes, price_huf, paid, budget_line_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      coupleId,
      input.name,
      input.category,
      input.notes,
      input.price_huf,
      input.paid ? 1 : 0,
      budgetLineId,
      ts,
      ts,
    );
  })();

  const created = getById(id, coupleId);
  if (!created) throw new Error("Failed to read inserted couple_supplier");
  return created;
}

interface UpdateInput {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
}

export function update(id: string, coupleId: number, input: UpdateInput): CoupleSupplier | null {
  const existing = db
    .prepare("SELECT * FROM couple_suppliers WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as Row | undefined;
  if (!existing) return null;

  const ts = now();
  const newName = input.name ?? existing.name;
  const newCategory = (input.category ?? existing.category) as SupplierCategory;
  const newNotes = input.notes !== undefined ? input.notes : existing.notes;
  const newPrice = input.price_huf !== undefined ? input.price_huf : existing.price_huf;
  const newPaid = input.paid !== undefined ? input.paid : existing.paid === 1;

  // Mirror + source-of-truth commit together (see insert()).
  db.transaction(() => {
    let newBudgetLineId: number | null = existing.budget_line_id;
    if (newPrice !== null && newPrice > 0) {
      if (newBudgetLineId !== null) {
        updateBudgetLine(newBudgetLineId, coupleId, newCategory, newName, newPrice, newPaid, ts);
      } else {
        newBudgetLineId = insertBudgetLine(
          coupleId,
          id,
          newCategory,
          newName,
          newPrice,
          newPaid,
          ts,
        );
      }
    } else if (newBudgetLineId !== null) {
      // Price cleared — drop the paired line.
      deleteBudgetLine(newBudgetLineId, coupleId);
      newBudgetLineId = null;
    }

    db.prepare(
      `UPDATE couple_suppliers
        SET name = ?, category = ?, notes = ?, price_huf = ?, paid = ?, budget_line_id = ?, updated_at = ?
      WHERE id = ? AND couple_id = ?`,
    ).run(
      newName,
      newCategory,
      newNotes,
      newPrice,
      newPaid ? 1 : 0,
      newBudgetLineId,
      ts,
      id,
      coupleId,
    );

    // If the supplier carries a payment schedule, the installments are the
    // source of truth: re-derive `paid` + the mirror's actual_huf from them,
    // overriding the manual all-or-nothing `paid` just written above. A no-op
    // when there are no installments.
    recomputePaidState(coupleId, id, ts);
  })();

  return getById(id, coupleId);
}

export function deleteById(id: string, coupleId: number): boolean {
  const existing = db
    .prepare("SELECT budget_line_id FROM couple_suppliers WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as { budget_line_id: number | null } | undefined;
  if (!existing) return false;

  // Drop the paired budget line and the supplier row together.
  const result = db.transaction(() => {
    if (existing.budget_line_id !== null) {
      deleteBudgetLine(existing.budget_line_id, coupleId);
    }
    return db
      .prepare("DELETE FROM couple_suppliers WHERE id = ? AND couple_id = ?")
      .run(id, coupleId);
  })();
  return result.changes > 0;
}

/** Used by couple purge — drops every DIY supplier for a couple. Linked
 *  budget lines are also dropped (they ON DELETE CASCADE via couple_id,
 *  but we walk the table here to be defensive and to keep audit visibility). */
export function purgeByCoupleId(coupleId: number): number {
  const r = db.prepare("DELETE FROM couple_suppliers WHERE couple_id = ?").run(coupleId);
  return r.changes;
}
