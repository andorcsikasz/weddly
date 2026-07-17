// Pending signups — the holding pen between "filled in the register form" and
// "proved the email address exists".
//
// A password registration writes a row here and nothing to `users`. Clicking
// the verify link promotes it: the users row is minted verified_email = 1 and
// every side effect register used to run inline (consent, audit, growth,
// planner grants) is replayed against the new id. See routes/email_verify.ts.
//
// The plaintext token is returned once, at creation, for the emailed link;
// only its hash is ever persisted (same contract as the other credential
// tables — see auth/tokens.ts).

import { hashToken, mintToken } from "../auth/tokens";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { log } from "../lib/logger";
import { recordConsent } from "./consents";
import { recordGrowthEvent } from "./growth_events";
import { grantPlannerAccount } from "./planner";
import { initPlannerBilling } from "./planner_billing";
import { rebindInvitationEmail } from "./planner_invitations";
import type { UserRow } from "./users";

/** How long an unclicked signup link stays redeemable. Matches VERIFY_TTL_MS
 *  (routes/email_verify.ts) — the link in the mail and the row it redeems must
 *  die together, or a user clicks a live link into a missing row. */
export const PENDING_SIGNUP_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface PendingSignupRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  locale: string | null;
  token: string;
  expires_at: number;
  signup_country: string | null;
  device_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  referer_header: string | null;
  planner_invite: string | null;
  privacy_version: string;
  terms_version: string;
  signup_ip: string | null;
  signup_user_agent: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreatePendingSignupInput {
  email: string;
  passwordHash: string;
  fullName: string;
  locale: string | null;
  signupCountry: string | null;
  deviceType: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  refererHeader: string | null;
  plannerInvite: string | null;
  privacyVersion: string;
  termsVersion: string;
  signupIp: string | null;
  signupUserAgent: string | null;
}

/** Create (or replace) the pending signup for an address and return the
 *  plaintext token for the emailed link.
 *
 *  Re-registering the same address OVERWRITES the row rather than 409ing. The
 *  address is unproven, so there is no account to protect and nothing to leak
 *  by accepting the request. It's also the only way to stay unstuck: a user who
 *  fat-fingered their password, or whose first mail was eaten, must be able to
 *  just sign up again. 409ing here would re-create the lockout this whole table
 *  exists to remove, only time-boxed to the TTL instead of forever.
 *
 *  The trade-off, stated plainly: whoever registers LAST owns the pending data,
 *  so someone who knows an address is mid-signup can overwrite it with their
 *  own password and name, and the victim's own link stops working (the token is
 *  UNIQUE and rewritten here). If the victim then clicks the attacker's link
 *  instead of noticing the mismatched name, the account is created with the
 *  attacker's password.
 *
 *  We accept that: the attacker never reaches anything the victim owns (there
 *  is no account yet), and the victim controls the inbox, so a password reset
 *  takes it straight back. The alternative — refusing the second register —
 *  costs every honest re-try to defend against it. */
export function createPendingSignup(input: CreatePendingSignupInput): string {
  const token = mintToken();
  const ts = now();
  db.prepare(
    `INSERT INTO pending_signups
       (email, password_hash, full_name, locale, token, expires_at,
        signup_country, device_type, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, referrer, referer_header, planner_invite,
        privacy_version, terms_version, signup_ip, signup_user_agent,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       full_name = excluded.full_name,
       locale = excluded.locale,
       token = excluded.token,
       expires_at = excluded.expires_at,
       signup_country = excluded.signup_country,
       device_type = excluded.device_type,
       utm_source = excluded.utm_source,
       utm_medium = excluded.utm_medium,
       utm_campaign = excluded.utm_campaign,
       utm_content = excluded.utm_content,
       utm_term = excluded.utm_term,
       referrer = excluded.referrer,
       referer_header = excluded.referer_header,
       planner_invite = excluded.planner_invite,
       privacy_version = excluded.privacy_version,
       terms_version = excluded.terms_version,
       signup_ip = excluded.signup_ip,
       signup_user_agent = excluded.signup_user_agent,
       updated_at = excluded.updated_at`,
  ).run(
    input.email,
    input.passwordHash,
    input.fullName,
    input.locale,
    hashToken(token),
    ts + PENDING_SIGNUP_TTL_MS,
    input.signupCountry,
    input.deviceType,
    input.utmSource,
    input.utmMedium,
    input.utmCampaign,
    input.utmContent,
    input.utmTerm,
    input.referrer,
    input.refererHeader,
    input.plannerInvite,
    input.privacyVersion,
    input.termsVersion,
    input.signupIp,
    input.signupUserAgent,
    ts,
    ts,
  );
  return token;
}

/** Look up a pending signup by the plaintext token from the emailed link.
 *  Returns null for unknown OR expired — the caller must not distinguish. */
export function getPendingSignupByToken(token: string): PendingSignupRow | null {
  const row = db.prepare("SELECT * FROM pending_signups WHERE token = ?").get(hashToken(token)) as
    | PendingSignupRow
    | undefined;
  if (!row) return null;
  if (row.expires_at < now()) return null;
  return row;
}

export function getPendingSignupByEmail(email: string): PendingSignupRow | null {
  return (
    (db.prepare("SELECT * FROM pending_signups WHERE email = ?").get(email) as
      | PendingSignupRow
      | undefined) ?? null
  );
}

export function deletePendingSignup(id: number): void {
  db.prepare("DELETE FROM pending_signups WHERE id = ?").run(id);
}

/** Mint a fresh link for an existing pending signup and return the plaintext
 *  token. Used by the public resend: a pending signup has no `users` row, so
 *  the user-keyed resend path can't see it at all — without this, the exact
 *  cohort that lost its welcome mail would have no way back in.
 *
 *  Rolls the expiry forward too: the point is to give a stuck user a working
 *  link, and one that inherits an almost-dead expiry isn't that. */
export function reissuePendingSignupToken(id: number): string {
  const token = mintToken();
  const ts = now();
  db.prepare(
    "UPDATE pending_signups SET token = ?, expires_at = ?, updated_at = ? WHERE id = ?",
  ).run(hashToken(token), ts + PENDING_SIGNUP_TTL_MS, ts, id);
  return token;
}

/** Turn a proved pending signup into a real account.
 *
 *  This is the back half of what `handleRegister` used to do in one go: the
 *  users row is minted verified_email = 1 (the click IS the proof, so there's
 *  no separate token to consume) and every deferred side effect is replayed
 *  against the fresh id. The pending row is deleted — its job is done.
 *
 *  The users INSERT + the pending DELETE run in one transaction: a crash
 *  between them would either strand a duplicate-able pending row or, worse,
 *  leave an account whose signup could be replayed by re-clicking the link.
 *
 *  Returns the new user row. Caller issues the session. */
export function promotePendingSignup(pending: PendingSignupRow): UserRow {
  const ts = now();

  const userId = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, locale,
                            signup_country, device_type, utm_source, utm_medium, utm_campaign,
                            utm_content, utm_term, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'owner', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.email,
        pending.password_hash,
        pending.full_name,
        pending.locale,
        pending.signup_country,
        pending.device_type,
        pending.utm_source,
        pending.utm_medium,
        pending.utm_campaign,
        pending.utm_content,
        pending.utm_term,
        ts,
        ts,
      );
    const id = Number(result.lastInsertRowid);
    db.prepare("DELETE FROM pending_signups WHERE id = ?").run(pending.id);
    return id;
  })();

  // Auto-promote to planner if email is on the waitlist. The waitlist is
  // auto-accept now, so any entry grants the account. The plan/cap stay at the
  // default until the planner confirms one during onboarding (prefill).
  const inWaitlist = db
    .prepare("SELECT id FROM planner_waitlist WHERE LOWER(email) = ?")
    .get(pending.email.toLowerCase());
  if (inWaitlist) {
    grantPlannerAccount(userId);
    // Open the planner's billing lifecycle (founding grant while slots remain,
    // else a 3-day trial) the moment the account is granted.
    initPlannerBilling(userId);
  }

  // Re-bind a planner email-invitation to the address they actually registered
  // with, so the onboarding link-up matches even if the invitee signed up under
  // a different email than the one the planner invited.
  if (pending.planner_invite) {
    rebindInvitationEmail(pending.planner_invite, pending.email);
  }

  // GDPR Art. 7(1) — the ledger records the request where the box was actually
  // ticked (register), NOT this verify click. Versions come from the pending
  // row for the same reason: they're what the user was shown at the time.
  recordConsent({
    subjectUserId: userId,
    subjectKind: "user",
    subjectRef: null,
    document: "privacy",
    version: pending.privacy_version,
    ip: pending.signup_ip,
    userAgent: pending.signup_user_agent,
  });
  recordConsent({
    subjectUserId: userId,
    subjectKind: "user",
    subjectRef: null,
    document: "terms",
    version: pending.terms_version,
    ip: pending.signup_ip,
    userAgent: pending.signup_user_agent,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "user.register",
    target_kind: "user",
    target_id: userId,
    after: { email: pending.email },
  });

  // user_agent is the REGISTER request's, replayed from the pending row — the
  // verify click's UA would describe whichever device opened the mail, which
  // is not the device that signed up.
  if (pending.referrer) {
    recordGrowthEvent("signup.from_referrer", {
      user_id: userId,
      referrer: pending.referrer,
      user_agent: pending.signup_user_agent,
    });
  } else if (pending.referer_header) {
    // Legacy fallback: Referer-based attribution for the /rsvp/* page that
    // pre-dates the explicit body field. Drops off as the frontend updates
    // every public CTA to thread `?ref=` through.
    recordGrowthEvent("signup.from_rsvp_referrer", {
      user_id: userId,
      referrer: pending.referer_header,
      user_agent: pending.signup_user_agent,
    });
  }

  // Fires here, not at register: an account now exists to attribute. Pairs with
  // `signup.started` (register) so the funnel can read verify drop-off, and
  // keeps the attribution denominator honest — signup.from_referrer is only
  // ever recorded for accounts that made it this far.
  recordGrowthEvent("signup.completed", {
    user_id: userId,
    user_agent: pending.signup_user_agent,
  });

  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
}

/** Drop pending signups whose link has expired. Runs on the hourly purge tick.
 *
 *  No PII notice and no tombstone: an expired pending signup was never an
 *  account, and its address was never proved — there is no data subject to
 *  notify and nothing referencing the row. This is the one signup-adjacent
 *  cleanup that CAN hard-delete (contrast purgeStaleUnverifiedSignups, which
 *  must scrub a real users row that audit_log points at). */
export function purgeExpiredPendingSignups(): number {
  const result = db.prepare("DELETE FROM pending_signups WHERE expires_at < ?").run(now());
  const deleted = Number(result.changes);
  if (deleted > 0) log.info("pending_signups.expired", { deleted });
  return deleted;
}
