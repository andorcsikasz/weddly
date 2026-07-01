// Admin moderation overrides for curated suppliers. Curated entries live in
// code (suppliers_data.ts) with no DB row, so hiding or deleting one is
// recorded here as a tombstone keyed by the curated slug. 'hidden' hides the
// entry from the public directory but keeps it in the admin catalog (with a
// restore path); 'deleted' removes it from both. Overrides survive deploys so
// a re-shipped code entry stays suppressed until an admin restores it.

import { db, now } from "../db";

export type CuratedOverrideStatus = "hidden" | "deleted";

interface CuratedOverrideRow {
  supplier_id: string;
  status: string;
  hide_reason: string | null;
  hidden_at: number | null;
}

/** Map of curated slug → override for every suppressed curated entry. One scan;
 *  the curated set is a few hundred rows at most. */
export function curatedOverrideMap(): Map<
  string,
  { status: CuratedOverrideStatus; hide_reason: string | null; hidden_at: number | null }
> {
  const rows = db
    .prepare("SELECT supplier_id, status, hide_reason, hidden_at FROM curated_supplier_overrides")
    .all() as CuratedOverrideRow[];
  const out = new Map<
    string,
    { status: CuratedOverrideStatus; hide_reason: string | null; hidden_at: number | null }
  >();
  for (const r of rows) {
    const status: CuratedOverrideStatus = r.status === "deleted" ? "deleted" : "hidden";
    out.set(r.supplier_id, { status, hide_reason: r.hide_reason, hidden_at: r.hidden_at });
  }
  return out;
}

/** True when a curated slug is safe to show on the PUBLIC directory (no hidden
 *  or deleted override). Single-row lookup for the detail/redirect/vote paths. */
export function isCuratedPubliclyVisible(slug: string): boolean {
  const row = db
    .prepare("SELECT status FROM curated_supplier_overrides WHERE supplier_id = ?")
    .get(slug) as { status: string } | undefined;
  return !row;
}

/** Upsert a hide/delete override for a curated slug. */
export function setCuratedOverride(
  slug: string,
  status: CuratedOverrideStatus,
  adminUserId: number,
  reason: string | null,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO curated_supplier_overrides
       (supplier_id, status, hide_reason, hidden_by_user_id, hidden_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(supplier_id) DO UPDATE SET
       status = excluded.status,
       hide_reason = excluded.hide_reason,
       hidden_by_user_id = excluded.hidden_by_user_id,
       hidden_at = excluded.hidden_at,
       updated_at = excluded.updated_at`,
  ).run(slug, status, reason, adminUserId, ts, ts, ts);
}

/** Drop the override for a curated slug (restore to its code-defined active
 *  state). Returns the number of rows removed. */
export function clearCuratedOverride(slug: string): number {
  return db.prepare("DELETE FROM curated_supplier_overrides WHERE supplier_id = ?").run(slug)
    .changes;
}
