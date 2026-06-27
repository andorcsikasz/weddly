// Forgot password / reset password. Token is opaque (32 random bytes hex),
// single-use, 1h TTL. /forgot always returns 200 to avoid leaking which emails
// are registered. Both endpoints are heavily rate-limited.

import { hashPassword } from "../auth/password";
import { hashToken, mintToken } from "../auth/tokens";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "../domain/emails";
import { getUserByEmail, getUserById } from "../domain/users";
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
  // Google-only accounts never set a password, so a password-recovery email
  // would be a stealthy take-over channel: an attacker who knows the email
  // could install a password without the legitimate user expecting that
  // surface to exist on their Google-bound account. Silently skip the issue
  // — still return 200 so the route doesn't leak which accounts are
  // Google-only vs password-only. See [[security_google_only_password_reset]].
  if (user.password_set === 0) {
    addAuditLog({
      actor_user_id: user.id,
      couple_id: null,
      action: "auth.password_reset_request_skipped_google_only",
      target_kind: "user",
      target_id: user.id,
    });
    return json({ ok: true });
  }

  // Invalidate any prior unconsumed reset tokens for this user so only the
  // latest link is live (narrows the redemption window, mirrors email_change).
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL").run(
    user.id,
  );

  // The plaintext token goes in the emailed link; only its hash is persisted,
  // so a DB/backup read can't replay it. See auth/tokens.ts.
  const token = mintToken();
  const ts = now();
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(user.id, hashToken(token), ts + RESET_TTL_MS, ts);

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

  const row = db
    .prepare("SELECT * FROM password_reset_tokens WHERE token = ?")
    .get(hashToken(body.token)) as TokenRow | undefined;
  if (!row) throw new HttpError(400, "Invalid or expired token");
  if (row.consumed_at) throw new HttpError(400, "Invalid or expired token");
  const ts = now();
  if (row.expires_at < ts) throw new HttpError(400, "Invalid or expired token");

  // Defence in depth: if somehow a token exists for a Google-only account
  // (legacy row, manual DB insert, race against a future "promote to
  // password" flow), refuse the reset and return the same opaque error.
  // See [[security_google_only_password_reset]].
  // Suspended-account gate: a token issued BEFORE the account was suspended
  // would otherwise still complete a reset, bypassing the suspension that login
  // + session-verify enforce (handleForgot already refuses to issue NEW tokens
  // to suspended users — this closes the pre-existing-token hole). Same opaque
  // error so suspension state isn't leaked. Mirrors email_change handleConfirm.
  const target = getUserById(row.user_id);
  if (!target || target.password_set === 0 || target.status === "suspended") {
    throw new HttpError(400, "Invalid or expired token");
  }

  const newHash = await hashPassword(body.password);
  // Flip password_set so any future "this account has a password" check (and the
  // reset/login paths that gate on it) stays consistent after a reset.
  db.prepare(
    "UPDATE users SET password_hash = ?, password_set = 1, updated_at = ? WHERE id = ?",
  ).run(newHash, ts, row.user_id);
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

  // Security confirmation to the inbox-of-record. If the user didn't trigger
  // the reset, the email gives them an immediate path back via /forgot-password.
  const user = getUserById(row.user_id);
  if (user && !user.email.endsWith("@purged.local")) {
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
      { user: { id: user.id, email: user.email, full_name: user.full_name } },
    );
  }

  return json({ ok: true });
}

export function registerPasswordResetRoutes(router: Router) {
  router.post("/api/auth/forgot", handleForgot);
  router.post("/api/auth/reset", handleReset);
}
