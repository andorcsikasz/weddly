// Boot-time reconciliation for orphaned couple workspaces.
//
// A couple must always have at least one resolvable owner (a couple_members
// row that joins to a live, non-purged users row). Two historical gaps could
// break that invariant and leave a workspace with NO owner, which the admin
// overview then renders as a blank name/email ("account without email"):
//   1. the additional-workspace create path (POST /api/couples) wasn't atomic,
//      so a mid-creation failure could commit the couple row without its owner
//      membership (fixed at the source: the write-set is now transactional);
//   2. a hard-deleted owner user (demo/planner reaping) left the couple behind.
//
// The couple_members backfill in db.ts re-adds memberships from partner_a_id /
// partner_b_id for any LIVE user before this runs, so by the time we look, a
// couple with no live-user member is genuinely unrecoverable (nobody can ever
// sign into it). The GDPR-correct treatment is to purge it: purgeOneCouple
// scrubs the child PII and tombstones the row as 'deleting', which the admin
// UI already hides from every live section.

import { db } from "../db";
import { log } from "../lib/logger";
import { purgeOneCouple } from "./purge";

interface OrphanRow {
  id: number;
}

/** Find non-demo, not-yet-purged couples that have no member resolvable to a
 *  live (non-@purged.local) user, and purge each. Idempotent: a purged couple
 *  is `status='deleting'` and no longer matches, so re-running is a no-op.
 *  Returns the number of workspaces reconciled. */
export function reconcileOrphanCouples(): number {
  const orphans = db
    .prepare(
      `SELECT c.id
         FROM couples c
        WHERE c.status != 'deleting'
          AND c.is_demo = 0
          AND NOT EXISTS (
                SELECT 1
                  FROM couple_members cm
                  JOIN users u ON u.id = cm.user_id
                 WHERE cm.couple_id = c.id
                   AND u.email NOT LIKE '%@purged.local'
              )`,
    )
    .all() as OrphanRow[];

  let purged = 0;
  for (const { id } of orphans) {
    try {
      // silent: there is no live owner to notify, so skip the "your data is
      // gone" mail entirely.
      purgeOneCouple(id, { silent: true });
      purged++;
    } catch (e) {
      log.error("orphan_reconcile.purge_failed", e, { couple_id: id });
    }
  }
  return purged;
}
