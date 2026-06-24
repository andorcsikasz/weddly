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
  /** Google-issued `sub` claim, set when a user signs in / signs up with
   *  Google. Null for password-only accounts. */
  google_sub?: string | null;
  /** Apple-issued `sub` claim, set when a user signs in / signs up with Apple.
   *  Null for accounts that never used Sign in with Apple. */
  apple_sub?: string | null;
  /** 1 = user has set a real local password; 0 = Google-only signup with a
   *  synthetic placeholder hash. Password-reset is refused when 0 so an
   *  attacker with knowledge of the email can't quietly install a password
   *  on a Google-only account. Defaults to 1 for back-compat. */
  password_set?: number;
  /** Per-user UI locale, captured at signup from the client's
   *  navigator.language. Null for pre-feature rows; falls back to the
   *  client's own detection in that case. */
  locale?: string | null;
  /** 1 = admin-marked beta tester (one of the team's own test accounts).
   *  Buckets the account + its workspace into the admin "Beta testers"
   *  group. Non-destructive label. Defaults to 0. */
  is_beta_tester?: number;
  /** Acquisition analytics, captured once at signup (see domain/signup_meta.ts).
   *  All nullable. signup_country = ISO-3166-1 alpha-2 derived from the request
   *  IP (IP not stored); device_type = coarse mobile/tablet/desktop bucket; the
   *  utm_* fields are the campaign params from the landing URL. Surfaced only in
   *  the admin Acquisition dashboard + the GDPR export; NULL'd on purge. */
  signup_country?: string | null;
  device_type?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  /** 'couple' (default) or 'planner'. Drives post-login routing and workspace
   *  fork. Set to 'planner' via admin action after waitlist approval. */
  user_type?: string | null;
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
    locale: normaliseLocale(row.locale),
    // password_set is nullable on legacy rows; treat null as "yes, has a
    // password" so password users from before the column existed still see
    // the password form in the re-auth modal.
    password_set: row.password_set !== 0,
    has_google: Boolean(row.google_sub),
    has_apple: Boolean(row.apple_sub),
    user_type: row.user_type === "planner" ? "planner" : "couple",
    created_at: row.created_at,
  };
}

/** Coerce a raw DB locale value into the shape the frontend expects. We
 *  only persist 'hu' | 'en' so anything else (legacy 'en-GB', stray
 *  'es-419') drops to null; the client then falls back to its own
 *  navigator detection. */
export function normaliseLocale(raw: string | null | undefined): "hu" | "en" | null {
  if (raw === "hu" || raw === "en") return raw;
  return null;
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

/** Non-throwing admin check for endpoints that serve BOTH couples and admins
 *  with role-scoped data (e.g. the supplier detail page once it opens to
 *  couples). Still requires auth, but returns `isAdmin: false` instead of a
 *  403 for a regular couple — the caller decides what each role may see. */
export function viewerIsAdmin(ctx: Ctx): { userId: number; isAdmin: boolean } {
  const userId = requireAuth(ctx);
  const row = getUserById(userId);
  return { userId, isAdmin: !!row && isAdminEmail(row.email) };
}
