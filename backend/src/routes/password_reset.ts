// Forgot password / reset password. Token is opaque (32 random bytes hex),
// single-use, 1h TTL. /forgot always returns 200 to avoid leaking which emails
// are registered. Both endpoints are heavily rate-limited.

import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth/password";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "../domain/emails";
import { getUserByEmail } from "../domain/users";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour
const FORGOT_BUCKET = { capacity: 5, refillRate: 1 / 60 }; // 5/min/IP, refills 1/min
const RESET_BUCKET = { capacity: 5, refillRate: 1 / 30 };

interface ForgotBody {
  email?: unknown;
}

async function handleForgot(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:forgot", FORGOT_BUCKET);
  const body = await readJson<ForgotBody>(ctx.req);
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // Always 200 — never tell the caller whether the email exists.
  if (!emailRaw || !emailRaw.includes("@")) return json({ ok: true });

  const user = getUserByEmail(emailRaw);
  if (!user || user.status === "suspended") return json({ ok: true });

  const token = randomBytes(32).toString("hex");
  const ts = now();
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(user.id, token, ts + RESET_TTL_MS, ts);

  addAuditLog({
    actor_user_id: user.id,
    couple_id: null,
    action: "auth.password_reset_request",
    target_kind: "user",
    target_id: user.id,
  });

  const resetUrl = `${CONFIG.frontendBaseUrl}/reset-password/${token}`;
  // Fire and forget — don't block on email failures (still 200 to caller).
  void sendKind(
    "password_reset",
    { resetUrl },
    { user: { id: user.id, email: user.email, full_name: user.full_name } },
  );

  return json({ ok: true });
}

interface ResetBody {
  token?: unknown;
  password?: unknown;
}

interface TokenRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

async function handleReset(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:reset", RESET_BUCKET);
  const body = await readJson<ResetBody>(ctx.req);
  if (typeof body.token !== "string" || body.token.length < 16) {
    throw new HttpError(400, "Invalid token");
  }
  if (
    typeof body.password !== "string" ||
    body.password.length < 8 ||
    body.password.length > 1024
  ) {
    throw new HttpError(400, "Password must be 8–1024 characters");
  }

  const row = db.prepare("SELECT * FROM password_reset_tokens WHERE token = ?").get(body.token) as
    | TokenRow
    | undefined;
  if (!row) throw new HttpError(400, "Invalid or expired token");
  if (row.consumed_at) throw new HttpError(400, "Invalid or expired token");
  const ts = now();
  if (row.expires_at < ts) throw new HttpError(400, "Invalid or expired token");

  const newHash = await hashPassword(body.password);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    newHash,
    ts,
    row.user_id,
  );
  db.prepare("UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?").run(ts, row.id);
  // Revoke all active sessions for this user — force re-login everywhere.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);

  addAuditLog({
    actor_user_id: row.user_id,
    couple_id: null,
    action: "auth.password_reset_complete",
    target_kind: "user",
    target_id: row.user_id,
  });

  return json({ ok: true });
}

export function registerPasswordResetRoutes(router: Router) {
  router.post("/api/auth/forgot", handleForgot);
  router.post("/api/auth/reset", handleReset);
}
