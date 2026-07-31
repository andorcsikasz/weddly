// "The names on this workspace are not names." Everything about that verdict
// for couples who are ALREADY inside the app: the ones the gate in
// `parsePartnerName` came too late for.
//
// The shape mirrors billing entitlement deliberately (see `toCoupleBilling`):
// one stored timestamp, everything else COMPUTED at read time. `name_flagged_at`
// records when we first noticed and is the anchor the 3-day deadline counts
// from; whether the couple is in breach right now is re-derived from the live
// names on every single read. So the notice and the lock vanish the moment
// someone types a real name, and no sweep has to run for them to get their
// workspace back.

import { checkPartnerNames, NAME_REVIEW_GRACE_MS, type NameReview } from "@shared/real_names";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { EDIT_PREFIXES, MUTATING_METHODS, onAnyPrefix } from "./billing";
import { getCoupleForUser } from "./couples";

interface NameReviewRow {
  bride_name: string;
  groom_name: string;
  name_flagged_at: number | null;
  is_demo?: number;
}

/**
 * The couple-facing state, or `null` when there is nothing to say.
 *
 * `null` in two distinct cases, and the difference matters:
 *  - never flagged (`name_flagged_at` is NULL): the overwhelming majority;
 *  - flagged once, but the names pass NOW. The couple fixed them. We do not
 *    keep nagging, and `clearNameFlagIfFixed` retires the stamp on the next
 *    write so even the anchor goes away.
 */
export function computeNameReview(row: NameReviewRow): NameReview | null {
  if (row.name_flagged_at == null) return null;
  // A demo workspace is seeded by us, with fairy-tale names on purpose.
  if (row.is_demo) return null;

  const fields = checkPartnerNames({
    bride_name: row.bride_name,
    groom_name: row.groom_name,
  });
  if (fields.length === 0) return null;

  const deadline = row.name_flagged_at + NAME_REVIEW_GRACE_MS;
  return {
    fields,
    flagged_at: row.name_flagged_at,
    deadline,
    locked: now() >= deadline,
  };
}

/** Convenience for the request pipeline, which has an id and no row. */
export function nameReviewForCouple(coupleId: number): NameReview | null {
  const row = db
    .prepare("SELECT bride_name, groom_name, name_flagged_at, is_demo FROM couples WHERE id = ?")
    .get(coupleId) as NameReviewRow | undefined;
  if (!row) return null;
  return computeNameReview(row);
}

/** Drop the stamp once the names pass. Called after any write that touches
 *  them, so a couple who corrects their names leaves the cohort for good
 *  rather than staying one bad edit away from an instant lock. */
export function clearNameFlagIfFixed(coupleId: number): void {
  const row = db
    .prepare("SELECT bride_name, groom_name, name_flagged_at FROM couples WHERE id = ?")
    .get(coupleId) as NameReviewRow | undefined;
  if (!row || row.name_flagged_at == null) return;
  if (checkPartnerNames(row).length > 0) return;
  db.prepare(
    "UPDATE couples SET name_flagged_at = NULL, name_notice_sent_at = NULL WHERE id = ?",
  ).run(coupleId);
}

/**
 * The one door a locked workspace keeps open: the PATCH that carries the fix.
 *
 * EXACT path, not a prefix: `/api/couples/current/archive` and the cover
 * uploads stay locked. `handleUpdateCurrentCouple` is a single endpoint that
 * accepts many field clusters, so a locked couple can technically also change
 * their wedding date through this hole. That is the deliberate trade: a lock
 * with no self-serve way out is a support ticket, and the alternative (a second
 * names-only endpoint) would leave the real one gated behind a rule the
 * frontend would have to duplicate.
 */
const NAME_FIX_PATH = "/api/couples/current";

/**
 * Read-only gate for a workspace whose 3-day correction window has passed.
 * Same shape and the same edit surfaces as `entitlementBlock`, and it runs
 * beside it in the request pipeline.
 *
 * Returns the review when the request must be refused, `null` otherwise.
 */
export function nameReviewBlock(
  method: string,
  pathname: string,
  userId: number | null,
): NameReview | null {
  if (!userId || !MUTATING_METHODS.has(method)) return null;
  if (pathname === NAME_FIX_PATH) return null;
  if (!onAnyPrefix(pathname, EDIT_PREFIXES)) return null;

  const couple = getCoupleForUser(userId);
  if (!couple) return null; // no workspace yet → the onboarding gate covers it

  const review = computeNameReview(couple);
  if (!review || !review.locked) return null;
  return review;
}

/**
 * Stamp every workspace whose partner names are placeholders, and un-stamp
 * every one that has since been fixed. Runs at boot and is idempotent: an
 * already-flagged couple keeps its ORIGINAL timestamp, because re-stamping
 * would silently restart the three days on every deploy and the deadline in
 * the email we already sent them would be a lie.
 *
 * Deliberately skipped:
 *  - demo workspaces (we seeded Shrek & Fiona ourselves);
 *  - `status='deleting'`: purge blanks the names to '', and a workspace on
 *    its way out does not need a notice;
 *  - couples whose names are BOTH empty, which is the legacy display_name-only
 *    shape that `init_households` backfills from `display_name`. Empty is a
 *    missing migration, not a person hiding.
 */
export function backfillNameReview(): { flagged: number; cleared: number } {
  const rows = db
    .prepare(
      `SELECT id, bride_name, groom_name, name_flagged_at
         FROM couples
        WHERE is_demo = 0 AND status != 'deleting'`,
    )
    .all() as Array<NameReviewRow & { id: number }>;

  const ts = now();
  let flagged = 0;
  let cleared = 0;

  const flagStmt = db.prepare("UPDATE couples SET name_flagged_at = ? WHERE id = ?");
  const clearStmt = db.prepare(
    "UPDATE couples SET name_flagged_at = NULL, name_notice_sent_at = NULL WHERE id = ?",
  );

  db.transaction(() => {
    for (const row of rows) {
      const empty = row.bride_name.trim() === "" && row.groom_name.trim() === "";
      const bad = !empty && checkPartnerNames(row).length > 0;
      if (bad && row.name_flagged_at == null) {
        flagStmt.run(ts, row.id);
        flagged++;
      } else if (!bad && row.name_flagged_at != null) {
        clearStmt.run(row.id);
        cleared++;
      }
    }
  })();

  if (flagged || cleared) {
    log.info("name_review.backfill", { flagged, cleared });
  }
  return { flagged, cleared };
}
