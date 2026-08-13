// Register / login / logout / me. Issues opaque session tokens.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { isUiLocale, UI_LOCALES } from "@shared/locales";
import { checkRealName } from "@shared/real_names";
import type { AuthSession } from "@shared/types";
import { burnPasswordVerify, hashPassword, verifyPassword } from "../auth/password";
import { extractToken, issueSession, revokeSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "../domain/emails";
import { recordGrowthEvent } from "../domain/growth_events";
import { createPendingSignup } from "../domain/pending_signups";
import { buildSignupAcquisition } from "../domain/signup_meta";
import { alertOnNewDevice } from "../domain/known_devices";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import {
  AUTH_BUCKET,
  assertLoginNotLocked,
  clearLoginFailures,
  rateLimit,
  recordLoginFailure,
} from "../lib/rate_limit";
import {
  getUserByEmail,
  getUserById,
  recordVisitedNav,
  toUser,
  type UserRow,
} from "../domain/users";
import { sendVerificationLink } from "./email_verify";

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
  /** UI locale the client is currently rendering in. Stored on `users.locale`
   *  so the user's preference survives across devices. Only 'hu' | 'en' are
   *  persisted; anything else (or omitted) leaves the column null and the
   *  client falls back to its own navigator.language detection. */
  locale?: unknown;
  /** Funnel attribution source — `rsvp` | `site` | `share`. The frontend
   *  extracts this from `?ref=<source>` on a public page and threads it
   *  here. Anything else is dropped at the boundary; the growth_events
   *  row gets a null source rather than user-controlled junk. */
  referrer?: unknown;
  /** Marketing campaign params the frontend read off the landing URL. Coerced
   *  + length-capped in buildSignupAcquisition; stored on users.utm_* for the
   *  admin Acquisition dashboard. (UtmInput shape.) */
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
  /** Planner email-invitation token from `?planner_invite=…` on the signup
   *  link. Re-binds the pending invitation to whatever email they register
   *  with so the onboarding hook still links them to the inviting planner. */
  planner_invite?: unknown;
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
  // Registration is the cheapest door in the product: an address and a name.
  // Refusing "Test" / "asdf" / a single letter here is what keeps the name on
  // an account meaning something later, when it appears on a review, an
  // inquiry a vendor reads, or the couple's own public page.
  const verdict = checkRealName(trimmed);
  if (verdict) {
    throw new HttpError(400, "Name does not look like a real name", {
      code: "placeholder_name",
      field: "full_name",
      reason: verdict.reason,
    });
  }
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

  // A real, verified account owns its address — that's a genuine conflict.
  // A merely-pending signup does NOT: createPendingSignup overwrites it, so an
  // abandoned or typo'd attempt can't squat an address it never proved.
  if (getUserByEmail(email)) throw new HttpError(409, "Email already registered");

  const passwordHash = await hashPassword(password);
  // Coerce locale at the boundary — only persist values the frontend +
  // backend i18n actually understand. Anything else stays null.
  const persistedLocale = isUiLocale(body.locale) ? body.locale : null;
  // Acquisition snapshot: country (from IP, IP discarded), device bucket, UTM.
  const acq = buildSignupAcquisition(ctx, body);

  // Funnel attribution: prefer the explicit body field over the Referer
  // header, which often points at /register (the page being submitted)
  // rather than the original /rsvp / /w landing. Allow-list keeps
  // user-controlled strings out of the growth_events column. Resolved here,
  // at register time, because the verify click carries neither.
  const allowedRefs: ReadonlySet<string> = new Set(["rsvp", "site", "share"]);
  const bodyRef = typeof body.referrer === "string" ? body.referrer : null;
  const refSource = bodyRef && allowedRefs.has(bodyRef) ? bodyRef : null;
  const referer = ctx.req.headers.get("referer");
  const userAgent = ctx.req.headers.get("user-agent");

  // No users row yet — the signup waits in `pending_signups` until the verify
  // link proves the address. Everything this handler used to do against a fresh
  // user_id (consent, audit, growth, planner grants, session) is replayed by
  // handleConsume once the account actually exists. See domain/pending_signups.
  const verifyToken = createPendingSignup({
    email,
    passwordHash,
    fullName,
    locale: persistedLocale,
    signupCountry: acq.signup_country,
    deviceType: acq.device_type,
    utmSource: acq.utm_source,
    utmMedium: acq.utm_medium,
    utmCampaign: acq.utm_campaign,
    utmContent: acq.utm_content,
    utmTerm: acq.utm_term,
    referrer: refSource,
    refererHeader: referer && /\/rsvp\/[^?#]+/.test(referer) ? referer : null,
    plannerInvite:
      typeof body.planner_invite === "string" && body.planner_invite.trim()
        ? body.planner_invite.trim()
        : null,
    privacyVersion: PRIVACY_VERSION,
    termsVersion: TERMS_VERSION,
    // GDPR Art. 7(1): the consent evidence is the ip/user-agent of the request
    // where the box was ticked. The verify click can come from another device
    // hours later, so it must not be the thing we record.
    signupIp: ctx.clientIp,
    signupUserAgent: userAgent,
  });

  // Intent counter. user_id is NULL — there is no user to point at yet. Pairs
  // with `signup.completed` (fired at verify) to read verify drop-off:
  //   drop-off = 1 - completed / started
  recordGrowthEvent("signup.started", { user_agent: userAgent });

  // Welcome + verification — single email, both purposes. Fire-and-forget so a
  // mailer outage doesn't fail the request; the user can always re-register
  // (the pending row is overwritten) or use the public resend.
  const verifyUrl = `${CONFIG.frontendBaseUrl}/verify-email/${verifyToken}`;
  void sendKind(
    "welcome_verify",
    { verifyUrl },
    { user: null, pending: { email, full_name: fullName, locale: persistedLocale } },
  );

  // 202, not 201: nothing was created yet. No session — a session implies an
  // account, and there isn't one until the address is proved.
  return json({ pending: true, email }, { status: 202 });
}

async function handleLogin(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "auth:login", AUTH_BUCKET);
  const body = await readJson<LoginBody>(ctx.req);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);

  // Per-account failed-login ceiling — catches distributed stuffing the per-IP
  // bucket can't. Checked before the user lookup so missing/real emails match.
  assertLoginNotLocked(email);

  const row = getUserByEmail(email) as UserRow | null;
  if (!row) {
    // Burn an equivalent verify so the missing-user path costs the same as a
    // real one — closes the username-enumeration timing oracle.
    await burnPasswordVerify(password);
    recordLoginFailure(email);
    throw new HttpError(401, "Invalid credentials");
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    recordLoginFailure(email);
    throw new HttpError(401, "Invalid credentials");
  }

  // Reveal suspension only AFTER the password check — otherwise the distinct
  // 403 "suspended" vs 401 "invalid" lets an attacker enumerate which addresses
  // are suspended without knowing the password.
  if (row.status === "suspended") throw new HttpError(403, "Account suspended");

  clearLoginFailures(email);

  // Hard email-verification gate: an unverified account never gets a session.
  // The password check above already proved identity, so re-sending the verify
  // link here is not an enumeration vector — and it gives the locked-out user a
  // fresh link without a separate step. We block with a typed 403 the login page
  // routes to a "check your email / resend" screen. OAuth (Google/Apple) users
  // are provider-attested (verified_email = 1) and so never trip this.
  if (!row.verified_email) {
    sendVerificationLink(row, "verify_resend");
    throw new HttpError(403, "Email not verified", { code: "email_unverified" });
  }

  const token = issueSession(row.id, "password");
  alertOnNewDevice(ctx, row);
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

  const token = issueSession(userId, "password");
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

interface SetLocaleBody {
  locale?: unknown;
}

/** Persist the user's explicit UI-language pick on `users.locale` so it
 *  survives sign-out and follows the account to fresh devices. Registration
 *  captures an initial value, but until this endpoint existed a later
 *  switcher flip never reached the server: /api/auth/me kept hydrating the
 *  stale signup locale and the UI "randomly" reverted to English. */
async function handleSetLocale(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const body = await readJson<SetLocaleBody>(ctx.req);
  if (!isUiLocale(body.locale)) {
    throw new HttpError(400, `locale must be one of ${UI_LOCALES.join(", ")}`);
  }
  db.prepare("UPDATE users SET locale = ?, updated_at = ? WHERE id = ?").run(
    body.locale,
    now(),
    userId,
  );
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(404, "User not found");
  return json({ user: toUser(fresh) });
}

/** Latch the "share Weddly" prompt as shown. Write-once: a second call is a
 *  no-op rather than a re-stamp, so the timestamp always answers "when did we
 *  first ask this person" and repeat calls from a racing second tab are
 *  harmless. Deliberately takes no body — there is nothing to configure, the
 *  only transition is null → now. */
function handleSharePromptSeen(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  db.prepare(
    "UPDATE users SET share_prompt_seen_at = ?, updated_at = ? WHERE id = ? AND share_prompt_seen_at IS NULL",
  ).run(now(), now(), userId);
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(404, "User not found");
  return json({ user: toUser(fresh) });
}

/** Mark one workspace nav destination as visited. Union-only, so it is safe to
 *  fire on every navigation and safe to race with a second tab — the rail calls
 *  it once per destination and ignores the response, treating its own optimistic
 *  state as authoritative until the next `/api/auth/me`. */
async function handleNavVisited(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const body = await readJson<{ path?: unknown }>(ctx.req);
  if (typeof body.path !== "string") throw new HttpError(400, "path is required");
  if (!recordVisitedNav(userId, body.path)) throw new HttpError(400, "Unknown nav path");
  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(404, "User not found");
  return json({ user: toUser(fresh) });
}

export function registerAuthRoutes(router: Router) {
  router.post("/api/auth/register", handleRegister);
  router.post("/api/auth/login", handleLogin);
  router.post("/api/auth/logout", handleLogout, true);
  router.post("/api/auth/change-password", handleChangePassword, true);
  router.get("/api/auth/me", handleMe, true);
  router.post("/api/auth/locale", handleSetLocale, true);
  router.post("/api/auth/share-prompt-seen", handleSharePromptSeen, true);
  router.post("/api/auth/nav-visited", handleNavVisited, true);
}
