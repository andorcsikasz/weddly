import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminVendorView } from "@shared/listings";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Register the ADMIN_EMAILS allowlist address, verify, return the bearer. */
async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

function userByEmail(email: string) {
  return db.prepare("SELECT id, role, couple_id FROM users WHERE email = ?").get(email) as
    | { id: number; role: string; couple_id: number | null }
    | undefined;
}

describe("admin convert user to vendor", () => {
  test("channels a mis-routed couple account over to a real vendor", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("supplier@weddly.test");
    const before = userByEmail("supplier@weddly.test");
    expect(before?.role).not.toBe("vendor");
    expect(before?.couple_id).toBe(coupleId);

    const res = await req<{ ok: true; vendor_account_id: number }>(
      "POST",
      `/api/admin/users/${before!.id}/convert-to-vendor`,
      { business_name: "Gyöngy Photography", category: "photography" },
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const accountId = res.data.vendor_account_id;
    expect(accountId).toBeGreaterThan(0);

    // Role flipped, couple_id preserved (non-destructive).
    const after = userByEmail("supplier@weddly.test");
    expect(after?.role).toBe("vendor");
    expect(after?.couple_id).toBe(coupleId);

    // vendor_accounts row created, onboarding pending (wizard runs on sign-in).
    const account = db
      .prepare(
        "SELECT owner_user_id, display_name, onboarding_done FROM vendor_accounts WHERE id = ?",
      )
      .get(accountId) as
      | { owner_user_id: number; display_name: string; onboarding_done: number }
      | undefined;
    expect(account?.owner_user_id).toBe(before!.id);
    expect(account?.display_name).toBe("Gyöngy Photography");
    expect(account?.onboarding_done).toBe(0);

    // A live listing seeded with the chosen category.
    const listing = db
      .prepare("SELECT category, name, status FROM listings WHERE vendor_account_id = ?")
      .get(accountId) as { category: string; name: string; status: string } | undefined;
    expect(listing?.category).toBe("photography");
    expect(listing?.name).toBe("Gyöngy Photography");
    expect(listing?.status).toBe("active");

    // Billing granted (founding-or-trial subscription row).
    const sub = db
      .prepare("SELECT subscription_status FROM vendor_subscriptions WHERE vendor_account_id = ?")
      .get(accountId) as { subscription_status: string } | undefined;
    expect(sub?.subscription_status).toBeDefined();

    // Audit trail.
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.user_convert_to_vendor'")
      .get() as { n: number };
    expect(audit.n).toBe(1);
  });

  test("converted account leaves the users list and appears on the vendors page", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("mover@weddly.test");
    const u = userByEmail("mover@weddly.test");

    await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { business_name: "Mover Studio", category: "dj" },
      { token: adminToken },
    );

    const users = await req<{ users: { email: string }[] }>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(users.data.users.some((x) => x.email === "mover@weddly.test")).toBe(false);

    const vendors = await req<{ active: AdminVendorView[] }>(
      "GET",
      "/api/admin/vendors",
      undefined,
      { token: adminToken },
    );
    expect(vendors.data.active.some((v) => v.owner_email === "mover@weddly.test")).toBe(true);
  });

  test("category 'other' requires a custom label", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("needslabel@weddly.test");
    const u = userByEmail("needslabel@weddly.test");

    const bad = await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "other" },
      { token: adminToken },
    );
    expect(bad.status).toBe(400);

    const good = await req<{ ok: true; vendor_account_id: number }>(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "other", custom_category: "Ice sculptor" },
      { token: adminToken },
    );
    expect(good.status).toBe(200);
    const listing = db
      .prepare("SELECT custom_category FROM listings WHERE vendor_account_id = ?")
      .get(good.data.vendor_account_id) as { custom_category: string | null } | undefined;
    expect(listing?.custom_category).toBe("Ice sculptor");
  });

  test("rejects an unknown category, a second conversion, and non-admins", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();
    const { token: coupleToken } = await bootstrapCouple("guarded@weddly.test");
    const u = userByEmail("guarded@weddly.test");

    // Unknown category → 400.
    const badCat = await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "not_a_real_category" },
      { token: adminToken },
    );
    expect(badCat.status).toBe(400);

    // Non-admin caller → 403.
    const forbidden = await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "catering" },
      { token: coupleToken },
    );
    expect(forbidden.status).toBe(403);

    // First real conversion succeeds.
    const first = await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "catering" },
      { token: adminToken },
    );
    expect(first.status).toBe(200);

    // Converting an already-vendor → 409.
    const again = await req(
      "POST",
      `/api/admin/users/${u!.id}/convert-to-vendor`,
      { category: "catering" },
      { token: adminToken },
    );
    expect(again.status).toBe(409);
  });
});
