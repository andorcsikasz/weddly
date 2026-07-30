// Planner reviews — the rules that differ from a supplier's. Everything else
// (persistence, the aggregate recompute, tags, the histogram, moderation, edit
// and soft-delete) is the supplier review stack unchanged, reached through the
// `planner:{id}` subject in shared/planner_reviews.ts.
//
// Two things are genuinely planner-specific and live here:
//
//   • WHO the subject is. A supplier id is deliberately not existence-checked
//     (a curated slug lives in code, not in `listings`), but a planner id is a
//     `users` row, so an unknown one must 404 rather than quietly seed an
//     aggregate for a planner nobody can open.
//   • WHAT counts as having worked together. For a supplier that is a cost-plan
//     line or a category pick; for a planner it is the consent handshake
//     itself — an accepted `planner_clients` link. That is a stronger proof
//     than either supplier signal: both sides agreed to it in the product.

import { plannerReviewSubjectId } from "@shared/planner_reviews";
import { db } from "../db";
import { getReviewSummary } from "./reviews";

/** The planner account behind a directory id, or null. Only an active planner
 *  user qualifies: a suspended or deleted account should not accept new
 *  reviews, and neither should a couple/vendor id that happens to be numeric. */
export function plannerAccountExists(plannerUserId: number): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM users
          WHERE id = ? AND user_type = 'planner' AND status = 'active'
       ) AS ok`,
    )
    .get(plannerUserId) as { ok: number };
  return row.ok === 1;
}

/** Engagement proof: this couple and this planner are linked, which in the
 *  planner flow means BOTH sides consented (the invite was accepted). Drives
 *  the "verified" flag and, with it, the no-auto-flag path for a low rating.
 *
 *  Reads the CURRENT link, so a couple who revoked their planner drops back to
 *  an unverified review that a 1-2 star sends to the admin queue. That is the
 *  intended reading rather than an oversight: a relationship that ended in a
 *  revoke is exactly the one worth a human glance before it sits on a named
 *  individual's profile. It never blocks the review itself. */
export function plannerHasClientLink(plannerUserId: number, coupleId: number): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM planner_clients
          WHERE planner_user_id = ? AND couple_id = ? AND status = 'active'
       ) AS ok`,
    )
    .get(plannerUserId, coupleId) as { ok: number };
  return row.ok === 1;
}

/** The planner's published-review aggregate, for the directory card + detail. */
export function plannerReviewSummary(plannerUserId: number) {
  return getReviewSummary(plannerReviewSubjectId(plannerUserId));
}
