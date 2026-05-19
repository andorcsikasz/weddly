// Register / login / logout / me. Issues opaque session tokens.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { AuthSession } from "@shared/types";
import { hashPassword, verifyPassword } from "../auth/password";
import { extractToken, issueSession, revokeSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { recordConsent } from "../domain/consents";
import { sendKind } from "../domain/emails";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { createVerificationToken } from "./email_verify";

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  full_name?: unknown;
  /** Required version stamps for the two documents the user accepts by
   *  clicking Register (clickwrap-style: the "By continuing…" microcopy
   *  beneath the button names both Privacy and Terms). Refusing stale
   *  clients keeps the ledger honest about what they actually saw. */
  privacy_version?: unknown;
  terms_version?: unknown;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Email is required");
  const trimmed = raw.trim().toLowerCase();
  // Loose check: at least an "@" with non-empty halves. We don't validate
  // deliverability here — production gets verify-email later.
  if (trimmed.length < 3 || !trimmed.includes("@") || trimmed.startsWith("@")) {
    throw new HttpError(400, "Email looks invalid");
  }
  return trimmed;
}

function parsePassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  if (raw.length > 1024) throw new HttpError(400, "Password too long");
  return raw;
}

function parseFullName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Name is required");
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 200) throw new HttpError(400, "Name looks invalid");
  return trimmed;
}

async function handleRegister(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:register", AUTH_BUCKET);
  const body = await readJson<RegisterBody>(ctx.req);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  const fullName = parseFullName(body.full_name);
  // GDPR Art. 7(1) — refuse the request if the client didn't pass the
  // current policy versions. The frontend bakes both constants into the
  // payload; an old cached SPA hitting a server with a bumped policy
  // forces a hard refresh rather than silently logging a stale consent.
  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date — please refresh the page");
  }

  if (getUserByEmail(email)) throw new HttpError(409, "Email already registered");

  const passwordHash = await hashPassword(password);
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, ?, ?)`,
    )
    .run(email, passwordHash, fullName, ts, ts);
  const userId = Number(result.lastInsertRowid);

  const ip = ctx.clientIp;
  const userAgent = ctx.req.headers.get("user-agent");
  recordConsent({
    subjectUserId: userId,
    subjectKind: "user",
    subjectRef: null,
    document: "privacy",
    version: PRIVACY_VERSION,
    ip,
    userAgent,
  });
  recordConsent({
    subjectUserId: userId,
    subjectKind: "user",
    subjectRef: null,
    document: "terms",
    version: TERMS_VERSION,
    ip,
    userAgent,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "user.register",
    target_kind: "user",
    target_id: userId,
    after: { email },
  });

  // Welcome + verification — single email, both purposes. Soft verification:
  // we never block signup or login on this; the dashboard banner nags until
  // they click. Fire-and-forget so a mailer outage doesn't fail registration.
  const verifyToken = createVerificationToken(userId);
  const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${verifyToken}`;
  void sendKind(
    "welcome_verify",
    { verifyUrl },
    { user: { id: userId, email, full_name: fullName } },
  );

  const token = issueSession(userId);
  // Skip the re-SELECT — every field is in scope from the INSERT above. The
  // hard-coded values mirror the DEFAULTs in the INSERT statement.
  const userRow: UserRow = {
    id: userId,
    email,
    password_hash: passwordHash,
    full_name: fullName,
    status: "active",
    role: "owner",
    couple_id: null,
    verified_email: 0,
    created_at: ts,
    updated_at: ts,
    last_seen_at: null,
  };
  const session: AuthSession = { token, user: toUser(userRow) };
  return json(session, { status: 201 });
}

async function handleLogin(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:login", AUTH_BUCKET);
  const body = await readJson<LoginBody>(ctx.req);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);

  const row = getUserByEmail(email) as UserRow | null;
  if (!row) throw new HttpError(401, "Invalid credentials");
  if (row.status === "suspended") throw new HttpError(403, "Account suspended");

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new HttpError(401, "Invalid credentials");

  const token = issueSession(row.id);
  const session: AuthSession = { token, user: toUser(row) };
  return json(session);
}

function handleLogout(ctx: Ctx): Response {
  requireAuth(ctx);
  const token = extractToken(ctx.req);
  if (token) revokeSession(token);
  return json({ ok: true });
}

interface ChangePasswordBody {
  current_password?: unknown;
  new_password?: unknown;
}

async function handleChangePassword(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:change_password", AUTH_BUCKET);
  const userId = requireAuth(ctx);
  const body = await readJson<ChangePasswordBody>(ctx.req);
  const current = parsePassword(body.current_password);
  const next = parsePassword(body.new_password);
  if (current === next) throw new HttpError(400, "New password must differ from current");

  const row = getUserById(userId);
  if (!row) throw new HttpError(404, "User not found");
  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) throw new HttpError(401, "Current password is incorrect");

  const ts = now();
  const newHash = await hashPassword(next);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    newHash,
    ts,
    userId,
  );
  // Revoke every active session — including this one — so the change forces
  // re-auth everywhere. We immediately reissue a fresh token for the caller
  // below so the device that made the change stays logged in.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "auth.password_change",
    target_kind: "user",
    target_id: userId,
  });

  const changedAt = new Date(ts).toLocaleString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const forgotUrl = `${CONFIG.frontendBaseUrl}/forgot-password`;
  void sendKind(
    "password_changed",
    { forgotUrl, changedAt },
    { user: { id: row.id, email: row.email, full_name: row.full_name } },
  );

  const token = issueSession(userId);
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(500, "User vanished after password change");
  const session: AuthSession = { token, user: toUser(fresh) };
  return json(session);
}

function handleMe(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const row = getUserById(userId);
  if (!row) throw new HttpError(404, "User not found");
  return json({ user: toUser(row) });
}

export function registerAuthRoutes(router: Router) {
  router.post("/api/auth/register", handleRegister);
  router.post("/api/auth/login", handleLogin);
  router.post("/api/auth/logout", handleLogout, true);
  router.post("/api/auth/change-password", handleChangePassword, true);
  router.get("/api/auth/me", handleMe, true);
}
