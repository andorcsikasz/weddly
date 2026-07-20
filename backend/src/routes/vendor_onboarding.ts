// Vendor onboarding routes — the accepted-waitlist → live vendor path:
//   1. POST /api/vendor/onboard/verify/:token   — anon; reads the token view (doesn't consume)
//   2. POST /api/vendor/onboard/complete        — anon; atomic create user+account+sub, issue session
//
// This is the listing-claim flow's completion transaction (routes/vendor_claim.ts)
// minus the listing: a waitlist vendor has no directory row to claim, so we just
// create the account and grant founding/trial billing. No card is asked — the
// first VENDOR_FOUNDING_CAP vendors are free for a year.

import { vendorCurrencyForLocale } from "@shared/vendor_billing";
import type {
  CompleteVendorOnboardingInput,
  VendorOnboardingVerifyView,
} from "@shared/vendor_onboarding";
import { VENDOR_FOUNDING_CAP } from "@shared/vendor_billing";
import type { AuthSession } from "@shared/types";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { db, now } from "../db";
import {
  currentVendorOffer,
  initVendorBilling,
  vendorFoundingSpotsLeft,
} from "../domain/vendor_billing";
import { createVendorAccount } from "../domain/vendor_accounts";
import { createVendorListing } from "../domain/listings";
import { getVendorWaitlistById } from "../domain/vendor_waitlist";
import {
  expireStaleOnboarding,
  getOnboardingByToken,
  markOnboardingCompleted,
} from "../domain/vendor_onboarding";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { maybeGrantVendorReferral } from "../domain/referrals";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// Token carries an effective bearer credential — rate-limit verify/complete to
// slow brute-force without locking out a vendor's legitimate retries.
const TOKEN_BUCKET = { capacity: 30, refillRate: 1 / 60 }; // 30 per minute per IP

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

function parseToken(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token || token.length < 16 || token.length > 128) throw new HttpError(400, "Invalid token");
  return token;
}

function handleVerify(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "vendor_onboard:verify", TOKEN_BUCKET);
  const token = parseToken((ctx.params as { token?: string }).token);
  const rowRaw = getOnboardingByToken(token);
  if (!rowRaw) throw new HttpError(404, "Onboarding link not found");
  const row = expireStaleOnboarding(rowRaw);

  const view: VendorOnboardingVerifyView = {
    business_name: row.business_name,
    email: row.email,
    category: row.category,
    status: (row.status as VendorOnboardingVerifyView["status"]) ?? "pending",
    expires_at: row.expires_at,
    founding_spots_left: vendorFoundingSpotsLeft(),
    founding_cap: VENDOR_FOUNDING_CAP,
    offer: currentVendorOffer(),
  };
  return json({ onboarding: view });
}

async function handleComplete(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor_onboard:complete", TOKEN_BUCKET);
  const body = await readJson<CompleteVendorOnboardingInput>(ctx.req);

  const token = parseToken(body.token);
  const password = parsePassword(body.password);
  const fullName = parseFullName(body.full_name);
  const locale = typeof body.locale === "string" ? body.locale : null;

  const rowRaw = getOnboardingByToken(token);
  if (!rowRaw) throw new HttpError(404, "Onboarding link not found");
  const row = expireStaleOnboarding(rowRaw);
  if (row.status === "expired") throw new HttpError(410, "Onboarding link expired");
  if (row.status === "cancelled") throw new HttpError(410, "Onboarding link was superseded");
  if (row.status === "completed") {
    throw new HttpError(409, "This vendor account was already activated", {
      code: "already_completed",
    });
  }

  // Same-email coexistence is rejected (a user can't hold both a couple and a
  // vendor account in v1) — mirrors the claim flow's guard.
  if (getUserByEmail(row.email)) {
    throw new HttpError(409, "An account with this email already exists", { code: "email_taken" });
  }

  const passwordHash = await hashPassword(password);
  const ts = now();
  const currency = vendorCurrencyForLocale(locale ?? row.locale);
  // Seed the fresh listing's city from the waitlist location (the vendor
  // refines it in the editor). The waitlist row may be gone — default to empty.
  const waitlist = row.waitlist_id != null ? getVendorWaitlistById(row.waitlist_id) : null;
  const seedCity = waitlist?.location?.trim() || "";
  const seedCategory = row.category ?? waitlist?.category ?? "venue";

  const ERR_EMAIL_TAKEN = "race:email_taken";
  const ERR_TOKEN_CONSUMED = "race:token_not_pending";
  let newUserId = 0;
  let newVendorAccountId = 0;

  const tx = db.transaction(() => {
    // Re-check the token status inside the tx: a sibling complete with the same
    // token may have landed between the read above and here.
    const fresh = db.prepare("SELECT status FROM vendor_onboarding WHERE id = ?").get(row.id) as
      | { status: string }
      | undefined;
    if (!fresh || fresh.status !== "pending") throw new Error(ERR_TOKEN_CONSUMED);

    let userResult;
    try {
      userResult = db
        .prepare(
          `INSERT INTO users
             (email, password_hash, full_name, status, role, verified_email, locale, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'vendor', 1, ?, ?, ?)`,
        )
        .run(row.email, passwordHash, fullName, locale ?? row.locale, ts, ts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) throw new Error(ERR_EMAIL_TAKEN);
      throw e;
    }
    newUserId = Number(userResult.lastInsertRowid);

    const account = createVendorAccount({
      ownerUserId: newUserId,
      displayName: row.business_name,
      contactEmail: row.email,
    });
    newVendorAccountId = account.id;

    // Give the vendor a live listing to land on + edit. A waitlist vendor has
    // no directory row to claim, so we mint a fresh 'claimed' listing.
    createVendorListing({
      vendorAccountId: newVendorAccountId,
      category: seedCategory,
      name: row.business_name,
      city: seedCity,
      contactEmail: row.email,
      // Carry the website from the waitlist application so the vendor lands on
      // a listing already populated with what they gave us.
      website: waitlist?.website ?? null,
    });

    markOnboardingCompleted(row.id, newVendorAccountId);
    // Grant founding (free year) or trial — inside the tx so the cohort count
    // and the grant are consistent with the account creation.
    initVendorBilling(newVendorAccountId, currency, ts);
  });

  try {
    tx();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === ERR_EMAIL_TAKEN) {
      throw new HttpError(409, "An account with this email already exists", {
        code: "email_taken",
      });
    }
    if (msg === ERR_TOKEN_CONSUMED) {
      throw new HttpError(409, "This vendor account was already activated", {
        code: "already_completed",
      });
    }
    throw e;
  }

  addAuditLog({
    actor_user_id: newUserId,
    couple_id: null,
    action: "vendor.onboard.complete",
    target_kind: "vendor_account",
    target_id: newVendorAccountId,
    after: { waitlist_id: row.waitlist_id, currency },
  });

  // Referral reward: if this vendor's waitlist entry was referred by a couple,
  // grant them 2 months free now that the vendor has activated.
  maybeGrantVendorReferral(row.waitlist_id);

  const sessionToken = issueSession(newUserId);
  const userRow = getUserById(newUserId);
  if (!userRow) throw new HttpError(500, "User vanished after onboarding completion");
  const session: AuthSession = { token: sessionToken, user: toUser(userRow as UserRow) };
  return json(session, { status: 201 });
}

export function registerVendorOnboardingRoutes(router: Router) {
  router.post("/api/vendor/onboard/verify/:token", handleVerify);
  router.post("/api/vendor/onboard/complete", handleComplete);
}
