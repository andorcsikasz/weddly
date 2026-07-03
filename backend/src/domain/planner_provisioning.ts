// Admin-provisioned planner accounts. An admin pre-registers a planner they
// struck a deal with in person (email + name + business name + category); the
// account is created dormant (random password hash, password_set=0,
// verified_email=0, so neither password login nor password reset works) with a
// 2-year free comp on planner_subscriptions, and the planner receives an
// activation link. Activation = set a password + clickwrap-accept the legal
// documents; only then does the account go live.
//
// The comp mirrors the couple-side admin grant: subscription_status='founding'
// with is_founding_member=0, so it does NOT consume one of the
// PLANNER_FOUNDING_CAP founding slots and doesn't show up as a founding badge.

import { randomBytes } from "node:crypto";
import { PLANNER_FOUNDING_DURATION_MS, plannerCurrencyForLocale } from "@shared/planner_billing";
import { hashPassword } from "../auth/password";
import { hashToken, mintToken } from "../auth/tokens";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { getUserByEmail } from "./users";

/** Activation-link validity. Generous on purpose: these are hand-picked
 *  partners, and the admin can re-send from the Szervezők list anyway. */
export const ACTIVATION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface PlannerActivationTokenRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface ProvisionPlannerInput {
  email: string;
  fullName: string;
  businessName: string;
  category: string;
}

/** Create the dormant planner account + the 2-year comp + the first activation
 *  token. Returns the new user id and the PLAINTEXT token for the email link.
 *  Throws 409 when the email already belongs to any account. */
export async function provisionPlanner(
  input: ProvisionPlannerInput,
): Promise<{ userId: number; token: string }> {
  const email = input.email.trim().toLowerCase();
  if (getUserByEmail(email)) throw new HttpError(409, "Email already registered");

  // `password_hash` is NOT NULL on the schema. Random unguessable placeholder,
  // argon2id'd, same pattern as Google-only accounts (auth_google.ts). Hash it
  // BEFORE the transaction: Bun.password is async and db.transaction callbacks
  // must stay synchronous.
  const placeholderHash = await hashPassword(randomBytes(48).toString("hex"));
  const token = mintToken();
  const ts = now();

  const run = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO users
           (email, password_hash, full_name, status, role, verified_email,
            password_set, user_type, business_name, planner_category,
            created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'owner', 0, 0, 'planner', ?, ?, ?, ?)`,
      )
      .run(email, placeholderHash, input.fullName, input.businessName, input.category, ts, ts);
    const userId = Number(result.lastInsertRowid);

    // 2-year comp, admin-granted: founding status keeps the shared entitlement
    // math happy, is_founding_member=0 keeps the 25 founding slots untouched.
    // Currency defaults to the null-locale pick and is re-pinned at activation
    // once the planner's real UI locale is known.
    db.prepare(
      `INSERT INTO planner_subscriptions
         (user_id, subscription_status, trial_ends_at, founding_until,
          is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'founding', NULL, ?, 0, ?, ?, ?)`,
    ).run(userId, ts + PLANNER_FOUNDING_DURATION_MS, plannerCurrencyForLocale(null), ts, ts);

    db.prepare(
      `INSERT INTO planner_activation_tokens (user_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, hashToken(token), ts + ACTIVATION_TTL_MS, ts);

    return userId;
  });

  return { userId: run(), token };
}

/** True while the planner still has an unconsumed activation token, i.e. the
 *  account is dormant and waiting on the emailed link. */
export function isActivationPending(userId: number): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL LIMIT 1",
      )
      .get(userId) !== undefined
  );
}

/** Re-issue the activation link: drop every unconsumed token (only the latest
 *  link stays live, mirrors password_reset) and mint a fresh one. Throws 409
 *  when the account was already activated. */
export function reissueActivationToken(userId: number): string {
  const consumed = db
    .prepare(
      "SELECT 1 FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NOT NULL LIMIT 1",
    )
    .get(userId);
  if (consumed) throw new HttpError(409, "Account already activated", { code: "already_active" });

  const hadPending = db
    .prepare(
      "SELECT 1 FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL LIMIT 1",
    )
    .get(userId);
  if (!hadPending) {
    // No token was ever minted for this planner (self-registered account), so
    // there is nothing to "re"-send and activation would be a downgrade.
    throw new HttpError(409, "Planner was not admin-provisioned", { code: "not_provisioned" });
  }

  db.prepare("DELETE FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL").run(
    userId,
  );
  const token = mintToken();
  const ts = now();
  db.prepare(
    `INSERT INTO planner_activation_tokens (user_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, hashToken(token), ts + ACTIVATION_TTL_MS, ts);
  return token;
}

/** Resolve a plaintext token to its row. Throws precise HttpErrors the
 *  activation page can branch on: 404 unknown, 410 consumed/expired. */
export function requireActivationToken(token: string): PlannerActivationTokenRow {
  if (token.length < 16 || token.length > 128) throw new HttpError(400, "Invalid token");
  const row = db
    .prepare("SELECT * FROM planner_activation_tokens WHERE token = ?")
    .get(hashToken(token)) as PlannerActivationTokenRow | undefined;
  if (!row) throw new HttpError(404, "Activation not found");
  if (row.consumed_at) {
    throw new HttpError(410, "Account already activated", { code: "activation_consumed" });
  }
  if (row.expires_at < now()) {
    throw new HttpError(410, "Activation link expired", { code: "activation_expired" });
  }
  return row;
}

/** Flip the dormant account live: install the real password, mark the email
 *  verified (they clicked the emailed link), persist the locale they activated
 *  in, re-pin the comp currency to that locale (safe pre-Stripe only), and
 *  consume the token. The caller records consents + audit + issues a session.
 *  The password is hashed by the caller (async) so this stays transactional. */
export function completeActivation(
  row: PlannerActivationTokenRow,
  passwordHash: string,
  locale: "hu" | "en" | null,
): void {
  const ts = now();
  db.transaction(() => {
    db.prepare(
      `UPDATE users
          SET password_hash = ?, password_set = 1, verified_email = 1,
              locale = COALESCE(?, locale), updated_at = ?
        WHERE id = ?`,
    ).run(passwordHash, locale, ts, row.user_id);
    if (locale) {
      db.prepare(
        `UPDATE planner_subscriptions
            SET currency = ?, updated_at = ?
          WHERE user_id = ? AND stripe_customer_id IS NULL`,
      ).run(plannerCurrencyForLocale(locale), ts, row.user_id);
    }
    db.prepare("UPDATE planner_activation_tokens SET consumed_at = ? WHERE id = ?").run(ts, row.id);
  })();
}
