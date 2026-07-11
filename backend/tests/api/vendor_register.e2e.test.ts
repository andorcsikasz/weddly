// Self-serve vendor signup — the planner-style "create an account directly,
// then run an in-app onboarding wizard" path that replaces the waitlist →
// admin-accept → token-activation flow.
//
// Covers (major-change rule — new endpoints + auth + schema + money/state):
//   - POST /api/vendor/register creates users(role='vendor') + vendor_account +
//     a live listing + a founding subscription, and issues a working session
//   - the fresh account starts with onboarding_done = 0 (wizard pending)
//   - duplicate email → 409; stale consent versions → 400; bad category → 400
//   - founding badge while slots remain; trial once the cohort is full
//   - POST /api/vendor/onboarding/complete flips the flag and is idempotent

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AuthSession } from "@shared/types";
import type { VendorListingView } from "@shared/listings";
import { VENDOR_FOUNDING_CAP } from "@shared/vendor_billing";
import { db } from "../../src/db";
import { req, wipeAll } from "../helpers";

interface RegBody {
  email?: string;
  password?: string;
  full_name?: string;
  business_name?: string;
  company_name?: string;
  category?: string;
  custom_category?: string;
  country?: string;
  registry_number?: string;
  vat_number?: string;
  legal_form?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  contact_phone?: string;
  website?: string;
  privacy_version?: string | null;
  terms_version?: string | null;
  locale?: string;
}

function register(body: RegBody) {
  return req<AuthSession>("POST", "/api/vendor/register", body);
}

const baseBody: RegBody = {
  email: "studio@test.test",
  password: "supersafe123",
  full_name: "Anna Photographer",
  business_name: "Florea Studio",
  category: "photo_video",
  locale: "en",
};

describe("vendor self-serve registration", () => {
  test("creates a vendor user + account + listing + founding sub and a working session", async () => {
    wipeAll();
    const reg = await register(baseBody);
    expect(reg.status).toBe(201);
    expect(reg.data.token).toBeTruthy();
    expect(reg.data.user.role).toBe("vendor");
    expect(reg.data.user.email).toBe("studio@test.test");

    // user row is role='vendor', unverified (soft verification)
    const user = db
      .prepare("SELECT id, role, verified_email FROM users WHERE email = ?")
      .get("studio@test.test") as { id: number; role: string; verified_email: number };
    expect(user.role).toBe("vendor");
    expect(user.verified_email).toBe(0);

    // vendor_account exists, owned by the user, with onboarding pending
    const account = db
      .prepare(
        "SELECT id, display_name, contact_email, onboarding_done FROM vendor_accounts WHERE owner_user_id = ?",
      )
      .get(user.id) as {
      id: number;
      display_name: string;
      contact_email: string;
      onboarding_done: number;
    };
    expect(account.display_name).toBe("Florea Studio");
    expect(account.contact_email).toBe("studio@test.test");
    expect(account.onboarding_done).toBe(0);

    // a live listing was seeded for the account
    const listing = db
      .prepare("SELECT category, name, status FROM listings WHERE vendor_account_id = ?")
      .get(account.id) as { category: string; name: string; status: string };
    expect(listing.category).toBe("photo_video");
    expect(listing.name).toBe("Florea Studio");
    expect(listing.status).toBe("active");

    // a founding subscription was granted (first vendor → free year)
    const sub = db
      .prepare(
        "SELECT subscription_status, is_founding_member, currency FROM vendor_subscriptions WHERE vendor_account_id = ?",
      )
      .get(account.id) as {
      subscription_status: string;
      is_founding_member: number;
      currency: string;
    };
    expect(sub.subscription_status).toBe("founding");
    expect(sub.is_founding_member).toBe(1);
    expect(sub.currency).toBe("EUR"); // locale 'en' → EUR

    // the issued session can read the vendor's own listing
    const me = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, {
      token: reg.data.token,
    });
    expect(me.status).toBe(200);
    expect(me.data.account.onboarding_done).toBe(false);
    expect(me.data.listing.name).toBe("Florea Studio");
  });

  test("rejects a duplicate email with 409", async () => {
    wipeAll();
    const first = await register(baseBody);
    expect(first.status).toBe(201);
    const dup = await register({ ...baseBody, business_name: "Other Studio" });
    expect(dup.status).toBe(409);
  });

  test("rejects a stale consent version with 400", async () => {
    wipeAll();
    const stale = await register({ ...baseBody, privacy_version: "1999-01-01" });
    expect(stale.status).toBe(400);
    // no user was created
    const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get("studio@test.test");
    expect(exists).toBeNull();
  });

  test("rejects an unknown category with 400", async () => {
    wipeAll();
    const bad = await register({ ...baseBody, category: "not_a_real_category" });
    expect(bad.status).toBe(400);
  });

  test("stores the company identity block on the account and seeds the listing from it", async () => {
    wipeAll();
    const reg = await register({
      ...baseBody,
      country: "hu", // lowercase in, uppercased at the boundary
      registry_number: "01-09-123456",
      vat_number: "12345678-2-41",
      legal_form: "Kft.",
      address: "Fő utca 1.",
      city: "Budapest",
      postal_code: "1011",
      contact_phone: "+36 30 123 4567",
      website: "https://florea.example",
    });
    expect(reg.status).toBe(201);

    const account = db
      .prepare(
        `SELECT country, registry_number, vat_number, legal_form, address, city, postal_code, contact_phone
           FROM vendor_accounts WHERE owner_user_id = ?`,
      )
      .get(reg.data.user.id) as {
      country: string;
      registry_number: string;
      vat_number: string;
      legal_form: string;
      address: string;
      city: string;
      postal_code: string;
      contact_phone: string;
    };
    expect(account.country).toBe("HU");
    expect(account.registry_number).toBe("01-09-123456");
    expect(account.vat_number).toBe("12345678-2-41");
    expect(account.legal_form).toBe("Kft.");
    expect(account.address).toBe("Fő utca 1.");
    expect(account.city).toBe("Budapest");
    expect(account.postal_code).toBe("1011");
    expect(account.contact_phone).toBe("+36 30 123 4567");

    // the seeded listing carries the public-facing subset so the onboarding
    // wizard opens prefilled
    const listing = db
      .prepare(
        "SELECT city, address, contact_phone, website FROM listings WHERE vendor_account_id = (SELECT id FROM vendor_accounts WHERE owner_user_id = ?)",
      )
      .get(reg.data.user.id) as {
      city: string;
      address: string;
      contact_phone: string;
      website: string;
    };
    expect(listing.city).toBe("Budapest");
    expect(listing.address).toBe("Fő utca 1.");
    expect(listing.contact_phone).toBe("+36 30 123 4567");
    expect(listing.website).toBe("https://florea.example");
  });

  test("keeps the legal company name distinct from the public display name", async () => {
    wipeAll();
    const reg = await register({
      ...baseBody,
      business_name: "WILD VYBES", // brand / what shows in the ad
      company_name: "WILD VYBES Kft.", // legal name, shown small
    });
    expect(reg.status).toBe(201);

    const account = db
      .prepare("SELECT display_name, company_name FROM vendor_accounts WHERE owner_user_id = ?")
      .get(reg.data.user.id) as { display_name: string; company_name: string };
    expect(account.display_name).toBe("WILD VYBES");
    expect(account.company_name).toBe("WILD VYBES Kft.");

    // the listing (the public ad) carries the brand, NOT the legal name
    const listing = db
      .prepare(
        "SELECT name FROM listings WHERE vendor_account_id = (SELECT id FROM vendor_accounts WHERE owner_user_id = ?)",
      )
      .get(reg.data.user.id) as { name: string };
    expect(listing.name).toBe("WILD VYBES");
  });

  test("category 'other' requires a custom label and stores it on the listing", async () => {
    wipeAll();
    // missing label → 400, nothing created
    const missing = await register({ ...baseBody, category: "other" });
    expect(missing.status).toBe(400);
    expect(db.prepare("SELECT 1 FROM users WHERE email = ?").get(baseBody.email ?? "")).toBeNull();

    const reg = await register({
      ...baseBody,
      category: "other",
      custom_category: "Tűzijáték show",
    });
    expect(reg.status).toBe(201);
    const listing = db
      .prepare(
        "SELECT category, custom_category FROM listings WHERE vendor_account_id = (SELECT id FROM vendor_accounts WHERE owner_user_id = ?)",
      )
      .get(reg.data.user.id) as { category: string; custom_category: string };
    expect(listing.category).toBe("other");
    expect(listing.custom_category).toBe("Tűzijáték show");
  });

  test("drops a stray custom label when a real category is picked", async () => {
    wipeAll();
    const reg = await register({ ...baseBody, custom_category: "should be ignored" });
    expect(reg.status).toBe(201);
    const listing = db
      .prepare(
        "SELECT custom_category FROM listings WHERE vendor_account_id = (SELECT id FROM vendor_accounts WHERE owner_user_id = ?)",
      )
      .get(reg.data.user.id) as { custom_category: string | null };
    expect(listing.custom_category).toBeNull();
  });

  test("company lookup availability + search are reachable without a session", async () => {
    wipeAll();
    // Signup runs pre-account, so the lookup endpoints must not 401. FR has a
    // free provider; the fake provider (COMPANY_LOOKUP_FAKE=1 in tests/setup)
    // serves fixtures.
    const availability = await req<{ available: boolean }>(
      "GET",
      "/api/company-lookup/availability?country=FR",
    );
    expect(availability.status).toBe(200);
    expect(availability.data.available).toBe(true);

    const search = await req<{ results: unknown[] }>(
      "GET",
      "/api/company-lookup/search?country=FR&q=fixture",
    );
    expect(search.status).toBe(200);
    expect(Array.isArray(search.data.results)).toBe(true);
  });

  test("hands the next vendor a trial once the founding cohort is full", async () => {
    wipeAll();
    // Exhaust the founding cohort by seeding CAP granted badges. FK constraints
    // mean each sub needs a real account, and each account a real owner user.
    const insUser = db.prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
       VALUES (?, 'x', 'Seed', 'active', 'vendor', 1, 0, 0)`,
    );
    const insAcct = db.prepare(
      `INSERT INTO vendor_accounts (owner_user_id, display_name, contact_email, onboarding_done, created_at, updated_at)
       VALUES (?, 'Seed', NULL, 1, 0, 0)`,
    );
    const insSub = db.prepare(
      `INSERT INTO vendor_subscriptions
         (vendor_account_id, subscription_status, is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'founding', 1, 'EUR', 0, 0)`,
    );
    for (let i = 1; i <= VENDOR_FOUNDING_CAP; i++) {
      const u = insUser.run(`seed${i}@test.test`);
      const a = insAcct.run(Number(u.lastInsertRowid));
      insSub.run(Number(a.lastInsertRowid));
    }

    const reg = await register(baseBody);
    expect(reg.status).toBe(201);
    const account = db
      .prepare("SELECT id FROM vendor_accounts WHERE owner_user_id = ?")
      .get(reg.data.user.id) as { id: number };
    const sub = db
      .prepare(
        "SELECT subscription_status, is_founding_member FROM vendor_subscriptions WHERE vendor_account_id = ?",
      )
      .get(account.id) as { subscription_status: string; is_founding_member: number };
    expect(sub.subscription_status).toBe("trialing");
    expect(sub.is_founding_member).toBe(0);
  });

  test("onboarding/complete flips the flag and is idempotent", async () => {
    wipeAll();
    const reg = await register(baseBody);
    const token = reg.data.token;

    const first = await req<VendorListingView>(
      "POST",
      "/api/vendor/onboarding/complete",
      undefined,
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.account.onboarding_done).toBe(true);

    // replay is fine
    const second = await req<VendorListingView>(
      "POST",
      "/api/vendor/onboarding/complete",
      undefined,
      { token },
    );
    expect(second.status).toBe(200);
    expect(second.data.account.onboarding_done).toBe(true);

    // persisted
    const me = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, { token });
    expect(me.data.account.onboarding_done).toBe(true);
  });
});

// ─── Google-based vendor signup (POST /api/vendor/register/google) ───────────
// Same provisioning as the password path, but the identity comes from a
// verified Google credential (GOOGLE_TEST_BYPASS is pinned in tests/setup.ts).

import { mintTestBearer } from "../../src/lib/google_oauth";

function registerGoogle(body: Omit<RegBody, "email" | "password"> & { credential: string }) {
  return req<AuthSession>("POST", "/api/vendor/register/google", body);
}

describe("vendor Google registration", () => {
  test("creates a verified vendor from a Google credential + business fields", async () => {
    wipeAll();
    const credential = mintTestBearer({
      sub: "g-vendor-1",
      email: "gvendor@test.test",
      name: "Gábor Vendor",
    });
    const reg = await registerGoogle({
      credential,
      full_name: "ignored — Google name wins",
      business_name: "Google Studio",
      category: "photo_video",
      locale: "en",
    });
    expect(reg.status).toBe(201);
    expect(reg.data.user.role).toBe("vendor");
    expect(reg.data.user.email).toBe("gvendor@test.test");
    // Google attests the address → verified, and it's a Google-only account.
    const user = db
      .prepare(
        "SELECT id, role, verified_email, google_sub, password_set FROM users WHERE email = ?",
      )
      .get("gvendor@test.test") as {
      id: number;
      role: string;
      verified_email: number;
      google_sub: string;
      password_set: number;
    };
    expect(user.role).toBe("vendor");
    expect(user.verified_email).toBe(1);
    expect(user.google_sub).toBe("g-vendor-1");
    expect(user.password_set).toBe(0);
    // The full vendor stack was provisioned (account + listing + founding sub).
    const account = db
      .prepare("SELECT id, display_name FROM vendor_accounts WHERE owner_user_id = ?")
      .get(user.id) as { id: number; display_name: string };
    expect(account.display_name).toBe("Google Studio");
    const listing = db
      .prepare("SELECT status FROM listings WHERE vendor_account_id = ?")
      .get(account.id) as { status: string };
    expect(listing.status).toBe("active");
    const sub = db
      .prepare("SELECT subscription_status FROM vendor_subscriptions WHERE vendor_account_id = ?")
      .get(account.id) as { subscription_status: string };
    expect(sub.subscription_status).toBe("founding");
    // The issued session works against a vendor-only surface.
    const me = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, {
      token: reg.data.token,
    });
    expect(me.status).toBe(200);
  });

  test("an email already in use → 409", async () => {
    wipeAll();
    await register(baseBody); // password vendor on studio@test.test
    const credential = mintTestBearer({ sub: "g-dup", email: "studio@test.test", name: "Dup" });
    const dup = await registerGoogle({
      credential,
      business_name: "Other",
      category: "photo_video",
    });
    expect(dup.status).toBe(409);
  });

  test("missing credential → 400; unknown category → 400", async () => {
    wipeAll();
    const noCred = await req("POST", "/api/vendor/register/google", {
      business_name: "X",
      category: "photo_video",
    });
    expect(noCred.status).toBe(400);

    const credential = mintTestBearer({ sub: "g-badcat", email: "badcat@test.test", name: "B" });
    const badCat = await registerGoogle({
      credential,
      business_name: "X",
      category: "not_a_real_category",
    });
    expect(badCat.status).toBe(400);
  });
});
