// A directory supplier's price on /app/budget.
//
// `couple_supplier_costs` is the couple's per-supplier money note against the
// DIRECTORY (curated slug, `c{N}` community id, `v{N}` vendor listing). It used
// to be a fully parallel money store: written from the supplier card, read by
// /app/suppliers and the compare dialog, and mirrored NOWHERE, so every vendor a
// couple booked out of the directory was silently missing from their budget
// while the hand-typed "Csinálom magam" rows were all there.
//
// This module is the mirror, and the rule it enforces is the reason it isn't a
// one-liner inside the cost upsert:
//
//   - **A cost row alone is a price note on a CANDIDATE.** A couple comparing
//     three venues in `SupplierCompareDialog` has a cost row for each of them;
//     mirroring all three would treble the venue budget. So the gate is
//     `couple_picks`, one row per (couple, category), the workspace's own
//     "this is our pick". Picked means committed, and only a committed supplier
//     spends money.
//   - **The category is the PICK's category**, mapped through
//     `SUPPLIER_TO_BUDGET`, not something re-derived from the listing. The pick
//     is what the couple actually decided this vendor is for.
//   - **The label is the listing's name**, resolved the same way
//     `vendorDisplayName` resolves it, falling back to the bare id so a listing
//     that has since been removed still shows the couple a row rather than a
//     blank.
//   - **A supplier the couple ALREADY owns privately is skipped.** A bound
//     `couple_suppliers` row (adopted or published, see `bindListing`) mirrors
//     its own price into `couple_supplier_costs` so the money shows on the
//     listing page too, and that private row already owns a `couple_supplier_id`
//     budget line. Mirroring here as well would put one booked vendor in the
//     budget twice. Same guard covers a pick that points at a DIY row's own hex
//     id, for the same reason.
//
// Everything is DERIVED: the line is recomputed from (pick, cost, private row)
// on every edge that can change any of the three, so there is no state to drift.
// `syncListingBudgetLine` is the single entry point and is idempotent: callers
// hand it a supplier id and it decides whether that supplier deserves a line,
// creates / updates / deletes accordingly, and does nothing at all when the
// answer hasn't changed.

import { isSentinelPick } from "@shared/picks";
import { SUPPLIER_TO_BUDGET } from "@shared/suppliers";
import { db, now } from "../db";

/** The couple's pick category for this supplier, or null when they haven't
 *  committed to it. A supplier picked in two categories at once is legal
 *  (UNIQUE is on the category, not the supplier) and yields ONE line, under the
 *  most recent decision. */
function pickedCategory(coupleId: number, supplierId: string): string | null {
  const row = db
    .prepare(
      `SELECT category FROM couple_picks
        WHERE couple_id = ? AND supplier_id = ?
        ORDER BY picked_at DESC, category ASC
        LIMIT 1`,
    )
    .get(coupleId, supplierId) as { category: string } | undefined;
  return row?.category ?? null;
}

/** Supplier category → budget bucket. An unknown slug (a taxonomy the admin
 *  added after this map was written) folds into "other" rather than dropping
 *  the money out of the budget entirely. */
function budgetCategoryFor(supplierCategory: string): string {
  const table = SUPPLIER_TO_BUDGET as Record<string, string | undefined>;
  return table[supplierCategory] ?? "other";
}

/** True when a private `couple_suppliers` row already stands for this supplier,
 *  and therefore already owns a mirrored budget line of its own. Matches on
 *  BOTH the bound listing id and the row's own id, because a pick can hold
 *  either. */
function ownedByPrivateRow(coupleId: number, supplierId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM couple_suppliers
        WHERE couple_id = ? AND (listing_id = ? OR id = ?)
        LIMIT 1`,
    )
    .get(coupleId, supplierId, supplierId) as { hit: number } | null;
  return Boolean(row);
}

/** The listing's display name, falling back to the id, the same resolution and
 *  same fallback as `vendorDisplayName` in routes/booking_messages.ts. */
function listingLabel(supplierId: string): string {
  const row = db.prepare("SELECT name FROM listings WHERE id = ?").get(supplierId) as
    | { name: string }
    | undefined;
  return row?.name ?? supplierId;
}

interface CostRow {
  planned_huf: number;
  actual_huf: number;
}

function costFor(coupleId: number, supplierId: string): CostRow | null {
  return (
    (db
      .prepare(
        "SELECT planned_huf, actual_huf FROM couple_supplier_costs WHERE couple_id = ? AND supplier_id = ?",
      )
      .get(coupleId, supplierId) as CostRow | undefined) ?? null
  );
}

/** Recompute the budget line a directory supplier is entitled to.
 *
 *  Call this from EVERY edge that can change "is this priced supplier our
 *  pick": the cost upsert / delete, the pick upsert / remove (both the supplier
 *  gained AND the one it replaced), and the binding paths that move a pick onto
 *  a listing or delete the private row behind it. Safe to call for an id that
 *  has no cost, no pick and no line: it is a no-op then.
 *
 *  Caller is expected to already be inside a transaction, so the source row and
 *  its mirror commit together (bun:sqlite nests via SAVEPOINT, so wrapping this
 *  again would also be safe). */
export function syncListingBudgetLine(coupleId: number, supplierId: string): void {
  const existing = db
    .prepare(
      "SELECT id FROM budget_lines WHERE couple_id = ? AND listing_id = ? ORDER BY id ASC LIMIT 1",
    )
    .get(coupleId, supplierId) as { id: number } | undefined;

  const category = isSentinelPick(supplierId) ? null : pickedCategory(coupleId, supplierId);
  const cost =
    category && !ownedByPrivateRow(coupleId, supplierId) ? costFor(coupleId, supplierId) : null;
  const planned = cost?.planned_huf ?? 0;
  const actual = cost?.actual_huf ?? 0;

  // No commitment, or no money on it: there is nothing for the budget to say.
  // Clearing both figures is also the only way the couple can take the row off
  // /app/budget, since the line itself is locked.
  if (!category || (planned <= 0 && actual <= 0)) {
    // Delete by listing_id rather than by the id read above, so a duplicate
    // written by an older build can never survive as an unreachable locked row.
    db.prepare("DELETE FROM budget_lines WHERE couple_id = ? AND listing_id = ?").run(
      coupleId,
      supplierId,
    );
    return;
  }

  const ts = now();
  const label = listingLabel(supplierId);
  const budgetCategory = budgetCategoryFor(category);

  if (existing) {
    // `paid_huf` is re-clamped rather than rewritten: nothing can set it on a
    // locked line today, but the invariant paid ≤ actual has to survive the
    // couple lowering what the vendor ended up costing.
    db.prepare(
      `UPDATE budget_lines
          SET category = ?, label = ?, planned_huf = ?, actual_huf = ?,
              paid_huf = MIN(paid_huf, ?), updated_at = ?
        WHERE id = ? AND couple_id = ?`,
    ).run(budgetCategory, label, planned, actual, actual, ts, existing.id, coupleId);
    return;
  }

  db.prepare(
    `INSERT INTO budget_lines
       (couple_id, category, label, planned_huf, actual_huf, paid_huf, notes,
        listing_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
  ).run(coupleId, budgetCategory, label, planned, actual, supplierId, ts, ts);
}
