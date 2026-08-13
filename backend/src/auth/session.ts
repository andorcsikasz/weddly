// Opaque session tokens: random 24-byte id + HMAC-SHA256 signature. No JWT.
// `users.status` is checked on every verify so suspensions take immediate effect.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { db, now } from "../db";

export const SESSION_COOKIE_NAME = "weddly_session";

interface SessionRow {
  id: string;
  user_id: number;
  created_at: number;
  expires_at: number;
  authenticated_at: number | null;
  auth_method: SessionAuthMethod | null;
  totp_counter: number | null;
}

export type SessionAuthMethod =
  | "password"
  | "google"
  | "apple"
  | "totp"
  | "email_link"
  | "activation"
  | "demo";

export interface SessionAuthentication {
  userId: number;
  authenticatedAt: number | null;
  method: SessionRow["auth_method"];
}

export interface SessionCredentials {
  token: string | null;
  source: "bearer" | "cookie" | null;
  mixed: boolean;
}

function sign(id: string): string {
  return createHmac("sha256", CONFIG.jwtSecret).update(id).digest("hex");
}

export function issueSession(userId: number, authMethod: SessionAuthMethod): string {
  const id = randomBytes(24).toString("hex");
  const created = now();
  const expires = created + CONFIG.sessionTtlMs;
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, authenticated_at, auth_method) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, created, expires, created, authMethod);
  // Signing in is an explicit user action. Subsequent presence is refreshed by
  // the UI interaction heartbeat, not by background authenticated requests.
  db.prepare("UPDATE users SET working_presence_at = ? WHERE id = ?").run(created, userId);
  return `${id}.${sign(id)}`;
}

function authenticatedRow(token: string): SessionRow | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return row;
}

export function verifySessionToken(token: string): number | null {
  const row = authenticatedRow(token);
  if (!row) return null;
  const u = db.prepare("SELECT status, last_seen_at FROM users WHERE id = ?").get(row.user_id) as
    | { status: string | null; last_seen_at: number | null }
    | undefined;
  if (!u || u.status === "suspended") return null;

  // Stamp `last_seen_at`, but throttle to one write per 5 minutes per user so
  // a chatty client doesn't pound the row on every API call. The admin
  // "Last active" column only needs minute-level resolution.
  const ts = now();
  if (!u.last_seen_at || ts - u.last_seen_at > 5 * 60 * 1000) {
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(ts, row.user_id);
  }

  // Sliding refresh: once the session is past its half-life, extend it to a
  // full TTL from now. Active users never see the SessionExpiredDialog; an
  // idle session still ages out at created_at + TTL. Throttled to once per
  // session per 5 minutes by piggybacking on the half-life check (the bump
  // moves the midpoint forward by TTL/2, so the next eligible write is at
  // least TTL/2 later — typically days).
  const halfLife = row.created_at + Math.floor(CONFIG.sessionTtlMs / 2);
  if (ts > halfLife) {
    const newExpires = ts + CONFIG.sessionTtlMs;
    db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?").run(
      ts,
      newExpires,
      row.id,
    );
  }

  return row.user_id;
}

/** Read the non-sliding primary-auth proof for the request's opaque session.
 *  Signature and expiry are rechecked so callers cannot manufacture a recent
 *  timestamp by pairing an authenticated ctx.userId with a different token. */
export function sessionAuthentication(token: string): SessionAuthentication | null {
  const row = authenticatedRow(token);
  if (!row) return null;
  return {
    userId: row.user_id,
    authenticatedAt: row.authenticated_at,
    method: row.auth_method,
  };
}

/** Elevate exactly the presented session after a second factor succeeds.
 * No new cookie/bearer is issued and no other device is touched. The WHERE
 * clause binds the proof to the already-authenticated principal. */
export function elevateSession(token: string, userId: number, totpCounter: number): boolean {
  const row = authenticatedRow(token);
  if (!row || row.user_id !== userId) return false;
  const elevate = db.transaction(() => {
    const principal = db
      .prepare(
        `UPDATE users SET admin_totp_counter = ?
          WHERE id = ? AND (admin_totp_counter IS NULL OR admin_totp_counter < ?)`,
      )
      .run(totpCounter, userId, totpCounter);
    if (principal.changes !== 1) return false;
    const result = db
      .prepare(
        `UPDATE sessions
            SET authenticated_at = ?, auth_method = 'totp', totp_counter = ?
          WHERE id = ? AND user_id = ?`,
      )
      .run(now(), totpCounter, row.id, userId);
    return result.changes === 1;
  });
  return elevate();
}

export function revokeSession(token: string): void {
  const dot = token.indexOf(".");
  if (dot < 0) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token.slice(0, dot));
}

/** Replace one authenticated session token without changing its user, expiry,
 * or assurance timestamps. Used only for the explicit legacy-browser bearer
 * migration: the script-readable token is revoked as the HttpOnly replacement
 * is issued, so copying it into a cookie cannot leave two replayable forms. */
export function rotateSessionToken(token: string): string | null {
  const row = authenticatedRow(token);
  if (!row) return null;
  const nextId = randomBytes(24).toString("hex");
  const rotate = db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO sessions
          (id, user_id, created_at, expires_at, authenticated_at, auth_method, totp_counter)
         SELECT ?, user_id, created_at, expires_at, authenticated_at, auth_method, totp_counter
           FROM sessions WHERE id = ?`,
      )
      .run(nextId, row.id);
    if (inserted.changes !== 1) return false;
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return true;
  });
  return rotate() ? `${nextId}.${sign(nextId)}` : null;
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function cookieToken(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=").trim() || null;
  }
  return null;
}

/** Resolve auth deterministically. The server rejects `mixed` before any
 * handler runs; callers outside the server receive null for an ambiguous pair
 * instead of silently preferring whichever credential appeared first. */
export function sessionCredentials(req: Request): SessionCredentials {
  const bearer = bearerToken(req);
  const cookie = cookieToken(req);
  if (bearer && cookie) return { token: null, source: null, mixed: true };
  if (bearer) return { token: bearer, source: "bearer", mixed: false };
  if (cookie) return { token: cookie, source: "cookie", mixed: false };
  return { token: null, source: null, mixed: false };
}

export function extractToken(req: Request): string | null {
  const credentials = sessionCredentials(req);
  return credentials.mixed ? null : credentials.token;
}

export function sessionCookie(token: string): string {
  const secure = CONFIG.frontendBaseUrl.startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(CONFIG.sessionTtlMs / 1000)}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = CONFIG.frontendBaseUrl.startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
