// Couple shortlist persistence — see backend/src/schema.sql `saved_suppliers`.
// Many rows per couple (one per saved supplier); `addSaved` is idempotent via
// the UNIQUE(couple_id, supplier_id) constraint so a double-save is a no-op
// rather than an error. Couple-scoped so both partners share the shortlist.

import type { SavedSupplier } from "@shared/saved";
import { db, now } from "../db";

interface Row {
  supplier_id: string;
  saved_by_user_id: number | null;
  saved_at: number;
}

function toDto(row: Row): SavedSupplier {
  return {
    supplier_id: row.supplier_id,
    saved_by_user_id: row.saved_by_user_id,
    saved_at: row.saved_at,
  };
}

export function listSavedForCouple(coupleId: number): SavedSupplier[] {
  const rows = db
    .prepare(
      `SELECT supplier_id, saved_by_user_id, saved_at
         FROM saved_suppliers
        WHERE couple_id = ?
        ORDER BY saved_at DESC`,
    )
    .all(coupleId) as Row[];
  return rows.map(toDto);
}

/** Idempotent insert. Returns true when a new row was added, false when the
 *  supplier was already on the shortlist (UNIQUE collision ignored). */
export function addSaved(coupleId: number, supplierId: string, userId: number): boolean {
  const r = db
    .prepare(
      `INSERT INTO saved_suppliers (couple_id, supplier_id, saved_by_user_id, saved_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(couple_id, supplier_id) DO NOTHING`,
    )
    .run(coupleId, supplierId, userId, now());
  return r.changes > 0;
}

/** Returns true if a row was removed (i.e. the supplier was on the shortlist). */
export function removeSaved(coupleId: number, supplierId: string): boolean {
  const r = db
    .prepare("DELETE FROM saved_suppliers WHERE couple_id = ? AND supplier_id = ?")
    .run(coupleId, supplierId);
  return r.changes > 0;
}
