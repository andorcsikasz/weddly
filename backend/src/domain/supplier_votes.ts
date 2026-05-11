// Per-couple up/down votes on directory suppliers. One row per
// (couple, supplier_id) — see schema.sql for why we moved off per-user
// keying. `user_id` is still stamped on each row for audit ("which partner
// cast the vote") but is no longer part of the unique key. Score aggregation
// is on-demand via SQL — no materialized view.

import { db, now } from "../db";

export type VoteValue = -1 | 0 | 1;

export interface SupplierVoteRow {
  id: number;
  user_id: number;
  couple_id: number | null;
  supplier_id: string;
  value: number;
  created_at: number;
  updated_at: number;
}

/** Returns the couple's vote on a given supplier, or 0 if not voted. */
export function getCoupleVote(coupleId: number, supplierId: string): VoteValue {
  const row = db
    .prepare("SELECT value FROM supplier_votes WHERE couple_id = ? AND supplier_id = ?")
    .get(coupleId, supplierId) as { value: number } | undefined;
  if (!row) return 0;
  return row.value === 1 ? 1 : row.value === -1 ? -1 : 0;
}

/** Map of supplier_id → couple's vote (-1, 0, 1). Missing keys = 0. */
export function getCoupleVotesMap(coupleId: number): Map<string, VoteValue> {
  const rows = db
    .prepare("SELECT supplier_id, value FROM supplier_votes WHERE couple_id = ?")
    .all(coupleId) as { supplier_id: string; value: number }[];
  const out = new Map<string, VoteValue>();
  for (const r of rows) {
    out.set(r.supplier_id, r.value === 1 ? 1 : r.value === -1 ? -1 : 0);
  }
  return out;
}

/** Map of supplier_id → net score. Counts couple-scoped rows only — orphan
 *  rows (couple_id IS NULL, voter no longer in a couple) are ignored so the
 *  public score reflects only currently-valid couples. */
export function getScoresMap(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT supplier_id, COALESCE(SUM(value), 0) AS score
         FROM supplier_votes
        WHERE couple_id IS NOT NULL
        GROUP BY supplier_id`,
    )
    .all() as { supplier_id: string; score: number }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.supplier_id, r.score);
  return out;
}

/** Upsert a +1 / -1 vote for the couple, or DELETE the row when value is 0.
 *  `userId` is recorded for audit but doesn't participate in the unique key.
 *  Each couple has at most one vote per supplier regardless of which partner
 *  cast it; calling again from the other partner overwrites in-place. */
export function setVote(
  coupleId: number,
  userId: number,
  supplierId: string,
  value: VoteValue,
): void {
  if (value === 0) {
    db.prepare("DELETE FROM supplier_votes WHERE couple_id = ? AND supplier_id = ?").run(
      coupleId,
      supplierId,
    );
    return;
  }
  const ts = now();
  // Upsert keyed on (couple_id, supplier_id) — the partial unique index in
  // schema.sql enforces single-row-per-couple. The legacy UNIQUE(user_id,
  // supplier_id) constraint stays for back-compat; both partners voting will
  // hit it harmlessly because we DELETE-then-INSERT below.
  db.prepare("DELETE FROM supplier_votes WHERE couple_id = ? AND supplier_id = ?").run(
    coupleId,
    supplierId,
  );
  db.prepare(
    `INSERT INTO supplier_votes (user_id, couple_id, supplier_id, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, coupleId, supplierId, value, ts, ts);
}
