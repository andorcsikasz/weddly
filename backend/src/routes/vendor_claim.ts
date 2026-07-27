// Vendor listing-claim routes. Three-step flow:
//   1. POST /api/vendor/claim/start              — anon; emails the listing's contact_email
//   2. POST /api/vendor/claim/verify/:token      — anon; reads the claim view (doesn't consume)
//   3. POST /api/vendor/claim/complete           — anon; atomic create + flip + session issue
//
// Each step is independently rate-limited per IP. The verify mail is sent via
// `sendKind("vendor_claim_verify", ...)` with a guest target (no user_id) —
// `send.ts` short-circuits the preferences lookup for guest sends and still
// writes the `email_log` row + Sentry breadcrumb on failure.
//
// See [[feedback_multi_agent_debate]] (path E synthesis) for why this ships
// in P2.B/C — consuming the P2.A schema before it rots.

import type { ClaimVerifyView, CompleteClaimInput, StartClaimInput } from "@shared/vendor_claim";
import type { AuthSession } from "@shared/types";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { sendKind } from "../domain/emails/send";
import {
  cancelAllPendingClaims,
  createClaim,
  expireStaleClaim,
  getClaimByToken,
  markClaimVerified,
  markOtherPendingClaimsCancelled,
} from "../domain/listing_claims";
import { getListingById } from "../domain/listings";
import { vendorCurrencyForLocale } from "@shared/vendor_billing";
import { createVendorAccount } from "../domain/vendor_accounts";
import { currentVendorOffer, initVendorBilling } from "../domain/vendor_billing";
import { emitVendorEvent } from "../domain/vendor_points";
import { getUserByEmail, getUserById, toUser, type UserRow } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// Per-IP buckets — start is the spammable surface (no auth, sends email), so
// it's the tightest. Verify + complete carry a token that's effectively a
// bearer credential; rate-limit them to slow brute-force, not lock out
// legitimate retries.
const START_BUCKET = { capacity: 5, refillRate: 1 / 600 }; // 5 per 10 min per IP
// Per-listing bucket — caps how many verify emails ANY caller can fire at a
// single listing's contact inbox over time, regardless of how many IPs the
// attacker rotates through. 3 per hour is well above legitimate retry need
// (most vendors click the first link) and well below an inbox-spam threshold.
const START_PER_LISTING_BUCKET = { capacity: 3, refillRate: 1 / 3600 };
const VERIFY_BUCKET = { capacity: 30, refillRate: 1 / 60 }; // 30 per minute per IP

// ── Email ──────────────────────────────────────────────────────────────────

async function sendClaimEmail(toEmail: string, listingName: string, token: string): Promise<void> {
  const verifyUrl = `${CONFIG.frontendBaseUrl}/vendor/claim/verify/${encodeURIComponent(token)}`;
  // Fire-and-forget; `sendKind` swallows mailer errors, logs them via Sentry,
  // and writes the `email_log` row itself — the claim row still landed and
  // admin can re-trigger if the mail send fails.
  await sendKind(
    "vendor_claim_verify",
    { listingName, verifyUrl },
    { user: null, guest: { email: toEmail, full_name: listingName } },
  );
}

// Heads-up to every admin on the allowlist the moment a claim starts — the
// product wants a human in the loop BEFORE the verify link is clicked. Sent as
// a guest send per admin (admins aren't guaranteed to have a users row); the
// kind is `transactional` so there's no opt-out lookup. Fire-and-forget — a
// mailer hiccup must never fail the claim itself.
function notifyAdminsOfClaim(opts: {
  listingName: string;
  listingId: string;
  claimantEmail: string;
  contactEmailMasked: string;
}): void {
  const adminUrl = `${CONFIG.frontendBaseUrl}/app/admin`;
  for (const email of CONFIG.adminEmails) {
    void sendKind(
      "vendor_claim_admin_alert",
      {
        listingName: opts.listingName,
        listingId: opts.listingId,
        claimantEmail: opts.claimantEmail,
        contactEmailMasked: opts.contactEmailMasked,
        adminUrl,
      },
      { user: null, guest: { email, full_name: "" } },
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at < 2) return "****";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

function parseListingId(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "listing_id required");
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 120) throw new HttpError(400, "listing_id invalid");
  return trimmed;
}

// Lightweight shape check only — this address never receives the verification
// link (that goes to the listing's contact_email), it's surfaced to admins as
// a who-is-asking signal. A full RFC validation would be theatre; we just want
// a sane string with one `@` and a dot in the domain.
function parseClaimantEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Email is required");
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 254) throw new HttpError(400, "Email looks invalid");
  const at = trimmed.indexOf("@");
  if (at < 1 || at !== trimmed.lastIndexOf("@") || !trimmed.slice(at + 1).includes(".")) {
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

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleStart(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor_claim:start", START_BUCKET);
  const body = await readJson<StartClaimInput>(ctx.req);
  const listingId = parseListingId(body.listing_id);
  const claimantEmail = parseClaimantEmail(body.claimant_email);

  const listing = getListingById(listingId);
  if (!listing) throw new HttpError(404, "Listing not found");
  if (listing.vendor_account_id !== null) {
    throw new HttpError(409, "Listing already claimed", { code: "already_claimed" });
  }
  if (!listing.contact_email) {
    throw new HttpError(409, "Listing has no contact email on file", {
      code: "no_contact_email",
    });
  }

  // Per-listing throttle: 3 verify emails per hour per listing, regardless
  // of how many IPs the caller is rotating through. Lands AFTER the listing
  // checks so probing for "does listing exist?" still 404s without burning
  // the inbox-protect quota.
  rateLimit(listingId, "vendor_claim:start:listing", START_PER_LISTING_BUCKET);

  const claim = createClaim(listingId, listing.contact_email, claimantEmail);
  await sendClaimEmail(listing.contact_email, listing.name, claim.token);

  // Let the admins know first — fire the heads-up the instant the claim lands,
  // not on the weekly Monday digest. Carries the claimer-typed email so a human
  // sees who's asking before the verify link is clicked.
  notifyAdminsOfClaim({
    listingName: listing.name,
    listingId,
    claimantEmail,
    contactEmailMasked: maskEmail(listing.contact_email),
  });

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "vendor.claim.start",
    target_kind: "listing",
    target_id: null,
    after: {
      listing_id: listingId,
      email_sent_to_masked: maskEmail(listing.contact_email),
      claimant_email_masked: maskEmail(claimantEmail),
    },
  });

  return json({
    ok: true,
    sent_to_masked: maskEmail(listing.contact_email),
  });
}

interface VerifyParams {
  token?: string;
}

function handleVerify(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "vendor_claim:verify", VERIFY_BUCKET);
  const tokenRaw = (ctx.params as VerifyParams).token ?? "";
  if (!tokenRaw || tokenRaw.length < 16 || tokenRaw.length > 128) {
    throw new HttpError(400, "Invalid token");
  }
  const claimRowRaw = getClaimByToken(tokenRaw);
  if (!claimRowRaw) throw new HttpError(404, "Claim not found");
  const claim = expireStaleClaim(claimRowRaw);
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(410, "Listing no longer exists");

  const view: ClaimVerifyView = {
    listing_id: claim.listing_id,
    listing_name: listing.name,
    email: claim.email_sent_to,
    category: listing.category,
    city: listing.city,
    status: (claim.status as ClaimVerifyView["status"]) ?? "pending",
    expires_at: claim.expires_at,
    offer: currentVendorOffer(),
  };
  return json({ claim: view });
}

async function handleComplete(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "vendor_claim:complete", VERIFY_BUCKET);
  const body = await readJson<CompleteClaimInput>(ctx.req);

  const tokenRaw = typeof body.token === "string" ? body.token.trim() : "";
  if (!tokenRaw || tokenRaw.length < 16 || tokenRaw.length > 128) {
    throw new HttpError(400, "Invalid token");
  }
  const password = parsePassword(body.password);
  const fullName = parseFullName(body.full_name);

  const claimRowRaw = getClaimByToken(tokenRaw);
  if (!claimRowRaw) throw new HttpError(404, "Claim not found");
  const claim = expireStaleClaim(claimRowRaw);
  if (claim.status === "expired") throw new HttpError(410, "Verification link expired");
  if (claim.status === "cancelled") throw new HttpError(410, "Claim was cancelled");
  if (claim.status === "verified") {
    throw new HttpError(409, "Claim already completed", { code: "already_verified" });
  }

  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(410, "Listing no longer exists");
  if (listing.vendor_account_id !== null) {
    // Pre-tx detection of "another claim already won". Cancel every pending
    // sibling so the email links rendered in inboxes don't lead to a token
    // that fails confusingly mid-form.
    cancelAllPendingClaims(claim.listing_id);
    throw new HttpError(409, "Listing already claimed", { code: "already_claimed" });
  }

  // Same-email coexistence is rejected for v1 — see [[feedback_multi_agent_debate]]
  // path E discussion. A future iteration can allow a single user to hold
  // BOTH a couple workspace and a vendor account by extending users.role.
  if (getUserByEmail(claim.email_sent_to)) {
    throw new HttpError(409, "An account with this email already exists", {
      code: "email_taken",
    });
  }

  const passwordHash = await hashPassword(password);
  const ts = now();

  // Sentinel errors thrown from inside the tx so we can map them to HTTP
  // responses cleanly outside. Using string sentinels rather than HttpError
  // because the tx callback shouldn't depend on the route layer's error type.
  const ERR_RACE_LISTING = "race:listing_already_claimed";
  const ERR_RACE_CLAIM = "race:claim_not_pending";
  const ERR_EMAIL_TAKEN = "race:email_taken";

  let newUserId = 0;
  let newVendorAccountId = 0;

  const tx = db.transaction(() => {
    // Re-check claim status inside the tx. If a sibling complete with the
    // SAME token landed first, this row is now 'verified' or 'cancelled'.
    const freshClaim = db.prepare("SELECT status FROM listing_claims WHERE id = ?").get(claim.id) as
      | { status: string }
      | undefined;
    if (!freshClaim || freshClaim.status !== "pending") {
      throw new Error(ERR_RACE_CLAIM);
    }

    // INSERT-into-users defends against the email-taken race: between the
    // pre-tx getUserByEmail check and here, somebody else may have grabbed
    // the address. UNIQUE constraint trips → tx rolls back.
    let userResult;
    try {
      userResult = db
        .prepare(
          `INSERT INTO users
             (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'vendor', 1, ?, ?)`,
        )
        .run(claim.email_sent_to, passwordHash, fullName, ts, ts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) throw new Error(ERR_EMAIL_TAKEN);
      throw e;
    }
    newUserId = Number(userResult.lastInsertRowid);

    const account = createVendorAccount({
      ownerUserId: newUserId,
      displayName: listing.name,
      contactEmail: claim.email_sent_to,
    });
    newVendorAccountId = account.id;

    // The conditional UPDATE is the inner-tx race guard: if a sibling complete
    // with a DIFFERENT token already flipped vendor_account_id, this returns
    // changes === 0 and we abort. Without this the orphan user + vendor_account
    // we just inserted would leak into prod with no owning listing.
    const upd = db
      .prepare(
        "UPDATE listings SET vendor_account_id = ?, updated_at = ? WHERE id = ? AND vendor_account_id IS NULL",
      )
      .run(newVendorAccountId, ts, claim.listing_id);
    if (upd.changes === 0) throw new Error(ERR_RACE_LISTING);

    markClaimVerified(claim.id, newVendorAccountId);
    markOtherPendingClaimsCancelled(claim.listing_id, claim.id);
    // Weddly Points: a claimed listing arrives already part-filled (name, city,
    // contact, often a blurb), so the account is born owed its completeness
    // milestones. Without this event they'd only land on the next profile edit
    // or the next boot backfill.
    emitVendorEvent(newVendorAccountId, "profile.updated");
  });
  try {
    tx();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === ERR_RACE_LISTING) {
      cancelAllPendingClaims(claim.listing_id);
      throw new HttpError(409, "Listing already claimed", { code: "already_claimed" });
    }
    if (msg === ERR_RACE_CLAIM) {
      throw new HttpError(409, "Claim already completed", { code: "already_verified" });
    }
    if (msg === ERR_EMAIL_TAKEN) {
      throw new HttpError(409, "An account with this email already exists", {
        code: "email_taken",
      });
    }
    throw e;
  }

  // Claiming IS this vendor's activation, so the founding-or-trial window
  // starts here, the same grant the register + onboarding paths make. Without a
  // sub row the account would sit on the FREE plan with no lead window to
  // enter (freemium: direct inquiries are PRO). Idempotent. Currency defaults
  // to EUR, the claim flow carries no locale; the vendor can pay in EUR
  // regardless of country.
  initVendorBilling(newVendorAccountId, vendorCurrencyForLocale(null), ts);

  addAuditLog({
    actor_user_id: newUserId,
    couple_id: null,
    action: "vendor.claim.complete",
    target_kind: "listing",
    target_id: null,
    after: {
      listing_id: claim.listing_id,
      vendor_account_id: newVendorAccountId,
    },
  });

  const sessionToken = issueSession(newUserId);
  const userRow = getUserById(newUserId);
  if (!userRow) throw new HttpError(500, "User vanished after claim completion");
  const session: AuthSession = { token: sessionToken, user: toUser(userRow as UserRow) };

  // Close the loop — the vendor just set their password and clicked through;
  // without this confirmation they'd land on /vendor with no proof anywhere
  // that an account was created on their behalf. Fire-and-forget.
  void sendKind(
    "vendor_claim_approved",
    {
      listingName: listing.name,
      managerUrl: `${CONFIG.frontendBaseUrl}/vendor`,
    },
    {
      user: { id: newUserId, email: userRow.email, full_name: userRow.full_name ?? "" },
    },
  );

  return json(session, { status: 201 });
}

export function registerVendorClaimRoutes(router: Router) {
  router.post("/api/vendor/claim/start", handleStart);
  router.post("/api/vendor/claim/verify/:token", handleVerify);
  router.post("/api/vendor/claim/complete", handleComplete);
}
