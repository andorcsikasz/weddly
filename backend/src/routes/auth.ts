// Register / login / logout / me. Issues opaque session tokens.

import type { AuthSession } from "@shared/types";
import { hashPassword, verifyPassword } from "../auth/password";
import { extractToken, issueSession, revokeSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { bilingualBody, sendEmail } from "../lib/mailer";
import { reportError } from "../lib/observability";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../lib/users";
import { createVerificationToken } from "./email_verify";

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  full_name?: unknown;
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
  const { html, text } = bilingualBody({
    hu: {
      greeting: `Szia ${fullName}!`,
      body: "Üdv a Weddly-n! Erősítsd meg az e-mail címed, hogy később vissza tudd állítani a jelszót, ha kell. A link 7 napig érvényes.",
      cta: "E-mail cím megerősítése",
    },
    en: {
      greeting: `Hi ${fullName},`,
      body: "Welcome to Weddly! Confirm your email so you can recover the account later if you forget your password. The link is valid for seven days.",
      cta: "Confirm your email",
    },
    ctaUrl: verifyUrl,
  });
  sendEmail({
    to: email,
    subject: "Weddly — üdv / welcome",
    html,
    text,
  }).catch((e) => reportError("mailer.send_failed", e, { template: "welcome", to: email }));

  const token = issueSession(userId);
  const userRow = getUserById(userId);
  if (!userRow) throw new HttpError(500, "User vanished after insert");
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
  router.get("/api/auth/me", handleMe, true);
}
