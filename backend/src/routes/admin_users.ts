// Read-only admin dashboard: list every registered user and every couple.
// Gate with requireAdmin() — same ADMIN_EMAILS allowlist as the supplier
// moderation routes.

import type { AdminCoupleView, AdminUserActivity, AdminUserView, UserFlag } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "../domain/emails";
import { purgeOneCouple, purgeOneUser } from "../domain/purge";
import { isAdminEmail, requireAdmin, type UserRow } from "../domain/users";
import { type CoupleRow, toCouple } from "../domain/couples";
import {
  activeFlagsByUserId,
  createUserFlag,
  getActiveFlagForUser,
  resolveActiveFlagForUser,
  type UserFlagRow,
} from "../domain/user_flags";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { createVerificationToken } from "./email_verify";

function toUserFlag(row: UserFlagRow): UserFlag {
  return {
    id: row.id,
    user_id: row.user_id,
    reason: row.reason,
    scheduled_delete_at: row.scheduled_delete_at,
    created_at: row.created_at,
  };
}

const EMPTY_ACTIVITY: AdminUserActivity = {
  supplier_tip_count: 0,
  supplier_tip_last_at: null,
  feedback_count: 0,
  feedback_last_at: null,
  prior_flag_count: 0,
};

/** One pass over the engagement tables, keyed by user_id. Used by the admin
 *  list to render compact "3 tipp · 5 napja" chips next to each row without
 *  triggering N+1 reads. Returns an empty record-shaped row for any user
 *  with no activity so callers can index unconditionally. */
function activityByUserId(): Map<number, AdminUserActivity> {
  const out = new Map<number, AdminUserActivity>();
  const ensure = (id: number): AdminUserActivity => {
    let row = out.get(id);
    if (!row) {
      row = { ...EMPTY_ACTIVITY };
      out.set(id, row);
    }
    return row;
  };

  // Supplier tips — every row counts (including hidden + deleted) so the
  // total engagement signal stays stable across moderation actions.
  const supplierRows = db
    .prepare(
      "SELECT submitter_user_id AS user_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM community_suppliers GROUP BY submitter_user_id",
    )
    .all() as { user_id: number; n: number; last_at: number | null }[];
  for (const r of supplierRows) {
    const a = ensure(r.user_id);
    a.supplier_tip_count = r.n;
    a.supplier_tip_last_at = r.last_at;
  }

  // Feedback — only user_id-attributed rows (anonymous landing feedback
  // doesn't carry a user link, intentionally).
  const feedbackRows = db
    .prepare(
      "SELECT user_id, COUNT(*) AS n, MAX(created_at) AS last_at FROM feedback_submissions WHERE user_id IS NOT NULL GROUP BY user_id",
    )
    .all() as { user_id: number; n: number; last_at: number | null }[];
  for (const r of feedbackRows) {
    const a = ensure(r.user_id);
    a.feedback_count = r.n;
    a.feedback_last_at = r.last_at;
  }

  // Prior (resolved) moderation flags — only counts closed rows; the live
  // flag is surfaced separately via active_flag.
  const flagRows = db
    .prepare(
      "SELECT user_id, COUNT(*) AS n FROM user_flags WHERE resolved_at IS NOT NULL GROUP BY user_id",
    )
    .all() as { user_id: number; n: number }[];
  for (const r of flagRows) {
    const a = ensure(r.user_id);
    a.prior_flag_count = r.n;
  }

  return out;
}

function toAdminUser(
  row: UserRow,
  flagByUser: Map<number, UserFlagRow>,
  activityByUser: Map<number, AdminUserActivity>,
): AdminUserView {
  const flag = flagByUser.get(row.id);
  const activity = activityByUser.get(row.id) ?? { ...EMPTY_ACTIVITY };
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role as AdminUserView["role"],
    status: row.status as AdminUserView["status"],
    is_admin: isAdminEmail(row.email),
    verified_email: Boolean(row.verified_email),
    couple_id: row.couple_id,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    active_flag: flag ? toUserFlag(flag) : null,
    activity,
  };
}

function listAllUsers(): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserRow[];
}

function listAllCouples(): CoupleRow[] {
  return db.prepare("SELECT * FROM couples ORDER BY created_at DESC").all() as CoupleRow[];
}

interface PartnerRow {
  id: number;
  full_name: string;
  email: string;
}

function partnersForCouple(coupleId: number): PartnerRow[] {
  return db
    .prepare("SELECT id, full_name, email FROM users WHERE couple_id = ? ORDER BY id ASC")
    .all(coupleId) as PartnerRow[];
}

/** One pass over audit_log → demo couples, aggregating feature-prefix
 *  counts so the admin couples listing can render usage chips on each
 *  live demo row without triggering N+1 reads. Real couples are skipped
 *  entirely — the chip is a demo-only signal. */
function demoFeatureCountsByCoupleId(): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  const rows = db
    .prepare(
      `SELECT a.couple_id AS couple_id, a.action AS action, COUNT(*) AS n
         FROM audit_log a
         JOIN couples c ON c.id = a.couple_id
        WHERE c.is_demo = 1
        GROUP BY a.couple_id, a.action`,
    )
    .all() as { couple_id: number; action: string; n: number }[];
  for (const r of rows) {
    const dot = r.action.indexOf(".");
    const feature = dot === -1 ? r.action : r.action.slice(0, dot);
    let bucket = out.get(r.couple_id);
    if (!bucket) {
      bucket = {};
      out.set(r.couple_id, bucket);
    }
    bucket[feature] = (bucket[feature] ?? 0) + r.n;
  }
  return out;
}

function toAdminCouple(
  row: CoupleRow,
  demoFeatureCounts: Map<number, Record<string, number>>,
): AdminCoupleView {
  const c = toCouple(row);
  // Workspace-level "last active" = the most recent partner activity. NULL
  // when neither partner has loaded the app since the column was added.
  const seen = db
    .prepare("SELECT MAX(last_seen_at) AS max FROM users WHERE couple_id = ?")
    .get(c.id) as { max: number | null };
  // Per-feature event counts for the admin demo panel — populated only
  // for demos (real couples have a richer activity surface and these
  // chips would be noisy there).
  const featureCounts = c.is_demo ? (demoFeatureCounts.get(c.id) ?? {}) : null;
  const totalEvents =
    featureCounts === null ? null : Object.values(featureCounts).reduce((sum, n) => sum + n, 0);
  return {
    id: c.id,
    slug: row.slug ?? null,
    display_name: c.display_name,
    bride_name: row.bride_name ?? null,
    groom_name: row.groom_name ?? null,
    status: c.status,
    partners: partnersForCouple(c.id),
    created_at: c.created_at,
    last_seen_at: seen.max,
    is_demo: c.is_demo,
    demo_feature_counts: featureCounts,
    demo_total_events: totalEvents,
  };
}

function listOneUserAdminView(userId: number): AdminUserView | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!row) return null;
  const flag = getActiveFlagForUser(userId);
  const flagMap = new Map<number, UserFlagRow>();
  if (flag) flagMap.set(userId, flag);
  // Single-row lookup — we still build the activity map but it's bounded
  // to whatever this user touched, so the queries stay tiny.
  const activityMap = activityByUserId();
  return toAdminUser(row, flagMap, activityMap);
}

function handleListUsers(ctx: Ctx): Response {
  requireAdmin(ctx);
  const flagMap = activeFlagsByUserId();
  const activityMap = activityByUserId();
  return json({
    users: listAllUsers().map((u) => toAdminUser(u, flagMap, activityMap)),
  });
}

function handleListCouples(ctx: Ctx): Response {
  requireAdmin(ctx);
  const demoCounts = demoFeatureCountsByCoupleId();
  return json({ couples: listAllCouples().map((row) => toAdminCouple(row, demoCounts)) });
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function handleResendVerify(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  const user = db
    .prepare("SELECT id, email, full_name, verified_email FROM users WHERE id = ?")
    .get(userId) as
    | { id: number; email: string; full_name: string; verified_email: number }
    | undefined;
  if (!user) throw new HttpError(404, "User not found");
  if (user.verified_email) return json({ ok: true, already_verified: true });

  const token = createVerificationToken(userId);
  const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${token}`;
  void sendKind(
    "verify_resend",
    { verifyUrl },
    { user: { id: user.id, email: user.email, full_name: user.full_name } },
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.user_resend_verify",
    target_kind: "user",
    target_id: userId,
  });

  return json({ ok: true });
}

function handleDeleteUser(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  if (userId === admin.id) throw new HttpError(400, "Cannot delete your own admin account");

  const before = db.prepare("SELECT id, email, couple_id FROM users WHERE id = ?").get(userId) as
    | { id: number; email: string; couple_id: number | null }
    | undefined;
  if (!before) throw new HttpError(404, "User not found");

  purgeOneUser(userId, { adminInitiated: true });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: before.couple_id,
    action: "admin.user_delete",
    target_kind: "user",
    target_id: userId,
    before: { email: before.email, couple_id: before.couple_id },
  });

  return json({ ok: true });
}

/**
 * Bulk re-purge every couple currently flagged `status="deleting"`. These
 * rows have already had their PII scrubbed by `purgeOneCouple` (either via
 * admin delete or the scheduled-pause worker) — re-running is idempotent and
 * cheap, and gives us a one-shot "clean residue" sweep for legacy tombstones.
 * Returns the count of rows that were touched so the UI can show a toast.
 */
function handlePurgeDeletingCouples(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const rows = db
    .prepare("SELECT id FROM couples WHERE status = 'deleting' ORDER BY id ASC")
    .all() as { id: number }[];

  for (const r of rows) {
    // adminInitiated=true is the right semantic (this is an admin action),
    // though in practice no email fires here because every user on these
    // tombstone rows already has a `@purged.local` address from the prior
    // sweep — the notify-list filter in `purgeOneCouple` will be empty.
    purgeOneCouple(r.id, { adminInitiated: true });
  }

  if (rows.length > 0) {
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.couples_purge_deleting",
      target_kind: "couple",
      target_id: null,
      note: `bulk purge of ${rows.length} deleting couples`,
    });
  }

  return json({ purged: rows.length });
}

/**
 * Flag a user account. Inserts a 7-day grace window into `user_flags`,
 * emails the recipient with the admin's reason verbatim, and audit-logs.
 * The hourly purge sweep auto-deletes the account at the deadline unless
 * the admin clears the flag in the meantime.
 */
async function handleFlagUser(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);
  if (userId === admin.id) {
    throw new HttpError(400, "Cannot flag your own admin account");
  }

  const body = await readJson<{ reason?: unknown }>(ctx.req);
  if (typeof body.reason !== "string") {
    throw new HttpError(400, "`reason` is required");
  }
  const reason = body.reason.trim();
  if (reason.length < 4) {
    throw new HttpError(400, "`reason` must be at least 4 characters");
  }
  if (reason.length > 2000) {
    throw new HttpError(400, "`reason` is too long (max 2000)");
  }

  const target = db
    .prepare("SELECT id, email, full_name, couple_id FROM users WHERE id = ?")
    .get(userId) as
    | { id: number; email: string; full_name: string; couple_id: number | null }
    | undefined;
  if (!target) throw new HttpError(404, "User not found");
  if (target.email.endsWith("@purged.local")) {
    throw new HttpError(400, "Cannot flag a purged user");
  }

  // Refuse to stack flags — caller must clear the existing one first.
  if (getActiveFlagForUser(userId)) {
    throw new HttpError(409, "User already has an active flag", { code: "already_flagged" });
  }

  const flag = createUserFlag({
    user_id: userId,
    flagged_by_user_id: admin.id,
    reason,
  });

  // Localised deadline strings for the email template — computed here so
  // the template stays a pure renderer.
  const deadlineDate = new Date(flag.scheduled_delete_at);
  const deadlineDateHu = new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(deadlineDate);
  const deadlineDateEn = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(deadlineDate);

  void sendKind(
    "account_flagged",
    { reason, deadlineDateHu, deadlineDateEn },
    {
      user: { id: target.id, email: target.email, full_name: target.full_name },
      couple_id: target.couple_id,
    },
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: target.couple_id,
    action: "admin.user_flag",
    target_kind: "user",
    target_id: userId,
    after: {
      flag_id: flag.id,
      scheduled_delete_at: flag.scheduled_delete_at,
      reason_length: reason.length,
    },
  });

  const view = listOneUserAdminView(userId);
  return json({ user: view, flag: toUserFlag(flag) });
}

/** Clear the user's active flag. Idempotent — 200 with `cleared: false`
 *  when there was nothing to clear. Accepts an optional admin note that
 *  records why (e.g. "user replied — concern addressed"). */
async function handleUnflagUser(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const userId = parseId(ctx);

  const body = await readJson<{ note?: unknown }>(ctx.req);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  const resolved = resolveActiveFlagForUser({
    user_id: userId,
    resolved_by_user_id: admin.id,
    note,
  });

  if (resolved) {
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "admin.user_unflag",
      target_kind: "user",
      target_id: userId,
      before: { flag_id: resolved.id },
      after: { note_length: note.length },
    });
  }

  const view = listOneUserAdminView(userId);
  return json({ user: view, cleared: resolved !== null });
}

type AdminSection = "suppliers" | "users" | "vendor_waitlist" | "feedback";
const VALID_SECTIONS: ReadonlySet<AdminSection> = new Set([
  "suppliers",
  "users",
  "vendor_waitlist",
  "feedback",
]);

/** Per-admin `seen_at` threshold for each sidebar section. Defaults to 0
 *  (epoch) when the admin has never opened that page — every existing
 *  row counts as "new" on first visit, then only rows authored after
 *  the visit count thereafter. */
function seenWatermarks(userId: number): Record<AdminSection, number> {
  const rows = db
    .prepare("SELECT section, seen_at FROM admin_section_seen WHERE user_id = ?")
    .all(userId) as { section: string; seen_at: number }[];
  const out: Record<AdminSection, number> = {
    suppliers: 0,
    users: 0,
    vendor_waitlist: 0,
    feedback: 0,
  };
  for (const r of rows) {
    if (VALID_SECTIONS.has(r.section as AdminSection)) {
      out[r.section as AdminSection] = r.seen_at;
    }
  }
  return out;
}

/**
 * Sidebar unread counts, Instagram-style: each section counts only the
 * rows authored AFTER this admin last opened that page. Opening the
 * page upserts `admin_section_seen` (via `handleMarkSectionSeen`) so
 * the badge clears on the next poll.
 *
 *   - suppliers       → community_suppliers awaiting_review, created_at > seen
 *   - users           → user_flags resolved_at IS NULL, created_at > seen
 *   - vendor_waitlist → vendor_waitlist status='new', created_at > seen
 *   - feedback        → feedback_submissions status='new', created_at > seen
 */
function handleSidebarBadges(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const seen = seenWatermarks(admin.id);
  const suppliers = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM community_suppliers WHERE status = 'awaiting_review' AND created_at > ?",
      )
      .get(seen.suppliers) as { n: number }
  ).n;
  // "Users" badge combines two unread signals: newly registered users
  // since the admin last looked + moderation flags raised since then.
  // Purged tombstones are excluded from the new-user count so a deleted
  // user doesn't re-light the badge every time the sweep stamps their row.
  const newUsers = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE created_at > ? AND email NOT LIKE '%@purged.local'",
      )
      .get(seen.users) as { n: number }
  ).n;
  const newFlags = (
    db
      .prepare("SELECT COUNT(*) AS n FROM user_flags WHERE resolved_at IS NULL AND created_at > ?")
      .get(seen.users) as { n: number }
  ).n;
  const users = newUsers + newFlags;
  const vendor_waitlist = (
    db
      .prepare("SELECT COUNT(*) AS n FROM vendor_waitlist WHERE status = 'new' AND created_at > ?")
      .get(seen.vendor_waitlist) as { n: number }
  ).n;
  const feedback = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM feedback_submissions WHERE status = 'new' AND created_at > ?",
      )
      .get(seen.feedback) as { n: number }
  ).n;
  return json({ suppliers, users, vendor_waitlist, feedback });
}

/** Upsert the admin's `seen_at` for one sidebar section. The frontend
 *  fires this every time the admin lands on /app/admin/{section}; the
 *  next badge poll then returns 0 for that section until newer rows
 *  arrive. Idempotent — repeated calls just bump the watermark. */
async function handleMarkSectionSeen(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<{ section?: unknown }>(ctx.req);
  if (typeof body.section !== "string" || !VALID_SECTIONS.has(body.section as AdminSection)) {
    throw new HttpError(400, "Invalid section");
  }
  const ts = Date.now();
  db.prepare(
    `INSERT INTO admin_section_seen (user_id, section, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, section) DO UPDATE SET seen_at = excluded.seen_at`,
  ).run(admin.id, body.section, ts);
  return json({ ok: true, section: body.section, seen_at: ts });
}

export function registerAdminUserRoutes(router: Router) {
  router.get("/api/admin/users", handleListUsers, true);
  router.get("/api/admin/couples", handleListCouples, true);
  router.get("/api/admin/sidebar-badges", handleSidebarBadges, true);
  router.post("/api/admin/sidebar-badges/seen", handleMarkSectionSeen, true);
  router.post("/api/admin/users/:id/resend-verify", handleResendVerify, true);
  router.delete("/api/admin/users/:id", handleDeleteUser, true);
  router.post("/api/admin/users/:id/flag", handleFlagUser, true);
  router.post("/api/admin/users/:id/unflag", handleUnflagUser, true);
  router.post("/api/admin/couples/purge-deleting", handlePurgeDeletingCouples, true);
}
