// Read-only admin dashboard: list every registered user and every couple.
// Gate with requireAdmin() — same ADMIN_EMAILS allowlist as the supplier
// moderation routes.

import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { db } from "../db";
import { isAdminEmail, requireAdmin, type UserRow } from "../domain/users";
import { type CoupleRow, toCouple } from "../domain/couples";
import { type Ctx, json, type Router } from "../lib/http";

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
  return {
    id: c.id,
    display_name: c.display_name,
    bride_name: row.bride_name ?? null,
    groom_name: row.groom_name ?? null,
    status: c.status,
    partners: partnersForCouple(c.id),
    created_at: c.created_at,
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

export function registerAdminUserRoutes(router: Router) {
  router.get("/api/admin/users", handleListUsers, true);
  router.get("/api/admin/couples", handleListCouples, true);
}
