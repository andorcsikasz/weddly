// Pause-to-delete purge worker. After a couple's 30-day pause window expires,
// PII is removed from child tables; the couples row + audit_log are kept (with
// PII fields nulled) so we can answer "this workspace existed and was deleted on
// X" for tax/legal retention.
//
// Schema is additive-only (CLAUDE.md), so we never DROP rows the app might
// still reference; instead we DELETE child PII rows (they have ON DELETE CASCADE
// to handle FKs) and stamp the couple as 'deleting' → fields nulled.

import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { log } from "../lib/logger";
import { sendKind } from "./emails";

export function purgeOneCouple(coupleId: number): void {
  const ts = now();

  // Send the "your data is gone" notice BEFORE we scrub the user table —
  // afterwards the email column is rewritten to `deleted-…@purged.local`
  // and the addresses are unrecoverable. Fire-and-forget: failure to mail
  // must not abort the destructive sweep.
  const couple = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(coupleId) as
    | { display_name: string }
    | undefined;
  const coupleDisplayName = couple?.display_name?.trim() || "your wedding";
  const usersToNotify = (
    db
      .prepare("SELECT id, email, full_name FROM users WHERE couple_id = ?")
      .all(coupleId) as Array<{ id: number; email: string; full_name: string }>
  ).filter((u) => u.email && !u.email.endsWith("@purged.local"));
  for (const u of usersToNotify) {
    void sendKind(
      "account_purged",
      { coupleDisplayName },
      {
        user: { id: u.id, email: u.email, full_name: u.full_name },
        couple_id: coupleId,
      },
    );
  }

  // Children with PII — delete entirely.
  db.prepare(
    "DELETE FROM seat_assignments WHERE table_id IN (SELECT id FROM seating_tables WHERE couple_id = ?)",
  ).run(coupleId);
  db.prepare("DELETE FROM seating_conflicts WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM seating_tables WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM guests WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM budget_lines WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM budget_snapshots WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM data_exports WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM couple_invites WHERE couple_id = ?").run(coupleId);
  // Email log + dispatch ledger: drop direct mentions of this couple. The
  // `to_email` column may also contain PII; scrub via the user-id link below.
  db.prepare("DELETE FROM email_log WHERE couple_id = ?").run(coupleId);
  db.prepare(
    "DELETE FROM email_log WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
  ).run(coupleId);
  db.prepare("DELETE FROM email_dispatches WHERE couple_id = ?").run(coupleId);
  db.prepare(
    "DELETE FROM email_dispatches WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
  ).run(coupleId);
  db.prepare(
    "DELETE FROM email_preferences WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
  ).run(coupleId);

  // Sessions for users belonging to this couple — kill them so a returning
  // user can't keep using a stale token.
  db.prepare(
    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
  ).run(coupleId);

  // Users: scrub PII but keep the row (FK target for audit_log + couples).
  db.prepare(
    `UPDATE users SET email = 'deleted-' || id || '@purged.local',
                      password_hash = '!purged!',
                      full_name = 'Purged user',
                      status = 'suspended',
                      updated_at = ?
       WHERE couple_id = ?`,
  ).run(ts, coupleId);

  // Couple row: keep id + timestamps for retention; null out everything else.
  db.prepare(
    `UPDATE couples SET display_name = 'Purged workspace',
                        bride_name = '',
                        groom_name = '',
                        wedding_date = NULL,
                        target_guest_count = NULL,
                        budget_ceiling_huf = NULL,
                        location_lat = NULL,
                        location_lng = NULL,
                        location_radius_km = NULL,
                        style_tags_json = '[]',
                        status = 'deleting',
                        updated_at = ?
       WHERE id = ?`,
  ).run(ts, coupleId);

  db.prepare(
    "UPDATE couple_pause_requests SET status = 'completed', completed_at = ? WHERE couple_id = ? AND status = 'pending'",
  ).run(ts, coupleId);

  addAuditLog({
    actor_user_id: null,
    couple_id: coupleId,
    action: "couple.purge",
    target_kind: "couple",
    target_id: coupleId,
    note: "scheduled deletion completed",
  });
}

/**
 * Admin-initiated immediate deletion of a single user.
 *
 * - If the user belongs to a couple, the whole workspace is purged (same
 *   sweep as the scheduled-delete worker — both partners' PII is scrubbed).
 * - For orphan users (signed up but never onboarded), just kill the row and
 *   their sessions / email artefacts. Audit-log entry tracks the action.
 */
export function purgeOneUser(userId: number): void {
  const ts = now();
  const user = db.prepare("SELECT id, email, couple_id FROM users WHERE id = ?").get(userId) as
    | { id: number; email: string; couple_id: number | null }
    | undefined;
  if (!user) return;

  if (user.couple_id) {
    purgeOneCouple(user.couple_id);
    return;
  }

  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_log WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_dispatches WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_preferences WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_change_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    `UPDATE users SET email = 'deleted-' || id || '@purged.local',
                      password_hash = '!purged!',
                      full_name = 'Purged user',
                      status = 'suspended',
                      updated_at = ?
       WHERE id = ?`,
  ).run(ts, userId);

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "user.admin_purge",
    target_kind: "user",
    target_id: userId,
    note: "admin-initiated deletion (orphan user)",
  });
}

/** Run the purge for any couples whose scheduled_delete_at has passed. */
export function runPurgeSweep(): { purged: number } {
  const ts = now();
  const due = db
    .prepare(
      "SELECT couple_id FROM couple_pause_requests WHERE status = 'pending' AND scheduled_delete_at <= ?",
    )
    .all(ts) as { couple_id: number }[];

  for (const { couple_id } of due) {
    try {
      purgeOneCouple(couple_id);
    } catch (e) {
      log.error("purge.couple_failed", e, { couple_id });
    }
  }
  return { purged: due.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the hourly sweep. Idempotent — calling twice does nothing. */
export function startPurgeWorker(): void {
  if (timer) return;
  // Run once at boot so a long downtime catches up immediately.
  try {
    const r = runPurgeSweep();
    if (r.purged > 0) log.info("purge.boot_sweep", { purged: r.purged });
  } catch (e) {
    log.error("purge.boot_sweep_failed", e);
  }
  timer = setInterval(
    () => {
      try {
        const r = runPurgeSweep();
        if (r.purged > 0) log.info("purge.hourly_sweep", { purged: r.purged });
      } catch (e) {
        log.error("purge.hourly_sweep_failed", e);
      }
    },
    1000 * 60 * 60,
  );
}

export function stopPurgeWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
