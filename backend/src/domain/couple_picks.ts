// Per-category supplier picks — see backend/src/schema.sql `couple_picks`.
// One row per (couple, category); `upsertPick` replaces on UNIQUE collision so
// the workspace always reflects the latest decision both partners can see.

import { type CouplePick, isSentinelPick } from "@shared/picks";
import { db, now } from "../db";
import { syncListingBudgetLine } from "./listing_budget_mirror";
import { resolveSupplierBase } from "./resolve_supplier";

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

/** The picks, each carrying the picked listing's published phone.
 *
 *  Resolved here rather than looked up on the catalogue because `/api/suppliers`
 *  no longer carries contact values (one response was every vendor's number).
 *  The couple's own picks are a handful of listings they explicitly chose, so
 *  answering for exactly those is the narrowest thing that keeps the dashboard's
 *  vendor-dialling row working without a fetch per card.
 *
 *  `resolveSupplierBase` is what accepts every id shape a pick can hold (curated
 *  slug, `c{N}`, `v{N}`, pretty form); anything it can't resolve — a sentinel
 *  pick, a DIY hex, a listing since removed — simply has no phone. */
/** A row's DTO plus the contact phone of the listing it points at. Shared by
 *  the primary picks and the extras, so both answer the same way. */
function withPhone(row: Row): CouplePick {
  const dto = toDto(row);
  const base = isSentinelPick(row.supplier_id) ? null : resolveSupplierBase(row.supplier_id);
  return { ...dto, contact_phone: base?.contact_phone ?? null };
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
  return rows.map(withPhone);
}

/** Extra suppliers the couple added beside a primary pick, oldest first so the
 *  list reads in the order they were chosen. */
export function listExtrasForCouple(coupleId: number): CouplePick[] {
  const rows = db
    .prepare(
      `SELECT category, supplier_id, picked_by_user_id, picked_at
         FROM couple_pick_extras
        WHERE couple_id = ?
        ORDER BY category ASC, picked_at ASC, id ASC`,
    )
    .all(coupleId) as Row[];
  return rows.map(withPhone);
}

export function getExtra(
  coupleId: number,
  category: string,
  supplierId: string,
): CouplePick | null {
  const row = db
    .prepare(
      `SELECT category, supplier_id, picked_by_user_id, picked_at
         FROM couple_pick_extras
        WHERE couple_id = ? AND category = ? AND supplier_id = ?`,
    )
    .get(coupleId, category, supplierId) as Row | undefined;
  return row ? toDto(row) : null;
}

/** Add a supplier as another pick in a category that already has a primary.
 *  The caller has checked there IS a primary and that this id is not it; this
 *  only stores the row and mirrors its budget line, so a second photographer
 *  costs what the first one does. Re-adding the same supplier is a no-op. */
export function addExtra(
  coupleId: number,
  category: string,
  supplierId: string,
  userId: number,
): CouplePick {
  const ts = now();
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO couple_pick_extras
         (couple_id, category, supplier_id, picked_by_user_id, picked_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(coupleId, category, supplierId, userId, ts);
    syncListingBudgetLine(coupleId, supplierId);
  })();
  const fresh = getExtra(coupleId, category, supplierId);
  if (!fresh) throw new Error("couple_pick_extras row vanished after insert");
  return fresh;
}

/** Withdraw an extra. Returns true when something was removed. */
export function removeExtra(coupleId: number, category: string, supplierId: string): boolean {
  return db.transaction(() => {
    const r = db
      .prepare(
        "DELETE FROM couple_pick_extras WHERE couple_id = ? AND category = ? AND supplier_id = ?",
      )
      .run(coupleId, category, supplierId);
    if (r.changes > 0) syncListingBudgetLine(coupleId, supplierId);
    return r.changes > 0;
  })();
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
 *  any) for audit `before` payloads before calling this.
 *
 *  The pick is also the COMMITMENT GATE on the budget: a priced directory
 *  supplier earns a `budget_lines` row only while it is picked. So the replace
 *  the UNIQUE constraint performs is two budget edits, not one: the supplier
 *  being dropped loses its line in the same breath as the new one gains it,
 *  which is the edge that would otherwise leave the couple paying for both. */
export function upsertPick(
  coupleId: number,
  category: string,
  supplierId: string,
  userId: number,
): CouplePick {
  const ts = now();
  const previous = getPick(coupleId, category);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO couple_picks (couple_id, category, supplier_id, picked_by_user_id, picked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(couple_id, category) DO UPDATE SET
         supplier_id = excluded.supplier_id,
         picked_by_user_id = excluded.picked_by_user_id,
         picked_at = excluded.picked_at`,
    ).run(coupleId, category, supplierId, userId, ts);
    // The new primary may already sit in this category as an extra. It is the
    // primary now, so keep it in exactly one place.
    db.prepare(
      "DELETE FROM couple_pick_extras WHERE couple_id = ? AND category = ? AND supplier_id = ?",
    ).run(coupleId, category, supplierId);
    if (previous && previous.supplier_id !== supplierId) {
      syncListingBudgetLine(coupleId, previous.supplier_id);
    }
    syncListingBudgetLine(coupleId, supplierId);
  })();
  const fresh = getPick(coupleId, category);
  if (!fresh) throw new Error("couple_picks row vanished after upsert");
  return fresh;
}

/** Returns true if a row was deleted (i.e. there was something to clear).
 *  Un-picking withdraws the commitment, so the mirrored budget line goes with
 *  it; the cost row itself survives as the price note it always was. */
export function removePick(coupleId: number, category: string): boolean {
  const previous = getPick(coupleId, category);
  const changes = db.transaction(() => {
    const r = db
      .prepare("DELETE FROM couple_picks WHERE couple_id = ? AND category = ?")
      .run(coupleId, category);
    if (previous) syncListingBudgetLine(coupleId, previous.supplier_id);
    // An extra with no primary beside it is not a pick the couple can make
    // sense of, so the most recent extra steps up into the primary's place.
    if (r.changes > 0) {
      const next = db
        .prepare(
          `SELECT id, supplier_id, picked_by_user_id, picked_at FROM couple_pick_extras
            WHERE couple_id = ? AND category = ?
            ORDER BY picked_at DESC, id DESC LIMIT 1`,
        )
        .get(coupleId, category) as
        | { id: number; supplier_id: string; picked_by_user_id: number | null; picked_at: number }
        | undefined;
      if (next) {
        db.prepare("DELETE FROM couple_pick_extras WHERE id = ?").run(next.id);
        db.prepare(
          `INSERT INTO couple_picks (couple_id, category, supplier_id, picked_by_user_id, picked_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(coupleId, category, next.supplier_id, next.picked_by_user_id, next.picked_at);
      }
    }
    return r.changes;
  })();
  return changes > 0;
}
