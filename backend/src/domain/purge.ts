// Pause-to-delete purge worker. After a couple's 30-day pause window expires,
// PII is removed from child tables; the couples row + audit_log are kept (with
// PII fields nulled) so we can answer "this workspace existed and was deleted on
// X" for tax/legal retention.
//
// Schema is additive-only (CLAUDE.md), so we never DROP rows the app might
// still reference; instead we DELETE child PII rows (they have ON DELETE CASCADE
// to handle FKs) and stamp the couple as 'deleting' → fields nulled.

import { storage } from "../lib/storage";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { log } from "../lib/logger";
import { sweepStaleRateLimitBuckets } from "../lib/rate_limit";
import { purgeStaleDemoCouples } from "./demo_seed";
import { purgeStalePlannerDemos } from "./planner_demo_seed";
import { purgeStaleVendorDemos } from "./vendor_demo_seed";
import { sendKind } from "./emails";
import { listFlagsDueForPurge, markFlagPurged } from "./user_flags";

export function purgeOneCouple(
  coupleId: number,
  options: { adminInitiated?: boolean; silent?: boolean; spareUserIds?: number[] } = {},
): void {
  const ts = now();
  const adminInitiated = options.adminInitiated === true;
  const silent = options.silent === true;
  // Users the caller is mid-relocating to another workspace (the partner-merge
  // flow links the merging user into the target couple AFTER this purge, so at
  // this instant they still look like an exclusive member of the source). Skip
  // every user-level effect for them — the caller owns their re-pointing.
  const spareSet = new Set(options.spareUserIds ?? []);

  // Resolve this workspace's members through `couple_members` (canonical), NOT
  // `users.couple_id` — that column is just the active-workspace pointer, so it
  // both MISSES a member who switched away and WRONGLY catches outsiders aimed
  // here (e.g. a planner currently viewing this client). Scoping user-level PII
  // erasure by the pointer over-deletes (nukes a multi-workspace user's global
  // data + identity) and under-scrubs (skips a member pointing elsewhere).
  const memberIds = (
    db.prepare("SELECT user_id FROM couple_members WHERE couple_id = ?").all(coupleId) as Array<{
      user_id: number;
    }>
  )
    .map((r) => r.user_id)
    .filter((uid) => !spareSet.has(uid));
  // A member is fully erased only if THIS is their only non-deleting workspace.
  // A member who still belongs to another live couple keeps their identity and
  // global per-user data — we just drop their membership here and repoint their
  // active pointer below if it aimed at this workspace.
  const exclusiveIds = memberIds.filter(
    (uid) =>
      db
        .prepare(
          `SELECT 1 FROM couple_members cm
             JOIN couples c ON c.id = cm.couple_id
            WHERE cm.user_id = ? AND cm.couple_id != ? AND c.status != 'deleting'
            LIMIT 1`,
        )
        .get(uid, coupleId) == null,
  );
  const sharedIds = memberIds.filter((uid) => !exclusiveIds.includes(uid));
  // Integer DB ids → injection-safe to inline; lets us reuse one fragment across
  // the user-scoped statements and skip them cleanly when the set is empty.
  const exclusiveIdList = exclusiveIds.join(",");

  // Send the "your data is gone" notice BEFORE we scrub the user table —
  // afterwards the email column is rewritten to `deleted-…@purged.local`
  // and the addresses are unrecoverable. Fire-and-forget: failure to mail
  // must not abort the destructive sweep.
  //
  // `silent: true` skips the email entirely. Used by the partner-merge
  // flow: the user is consciously discarding their solo workspace to
  // join their partner's, so a "your data is gone" email would just
  // confuse — they're not losing access, they're moving.
  if (!silent) {
    const couple = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(coupleId) as
      | { display_name: string }
      | undefined;
    const coupleDisplayName = couple?.display_name?.trim() || "your wedding";
    // Notify only the members actually being erased (exclusive to this
    // workspace). A member who keeps their account because they belong to
    // another live couple should not get a "your data is gone" notice.
    const usersToNotify =
      exclusiveIds.length === 0
        ? []
        : (
            db
              .prepare(`SELECT id, email, full_name FROM users WHERE id IN (${exclusiveIdList})`)
              .all() as Array<{ id: number; email: string; full_name: string }>
          ).filter((u) => u.email && !u.email.endsWith("@purged.local"));
    for (const u of usersToNotify) {
      const target = {
        user: { id: u.id, email: u.email, full_name: u.full_name },
        couple_id: coupleId,
      };
      if (adminInitiated) {
        void sendKind("account_admin_purged", { coupleDisplayName }, target);
      } else {
        void sendKind("account_purged", { coupleDisplayName }, target);
      }
    }
  }

  // Children with PII — delete entirely. We keep the `couples` and `users`
  // rows (FK targets for `audit_log`) but every child table that holds
  // user-authored content or personally identifying information is wiped
  // here. The full sweep is the right-to-erasure contract — anything we
  // leave behind has to either be content-free or referenced by retention
  // (audit_log only). Schema is additive, so we DELETE rather than DROP.
  //
  // All ~25 destructive statements run inside a single transaction: erasure
  // must be atomic. A mid-sweep crash that left guests/seating deleted but
  // the couples row still 'active' (or PII half-scrubbed) is both a data-
  // integrity and a GDPR-compliance hazard, so we commit-or-rollback as one.
  const applyPurge = db.transaction(() => {
    db.prepare(
      "DELETE FROM seat_assignments WHERE table_id IN (SELECT id FROM seating_tables WHERE couple_id = ?)",
    ).run(coupleId);
    db.prepare("DELETE FROM seating_conflicts WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM seating_tables WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM guests WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM households WHERE couple_id = ?").run(coupleId);
    // Uploaded moodboard images — rows here; the files on disk are unlinked
    // best-effort after the transaction commits (see below).
    db.prepare("DELETE FROM moodboard_images WHERE couple_id = ?").run(coupleId);
    // Children-first: installments ON DELETE CASCADE from couple_suppliers,
    // but delete explicitly to keep the erasure sweep self-describing.
    db.prepare("DELETE FROM supplier_installments WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_suppliers WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_supplier_costs WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_picks WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM saved_suppliers WHERE couple_id = ?").run(coupleId);
    // GDPR erasure gap (audit 2026-06): these couple-scoped PII tables were
    // never swept. Because purge UPDATEs couples.status='deleting' instead of
    // DELETEing the row, their couple_id ON DELETE CASCADE never fires — so we
    // delete explicitly. All carry user-authored content (lodging/transfer
    // logistics, wishlist + soft pledges, the private received-gifts ledger,
    // notification feed + read watermarks). Children-first where there's a FK.
    db.prepare("DELETE FROM wishlist_interests WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM wishlist_items WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM received_gifts WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM accommodations WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM transfers WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM notification_seen WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_notifications WHERE couple_id = ?").run(coupleId);
    // Membership graph (who belonged to this workspace, with what role). FKs
    // CASCADE from couples/users, but both rows are KEPT (audit_log targets),
    // so the cascade never fires — delete the relationship record explicitly.
    db.prepare("DELETE FROM couple_members WHERE couple_id = ?").run(coupleId);
    // Q3 Outreach Inbox cascade — children-first so SQLite's FK enforcement
    // doesn't complain. Tables are empty until the Q3 build wires sends, but
    // the cascade is part of the GDPR contract and lands with the schema.
    db.prepare(
      `DELETE FROM outreach_replies WHERE message_id IN (
       SELECT om.id FROM outreach_messages om
       JOIN outreach_campaigns oc ON oc.id = om.campaign_id
       WHERE oc.couple_id = ?
     )`,
    ).run(coupleId);
    db.prepare(
      "DELETE FROM outreach_messages WHERE campaign_id IN (SELECT id FROM outreach_campaigns WHERE couple_id = ?)",
    ).run(coupleId);
    db.prepare("DELETE FROM outreach_campaigns WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM supplier_votes WHERE couple_id = ?").run(coupleId);
    // Supplier detail page — couple-authored reviews, Q&A comments by the
    // couple's users, and booking inquiries. Editorial reviews (couple_id NULL)
    // belong to admins, not to this workspace, so they stay untouched.
    // supplier_review_tags cascades via FK ON DELETE CASCADE.
    db.prepare("DELETE FROM supplier_reviews WHERE couple_id = ?").run(coupleId);
    if (exclusiveIds.length > 0) {
      db.prepare(
        `DELETE FROM supplier_comments WHERE author_user_id IN (${exclusiveIdList})`,
      ).run();
    }
    db.prepare("DELETE FROM supplier_bookings WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM planning_items WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM schedule_events WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM budget_lines WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM budget_snapshots WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_income WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM data_exports WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM couple_invites WHERE couple_id = ?").run(coupleId);
    // Email log + dispatch ledger: drop direct mentions of this couple. The
    // `to_email` column may also contain PII; scrub via the user-id link below.
    db.prepare("DELETE FROM email_log WHERE couple_id = ?").run(coupleId);
    db.prepare("DELETE FROM email_dispatches WHERE couple_id = ?").run(coupleId);

    // User-scoped PII — feedback, per-user email artefacts, and sessions —
    // for the members being fully erased (exclusive to this workspace). A
    // member who keeps their account (still on another live couple) retains
    // all of this; we only unlink them below.
    if (exclusiveIds.length > 0) {
      db.prepare(`DELETE FROM feedback_submissions WHERE user_id IN (${exclusiveIdList})`).run();
      db.prepare(`DELETE FROM email_log WHERE user_id IN (${exclusiveIdList})`).run();
      db.prepare(`DELETE FROM email_dispatches WHERE user_id IN (${exclusiveIdList})`).run();
      db.prepare(`DELETE FROM email_preferences WHERE user_id IN (${exclusiveIdList})`).run();
      // Kill their sessions so a returning user can't keep using a stale token.
      db.prepare(`DELETE FROM sessions WHERE user_id IN (${exclusiveIdList})`).run();
    }

    // Members who survive (belong to another live couple): drop just their
    // membership in this workspace and repoint their active pointer away if it
    // aimed here, so they don't land on a tombstoned "Purged workspace".
    for (const uid of sharedIds) {
      const other = db
        .prepare(
          `SELECT cm.couple_id AS id FROM couple_members cm
             JOIN couples c ON c.id = cm.couple_id
            WHERE cm.user_id = ? AND cm.couple_id != ? AND c.status != 'deleting'
            ORDER BY cm.created_at ASC LIMIT 1`,
        )
        .get(uid, coupleId) as { id: number } | undefined;
      db.prepare(
        "UPDATE users SET couple_id = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
      ).run(other?.id ?? null, ts, uid, coupleId);
    }

    // Users: scrub PII but keep the row (FK target for audit_log + couples).
    // Acquisition fields are NULL'd too — a purged user must not retain
    // country / UTM / device attribution (GDPR Art 17 erasure). Only the
    // exclusive members are anonymised; a member who still belongs to another
    // live couple keeps their identity (they were unlinked + repointed above).
    if (exclusiveIds.length > 0) {
      db.prepare(
        `UPDATE users SET email = 'deleted-' || id || '@purged.local',
                        password_hash = '!purged!',
                        full_name = 'Purged user',
                        status = 'suspended',
                        signup_country = NULL,
                        device_type = NULL,
                        utm_source = NULL,
                        utm_medium = NULL,
                        utm_campaign = NULL,
                        utm_content = NULL,
                        utm_term = NULL,
                        updated_at = ?
         WHERE id IN (${exclusiveIdList})`,
      ).run(ts);
    }

    // Anyone else still pointing here (e.g. a planner who was viewing this
    // client when it was purged) is not a member and must not be anonymised —
    // just clear their stale active pointer so they don't land on the tombstone.
    if (exclusiveIds.length > 0) {
      db.prepare(
        `UPDATE users SET couple_id = NULL, updated_at = ?
          WHERE couple_id = ? AND id NOT IN (${exclusiveIdList})`,
      ).run(ts, coupleId);
    } else {
      db.prepare("UPDATE users SET couple_id = NULL, updated_at = ? WHERE couple_id = ?").run(
        ts,
        coupleId,
      );
    }

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
                        purged_at = ?,
                        updated_at = ?
       WHERE id = ?`,
    ).run(ts, ts, coupleId);

    // Mark the pause request completed AND scrub its free-text PII: `reason` is
    // text the user wrote and can re-identify the couple. We do NOT null
    // requested_by_user_id — it's NOT NULL and FK-bound, and the user row it
    // points at is itself anonymized in-place later in this same sweep, so the
    // pointer no longer leaks PII. Drop the status filter so a non-pending
    // request is scrubbed too — erasure must not depend on lifecycle state.
    db.prepare(
      "UPDATE couple_pause_requests SET status = 'completed', completed_at = ?, reason = NULL WHERE couple_id = ?",
    ).run(ts, coupleId);

    // Next-11 (GDPR purge gap): growth_events.couple_id has ON DELETE CASCADE,
    // but `purgeOneCouple` scrubs the couples row in-place (line 117 UPDATE,
    // not DELETE), so the cascade never fires. Explicit DELETE here so the
    // behavioural trail — `referrer` (may carry microsite slugs that
    // re-identify the wedding) + `payload_json` — is wiped alongside the
    // rest of the workspace's data.
    db.prepare("DELETE FROM growth_events WHERE couple_id = ?").run(coupleId);

    addAuditLog({
      actor_user_id: null,
      couple_id: coupleId,
      action: "couple.purge",
      target_kind: "couple",
      target_id: coupleId,
      note: "scheduled deletion completed",
    });
  });
  applyPurge();

  // Best-effort removal of this couple's uploaded files (photos, moodboard,
  // cover, budget docs, honeymoon cover). Outside the DB transaction — a leaked
  // object under uploads doesn't break erasure of the data itself, and storage
  // errors must not roll back the purge (deletePrefix swallows its own errors).
  void storage.deletePrefix(`couples/${coupleId}/`);
}

/**
 * Admin-initiated immediate deletion of a single user.
 *
 * - If the user belongs to a couple, the whole workspace is purged (same
 *   sweep as the scheduled-delete worker — both partners' PII is scrubbed).
 * - For orphan users (signed up but never onboarded), just kill the row and
 *   their sessions / email artefacts. Audit-log entry tracks the action.
 */
export function purgeOneUser(userId: number, options: { adminInitiated?: boolean } = {}): void {
  const ts = now();
  const adminInitiated = options.adminInitiated === true;
  const user = db
    .prepare("SELECT id, email, couple_id, full_name FROM users WHERE id = ?")
    .get(userId) as
    | { id: number; email: string; couple_id: number | null; full_name: string }
    | undefined;
  if (!user) return;

  if (user.couple_id) {
    purgeOneCouple(user.couple_id, { adminInitiated });
    return;
  }

  // Orphan user (signed up, never onboarded). Send the "your account is gone"
  // notice BEFORE we scrub the row — same fire-and-forget pattern as the
  // couple purge. Only fires for admin-initiated deletes; the scheduled-pause
  // worker can't reach orphans (no couple_id → no pause request to expire).
  if (adminInitiated && user.email && !user.email.endsWith("@purged.local")) {
    void sendKind(
      "account_admin_purged",
      { coupleDisplayName: null },
      {
        user: { id: user.id, email: user.email, full_name: user.full_name },
        couple_id: null,
      },
    );
  }

  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_log WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_dispatches WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_preferences WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM email_change_tokens WHERE user_id = ?").run(userId);
  // Orphan users may have voted on community suppliers or submitted
  // feedback before they were deleted. Wipe both — they're personally
  // identifying content tied to this user.
  db.prepare("DELETE FROM supplier_votes WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM feedback_submissions WHERE user_id = ?").run(userId);

  // Next-11 — three Phase-2 tables that didn't exist when this sweep was
  // first written:
  //   - listing_claims.email_sent_to is raw PII (the vendor's contact
  //     email captured at claim-start). Not FK-linked to users, so
  //     nothing cascades it away — DELETE explicitly.
  //   - vendor_accounts.owner_user_id has ON DELETE CASCADE, but we
  //     scrub the users row in-place (UPDATE below), so the cascade
  //     never fires. DELETE explicitly; that in turn flips
  //     listings.vendor_account_id + listing_claims.vendor_account_id
  //     to NULL via their FK SET-NULL rules, leaving the directory
  //     listing as orphaned-but-public (correct: it's curated content,
  //     not the user's personal data).
  //   - growth_events.user_id is ON DELETE SET NULL but the users row
  //     survives the scrub, so explicit UPDATE de-links the behavioural
  //     trail from the now-purged identity. Row kept (aggregate-only).
  db.prepare("DELETE FROM listing_claims WHERE email_sent_to = ?").run(user.email);
  db.prepare("DELETE FROM vendor_accounts WHERE owner_user_id = ?").run(userId);
  db.prepare("UPDATE growth_events SET user_id = NULL WHERE user_id = ?").run(userId);

  db.prepare(
    `UPDATE users SET email = 'deleted-' || id || '@purged.local',
                      password_hash = '!purged!',
                      full_name = 'Purged user',
                      status = 'suspended',
                      signup_country = NULL,
                      device_type = NULL,
                      utm_source = NULL,
                      utm_medium = NULL,
                      utm_campaign = NULL,
                      utm_content = NULL,
                      utm_term = NULL,
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

/** Run the purge for any couples whose scheduled_delete_at has passed.
 *  Also tidies the rate_limit_buckets table on the same tick — both are
 *  cheap, scheduled housekeeping. */
export function runPurgeSweep(): {
  purged: number;
  flagged_purged: number;
  demos_purged: number;
  residue_finalised: number;
  ratelimit_buckets_deleted: number;
} {
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

  // Legacy tombstones: rows already in status='deleting' from an older purge
  // pass that predates a table/column the current scrubber covers. purged_at is
  // NULL on those (it's stamped only by the current purgeOneCouple), so we
  // re-finalise each one once and the stamp keeps it out of every later tick.
  // This is what used to be the manual "purge deleting workspaces" admin button.
  let residueFinalised = 0;
  const residue = db
    .prepare("SELECT id FROM couples WHERE status = 'deleting' AND purged_at IS NULL")
    .all() as { id: number }[];
  for (const { id } of residue) {
    try {
      // adminInitiated isn't meaningful here (no human actor) and no email can
      // fire — every member already carries a `@purged.local` address.
      purgeOneCouple(id, { silent: true });
      residueFinalised += 1;
    } catch (e) {
      log.error("purge.residue_failed", e, { couple_id: id });
    }
  }

  // Admin moderation flags — every flag past its deadline is treated like
  // an admin-initiated delete: the recipient gets the `account_admin_purged`
  // email and the flag is marked resolved with a synthetic note so it
  // doesn't fire again on the next tick.
  const flagsDue = listFlagsDueForPurge();
  let flaggedPurged = 0;
  for (const flag of flagsDue) {
    try {
      purgeOneUser(flag.user_id, { adminInitiated: true });
      markFlagPurged(flag.id);
      addAuditLog({
        actor_user_id: null,
        couple_id: null,
        action: "user.flag_auto_purge",
        target_kind: "user",
        target_id: flag.user_id,
        note: `auto-purge at flag deadline (flag ${flag.id})`,
      });
      flaggedPurged += 1;
    } catch (e) {
      log.error("purge.flag_failed", e, { flagId: flag.id, userId: flag.user_id });
    }
  }

  // Demo workspaces past the 4h lifetime — kept on the same hourly tick
  // instead of a dedicated timer so we only run one housekeeping loop.
  // Reap demo PLANNERS and VENDORS before their client couples (ordering
  // note in purgeStalePlannerDemos).
  let demosPurged = 0;
  try {
    purgeStalePlannerDemos();
    purgeStaleVendorDemos();
    demosPurged = purgeStaleDemoCouples();
  } catch (e) {
    log.error("purge.demo_sweep_failed", e);
  }

  let ratelimitDeleted = 0;
  try {
    ratelimitDeleted = sweepStaleRateLimitBuckets().deleted;
  } catch (e) {
    log.error("purge.ratelimit_sweep_failed", e);
  }
  return {
    purged: due.length,
    flagged_purged: flaggedPurged,
    demos_purged: demosPurged,
    residue_finalised: residueFinalised,
    ratelimit_buckets_deleted: ratelimitDeleted,
  };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the hourly sweep. Idempotent — calling twice does nothing. */
export function startPurgeWorker(): void {
  if (timer) return;
  // Run once at boot so a long downtime catches up immediately.
  try {
    const r = runPurgeSweep();
    if (r.purged > 0 || r.demos_purged > 0 || r.ratelimit_buckets_deleted > 0)
      log.info("purge.boot_sweep", r);
  } catch (e) {
    log.error("purge.boot_sweep_failed", e);
  }
  timer = setInterval(
    () => {
      try {
        const r = runPurgeSweep();
        if (
          r.purged > 0 ||
          r.demos_purged > 0 ||
          r.residue_finalised > 0 ||
          r.ratelimit_buckets_deleted > 0
        )
          log.info("purge.hourly_sweep", r);
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
