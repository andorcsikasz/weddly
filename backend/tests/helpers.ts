// Shared test harness for backend e2e tests. Mirrors the original helpers
// inlined at the top of backend/tests/e2e.test.ts — pulled into a module so
// the per-domain test files in backend/tests/api/*.e2e.ts can reuse them
// without duplicating ~150 lines apiece.
//
// MUST be imported AFTER `import "./setup"` in test files (or after any
// other import that triggers the server boot), so PORT + DB_PATH + admin
// allowlist env vars are already in place.

import { expect } from "bun:test";

import { TRIAL_GRACE_MS } from "@shared/billing";
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  VENDOR_BETA_NOTICE_VERSION,
  VENDOR_TERMS_VERSION,
} from "@shared/legal";
import type { AuthSession } from "@shared/types";
import { __testPlaintextForHash } from "../src/auth/tokens";
import { db, VISITOR_SYSTEM_USER_EMAIL } from "../src/db";
import { seedSupplierTaxonomy } from "../src/domain/supplier_taxonomy";
import { __resetGoogleCalendarFake } from "../src/lib/google_calendar";
import { resetPublicStatsCache } from "../src/routes/public_stats";

/** Single-use credential token tables whose values are now stored hashed
 *  (auth/tokens.ts). Tests can't read the plaintext from the row anymore, so
 *  `latestCredentialToken` resolves it through the test-only capture map. */
type HashedTokenTable =
  | "email_verification_tokens"
  | "password_reset_tokens"
  | "email_change_tokens";

/** Recover the PLAINTEXT of the most-recent hashed credential token for an
 *  email — the value a real user would receive in the link. Mirrors the
 *  "click the emailed link" path now that only the hash is persisted. */
export function latestCredentialToken(table: HashedTokenTable, email: string): string {
  const row = db
    .prepare(
      `SELECT token FROM ${table} WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1`,
    )
    .get(email.trim().toLowerCase()) as { token: string } | undefined;
  if (!row) throw new Error(`no ${table} row for ${email}`);
  const plaintext = __testPlaintextForHash(row.token);
  if (!plaintext) throw new Error(`no captured plaintext for ${table}/${email}`);
  return plaintext;
}

/** As `latestCredentialToken` but resolves the plaintext for a given stored
 *  hash directly (for sites that already hold a token row). */
export function plaintextForStoredToken(storedHash: string): string {
  const plaintext = __testPlaintextForHash(storedHash);
  if (!plaintext) throw new Error("no captured plaintext for token hash");
  return plaintext;
}

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

export interface ReqOpts {
  token?: string;
  clientIp?: string;
  /** Extra HTTP headers (e.g. `If-Match`) merged onto the request. */
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  status: number;
  data: T;
}

/** Same shape as the helper inlined at the top of e2e.test.ts — kept
 *  intentionally identical so any test moved over from there compiles
 *  unchanged. Spoofs a unique client IP per call so the rate-limit
 *  buckets don't bleed across the cohort. */
export async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: ReqOpts = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-client-ip":
      opts.clientIp ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers[k] = v;
  }

  const finalBody = withConsentVersions(method, path, body);

  // The vendor-waitlist endpoint consumes multipart/form-data (it accepts an
  // optional price_list upload), so encode the JSON-shaped test body as a form.
  // Arrays map to repeated `key[]` fields (e.g. portfolio_links[]); null/
  // undefined are dropped so "missing version" probes still hit the 400 path.
  // Drop the JSON Content-Type and let fetch set the multipart boundary.
  if (
    method === "POST" &&
    path === "/api/vendors/waitlist" &&
    finalBody &&
    typeof finalBody === "object"
  ) {
    delete headers["Content-Type"];
    const form = new FormData();
    for (const [key, value] of Object.entries(finalBody as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) form.append(`${key}[]`, String(item));
        }
      } else {
        form.append(key, String(value));
      }
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: form });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: finalBody === undefined ? undefined : JSON.stringify(finalBody),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data: data as T };
}

/** Backfills the GDPR consent-version fields on register + vendor-waitlist
 *  payloads so individual tests don't have to thread them through. Tests
 *  that deliberately probe the "missing version" path pass `null` explicitly,
 *  which this helper preserves. */
function withConsentVersions(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || body === undefined || body === null || typeof body !== "object") {
    return body;
  }
  const obj = body as Record<string, unknown>;
  if (
    path === "/api/auth/register" ||
    path === "/api/auth/google" ||
    path === "/api/auth/apple" ||
    path === "/api/vendor/register" ||
    path === "/api/vendor/register/google"
  ) {
    // Every register path requires the exact policy documents applicable to
    // that role.
    // for brand-new accounts. Tests probing the "missing version" path
    // pass either field as null to preserve the original probe.
    const vendorFields = path.startsWith("/api/vendor/")
      ? {
          ...("vendor_terms_version" in obj ? {} : { vendor_terms_version: VENDOR_TERMS_VERSION }),
          ...("highlighted_terms_accepted" in obj ? {} : { highlighted_terms_accepted: true }),
        }
      : { ...("terms_version" in obj ? {} : { terms_version: TERMS_VERSION }) };
    return {
      ...("privacy_version" in obj ? {} : { privacy_version: PRIVACY_VERSION }),
      ...vendorFields,
      ...obj,
    };
  }
  if (path === "/api/vendors/waitlist") {
    return {
      ...("privacy_version" in obj ? {} : { privacy_version: PRIVACY_VERSION }),
      ...("vendor_beta_notice_version" in obj
        ? {}
        : { vendor_beta_notice_version: VENDOR_BETA_NOTICE_VERSION }),
      ...obj,
    };
  }
  return body;
}

/** Wipe every couple/user-scoped table so tests start from a clean state.
 *  Order matters — children before parents. Wrapped so a missing table
 *  (e.g. a fresh checkout that hasn't run a recent migration yet) doesn't
 *  abort the suite. Re-seeds the supplier taxonomy because community
 *  supplier + admin tests assume the 6-group / 14-category baseline. */
export function wipeAll(): void {
  const tables = [
    "audit_log",
    "couple_pause_requests",
    "seat_assignments",
    "seating_conflicts",
    "seating_tables",
    "schedule_events",
    "wishlist_interests",
    "wishlist_items",
    "received_gifts",
    "planning_items",
    "moodboard_images",
    "guests",
    "households",
    "budget_snapshots",
    "budget_lines",
    "data_exports",
    "couple_invites",
    "sessions",
    "rate_limit_buckets",
    "password_reset_tokens",
    "planner_activation_tokens",
    // Unclicked signups. A leaked row makes the NEXT test's register for the
    // same address hit the ON CONFLICT update path and, worse, leaves
    // `verifyUserEmail` redeeming a stale token minted by the previous test.
    "pending_signups",
    "email_verification_tokens",
    "email_change_tokens",
    "email_log",
    "email_dispatches",
    "admin_email_send_dedupe",
    "email_preferences",
    "community_supplier_reports",
    "community_supplier_verifications",
    "community_suppliers",
    // Curated moderation overrides — a leaked tombstone would hide a curated
    // slug from the public list in a later test.
    "curated_supplier_overrides",
    "couple_suppliers",
    "couple_supplier_costs",
    "couple_picks",
    "supplier_votes",
    "vendor_waitlist",
    "feedback_submissions",
    "demo_usage",
    "couple_members",
    // P2.A — unified listing/vendor schema; community rows in `listings` orphan
    // when community_suppliers is wiped, so clean them here. Curated rows are
    // re-materialised by `backfillListings()` on the next boot; tests don't
    // re-trigger it because the server is already running, so we DELETE only
    // the community/claimed rows and trust the boot snapshot for curated.
    "growth_events",
    "listing_claims",
    // Claim-invite campaign: sends cascade off campaigns, but delete both (and
    // in child-before-parent order) so a leaked send row can't make the next
    // test's targeting query skip an address it should have picked up.
    "vendor_claim_campaign_sends",
    "vendor_claim_campaigns",
    // Address-level suppression is a permanent tombstone in prod, which is
    // exactly why a leaked row would silently mute a later test's outreach.
    "email_optouts",
    // vendor billing/onboarding — subs cascade off vendor_accounts, but delete
    // explicitly (and before vendor_accounts) so a leaked founding badge can't
    // bleed the cohort count into the next test.
    "vendor_onboarding",
    "vendor_subscriptions",
    "vendor_accounts",
    "referral_grants",
    "stripe_webhook_events",
    "stripe_webhook_deliveries",
    "couple_currency_history",
    "consent_log",
    "supplier_views",
    // Admin-only supplier detail tables — wipe in child-before-parent order
    // (review_tags references supplier_reviews via FK; the latter has no FK
    // to anything we wipe afterwards). Aggregates table is keyed by
    // supplier_id string so no FK ordering concern.
    "supplier_review_tags",
    "supplier_reviews",
    "supplier_comments",
    // Booking threads cascade off supplier_bookings (and attachments off the
    // messages), but the file's convention is to name child tables explicitly
    // so a future FK change can't silently start leaking rows between suites.
    "booking_message_attachments",
    "booking_messages",
    "vendor_message_templates",
    "supplier_bookings",
    "vendor_unavailable_dates",
    "supplier_aggregates",
    // Verified-visitor identity + device sessions (email-verified parties with
    // no account). Sessions cascade off verified_visitors, but wipe explicitly
    // (child first). supplier_reviews.author_visitor_id and community_suppliers.
    // submitter_visitor_id are ON DELETE SET NULL, so ordering vs those is free.
    "verified_visitor_sessions",
    "verified_visitors",
    // Wipe the taxonomy AFTER the community/couple supplier tables that
    // reference it (FK on category slug) — then seedSupplierTaxonomy at the
    // bottom of this function repopulates the 6 default groups / 14
    // categories. Without this wipe, admin-CRUD tests across files leak
    // extra groups/categories into later tests' baseline counts.
    "supplier_categories",
    "supplier_groups",
    // Planner tables. planner_clients/planner_invitations cascade off users,
    // but wipe explicitly for determinism; planner_waitlist is keyed by email
    // (no FK) so it MUST be wiped here or accepted entries leak into the next
    // test's auto-promote check.
    "planner_invitations",
    "planner_clients",
    "planner_messages",
    "planner_events",
    "planner_portfolio",
    "planner_waitlist",
    // Planner billing — subs cascade off users, but delete explicitly (and
    // before users) so a leaked founding badge can't bleed the cohort count
    // into the next test.
    "planner_subscriptions",
    // Google Calendar push-sync — cascade off couples/users, but wipe
    // explicitly (child map before the connection) so a leaked connection can't
    // bleed into the next test's status assertions.
    "google_calendar_event_map",
    "google_calendar_connections",
    // Same for the vendor-side push-sync (parallel aggregate, own tables).
    "vendor_google_calendar_event_map",
    "vendor_google_calendar_connections",
    // Couple-card deck feedback + the 26th-card suggestions. Anonymous, keyed by
    // deck_id string (no FK to anything we wipe), so nothing forces the order —
    // but they MUST be listed or rows accumulate across runs and inflate the
    // admin couple-card analytics counts in a later test.
    "couple_card_feedback",
    "couple_card_suggestions",
    "content_notices",
    // users MUST come before couples — users.couple_id REFERENCES couples(id)
    // with no CASCADE, so deleting couples first FK-fails (silently swallowed
    // by the try/catch below) and leaves stale rows that bleed into the next
    // test. Order mirrors the original wipeAll in tests/e2e.test.ts.
    "users",
    "couples",
  ];
  for (const t of tables) {
    try {
      if (t === "users") {
        // Preserve the reserved verified-visitor system user — db.ts seeds it
        // once and getVisitorSystemUserId() caches its id, so deleting the row
        // would leave a stale cached id that FK-fails the next visitor-authored
        // insert (review / community supplier).
        db.prepare("DELETE FROM users WHERE email != ?").run(VISITOR_SYSTEM_USER_EMAIL);
      } else {
        db.exec(`DELETE FROM ${t}`);
      }
    } catch {
      // Table may not yet exist on a fresh boot; ignore.
    }
  }
  // Listings.curated stays (re-materialised by backfill on boot); wipe the
  // mutable community/claimed slices so a test isn't surprised by orphans.
  try {
    db.exec("DELETE FROM listings WHERE source != 'curated'");
  } catch {
    // Listings table may not yet exist on a fresh boot; ignore.
  }
  // Re-seed the supplier taxonomy after wiping — public directory + admin
  // taxonomy tests expect the 6 default groups / 14 categories to exist.
  // seedSupplierTaxonomy is idempotent so a partial wipe is safe.
  seedSupplierTaxonomy();
  // Reset the billing kill-switch to its default (off) so a test that flips it
  // on doesn't leak enforcement into the next one. The singleton row is never
  // deleted, just reset.
  try {
    db.exec(
      "UPDATE billing_control SET enforcement_on = 0, enforced_at = NULL, enforced_by_user_id = NULL WHERE id = 1",
    );
  } catch {
    // Table may not exist on a very old DB; ignore.
  }
  // New-payment launch switches are independent of entitlement enforcement,
  // but share the same safe resting state: every test starts with all products
  // OFF unless it explicitly exercises a launched surface.
  try {
    db.exec(
      "UPDATE payment_launch_control SET enabled = 0, version = 0, updated_at = NULL, updated_by_user_id = NULL",
    );
  } catch {
    // Table may not exist on a very old DB; ignore.
  }
  // Drop any fake Google calendars a prior test created so their event counts
  // don't leak into the next case's assertions.
  __resetGoogleCalendarFake();
  // The landing-page counters are memoised for 60s IN PROCESS, so wiping the
  // tables is not enough: a suite that ran less than a minute earlier leaves
  // real counts in the cache, and the next "0/0 on an empty database" assertion
  // reads them instead of the empty tables it just created. Passes alone, fails
  // in a full run, which is the shape that wastes an afternoon.
  resetPublicStatsCache();
}

/** Turn the global go-live switch ON for this test. Entitlement is DEFERRED by
 *  default (the production resting state, reset by `wipeAll`), which means no
 *  aggregate is gated: a lapsed couple, planner or vendor still reads as
 *  entitled. Any test asserting that a paywall BITES has to flip this first, or
 *  it is asserting against a wall that isn't up yet. Call after `wipeAll()`. */
/** Age the paywall past the post-trial grace week, so a lapsed couple is really
 *  read-only. The week counts from whichever came LATER, the trial ending or the
 *  wall going up, so enabling enforcement this instant still owes every lapsed
 *  couple seven days: a test that lapses a trial and flips the switch gets 200,
 *  not 402, until this is called. Pairs with `enableBillingEnforcement` /
 *  `setBillingEnforcement`, and reads as what it is for at the call site. */
export function expireTrialGraceWindow(): void {
  db.prepare("UPDATE billing_control SET enforced_at = ? WHERE id = 1").run(
    Date.now() - (TRIAL_GRACE_MS + 60_000),
  );
}

export function enableBillingEnforcement(): void {
  // Stamps `enforced_at` exactly as `setBillingEnforcement` does in production.
  // It is not decoration: the post-trial grace week counts from whichever came
  // later, the trial end or the wall going up, so a helper that left it NULL
  // would quietly test a different rule than the one that ships.
  db.prepare("UPDATE billing_control SET enforcement_on = 1, enforced_at = ? WHERE id = 1").run(
    Date.now(),
  );
}

/** Recover the PLAINTEXT verify-link token for a parked signup — the value the
 *  welcome mail would carry. A password register no longer creates a `users`
 *  row, so its token lives in `pending_signups`, not
 *  `email_verification_tokens` (see domain/pending_signups.ts). */
export function latestPendingSignupToken(email: string): string {
  const row = db
    .prepare("SELECT token FROM pending_signups WHERE email = ?")
    .get(email.trim().toLowerCase()) as { token: string } | undefined;
  if (!row) throw new Error(`no pending_signups row for ${email}`);
  const plaintext = __testPlaintextForHash(row.token);
  if (!plaintext) throw new Error(`no captured plaintext for pending_signups/${email}`);
  return plaintext;
}

/** Click the verify link for an address — whichever kind of link it is.
 *
 *  Three cases, because there are three states an address can be in:
 *   - a parked signup (the password-register path): the click MINTS the
 *     account and returns its first session;
 *   - a real but unverified user (vendor register, a resend): flips the flag;
 *   - already verified: no-op.
 *
 *  The last case keeps `register -> verify` call sites working after
 *  `registerAndVerify` already did the verifying. */
export async function verifyUserEmail(email: string): Promise<void> {
  const pending = db
    .prepare("SELECT id FROM pending_signups WHERE email = ?")
    .get(email.trim().toLowerCase());
  if (pending) {
    const r = await req("POST", `/api/auth/verify/${latestPendingSignupToken(email)}`, {});
    expect(r.status).toBe(201);
    return;
  }
  const user = db
    .prepare("SELECT verified_email FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as { verified_email: number } | undefined;
  if (user?.verified_email) return;
  const token = latestCredentialToken("email_verification_tokens", email);
  const r = await req("POST", `/api/auth/verify/${token}`, {});
  expect(r.status).toBe(200);
}

/** Register + click the verify link, returning the session the way
 *  `POST /api/auth/register` used to.
 *
 *  Register alone no longer yields a session (it parks a pending signup and
 *  returns 202) — the account only exists once the link is clicked. Almost
 *  every test wants "a user that exists and is signed in", so this helper keeps
 *  the old `{ status: 201, data: { token, user } }` shape and callers can stay
 *  as they were. Tests probing register itself (409 on a taken address, stale
 *  consent versions, the 202 body) should call `req` directly. */
export async function registerAndVerify(
  body: Record<string, unknown>,
  opts: ReqOpts = {},
): Promise<ApiResult<AuthSession>> {
  const email = String(body.email ?? "");
  const reg = await req<{ pending: true; email: string }>("POST", "/api/auth/register", body, opts);
  if (reg.status !== 202) {
    // Surface the real failure (409 / 400 / 429) instead of dying later on a
    // missing pending row.
    return { status: reg.status, data: reg.data as unknown as AuthSession };
  }
  const verified = await req<AuthSession>(
    "POST",
    `/api/auth/verify/${latestPendingSignupToken(email)}`,
    {},
    opts,
  );
  expect(verified.status).toBe(201);
  return verified;
}

/** Register a fresh user, verify their email, onboard a default couple, and
 *  return both their bearer token and the new couple_id. The standard
 *  shortcut for any test that needs an authenticated, verified, onboarded
 *  user but doesn't care about the specific values. */
export async function bootstrapCouple(
  email = "couple@weddly.test",
): Promise<{ token: string; coupleId: number }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Owner",
  });
  expect(reg.status).toBe(201);
  const ob = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mia & Lucas",
      wedding_date: "2026-09-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return { token: reg.data.token, coupleId: ob.data.couple.id };
}
