// Change-email flow: logged-in user enters a new address + their current
// password; we mail a confirm link to the new inbox and a warning to the
// old one. Only when the new inbox clicks through does users.email flip.
// Single-use tokens, 1h TTL.

import { randomBytes } from "node:crypto";
import { verifyPassword } from "../auth/password";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "../domain/emails";
import { getUserByEmail, getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";

const CHANGE_TTL_MS = 1000 * 60 * 60; // 1 hour

interface ChangeRequestBody {
  new_email?: unknown;
  current_password?: unknown;
}

interface ChangeTokenRow {
  id: number;
  user_id: number;
  new_email: string;
  token: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Email is required");
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || !trimmed.includes("@") || trimmed.startsWith("@")) {
    throw new HttpError(400, "Email looks invalid");
  }
  return trimmed;
}

async function handleRequest(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:change_email", AUTH_BUCKET);
  const userId = requireAuth(ctx);
  const body = await readJson<ChangeRequestBody>(ctx.req);
  const newEmail = parseEmail(body.new_email);
  if (typeof body.current_password !== "string" || body.current_password.length < 8) {
    throw new HttpError(400, "Current password is required");
  }

  const user = getUserById(userId);
  if (!user) throw new HttpError(404, "User not found");
  if (user.email === newEmail) throw new HttpError(400, "New email is the same as current");

  const ok = await verifyPassword(body.current_password, user.password_hash);
  if (!ok) throw new HttpError(401, "Current password is incorrect");

  // Refuse if the address is already in use by another active account.
  // Suspended/purged users keep their (scrubbed) email so we don't block on those.
  const clash = getUserByEmail(newEmail);
  if (clash && clash.id !== userId && clash.status !== "suspended") {
    throw new HttpError(409, "Email already registered");
  }

  // Drop any prior pending change for this user — only the latest token is valid.
  db.prepare("DELETE FROM email_change_tokens WHERE user_id = ? AND consumed_at IS NULL").run(
    userId,
  );

  const token = randomBytes(32).toString("hex");
  const ts = now();
  db.prepare(
    `INSERT INTO email_change_tokens (user_id, new_email, token, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(userId, newEmail, token, ts + CHANGE_TTL_MS, ts);

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "auth.email_change_request",
    target_kind: "user",
    target_id: userId,
    after: { new_email: newEmail },
  });

  const confirmUrl = `${CONFIG.frontendBaseUrl}/change-email/${token}`;
  const forgotUrl = `${CONFIG.frontendBaseUrl}/forgot-password`;

  // To the NEW inbox: confirm link.
  void sendKind(
    "email_change_verify",
    { confirmUrl, oldEmail: user.email },
    {
      user: null,
      guest: { email: newEmail, full_name: user.full_name },
      couple_id: user.couple_id ?? null,
    },
  );
  // To the OLD inbox: heads-up + reset-password escape hatch.
  void sendKind(
    "email_change_warning",
    { newEmail, forgotUrl },
    { user: { id: user.id, email: user.email, full_name: user.full_name } },
  );

  return json({ ok: true });
}

async function handleConfirm(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:change_email_confirm", AUTH_BUCKET);
  const tokenRaw = ctx.params.token;
  if (typeof tokenRaw !== "string" || tokenRaw.length < 16) {
    throw new HttpError(400, "Invalid token");
  }

  const row = db.prepare("SELECT * FROM email_change_tokens WHERE token = ?").get(tokenRaw) as
    | ChangeTokenRow
    | undefined;
  if (!row) throw new HttpError(400, "Invalid or expired token");
  if (row.consumed_at) throw new HttpError(400, "Invalid or expired token");
  const ts = now();
  if (row.expires_at < ts) throw new HttpError(400, "Invalid or expired token");

  // Final clash check — another user could have registered the same email in
  // the window between request and confirm.
  const clash = getUserByEmail(row.new_email);
  if (clash && clash.id !== row.user_id && clash.status !== "suspended") {
    throw new HttpError(409, "Email already registered");
  }

  db.prepare("UPDATE users SET email = ?, verified_email = 1, updated_at = ? WHERE id = ?").run(
    row.new_email,
    ts,
    row.user_id,
  );
  db.prepare("UPDATE email_change_tokens SET consumed_at = ? WHERE id = ?").run(ts, row.id);
  // Force re-auth everywhere — the address that owns the account just changed.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);

  addAuditLog({
    actor_user_id: row.user_id,
    couple_id: null,
    action: "auth.email_change_complete",
    target_kind: "user",
    target_id: row.user_id,
    after: { new_email: row.new_email },
  });

  return json({ ok: true, email: row.new_email });
}

export function registerEmailChangeRoutes(router: Router) {
  router.post("/api/auth/change-email-request", handleRequest, true);
  router.post("/api/auth/change-email/:token", handleConfirm);
}
