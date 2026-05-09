// Pause-to-delete purge worker. After a couple's 30-day pause window expires,
// PII is removed from child tables; the couples row + audit_log are kept (with
// PII fields nulled) so we can answer "this workspace existed and was deleted on
// X" for tax/legal retention.
//
// Schema is additive-only (CLAUDE.md), so we never DROP rows the app might
// still reference; instead we DELETE child PII rows (they have ON DELETE CASCADE
// to handle FKs) and stamp the couple as 'deleting' → fields nulled.

import { db, now } from "./../db";
import { addAuditLog } from "./audit";

export function purgeOneCouple(coupleId: number): void {
  const ts = now();
  // Children with PII — delete entirely.
  db.prepare(
    "DELETE FROM seat_assignments WHERE table_id IN (SELECT id FROM seating_tables WHERE couple_id = ?)",
  ).run(coupleId);
  db.prepare("DELETE FROM seating_conflicts WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM seating_tables WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM guests WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM budget_lines WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM budget_snapshots WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM couple_invites WHERE couple_id = ?").run(coupleId);

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
      console.error(`[purge] failed for couple_id=${couple_id}`, e);
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
    if (r.purged > 0) console.log(`[purge] boot sweep purged ${r.purged} couple(s)`);
  } catch (e) {
    console.error("[purge] boot sweep error", e);
  }
  timer = setInterval(
    () => {
      try {
        const r = runPurgeSweep();
        if (r.purged > 0) console.log(`[purge] hourly sweep purged ${r.purged} couple(s)`);
      } catch (e) {
        console.error("[purge] sweep error", e);
      }
    },
    1000 * 60 * 60,
  );
}

export function stopPurgeWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
