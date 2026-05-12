// Per-category supplier picks — see backend/src/schema.sql `couple_picks`.
// One row per (couple, category); `upsertPick` replaces on UNIQUE collision so
// the workspace always reflects the latest decision both partners can see.

import type { CouplePick } from "@shared/picks";
import { db, now } from "../db";

interface Row {
  category: string;
  supplier_id: string;
  picked_by_user_id: number | null;
  picked_at: number;
}

function toDto(row: Row): CouplePick {
  return {
    category: row.category,
    supplier_id: row.supplier_id,
    picked_by_user_id: row.picked_by_user_id,
    picked_at: row.picked_at,
  };
}

export function listPicksForCouple(coupleId: number): CouplePick[] {
  const rows = db
    .prepare(
      `SELECT category, supplier_id, picked_by_user_id, picked_at
         FROM couple_picks
        WHERE couple_id = ?
        ORDER BY category ASC`,
    )
    .all(coupleId) as Row[];
  return rows.map(toDto);
}

export function getPick(coupleId: number, category: string): CouplePick | null {
  const row = db
    .prepare(
      `SELECT category, supplier_id, picked_by_user_id, picked_at
         FROM couple_picks
        WHERE couple_id = ? AND category = ?`,
    )
    .get(coupleId, category) as Row | undefined;
  return row ? toDto(row) : null;
}

/** Insert-or-replace a pick. Uses the UNIQUE(couple_id, category) constraint
 *  to keep exactly one row per category — caller looks up the prior pick (if
 *  any) for audit `before` payloads before calling this. */
export function upsertPick(
  coupleId: number,
  category: string,
  supplierId: string,
  userId: number,
): CouplePick {
  const ts = now();
  db.prepare(
    `INSERT INTO couple_picks (couple_id, category, supplier_id, picked_by_user_id, picked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(couple_id, category) DO UPDATE SET
       supplier_id = excluded.supplier_id,
       picked_by_user_id = excluded.picked_by_user_id,
       picked_at = excluded.picked_at`,
  ).run(coupleId, category, supplierId, userId, ts);
  const fresh = getPick(coupleId, category);
  if (!fresh) throw new Error("couple_picks row vanished after upsert");
  return fresh;
}

/** Returns true if a row was deleted (i.e. there was something to clear). */
export function removePick(coupleId: number, category: string): boolean {
  const r = db
    .prepare("DELETE FROM couple_picks WHERE couple_id = ? AND category = ?")
    .run(coupleId, category);
  return r.changes > 0;
}
