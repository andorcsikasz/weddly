// Per-user up/down votes on directory suppliers. One row per (user, supplier).
// Score aggregation is on-demand via SQL — no materialized view.

import { db, now } from "../db";

export type VoteValue = -1 | 0 | 1;

export interface SupplierVoteRow {
  id: number;
  user_id: number;
  supplier_id: string;
  value: number;
  created_at: number;
  updated_at: number;
}

/** Returns the user's vote on a given supplier, or 0 if not voted. */
export function getUserVote(userId: number, supplierId: string): VoteValue {
  const row = db
    .prepare("SELECT value FROM supplier_votes WHERE user_id = ? AND supplier_id = ?")
    .get(userId, supplierId) as { value: number } | undefined;
  if (!row) return 0;
  return row.value === 1 ? 1 : row.value === -1 ? -1 : 0;
}

/** Map of supplier_id → user's vote (-1, 0, 1). Missing keys = 0. */
export function getUserVotesMap(userId: number): Map<string, VoteValue> {
  const rows = db
    .prepare("SELECT supplier_id, value FROM supplier_votes WHERE user_id = ?")
    .all(userId) as { supplier_id: string; value: number }[];
  const out = new Map<string, VoteValue>();
  for (const r of rows) {
    out.set(r.supplier_id, r.value === 1 ? 1 : r.value === -1 ? -1 : 0);
  }
  return out;
}

/** Map of supplier_id → net score. Missing keys = 0. */
export function getScoresMap(): Map<string, number> {
  const rows = db
    .prepare(
      "SELECT supplier_id, COALESCE(SUM(value), 0) AS score FROM supplier_votes GROUP BY supplier_id",
    )
    .all() as { supplier_id: string; score: number }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.supplier_id, r.score);
  return out;
}

/** Upsert a +1 / -1 vote, or DELETE the row when value is 0. */
export function setVote(userId: number, supplierId: string, value: VoteValue): void {
  if (value === 0) {
    db.prepare("DELETE FROM supplier_votes WHERE user_id = ? AND supplier_id = ?").run(
      userId,
      supplierId,
    );
    return;
  }
  const ts = now();
  db.prepare(
    `INSERT INTO supplier_votes (user_id, supplier_id, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, supplier_id) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(userId, supplierId, value, ts, ts);
}
