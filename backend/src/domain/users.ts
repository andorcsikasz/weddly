// User row → DTO mapper, plus tiny lookup helpers.

import type { User, UserRole, UserStatus } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import { type Ctx, HttpError, requireAuth } from "../lib/http";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  status: string;
  role: string;
  couple_id: number | null;
  verified_email: number;
  created_at: number;
  updated_at: number;
  /** Additive column (see db.ts) — null for rows that pre-date the field. */
  last_seen_at: number | null;
}

/** Email-allowlist admin check. Source of truth is the `ADMIN_EMAILS` env var
 *  (see config.ts). Reversible by editing Railway env — no DB migration needed. */
export function isAdminEmail(email: string): boolean {
  return CONFIG.adminEmails.includes(email.trim().toLowerCase());
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    status: row.status as UserStatus,
    role: row.role as UserRole,
    is_admin: isAdminEmail(row.email),
    couple_id: row.couple_id,
    verified_email: Boolean(row.verified_email),
    created_at: row.created_at,
  };
}

export function getUserById(id: number): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  const norm = email.trim().toLowerCase();
  return (
    (db.prepare("SELECT * FROM users WHERE email = ?").get(norm) as UserRow | undefined) ?? null
  );
}

/** Auth + ADMIN_EMAILS gate. Use on every /api/admin/* handler. */
export function requireAdmin(ctx: Ctx): UserRow {
  const userId = requireAuth(ctx);
  const row = getUserById(userId);
  if (!row) throw new HttpError(401, "User not found");
  if (!isAdminEmail(row.email)) throw new HttpError(403, "Admin only");
  return row;
}
