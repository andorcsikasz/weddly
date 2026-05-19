// "Sign in / sign up with Google" — single POST that handles both cases.
// The frontend hands us a Google Identity Services `credential` (an ID-token
// JWT); we verify it server-side and then:
//
//   1. Match `users.google_sub` → existing Google-linked account, log in.
//   2. Else match by email AND `email_verified` on the existing row →
//      link this Google account to the existing user, log in.
//   3. Else create a new user (verified_email = 1 because Google attests it)
//      and log in. New registrations need the same `privacy_version` field
//      the password flow requires; existing-user logins don't.
//
// Password is never touched here. Google-only accounts keep the NOT NULL
// `password_hash` column happy with a random unguessable value so a stolen
// hash can't be cracked back into a usable password.

import { randomBytes } from "node:crypto";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { AuthSession } from "@shared/types";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { recordConsent } from "../domain/consents";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { CONFIG } from "../config";
import { verifyGoogleCredential } from "../lib/google_oauth";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";

interface GoogleAuthBody {
  credential?: unknown;
  /** Required for new registrations — matches the password-register contract.
   *  Ignored when the credential maps to an existing account. */
  privacy_version?: unknown;
  terms_version?: unknown;
}

async function handleGoogleAuth(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:google", AUTH_BUCKET);
  if (!CONFIG.googleClientId && !CONFIG.googleTestBypass) {
    throw new HttpError(503, "Google sign-in is not configured");
  }

  const body = await readJson<GoogleAuthBody>(ctx.req);
  const credential = body.credential;
  if (typeof credential !== "string" || credential.length === 0) {
    throw new HttpError(400, "Missing Google credential");
  }

  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (e) {
    ctx.log.warn("auth.google_verify_failed", { error: String(e) });
    throw new HttpError(401, "Google credential rejected");
  }
  // Google sometimes returns email_verified=false for legacy accounts. We
  // refuse the linking path in that case — otherwise anyone could claim
  // someone else's Weddly account by registering an unverified Google login
  // with their email.
  if (!identity.email_verified) {
    throw new HttpError(400, "Google account email is not verified");
  }

  // 1) Already linked? Just sign them in.
  const existingByGoogle = db
    .prepare("SELECT * FROM users WHERE google_sub = ?")
    .get(identity.sub) as UserRow | undefined;
  if (existingByGoogle) {
    if (existingByGoogle.status === "suspended") throw new HttpError(403, "Account suspended");
    return signInExisting(ctx, existingByGoogle, "auth.login_google");
  }

  // 2) Existing email-only account? Auto-link only when the email is verified
  //    on our side, otherwise an attacker could create a Weddly account with
  //    someone else's email and steal it the moment that someone signs in
  //    with Google.
  const existingByEmail = getUserByEmail(identity.email);
  if (existingByEmail) {
    if (existingByEmail.status === "suspended") throw new HttpError(403, "Account suspended");
    if (!existingByEmail.verified_email) {
      throw new HttpError(
        409,
        "An unverified Weddly account already uses this email. Reset its password first, then verify it before linking Google.",
      );
    }
    db.prepare("UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?").run(
      identity.sub,
      now(),
      existingByEmail.id,
    );
    addAuditLog({
      actor_user_id: existingByEmail.id,
      couple_id: null,
      action: "auth.google_linked",
      target_kind: "user",
      target_id: existingByEmail.id,
    });
    const fresh = getUserById(existingByEmail.id);
    if (!fresh) throw new HttpError(500, "User vanished after Google link");
    return signInExisting(ctx, fresh, "auth.login_google");
  }

  // 3) Brand-new user. GDPR Art. 7(1) — the same version checks the
  //    password register flow uses apply here too. Clicking the Google
  //    button is the affirmative act that accepts both documents per
  //    the "By continuing…" microcopy on the signup card.
  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date — please refresh the page");
  }

  const fullName = identity.name.length > 0 ? identity.name.slice(0, 200) : identity.email;
  // `password_hash` is NOT NULL on the schema. Generate a random unguessable
  // value — argon2id'd so a DB dump can't be cracked into a usable password.
  const placeholderPw = `${randomBytes(32).toString("hex")}${randomBytes(32).toString("hex")}`;
  const passwordHash = await hashPassword(placeholderPw);
  const ts = now();
  // password_set = 0 — Google-only account. Stops the password-reset side
  // door from working on accounts the legitimate user never put a password
  // on, see [[security_google_only_password_reset]].
  const result = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          google_sub, password_set, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, ?, 0, ?, ?)`,
    )
    .run(identity.email, passwordHash, fullName, identity.sub, ts, ts);
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
    action: "user.register_google",
    target_kind: "user",
    target_id: userId,
    after: { email: identity.email },
  });

  // No verify-email send: Google has already attested the address. The
  // dashboard's "verify your email" banner short-circuits when
  // verified_email = 1 so the user lands directly on onboarding.

  const token = issueSession(userId);
  // Re-read the freshly-inserted row instead of hand-reconstructing it — the
  // schema picks up additive columns (google_sub, password_set, last_seen_at)
  // without needing this literal to be kept in sync.
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(500, "User vanished after Google register");
  const session: AuthSession = { token, user: toUser(fresh) };
  return json(session, { status: 201 });
}

function signInExisting(ctx: Ctx, row: UserRow, auditAction: string): Response {
  const token = issueSession(row.id);
  addAuditLog({
    actor_user_id: row.id,
    couple_id: null,
    action: auditAction,
    target_kind: "user",
    target_id: row.id,
  });
  const session: AuthSession = { token, user: toUser(row) };
  ctx.log.info(auditAction, { user_id: row.id });
  return json(session);
}

export function registerAuthGoogleRoutes(router: Router) {
  router.post("/api/auth/google", handleGoogleAuth);
}
