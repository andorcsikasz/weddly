// Shared test harness for backend e2e tests. Mirrors the original helpers
// inlined at the top of backend/tests/e2e.test.ts — pulled into a module so
// the per-domain test files in backend/tests/api/*.e2e.ts can reuse them
// without duplicating ~150 lines apiece.
//
// MUST be imported AFTER `import "./setup"` in test files (or after any
// other import that triggers the server boot), so PORT + DB_PATH + admin
// allowlist env vars are already in place.

import { expect } from "bun:test";

import { PRIVACY_VERSION, TERMS_VERSION, VENDOR_BETA_NOTICE_VERSION } from "@shared/legal";
import { __testPlaintextForHash } from "../src/auth/tokens";
import { db } from "../src/db";
import { seedSupplierTaxonomy } from "../src/domain/supplier_taxonomy";

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
    path === "/api/vendor/register"
  ) {
    // Every register path requires BOTH privacy_version and terms_version
    // for brand-new accounts. Tests probing the "missing version" path
    // pass either field as null to preserve the original probe.
    return {
      ...("privacy_version" in obj ? {} : { privacy_version: PRIVACY_VERSION }),
      ...("terms_version" in obj ? {} : { terms_version: TERMS_VERSION }),
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
    "email_verification_tokens",
    "email_change_tokens",
    "email_log",
    "email_dispatches",
    "email_preferences",
    "community_supplier_reports",
    "community_supplier_verifications",
    "community_suppliers",
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
    // vendor billing/onboarding — subs cascade off vendor_accounts, but delete
    // explicitly (and before vendor_accounts) so a leaked founding badge can't
    // bleed the cohort count into the next test.
    "vendor_onboarding",
    "vendor_subscriptions",
    "vendor_accounts",
    "referral_grants",
    "stripe_webhook_events",
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
    "supplier_bookings",
    "vendor_unavailable_dates",
    "supplier_aggregates",
    // Wipe the taxonomy AFTER the community/couple supplier tables that
    // reference it (FK on category slug) — then seedSupplierTaxonomy at the
    // bottom of this function repopulates the 6 default groups / 14
    // categories. Without this wipe, admin-CRUD tests across files leak
    // extra groups/categories into later tests' baseline counts.
    "supplier_categories",
    "supplier_groups",
    // users MUST come before couples — users.couple_id REFERENCES couples(id)
    // with no CASCADE, so deleting couples first FK-fails (silently swallowed
    // by the try/catch below) and leaves stale rows that bleed into the next
    // test. Order mirrors the original wipeAll in tests/e2e.test.ts.
    "users",
    "couples",
  ];
  for (const t of tables) {
    try {
      db.exec(`DELETE FROM ${t}`);
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
}

/** Mark the most recently-issued verification token for the email as used.
 *  Same code path a real user clicking the welcome-mail link would hit. */
export async function verifyUserEmail(email: string): Promise<void> {
  const token = latestCredentialToken("email_verification_tokens", email);
  const r = await req("POST", `/api/auth/verify/${token}`, {});
  expect(r.status).toBe(200);
}

/** Register a fresh user, verify their email, onboard a default couple, and
 *  return both their bearer token and the new couple_id. The standard
 *  shortcut for any test that needs an authenticated, verified, onboarded
 *  user but doesn't care about the specific values. */
export async function bootstrapCouple(
  email = "couple@weddly.test",
): Promise<{ token: string; coupleId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Owner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
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
