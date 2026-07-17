import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminVendorView } from "@shared/listings";
import { db } from "../../src/db";
import { createVendorListing } from "../../src/domain/listings";
import { recordSupplierEvents } from "../../src/domain/supplier_views";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { createOnboardingToken } from "../../src/domain/vendor_onboarding";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Register the ADMIN_EMAILS allowlist address, verify, return the bearer. */
async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

/** Seed an activated vendor: a users row flipped to role='vendor' plus a
 *  vendor_accounts row. Returns { userId, accountId }. */
async function seedActivatedVendor(
  email: string,
  displayName: string,
): Promise<{ userId: number; accountId: number }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({ ownerUserId: userId, displayName });
  return { userId, accountId: account.id };
}

describe("admin vendor management", () => {
  test("lists activated accounts and pending onboardings together", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("vendor1@weddly.test", "Studio Bloom");
    createOnboardingToken({
      waitlistId: null,
      businessName: "Pending Florals",
      email: "pending@weddly.test",
      category: null,
      locale: null,
    });

    const res = await req<{ active: AdminVendorView[]; pending: AdminVendorView[] }>(
      "GET",
      "/api/admin/vendors",
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toHaveLength(1);
    expect(res.data.active[0]?.id).toBe(accountId);
    expect(res.data.active[0]?.state).toBe("active");
    expect(res.data.active[0]?.display_name).toBe("Studio Bloom");
    expect(res.data.pending).toHaveLength(1);
    expect(res.data.pending[0]?.state).toBe("pending");
    expect(res.data.pending[0]?.display_name).toBe("Pending Florals");
  });

  test("an activated vendor lives on the vendors page, NOT in the couples user list", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("shopowner@weddly.test", "Studio Bloom");

    // Present on FIÓKOK → Szolgáltatók (its home).
    const vendors = await req<{ active: AdminVendorView[] }>(
      "GET",
      "/api/admin/vendors",
      undefined,
      { token: adminToken },
    );
    expect(vendors.data.active.some((v) => v.id === accountId)).toBe(true);

    // Absent from FIÓKOK → Felhasználók — a real vendor has its own page and must
    // not double up in the couples-oriented user list.
    const users = await req<{ users: { email: string }[] }>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(users.data.users.some((u) => u.email === "shopowner@weddly.test")).toBe(false);
  });

  test("vendor admin row rolls up directory views + outbound clicks", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("reach@weddly.test", "Reach Studio");
    createVendorListing({
      vendorAccountId: accountId,
      category: "photo_video",
      name: "Reach Studio",
      city: "Budapest",
      contactEmail: "reach@weddly.test",
    });
    const listingId = `v${accountId}`;

    // The whitelist fix: a self-registered vendor's `v{N}` events are recorded
    // now (they used to be silently dropped). 3 views, 1 website, 1 phone click.
    const written = recordSupplierEvents(
      [
        { supplier_id: listingId, type: "view" },
        { supplier_id: listingId, type: "view" },
        { supplier_id: listingId, type: "view" },
        { supplier_id: listingId, type: "website_click" },
        { supplier_id: listingId, type: "phone_click" },
      ],
      null,
      null,
    );
    expect(written).toBe(5);

    const res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    const row = res.data.active.find((v) => v.id === accountId);
    expect(row?.analytics?.views_total).toBe(3);
    expect(
      (row?.analytics?.website_clicks_total ?? 0) + (row?.analytics?.phone_clicks_total ?? 0),
    ).toBe(2);
  });

  test("suspend + reactivate flips the owner's users.status", async () => {
    const adminToken = await bootstrapAdmin();
    const { userId, accountId } = await seedActivatedVendor("vendor2@weddly.test", "Cake Co");

    const suspend = await req(
      "POST",
      `/api/admin/vendors/${accountId}/suspend`,
      {},
      { token: adminToken },
    );
    expect(suspend.status).toBe(200);
    let row = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status: string };
    expect(row.status).toBe("suspended");

    const reactivate = await req(
      "POST",
      `/api/admin/vendors/${accountId}/reactivate`,
      {},
      { token: adminToken },
    );
    expect(reactivate.status).toBe(200);
    row = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status: string };
    expect(row.status).toBe("active");
  });

  test("PATCH updates business details", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("vendor3@weddly.test", "Old Name");

    const res = await req(
      "PATCH",
      `/api/admin/vendors/${accountId}`,
      { display_name: "New Name", contact_email: "hello@newname.test" },
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT display_name, contact_email FROM vendor_accounts WHERE id = ?")
      .get(accountId) as { display_name: string; contact_email: string | null };
    expect(row.display_name).toBe("New Name");
    expect(row.contact_email).toBe("hello@newname.test");
  });

  test("PATCH sets the company name and renames the vendor's own listing (the ad)", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("branded@weddly.test", "WILD VYBES Kft.");
    // A live claimed listing (id v{N}) whose name mirrors the old display name —
    // this is the public ad the vendor wants to show a brand instead.
    createVendorListing({
      vendorAccountId: accountId,
      category: "photography",
      name: "WILD VYBES Kft.",
      city: "Budapest",
      contactEmail: "branded@weddly.test",
    });

    const res = await req(
      "PATCH",
      `/api/admin/vendors/${accountId}`,
      { display_name: "WILD VYBES", company_name: "WILD VYBES Kft." },
      { token: adminToken },
    );
    expect(res.status).toBe(200);

    const acct = db
      .prepare("SELECT display_name, company_name FROM vendor_accounts WHERE id = ?")
      .get(accountId) as { display_name: string; company_name: string };
    expect(acct.display_name).toBe("WILD VYBES");
    expect(acct.company_name).toBe("WILD VYBES Kft.");

    // the claimed listing (the public ad) now shows the brand, not the legal name
    const listing = db
      .prepare("SELECT name FROM listings WHERE vendor_account_id = ? AND source = 'claimed'")
      .get(accountId) as { name: string };
    expect(listing.name).toBe("WILD VYBES");

    // …and the full public wire path carries both: brand as `name`, legal name
    // as the small `company_name` line.
    const pub = await req<{ detail: { name: string; company_name: string | null } }>(
      "GET",
      `/api/public/vendors/v${accountId}`,
    );
    expect(pub.status).toBe(200);
    expect(pub.data.detail.name).toBe("WILD VYBES");
    expect(pub.data.detail.company_name).toBe("WILD VYBES Kft.");
  });

  test("resend re-mints a pending onboarding token", async () => {
    const adminToken = await bootstrapAdmin();
    const first = createOnboardingToken({
      waitlistId: null,
      businessName: "Resend Me",
      email: "resend@weddly.test",
      category: null,
      locale: null,
    });

    const res = await req(
      "POST",
      `/api/admin/vendors/onboarding/${first.id}/resend`,
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(200);

    // Old token superseded (cancelled), a fresh pending row exists.
    const old = db.prepare("SELECT status FROM vendor_onboarding WHERE id = ?").get(first.id) as {
      status: string;
    };
    expect(old.status).toBe("cancelled");
    const pendingCount = db
      .prepare("SELECT COUNT(*) AS n FROM vendor_onboarding WHERE email = ? AND status = 'pending'")
      .get("resend@weddly.test") as { n: number };
    expect(pendingCount.n).toBe(1);

    // The resend goes out as the transactional `vendor_activation` mail (its
    // button IS the activation link), not the old outreach decision reply.
    const logged = db
      .prepare("SELECT kind, category FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .get("resend@weddly.test") as { kind: string; category: string } | undefined;
    expect(logged?.kind).toBe("vendor_activation");
    expect(logged?.category).toBe("transactional");
  });

  test("admin register mints a pending onboarding + activation email", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await req<{ ok: true; onboarding_id: number }>(
      "POST",
      "/api/admin/vendors/register",
      {
        business_name: "Admin Made Studio",
        email: "admin-made@weddly.test",
        category: "photography",
      },
      { token: adminToken },
    );
    expect(res.status).toBe(201);

    // A pending onboarding row exists — no user account yet (activation pending).
    const pending = db
      .prepare(
        "SELECT business_name, category, status FROM vendor_onboarding WHERE email = ? AND status = 'pending'",
      )
      .get("admin-made@weddly.test") as
      | { business_name: string; category: string; status: string }
      | undefined;
    expect(pending?.business_name).toBe("Admin Made Studio");
    expect(pending?.category).toBe("photography");
    expect(
      db.prepare("SELECT id FROM users WHERE email = ?").get("admin-made@weddly.test") ?? null,
    ).toBeNull();

    // It surfaces in the admin "Aktiválásra vár" list.
    const list = await req<{ pending: { contact_email: string; state: string }[] }>(
      "GET",
      "/api/admin/vendors",
      undefined,
      { token: adminToken },
    );
    expect(list.data.pending.some((p) => p.contact_email === "admin-made@weddly.test")).toBe(true);

    // The activation email went out as the transactional vendor_activation mail.
    const logged = db
      .prepare("SELECT kind, category FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .get("admin-made@weddly.test") as { kind: string; category: string } | undefined;
    expect(logged?.kind).toBe("vendor_activation");

    // Re-registering the same email supersedes the prior link (one live token).
    const again = await req(
      "POST",
      "/api/admin/vendors/register",
      { business_name: "Renamed", email: "admin-made@weddly.test", category: "dj" },
      { token: adminToken },
    );
    expect(again.status).toBe(201);
    const liveCount = db
      .prepare("SELECT COUNT(*) AS n FROM vendor_onboarding WHERE email = ? AND status = 'pending'")
      .get("admin-made@weddly.test") as { n: number };
    expect(liveCount.n).toBe(1);
  });

  test("admin register rejects a taken email (409) and a bad category (400)", async () => {
    const adminToken = await bootstrapAdmin();
    await seedActivatedVendor("taken@weddly.test", "Existing Vendor");
    const dup = await req(
      "POST",
      "/api/admin/vendors/register",
      { business_name: "X", email: "taken@weddly.test", category: "photography" },
      { token: adminToken },
    );
    expect(dup.status).toBe(409);

    const badCat = await req(
      "POST",
      "/api/admin/vendors/register",
      { business_name: "X", email: "fresh@weddly.test", category: "not_a_category" },
      { token: adminToken },
    );
    expect(badCat.status).toBe(400);
  });

  test("non-admin cannot register a vendor", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("nota@weddly.test");
    const res = await req(
      "POST",
      "/api/admin/vendors/register",
      { business_name: "X", email: "x@weddly.test", category: "photography" },
      { token },
    );
    expect(res.status).toBe(403);
  });

  test("DELETE purges the vendor account", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("vendor4@weddly.test", "Gone Soon");

    const res = await req("DELETE", `/api/admin/vendors/${accountId}`, undefined, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT id FROM vendor_accounts WHERE id = ?").get(accountId);
    expect(row ?? null).toBeNull();
  });

  test("list derives the FREE/PRO plan from the billing entitlement", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("vendor5@weddly.test", "Tiered Tunes");
    initVendorBilling(accountId, "HUF");

    // Founding grant → entitled → PRO with the founding badge.
    let res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    let view = res.data.active.find((v) => v.id === accountId);
    expect(view?.plan).toBe("pro");
    expect(view?.billing_reason).toBe("founding");
    expect(view?.is_founding_member).toBe(true);
    expect(view?.subscription_status).toBe("founding");
    // Billing-detail fields the admin row now surfaces (early-adopter "free
    // until" date + the honest payment-status pill inputs).
    expect(typeof view?.founding_until).toBe("number");
    expect(view?.card_on_file).toBe(false);
    expect(view).toHaveProperty("trial_ends_at");
    expect(view).toHaveProperty("current_period_end");
    expect(view).toHaveProperty("billing_starts_at");
    expect(view).toHaveProperty("lead_credits_used");

    // Lapse the founding window → the derived plan falls to FREE.
    db.prepare(
      "UPDATE vendor_subscriptions SET founding_until = ? WHERE vendor_account_id = ?",
    ).run(Date.now() - 1000, accountId);
    res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    view = res.data.active.find((v) => v.id === accountId);
    expect(view?.plan).toBe("free");
    expect(view?.is_founding_member).toBe(true);
  });

  test("demo vendors are excluded from the admin vendor list", async () => {
    const adminToken = await bootstrapAdmin();
    // A real activated vendor, then a throwaway demo vendor (demo-…@demo.weddly.local).
    const { accountId } = await seedActivatedVendor("realvendor@weddly.test", "Real Studio");
    expect((await req("POST", "/api/demo/vendor/start", {})).status).toBe(201);

    const res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    // Only the real vendor survives — the demo one is filtered out (mirrors the
    // planner list), so it never inflates the admin vendor list or its counts.
    expect(res.data.active).toHaveLength(1);
    expect(res.data.active[0]?.id).toBe(accountId);
    expect(res.data.active.some((v) => v.owner_email?.endsWith("@demo.weddly.local"))).toBe(false);
  });

  test("a purged vendor owner is excluded from the admin vendor list", async () => {
    const adminToken = await bootstrapAdmin();
    const keep = await seedActivatedVendor("keep-vendor@weddly.test", "Keep Studio");
    const gone = await seedActivatedVendor("gone-vendor@weddly.test", "Gone Studio");
    // Purge tombstone on the second vendor's owner (email → deleted-…@purged.local).
    db.prepare(
      "UPDATE users SET email = 'deleted-' || id || '@purged.local', status = 'suspended' WHERE id = ?",
    ).run(gone.userId);

    const res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const ids = res.data.active.map((v) => v.id);
    expect(ids).toContain(keep.accountId);
    expect(ids).not.toContain(gone.accountId);
    expect(res.data.active.some((v) => v.owner_email?.endsWith("@purged.local"))).toBe(false);
  });

  test("non-admin is rejected", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("notadmin@weddly.test");
    const res = await req("GET", "/api/admin/vendors", undefined, { token });
    expect(res.status).toBe(403);
  });
});

describe("admin vendor incomplete-listing reminder", () => {
  function completeListing(accountId: number): void {
    createVendorListing({
      vendorAccountId: accountId,
      category: "photography",
      name: "Studio Bloom",
      city: "Budapest",
      contactEmail: "owner@weddly.test",
    });
    const listing = db
      .prepare("SELECT id FROM listings WHERE vendor_account_id = ?")
      .get(accountId) as { id: string };
    const ts = Date.now();
    db.prepare(
      "UPDATE listings SET hero_image_url = ?, blurb_hu = ?, price_band = 3 WHERE id = ?",
    ).run("https://cdn.example/hero.jpg", "Bemutatkozó szöveg.", listing.id);
    db.prepare(
      "INSERT INTO listing_packages (listing_id, name, price_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(listing.id, "Alapcsomag", "150000 Ft", ts, ts);
    db.prepare(
      "INSERT INTO vendor_unavailable_dates (vendor_account_id, blocked_date, created_at) VALUES (?, ?, ?)",
    ).run(accountId, "2030-06-20", ts);
  }

  test("emails an incomplete vendor on demand and advances the reminder count", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("inc1@weddly.test", "Studio Bloom");
    // No listing → every public section missing → incomplete.
    const res = await req<{ ok: boolean; missing: Record<string, boolean> }>(
      "POST",
      `/api/admin/vendors/${accountId}/remind-incomplete`,
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.missing.photos).toBe(true);

    const acct = db
      .prepare("SELECT profile_nudge_count FROM vendor_accounts WHERE id = ?")
      .get(accountId) as { profile_nudge_count: number };
    expect(acct.profile_nudge_count).toBe(1);
    const logged = db
      .prepare(
        `SELECT COUNT(*) AS n FROM email_log
           WHERE kind = 'vendor_profile_incomplete'
             AND user_id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)`,
      )
      .get(accountId) as { n: number };
    expect(logged.n).toBe(1);
  });

  test("400s when the listing is already complete", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("inc2@weddly.test", "Studio Bloom");
    completeListing(accountId);
    const res = await req(
      "POST",
      `/api/admin/vendors/${accountId}/remind-incomplete`,
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(400);
  });

  test("the admin list flags incomplete vendors with their missing sections", async () => {
    const adminToken = await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("inc3@weddly.test", "Studio Bloom");
    const res = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    const row = res.data.active.find((v) => v.id === accountId);
    expect(row?.listing_incomplete).toBe(true);
    expect(row?.listing_missing?.photos).toBe(true);
    expect(row?.profile_nudge_count).toBe(0);
  });

  test("a non-admin cannot send a reminder", async () => {
    await bootstrapAdmin();
    const { accountId } = await seedActivatedVendor("inc4@weddly.test", "Studio Bloom");
    const { token } = await bootstrapCouple("notadmin2@weddly.test");
    const res = await req(
      "POST",
      `/api/admin/vendors/${accountId}/remind-incomplete`,
      {},
      { token },
    );
    expect(res.status).toBe(403);
  });
});
