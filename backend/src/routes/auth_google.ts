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
import { sendKind } from "../domain/emails";
import { alertOnNewDevice } from "../domain/known_devices";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { AUTH_BUCKET, rateLimit } from "../lib/rate_limit";
import { CONFIG } from "../config";
import { verifyGoogleCredential } from "../lib/google_oauth";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { buildSignupAcquisition } from "../domain/signup_meta";

interface GoogleAuthBody {
  credential?: unknown;
  /** Required for new registrations — matches the password-register contract.
   *  Ignored when the credential maps to an existing account. */
  privacy_version?: unknown;
  terms_version?: unknown;
  /** UI locale to persist on the new users row — same contract as
   *  /api/auth/register. Only 'hu' | 'en' are kept; the column is
   *  nullable so the existing-account branch never touches it. */
  locale?: unknown;
  /** Acquisition UTM params — same contract as /api/auth/register. Applied
   *  only on the new-registration branch. (UtmInput shape.) */
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
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

  // Normalise locale once — used both to backfill null-locale existing users
  // and to persist locale on brand-new registrations.
  const clientLocale = body.locale === "hu" || body.locale === "en" ? body.locale : null;

  // 1) Already linked? Just sign them in.
  const existingByGoogle = db
    .prepare("SELECT * FROM users WHERE google_sub = ?")
    .get(identity.sub) as UserRow | undefined;
  if (existingByGoogle) {
    if (existingByGoogle.status === "suspended") throw new HttpError(403, "Account suspended");
    // Backfill locale for pre-feature users whose column is NULL so that
    // the frontend's auth effect can apply the server preference on the
    // next /api/auth/me call instead of falling back to English.
    let rowToSign: UserRow = existingByGoogle;
    if (!existingByGoogle.locale && clientLocale) {
      db.prepare("UPDATE users SET locale = ?, updated_at = ? WHERE id = ?").run(
        clientLocale,
        now(),
        existingByGoogle.id,
      );
      rowToSign = { ...existingByGoogle, locale: clientLocale };
    }
    return signInExisting(ctx, rowToSign, "auth.login_google");
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
    let freshToSign: UserRow = fresh;
    if (!fresh.locale && clientLocale) {
      db.prepare("UPDATE users SET locale = ?, updated_at = ? WHERE id = ?").run(
        clientLocale,
        now(),
        fresh.id,
      );
      freshToSign = { ...fresh, locale: clientLocale };
    }
    return signInExisting(ctx, freshToSign, "auth.login_google");
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
  const persistedLocale = clientLocale;
  const acq = buildSignupAcquisition(ctx, body);
  const result = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          google_sub, password_set, locale,
          signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      identity.email,
      passwordHash,
      fullName,
      identity.sub,
      persistedLocale,
      acq.signup_country,
      acq.device_type,
      acq.utm_source,
      acq.utm_medium,
      acq.utm_campaign,
      acq.utm_content,
      acq.utm_term,
      ts,
      ts,
    );
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
  //
  // A welcome mail still goes out, and for this path it's the ONLY one: a
  // Google signup skips welcome_verify entirely, so until this send existed a
  // Google-registered couple had an empty inbox and an empty email history.
  void sendKind(
    "welcome_account",
    { dashboardUrl: `${CONFIG.frontendBaseUrl}/app`, via: "google" },
    { user: { id: userId, email: identity.email, full_name: fullName } },
  );

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

  // Same device-alert path as password login. Google's own "new sign-in"
  // mails cover the Google account side; this one covers Weddly specifically
  // so the user has full visibility regardless of provider.
  alertOnNewDevice(ctx, row);

  const session: AuthSession = { token, user: toUser(row) };
  ctx.log.info(auditAction, { user_id: row.id });
  return json(session);
}

export function registerAuthGoogleRoutes(router: Router) {
  router.post("/api/auth/google", handleGoogleAuth);
}
