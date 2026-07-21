import { db, now } from "../db";

/**
 * One-time cleanup: mark every account that already exists as email-verified.
 *
 * Since the pending_signups split a couple can no longer be created without
 * verifying first (there is no `users` row until the click), so an unverified
 * couple `users` row is always a legacy straggler from before that change. This
 * flips every such account, plus any unverified vendor that already registered,
 * to `verified_email = 1`.
 *
 * Deliberately bounded and guarded:
 *  - `created_at < cutoffMs` bounds it to accounts that exist as of the fix, so
 *    a vendor who registers AFTER the cutoff still proves their address the
 *    normal way. Without this bound the backfill would auto-verify every future
 *    registration on the next boot and permanently defeat email verification.
 *  - `password_set = 0` is skipped: admin-provisioned dormant planners and OAuth
 *    placeholder hashes are unverified ON PURPOSE until activation
 *    (planner_provisioning.ts). Verifying them would break their setup flow.
 *  - `@purged.local` tombstones are skipped: a purge scrubs the address but
 *    never resets verified_email, so they would otherwise re-match forever.
 *
 * Idempotent: a verified row no longer matches `verified_email = 0`.
 *
 * @returns how many rows were flipped.
 */
export function verifyExistingUnverifiedAccounts(cutoffMs: number): number {
  return db
    .prepare(
      `UPDATE users
          SET verified_email = 1, updated_at = ?
        WHERE verified_email = 0
          AND password_set = 1
          AND email NOT LIKE '%@purged.local'
          AND created_at < ?`,
    )
    .run(now(), cutoffMs).changes;
}
