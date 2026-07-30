// How a planner is addressed by the review stack.
//
// Reviews are the one part of the supplier machinery a planner can share
// outright: `supplier_reviews.supplier_id` is bare TEXT with no FK (curated
// suppliers live in code, not in `listings`), so the aggregate, the tag table,
// the 1-5 histogram, the admin flagged queue, edit and soft-delete all key on
// that string and never ask what it points at. A planner therefore needs an id
// in that namespace rather than a parallel `planner_reviews` table — which is
// the opposite of how planner portfolios, packages and blocked dates went,
// because those mirror tables that key on a listing FK and had nowhere to put a
// planner. Reviews have no FK, so there is nothing to mirror.
//
// The prefix uses a COLON on purpose. A curated supplier id is a slug
// (`[a-z0-9-]+`) or `c{N}`, and neither can contain one, so a planner subject
// cannot collide with a supplier id no matter what slug anyone adds later. A
// hyphen would only have been unlikely.

export const PLANNER_REVIEW_PREFIX = "planner:";

/** The `supplier_reviews.supplier_id` value for a planner account. */
export function plannerReviewSubjectId(plannerUserId: number): string {
  return `${PLANNER_REVIEW_PREFIX}${plannerUserId}`;
}

/** The planner behind a review subject, or null when the id is a supplier's.
 *  Anything that reads review rows generically (the admin queue, an export)
 *  uses this to tell the two kinds of subject apart. */
export function plannerUserIdFromSubject(subjectId: string): number | null {
  if (!subjectId.startsWith(PLANNER_REVIEW_PREFIX)) return null;
  const n = Number(subjectId.slice(PLANNER_REVIEW_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}
