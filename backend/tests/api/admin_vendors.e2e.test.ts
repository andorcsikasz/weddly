import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminVendorView } from "@shared/listings";
import { db } from "../../src/db";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { createOnboardingToken } from "../../src/domain/vendor_onboarding";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

/** Register the ADMIN_EMAILS allowlist address, verify, return the bearer. */
async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Seed an activated vendor: a users row flipped to role='vendor' plus a
 *  vendor_accounts row. Returns { userId, accountId }. */
async function seedActivatedVendor(
  email: string,
  displayName: string,
): Promise<{ userId: number; accountId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  await verifyUserEmail(email);
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

  test("non-admin is rejected", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("notadmin@weddly.test");
    const res = await req("GET", "/api/admin/vendors", undefined, { token });
    expect(res.status).toBe(403);
  });
});
