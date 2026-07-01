// Register / login / logout / me. Issues opaque session tokens.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { AuthSession } from "@shared/types";
import { burnPasswordVerify, hashPassword, verifyPassword } from "../auth/password";
import { extractToken, issueSession, revokeSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { recordConsent } from "../domain/consents";
import { sendKind } from "../domain/emails";
import { recordGrowthEvent } from "../domain/growth_events";
import { grantPlannerAccount } from "../domain/planner";
import { initPlannerBilling } from "../domain/planner_billing";
import { rebindInvitationEmail } from "../domain/planner_invitations";
import { buildSignupAcquisition } from "../domain/signup_meta";
import { deviceFingerprint, recordKnownDevice } from "../domain/known_devices";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import {
  AUTH_BUCKET,
  assertLoginNotLocked,
  clearLoginFailures,
  rateLimit,
  recordLoginFailure,
} from "../lib/rate_limit";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { createVerificationToken, sendVerificationLink } from "./email_verify";

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
  // Coerce locale at the boundary — only persist values the frontend +
  // backend i18n actually understand. Anything else stays null.
  const persistedLocale = body.locale === "hu" || body.locale === "en" ? body.locale : null;
  // Acquisition snapshot: country (from IP, IP discarded), device bucket, UTM.
  const acq = buildSignupAcquisition(ctx, body);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, locale,
                          signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                          created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      email,
      passwordHash,
      fullName,
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

  // Auto-promote to planner if email is on the waitlist. The waitlist is
  // auto-accept now, so any entry grants the account. The plan/cap stay at the
  // default until the planner confirms one during onboarding (prefill).
  const inWaitlist = db
    .prepare("SELECT id FROM planner_waitlist WHERE LOWER(email) = ?")
    .get(email.toLowerCase());
  if (inWaitlist) {
    grantPlannerAccount(userId);
    // Open the planner's billing lifecycle (founding grant while slots remain,
    // else a 3-day trial) the moment the account is granted.
    initPlannerBilling(userId);
  }

  // Re-bind a planner email-invitation to the address they actually registered
  // with, so the onboarding link-up matches even if the invitee signed up under
  // a different email than the one the planner invited.
  if (typeof body.planner_invite === "string" && body.planner_invite.trim()) {
    rebindInvitationEmail(body.planner_invite.trim(), email);
  }

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

  // Funnel attribution: prefer the explicit body field over the Referer
  // header, which often points at /register (the page being submitted)
  // rather than the original /rsvp / /w landing. Allow-list keeps
  // user-controlled strings out of the growth_events column.
  const allowedRefs: ReadonlySet<string> = new Set(["rsvp", "site", "share"]);
  const bodyRef = typeof body.referrer === "string" ? body.referrer : null;
  const refSource = bodyRef && allowedRefs.has(bodyRef) ? bodyRef : null;
  if (refSource) {
    recordGrowthEvent("signup.from_referrer", {
      user_id: userId,
      referrer: refSource,
      user_agent: ctx.req.headers.get("user-agent"),
    });
  } else {
    // Legacy fallback: Referer-based attribution for the /rsvp/* page that
    // pre-dates the explicit body field. Drops off as the frontend updates
    // every public CTA to thread `?ref=` through.
    const referer = ctx.req.headers.get("referer");
    if (referer && /\/rsvp\/[^?#]+/.test(referer)) {
      recordGrowthEvent("signup.from_rsvp_referrer", {
        user_id: userId,
        referrer: referer,
        user_agent: ctx.req.headers.get("user-agent"),
      });
    }
  }

  // Every successful register fires `signup.completed` — pairs with the
  // referrer-tagged events above so the dashboard can compute attribution
  // rate (= signup.from_referrer / signup.completed). Without this base
  // counter, attribution is just a number with no denominator.
  recordGrowthEvent("signup.completed", {
    user_id: userId,
    user_agent: ctx.req.headers.get("user-agent"),
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
    signup_country: acq.signup_country,
    device_type: acq.device_type,
    utm_source: acq.utm_source,
    utm_medium: acq.utm_medium,
    utm_campaign: acq.utm_campaign,
    utm_content: acq.utm_content,
    utm_term: acq.utm_term,
  };
  const session: AuthSession = { token, user: toUser(userRow) };
  return json(session, { status: 201 });
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
  if (row.status === "suspended") throw new HttpError(403, "Account suspended");

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    recordLoginFailure(email);
    throw new HttpError(401, "Invalid credentials");
  }

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

  const token = issueSession(row.id);
  alertOnNewDevice(ctx, row);
  const session: AuthSession = { token, user: toUser(row) };
  return json(session);
}

/** Check this sign-in's device fingerprint against the user's known list.
 *  Silently records first-ever device; fires `new_device_signin` when the
 *  fingerprint is unrecognised. Fire-and-forget — sign-in must succeed even
 *  if the mailer hiccups. */
function alertOnNewDevice(ctx: Ctx, row: UserRow): void {
  const fp = deviceFingerprint(ctx.req.headers.get("user-agent"), ctx.clientIp);
  const result = recordKnownDevice(row.id, fp);
  if (result.kind !== "new") return;
  const signedInAt = new Date(now()).toLocaleString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  void sendKind(
    "new_device_signin",
    { signedInAt, forgotUrl: `${CONFIG.frontendBaseUrl}/forgot-password` },
    { user: { id: row.id, email: row.email, full_name: row.full_name } },
  );
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
