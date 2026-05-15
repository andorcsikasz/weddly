// Read-only admin dashboard: list every registered user and every couple.
// Gate with requireAdmin() — same ADMIN_EMAILS allowlist as the supplier
// moderation routes.

import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "../domain/emails";
import { purgeOneCouple, purgeOneUser } from "../domain/purge";
import { isAdminEmail, requireAdmin, type UserRow } from "../domain/users";
import { type CoupleRow, toCouple } from "../domain/couples";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { createVerificationToken } from "./email_verify";

function toAdminUser(row: UserRow): AdminUserView {
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

function toAdminCouple(row: CoupleRow): AdminCoupleView {
  const c = toCouple(row);
  // Workspace-level "last active" = the most recent partner activity. NULL
  // when neither partner has loaded the app since the column was added.
  const seen = db
    .prepare("SELECT MAX(last_seen_at) AS max FROM users WHERE couple_id = ?")
    .get(c.id) as { max: number | null };
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
  };
}

function handleListUsers(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ users: listAllUsers().map(toAdminUser) });
}

function handleListCouples(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ couples: listAllCouples().map(toAdminCouple) });
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

export function registerAdminUserRoutes(router: Router) {
  router.get("/api/admin/users", handleListUsers, true);
  router.get("/api/admin/couples", handleListCouples, true);
  router.post("/api/admin/users/:id/resend-verify", handleResendVerify, true);
  router.delete("/api/admin/users/:id", handleDeleteUser, true);
  router.post("/api/admin/couples/purge-deleting", handlePurgeDeletingCouples, true);
}
