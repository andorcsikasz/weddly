// "Sign in / sign up with Apple" — single POST that handles both cases.
// The frontend runs Sign in with Apple JS and hands us the `credential`
// (the authorization `id_token` JWT); we verify it server-side and then:
//
//   1. Match `users.apple_sub` → existing Apple-linked account, log in.
//   2. Else match by email AND `email_verified` on the existing row →
//      link this Apple account to the existing user, log in.
//   3. Else create a new user (verified_email = 1 because Apple attests it)
//      and log in. New registrations need the same `privacy_version` field
//      the password flow requires; existing-user logins don't.
//
// Apple, unlike Google, does NOT put the display name in the id_token — it
// only hands the name to the JS client on the FIRST authorization. We accept
// it here as an optional `full_name` field used purely for display on the
// brand-new branch (never trusted for identity, never overwrites an existing
// row). When absent we fall back to the email, same as Google's empty-name
// path. Apple may also hand us a private-relay email — that's a real,
// deliverable address Apple forwards, so we treat it exactly like any other.
//
// Password is never touched here. Apple-only accounts keep the NOT NULL
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
import { verifyAppleCredential } from "../lib/apple_oauth";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { buildSignupAcquisition } from "../domain/signup_meta";

interface AppleAuthBody {
  credential?: unknown;
  /** Display name from Apple's first-authorization JS `user` object. Apple
   *  never repeats it, so the client sends it through on signup; we use it for
   *  display only and only on the brand-new branch. */
  full_name?: unknown;
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

async function handleAppleAuth(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:apple", AUTH_BUCKET);
  if (!CONFIG.appleClientId && !CONFIG.appleTestBypass) {
    throw new HttpError(503, "Apple sign-in is not configured");
  }

  const body = await readJson<AppleAuthBody>(ctx.req);
  const credential = body.credential;
  if (typeof credential !== "string" || credential.length === 0) {
    throw new HttpError(400, "Missing Apple credential");
  }

  let identity;
  try {
    identity = await verifyAppleCredential(credential);
  } catch (e) {
    ctx.log.warn("auth.apple_verify_failed", { error: String(e) });
    throw new HttpError(401, "Apple credential rejected");
  }
  // Apple normally attests the email, but refuse the linking/creation paths
  // when it doesn't — otherwise anyone could claim someone else's Weddly
  // account by registering an unverified Apple login with their email.
  if (!identity.email_verified) {
    throw new HttpError(400, "Apple account email is not verified");
  }

  // 1) Already linked? Just sign them in.
  const existingByApple = db.prepare("SELECT * FROM users WHERE apple_sub = ?").get(identity.sub) as
    | UserRow
    | undefined;
  if (existingByApple) {
    if (existingByApple.status === "suspended") throw new HttpError(403, "Account suspended");
    return signInExisting(ctx, existingByApple, "auth.login_apple");
  }

  // 2) Existing email-only account? Auto-link only when the email is verified
  //    on our side, otherwise an attacker could create a Weddly account with
  //    someone else's email and steal it the moment that someone signs in
  //    with Apple.
  const existingByEmail = getUserByEmail(identity.email);
  if (existingByEmail) {
    if (existingByEmail.status === "suspended") throw new HttpError(403, "Account suspended");
    if (!existingByEmail.verified_email) {
      throw new HttpError(
        409,
        "An unverified Weddly account already uses this email. Reset its password first, then verify it before linking Apple.",
      );
    }
    db.prepare("UPDATE users SET apple_sub = ?, updated_at = ? WHERE id = ?").run(
      identity.sub,
      now(),
      existingByEmail.id,
    );
    addAuditLog({
      actor_user_id: existingByEmail.id,
      couple_id: null,
      action: "auth.apple_linked",
      target_kind: "user",
      target_id: existingByEmail.id,
    });
    const fresh = getUserById(existingByEmail.id);
    if (!fresh) throw new HttpError(500, "User vanished after Apple link");
    return signInExisting(ctx, fresh, "auth.login_apple");
  }

  // 3) Brand-new user. GDPR Art. 7(1) — the same version checks the
  //    password register flow uses apply here too. Clicking the Apple
  //    button is the affirmative act that accepts both documents per
  //    the "By continuing…" microcopy on the signup card.
  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.terms_version !== TERMS_VERSION) {
    throw new HttpError(400, "Terms version is out of date — please refresh the page");
  }

  // Apple doesn't put the name in the token; the client forwards what Apple
  // handed it on first auth. Display-only, never trusted for identity.
  const claimedName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const fullName = claimedName.length > 0 ? claimedName.slice(0, 200) : identity.email;
  // `password_hash` is NOT NULL on the schema. Generate a random unguessable
  // value — argon2id'd so a DB dump can't be cracked into a usable password.
  const placeholderPw = `${randomBytes(32).toString("hex")}${randomBytes(32).toString("hex")}`;
  const passwordHash = await hashPassword(placeholderPw);
  const ts = now();
  // password_set = 0 — Apple-only account. Stops the password-reset side door
  // from working on accounts the legitimate user never put a password on, same
  // as the Google-only path, see [[security_google_only_password_reset]].
  const persistedLocale = body.locale === "hu" || body.locale === "en" ? body.locale : null;
  const acq = buildSignupAcquisition(ctx, body);
  const result = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          apple_sub, password_set, locale,
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
    action: "user.register_apple",
    target_kind: "user",
    target_id: userId,
    after: { email: identity.email },
  });

  // No verify-email send: Apple has already attested the address. The
  // dashboard's "verify your email" banner short-circuits when
  // verified_email = 1 so the user lands directly on onboarding.
  //
  // A welcome mail still goes out, and for this path it's the ONLY one: an
  // Apple signup skips welcome_verify entirely. Note Private Relay addresses
  // land here too, and they forward fine.
  void sendKind(
    "welcome_account",
    { dashboardUrl: `${CONFIG.frontendBaseUrl}/app`, via: "apple" },
    { user: { id: userId, email: identity.email, full_name: fullName } },
  );

  const token = issueSession(userId, "apple");
  // Re-read the freshly-inserted row instead of hand-reconstructing it — the
  // schema picks up additive columns (apple_sub, password_set, last_seen_at)
  // without needing this literal to be kept in sync.
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(500, "User vanished after Apple register");
  const session: AuthSession = { token, user: toUser(fresh) };
  return json(session, { status: 201 });
}

function signInExisting(ctx: Ctx, row: UserRow, auditAction: string): Response {
  const token = issueSession(row.id, "apple");
  addAuditLog({
    actor_user_id: row.id,
    couple_id: null,
    action: auditAction,
    target_kind: "user",
    target_id: row.id,
  });

  // Same device-alert path as password login. Apple's own "new sign-in" mails
  // cover the Apple account side; this one covers Weddly specifically so the
  // user has full visibility regardless of provider.
  alertOnNewDevice(ctx, row);

  const session: AuthSession = { token, user: toUser(row) };
  ctx.log.info(auditAction, { user_id: row.id });
  return json(session);
}

export function registerAuthAppleRoutes(router: Router) {
  router.post("/api/auth/apple", handleAppleAuth);
}
