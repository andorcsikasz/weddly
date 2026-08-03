// User row → DTO mapper, plus tiny lookup helpers.

import { isUiLocale, type UiLocale } from "@shared/locales";
import type { User, UserRole, UserStatus } from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
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
  /** Planner/vendor business identity, filled at onboarding or when an admin
   *  provisions the account. Null for couple users. */
  business_name?: string | null;
  /** Free-text business category typed by the admin at planner provisioning. */
  planner_category?: string | null;
  /** Unix ms the "share Weddly" prompt was auto-shown, or null if never.
   *  Write-once (see routes/auth.ts) — it is the one-shot latch for the
   *  automatic popup, not a dismissal counter. */
  share_prompt_seen_at?: number | null;
  /** JSON array of workspace nav paths the user has opened at least once
   *  ("/app/guests", …). Null on pre-feature rows = nothing explored yet.
   *  Written by POST /api/auth/nav-visited, union-only. */
  visited_nav?: string | null;
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
    share_prompt_seen_at: row.share_prompt_seen_at ?? null,
    visited_nav: parseVisitedNav(row.visited_nav),
    created_at: row.created_at,
  };
}

/** A nav destination is stored as its own route path, so the rail can compare
 *  against `NavItem.to` with no extra mapping table. Anything that isn't an
 *  /app path is refused rather than stored — the column is user-writable and
 *  ends up in the DTO, so it stays a closed shape. */
const NAV_PATH_RE = /^\/app(\/[a-z0-9-]{1,32}){0,2}$/;
/** Hard ceiling on the stored set. The couple rail has ~15 destinations; the
 *  cap only exists so a scripted client can't grow the row without bound. */
const VISITED_NAV_MAX = 40;

/** Tolerant reader: a malformed / hand-edited value reads as "nothing visited"
 *  rather than throwing on a `/api/auth/me` that has nothing to do with it. */
export function parseVisitedNav(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && NAV_PATH_RE.test(p));
  } catch {
    return [];
  }
}

/** Union `path` into the user's visited set. Union-only and idempotent: two
 *  tabs landing on the same page, or a device replaying an old path, can only
 *  ever add. Returns false when the path is not a nav path we store. */
export function recordVisitedNav(userId: number, path: string): boolean {
  if (!NAV_PATH_RE.test(path)) return false;
  const row = getUserById(userId);
  if (!row) return false;
  const current = parseVisitedNav(row.visited_nav);
  if (current.includes(path)) return true;
  const next = [...current, path].slice(-VISITED_NAV_MAX);
  db.prepare("UPDATE users SET visited_nav = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(next),
    now(),
    userId,
  );
  return true;
}

/** Coerce a raw DB locale value into the shape the frontend expects. We
 *  persist the shipped UI locales (`UI_LOCALES`); anything else (legacy
 *  'en-GB', stray 'es-419') drops to null and the client then falls back to
 *  its own navigator detection. */
export function normaliseLocale(raw: string | null | undefined): UiLocale | null {
  return isUiLocale(raw) ? raw : null;
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

/** Directly set a user's account status. `suspended` is checked on every token
 *  verify so it takes effect immediately (the couple/vendor/planner loses
 *  access on their next request). Used by the admin management surfaces to
 *  suspend/reactivate vendors and planners without the flag grace window. */
export function setUserStatus(userId: number, status: "active" | "suspended"): void {
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), userId);
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
