// Duplicate vendor accounts: detection + the admin merge that repairs one.
//
// Production produced a real duplicate ("La Contessa Kastélyhotel" ended up
// with two vendor_accounts + two logins) because self-serve register's own
// `assertNoUnclaimedDirectoryTwin` (routes/vendor_register.ts) deliberately
// lets a CLAIMED namesake through — a real second business can share a name —
// and only ever logged it. Nobody reads server logs for that.
//
// Covers (major-change rule — new endpoint + new detection path):
//   - a name/email match against an existing vendor account raises an
//     admin-visible audit_log row, without blocking the registration
//   - POST /api/admin/vendors/:id/merge moves the real listing (photos,
//     reach, reminder history) onto the surviving account, retires the
//     other account's empty listing, fills gaps on the surviving account,
//     retains the absorbed email as secondary_contact_email, suspends the
//     absorbed login (so its email stays taken and can't spawn a third
//     account), and leaves exactly one listing/account for the business

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminVendorView } from "@shared/listings";
import type { AuthSession } from "@shared/types";
import { db } from "../../src/db";
import { req, registerAndVerify, wipeAll } from "../helpers";

interface RegBody {
  email: string;
  password: string;
  full_name: string;
  business_name: string;
  category: string;
  city?: string;
  locale?: string;
}

function register(body: RegBody) {
  return req<AuthSession>("POST", "/api/vendor/register", body);
}

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

function vendorAccountByEmail(email: string) {
  return db
    .prepare(
      `SELECT va.id, va.owner_user_id, va.display_name FROM vendor_accounts va
         JOIN users u ON u.id = va.owner_user_id
        WHERE u.email = ?`,
    )
    .get(email) as { id: number; owner_user_id: number; display_name: string } | undefined;
}

function listingByVendorAccount(id: number) {
  return db.prepare("SELECT id, status FROM listings WHERE vendor_account_id = ?").get(id) as
    | { id: string; status: string }
    | undefined;
}

describe("vendor duplicate detection", () => {
  test("a name match against an existing claimed vendor is logged for an admin, without blocking", async () => {
    wipeAll();
    const first = await register({
      email: "dup-a@test.test",
      password: "supersafe123",
      full_name: "Owner A",
      business_name: "Kettős Rendezvényház",
      category: "venue",
      city: "Pécs",
    });
    expect(first.status).toBe(201);

    const second = await register({
      email: "dup-b@test.test",
      password: "supersafe123",
      full_name: "Owner B",
      business_name: "Kettős Rendezvényház",
      category: "venue",
      city: "Szeged",
    });
    // Never blocked — a real second business can share a name.
    expect(second.status).toBe(201);

    const audit = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE action = 'vendor.duplicate_detected' ORDER BY id DESC LIMIT 1",
      )
      .get() as { after_json: string } | undefined;
    expect(audit).toBeDefined();
    const after = JSON.parse(audit!.after_json) as {
      email: string;
      matches: { owner_email: string }[];
    };
    expect(after.email).toBe("dup-b@test.test");
    expect(after.matches.some((m) => m.owner_email === "dup-a@test.test")).toBe(true);
  }, 30000);

  test("no name/email overlap raises no duplicate alert", async () => {
    wipeAll();
    await register({
      email: "solo@test.test",
      password: "supersafe123",
      full_name: "Owner Solo",
      business_name: "Egyedi Fotó Stúdió",
      category: "photography",
    });
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vendor.duplicate_detected'")
      .get() as { n: number };
    expect(audit.n).toBe(0);
  }, 30000);
});

describe("admin merge duplicate vendor accounts", () => {
  test("moves the real listing onto the surviving account and retires the empty duplicate", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    // The "real" account: has a live listing that already earned photos,
    // directory reach, and incomplete-listing reminders.
    const oldReg = await register({
      email: "old-login@lacontessa.test",
      password: "supersafe123",
      full_name: "Old Owner",
      business_name: "La Contessa Test Kastélyhotel",
      category: "venue",
      city: "Szilvásvárad",
    });
    expect(oldReg.status).toBe(201);
    const oldAccount = vendorAccountByEmail("old-login@lacontessa.test")!;
    const oldListing = listingByVendorAccount(oldAccount.id)!;

    const ts = Date.now();
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      oldListing.id,
      "/uploads/listings/test/hero.webp",
      ts,
    );
    db.prepare(
      "INSERT INTO supplier_events (supplier_id, event_type, created_at) VALUES (?, 'view', ?)",
    ).run(oldListing.id, ts);
    db.prepare(
      "UPDATE vendor_accounts SET profile_nudge_count = 2, profile_nudge_last_at = ?, city = 'Szilvásvárad', onboarding_done = 1 WHERE id = ?",
    ).run(ts, oldAccount.id);

    // The "duplicate" account: same business, re-registered fresh — empty
    // listing, no history.
    const newReg = await register({
      email: "new-login@lacontessa.test",
      password: "supersafe123",
      full_name: "New Owner",
      business_name: "La Contessa Test Kastélyhotel",
      category: "venue",
    });
    expect(newReg.status).toBe(201);
    const newAccount = vendorAccountByEmail("new-login@lacontessa.test")!;
    const newListing = listingByVendorAccount(newAccount.id)!;
    expect(newListing.id).not.toBe(oldListing.id);

    const mergeRes = await req<{
      ok: true;
      deleted_listing_ids: string[];
      hidden_listing_ids: string[];
      fields_filled: string[];
      vendor: AdminVendorView;
    }>(
      "POST",
      `/api/admin/vendors/${newAccount.id}/merge`,
      { absorb_id: oldAccount.id, surviving_listing_id: oldListing.id },
      { token: adminToken },
    );
    expect(mergeRes.status).toBe(200);
    expect(mergeRes.data.deleted_listing_ids).toEqual([newListing.id]);
    expect(mergeRes.data.hidden_listing_ids).toEqual([]);
    expect(mergeRes.data.fields_filled).toContain("secondary_contact_email");
    expect(mergeRes.data.fields_filled).toContain("profile_nudge_count");
    expect(mergeRes.data.fields_filled).toContain("onboarding_done");

    // The real listing now belongs to the surviving account; the photo/event
    // rows never moved because the listing itself carried them.
    const movedListing = db
      .prepare("SELECT vendor_account_id, status FROM listings WHERE id = ?")
      .get(oldListing.id) as { vendor_account_id: number; status: string };
    expect(movedListing.vendor_account_id).toBe(newAccount.id);
    expect(movedListing.status).toBe("active");
    const photoCount = db
      .prepare("SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?")
      .get(oldListing.id) as { n: number };
    expect(photoCount.n).toBe(1);

    // The duplicate's empty listing is gone; only one listing remains for the
    // whole business.
    const goneListing = db.prepare("SELECT id FROM listings WHERE id = ?").get(newListing.id);
    expect(goneListing ?? null).toBeNull();
    const listingCount = db
      .prepare("SELECT COUNT(*) AS n FROM listings WHERE vendor_account_id = ?")
      .get(newAccount.id) as { n: number };
    expect(listingCount.n).toBe(1);

    // Gaps filled on the surviving account, nothing overwritten.
    const survivor = db
      .prepare(
        "SELECT city, secondary_contact_email, profile_nudge_count, onboarding_done FROM vendor_accounts WHERE id = ?",
      )
      .get(newAccount.id) as {
      city: string | null;
      secondary_contact_email: string | null;
      profile_nudge_count: number;
      onboarding_done: number;
    };
    expect(survivor.city).toBe("Szilvásvárad");
    expect(survivor.secondary_contact_email).toBe("old-login@lacontessa.test");
    expect(survivor.profile_nudge_count).toBe(2);
    expect(survivor.onboarding_done).toBe(1);

    // The absorbed account is gone; its login survives but is suspended, so
    // its email stays permanently taken (can't spawn a third account) and
    // can't sign back in either.
    const absorbedAccount = db
      .prepare("SELECT id FROM vendor_accounts WHERE id = ?")
      .get(oldAccount.id);
    expect(absorbedAccount ?? null).toBeNull();
    const oldUser = db
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(oldAccount.owner_user_id) as { status: string };
    expect(oldUser.status).toBe("suspended");

    const thirdAttempt = await register({
      email: "old-login@lacontessa.test",
      password: "supersafe123",
      full_name: "Impersonator",
      business_name: "Something Else",
      category: "venue",
    });
    expect(thirdAttempt.status).toBe(409);

    // Admin list reflects exactly one live account for the business.
    const list = await req<{ active: AdminVendorView[] }>("GET", "/api/admin/vendors", undefined, {
      token: adminToken,
    });
    const survivors = list.data.active.filter(
      (v) => v.display_name === "La Contessa Test Kastélyhotel",
    );
    expect(survivors.length).toBe(1);
    expect(survivors[0]?.listing_count).toBe(1);

    // Audit trail.
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.vendor_merge'")
      .get() as { n: number };
    expect(audit.n).toBe(1);
  }, 30000);

  test("rejects a surviving listing that belongs to neither account, and merging an account into itself", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();
    const a = await register({
      email: "solo-a@test.test",
      password: "supersafe123",
      full_name: "A",
      business_name: "Solo A Kft.",
      category: "venue",
    });
    expect(a.status).toBe(201);
    const accountA = vendorAccountByEmail("solo-a@test.test")!;

    const selfMerge = await req(
      "POST",
      `/api/admin/vendors/${accountA.id}/merge`,
      { absorb_id: accountA.id, surviving_listing_id: "whatever" },
      { token: adminToken },
    );
    expect(selfMerge.status).toBe(400);

    const b = await register({
      email: "solo-b@test.test",
      password: "supersafe123",
      full_name: "B",
      business_name: "Solo B Kft.",
      category: "venue",
    });
    expect(b.status).toBe(201);
    const accountB = vendorAccountByEmail("solo-b@test.test")!;

    const wrongListing = await req(
      "POST",
      `/api/admin/vendors/${accountA.id}/merge`,
      { absorb_id: accountB.id, surviving_listing_id: "not-either-accounts-listing" },
      { token: adminToken },
    );
    expect(wrongListing.status).toBe(400);
  }, 30000);
});
