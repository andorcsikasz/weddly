// Email verification ("soft" — never blocks signup or login). The token is
// opaque (32 random bytes hex), single-use, 7-day TTL. handleConsume sets
// users.verified_email = 1; handleResend issues a fresh token for the
// current authenticated user.

import { hashToken, mintToken } from "../auth/tokens";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "../domain/emails";
import { getUserByEmail, getUserById, type UserRow } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

export const VERIFY_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const RESEND_BUCKET = { capacity: 5, refillRate: 1 / 60 }; // 5/min/IP, refills 1/min
const CONSUME_BUCKET = { capacity: 10, refillRate: 1 / 30 };

interface VerifyTokenRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

/** Generate + persist a fresh verification token. Used by register + resend. */
export function createVerificationToken(userId: number): string {
  // Return the plaintext token (for the emailed link) but persist only its hash
  // so a DB/backup read can't replay it. See auth/tokens.ts.
  const token = mintToken();
  const ts = now();
  db.prepare(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(userId, hashToken(token), ts + VERIFY_TTL_MS, ts);
  return token;
}

/** Mint a fresh token, audit it, and email the verification link. Shared by
 *  the register flow, the authenticated resend, the unauthenticated (locked-out)
 *  resend, and the login gate. Fire-and-forget send — callers never block on
 *  the mailer. No-op when the user is already verified. */
export function sendVerificationLink(
  user: Pick<UserRow, "id" | "email" | "full_name" | "verified_email">,
  kind: "welcome_verify" | "verify_resend" = "verify_resend",
): void {
  if (user.verified_email) return;
  const token = createVerificationToken(user.id);
  addAuditLog({
    actor_user_id: user.id,
    couple_id: null,
    action: "auth.verify_email_resend",
    target_kind: "user",
    target_id: user.id,
  });
  const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${token}`;
  void sendKind(
    kind,
    { verifyUrl },
    { user: { id: user.id, email: user.email, full_name: user.full_name } },
  );
}

async function handleResend(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:verify_resend", RESEND_BUCKET);
  const userId = requireAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(404, "User not found");
  if (user.verified_email) return json({ ok: true, already_verified: true });

  sendVerificationLink(user, "verify_resend");
  return json({ ok: true });
}

/** Unauthenticated resend keyed by email. Needed because the login gate blocks
 *  unverified users *before* they hold a session, so the authed `handleResend`
 *  is unreachable for exactly the cohort that needs a fresh link. Always returns
 *  200 with no signal about whether the address exists or is already verified —
 *  closes the account-enumeration oracle. Rate-limited per IP like the authed
 *  variant. */
async function handleResendPublic(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:verify_resend", RESEND_BUCKET);
  const body = await readJson<{ email?: unknown }>(ctx.req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.includes("@") && !email.startsWith("@")) {
    const user = getUserByEmail(email);
    if (user && !user.verified_email && user.status !== "suspended") {
      sendVerificationLink(user, "verify_resend");
    }
  }
  return json({ ok: true });
}

async function handleConsume(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:verify_consume", CONSUME_BUCKET);
  const tokenRaw = ctx.params.token;
  if (typeof tokenRaw !== "string" || tokenRaw.length < 16) {
    throw new HttpError(400, "Invalid token");
  }

  const row = db
    .prepare("SELECT * FROM email_verification_tokens WHERE token = ?")
    .get(hashToken(tokenRaw)) as VerifyTokenRow | undefined;
  if (!row) throw new HttpError(400, "Invalid or expired token");
  if (row.consumed_at) throw new HttpError(400, "Invalid or expired token");
  const ts = now();
  if (row.expires_at < ts) throw new HttpError(400, "Invalid or expired token");

  db.prepare("UPDATE users SET verified_email = 1, updated_at = ? WHERE id = ?").run(
    ts,
    row.user_id,
  );
  db.prepare("UPDATE email_verification_tokens SET consumed_at = ? WHERE id = ?").run(ts, row.id);

  addAuditLog({
    actor_user_id: row.user_id,
    couple_id: null,
    action: "auth.verify_email_complete",
    target_kind: "user",
    target_id: row.user_id,
  });

  return json({ ok: true });
}

export function registerEmailVerifyRoutes(router: Router) {
  router.post("/api/auth/verify/request", handleResend, true);
  router.post("/api/auth/verify/request-public", handleResendPublic);
  router.post("/api/auth/verify/:token", handleConsume);
}
