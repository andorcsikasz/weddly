// Empty-household cleanup. Whenever a guest is moved off a household (guest
// editor modal, drag&drop, "+1" adoption, partner-guest sync, CSV/bulk import),
// the household it left can end up with zero members. A member-less household is
// an orphan: a household exists only to hold guests, so an empty one should not
// linger in the guest list, the household picker dropdowns, or the check-in
// credential space (it keeps a UNIQUE code). This module is the single place
// that "delete the household if the move emptied it" decision lives; every
// guest-move path calls purgeHouseholdIfEmpty so the rule never drifts or gets
// duplicated.
//
// Decision (2026-07): an emptied household is ALWAYS deleted, even when an
// invite was already sent to it. The per-household households.invited_at goes
// away with the row, but every moved guest carries its own guests.invited_at,
// so no invite history is lost from the guest's side.
//
// FK-safe under PRAGMA foreign_keys = ON: an empty household has no guests row
// to block the delete (that FK is NO ACTION), and the remaining child
// references self-clean on delete (wishlist_interests CASCADE, received_gifts +
// growth_events SET NULL). Callers wrap this together with the move UPDATE in a
// single db.transaction so the move and the cleanup commit atomically.

import { db } from "../db";

const countMembers = db.prepare("SELECT COUNT(*) AS n FROM guests WHERE household_id = ?");
const deleteHousehold = db.prepare("DELETE FROM households WHERE id = ? AND couple_id = ?");

/** Delete `householdId` when no guest still belongs to it. Scoped to the couple
 *  so a stale or foreign id can never reach another workspace's row. A null id
 *  (guest was ungrouped) is a no-op. Returns true when a household was removed.
 *
 *  Call this AFTER the move UPDATE has committed the guest to its new household,
 *  inside the same db.transaction, passing the guest's PREVIOUS household id. */
export function purgeHouseholdIfEmpty(coupleId: number, householdId: number | null): boolean {
  if (householdId == null) return false;
  const row = countMembers.get(householdId) as { n: number };
  if (row.n > 0) return false;
  const res = deleteHousehold.run(householdId, coupleId);
  return res.changes > 0;
}

export interface EmptyHouseholdRow {
  id: number;
  couple_id: number;
  label: string;
  code: string;
  created_at: string;
}

/** Every household with no member guests, across all couples. Used by the
 *  one-time cleanup script to report orphans before deleting them. Note that a
 *  freshly created-but-not-yet-populated household is also member-less, so the
 *  script surfaces this list for operator review rather than deleting blindly. */
export function listEmptyHouseholds(): EmptyHouseholdRow[] {
  return db
    .prepare(
      `SELECT h.id, h.couple_id, h.label, h.code, h.created_at
         FROM households h
        WHERE NOT EXISTS (SELECT 1 FROM guests g WHERE g.household_id = h.id)
        ORDER BY h.couple_id, h.created_at`,
    )
    .all() as EmptyHouseholdRow[];
}

/** Hard-delete the given household ids in one transaction. FK-safe (see the
 *  module note). Returns how many rows were removed. */
export function purgeEmptyHouseholds(ids: number[]): number {
  const del = db.prepare("DELETE FROM households WHERE id = ?");
  let removed = 0;
  const tx = db.transaction((batch: number[]) => {
    for (const id of batch) removed += del.run(id).changes;
  });
  tx(ids);
  return removed;
}
