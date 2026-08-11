import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { db, now } from "../../src/db";
import { markGuestPagePrepaid, setBillingEnforcement } from "../../src/domain/billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Register + verify a plain user; returns token + id. */
async function registerVerified(email: string): Promise<{ token: string; userId: number }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Person",
  });
  expect(reg.status).toBe(201);
  return { token: reg.data.token, userId: reg.data.user.id };
}

/** Make a user a planner and link them ACTIVE to a couple, optionally entering
 *  the workspace (couple_id set) so couple-scoped edits resolve to that couple. */
function makeManagingPlanner(plannerUserId: number, coupleId: number, enter: boolean): void {
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = ? WHERE id = ?").run(
    enter ? coupleId : null,
    plannerUserId,
  );
  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, 'active', 'planner', ?)",
  ).run(plannerUserId, coupleId, now());
}

/** Force a couple past its free window so the paywall would bite (own
 *  entitlement = false). */
function lapse(coupleId: number): void {
  db.prepare(
    "UPDATE couples SET subscription_status = 'none', trial_ends_at = NULL, founding_until = NULL WHERE id = ?",
  ).run(coupleId);
}

describe("planner-managed billing + guest-page add-on", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    // Never leak the global enforcement switch into other suites.
    setBillingEnforcement(false, 1);
  });

  test("a lapsed couple with NO planner is fully read-only once enforcement is on", async () => {
    const { token, coupleId } = await bootstrapCouple("solo@weddly.test");
    lapse(coupleId);
    setBillingEnforcement(true, 1);

    const guests = await req("POST", "/api/guests", {}, { token });
    expect(guests.status).toBe(402);
    const site = await req("PATCH", "/api/couples/current", { venue_name: "X" }, { token });
    expect(site.status).toBe(402);
  });

  test("planner-managed lapsed couple: the member is viewer-only, the planner still edits", async () => {
    const { token: coupleToken, coupleId } = await bootstrapCouple("managed@weddly.test");
    const planner = await registerVerified("mgr@weddly.test");
    makeManagingPlanner(planner.userId, coupleId, true);
    lapse(coupleId);
    setBillingEnforcement(true, 1);

    // Couple member is blocked (viewer-only) on the workspace.
    const memberEdit = await req("POST", "/api/guests", {}, { token: coupleToken });
    expect(memberEdit.status).toBe(402);

    // The managing planner is NEVER billing-blocked (empty body → not 402).
    const plannerEdit = await req("POST", "/api/guests", {}, { token: planner.token });
    expect(plannerEdit.status).not.toBe(402);
  });

  test("guest-page add-on: planner can't enable until the couple prepaid; then the member edits their guest page", async () => {
    const { token: coupleToken, coupleId } = await bootstrapCouple("addon@weddly.test");
    const planner = await registerVerified("mgr2@weddly.test");
    makeManagingPlanner(planner.userId, coupleId, false);
    lapse(coupleId);
    setBillingEnforcement(true, 1);

    // Before the add-on: member blocked on the guest page too.
    const before = await req(
      "PATCH",
      "/api/couples/current",
      { venue_name: "X" },
      {
        token: coupleToken,
      },
    );
    expect(before.status).toBe(402);

    // Planner cannot switch it on until the couple has prepaid their 30%.
    const earlyEnable = await req<{ code?: string }>(
      "POST",
      `/api/planner/clients/${coupleId}/guest-page-access`,
      { enabled: true },
      { token: planner.token },
    );
    expect(earlyEnable.status).toBe(402);

    // Simulate the 70%-off add-on checkout completing (webhook → prepaid).
    markGuestPagePrepaid(coupleId);

    // Now the planner can switch guest-page editing on.
    const enable = await req<{ guest_page_addon: boolean }>(
      "POST",
      `/api/planner/clients/${coupleId}/guest-page-access`,
      { enabled: true },
      { token: planner.token },
    );
    expect(enable.status).toBe(200);
    expect(enable.data.guest_page_addon).toBe(true);

    // The couple member can now edit their own guest page (not 402)...
    const guestPage = await req(
      "PATCH",
      "/api/couples/current",
      { venue_name: "X" },
      {
        token: coupleToken,
      },
    );
    expect(guestPage.status).not.toBe(402);

    // ...but is still viewer-only on the rest of the workspace.
    const elsewhere = await req("POST", "/api/guests", {}, { token: coupleToken });
    expect(elsewhere.status).toBe(402);
  });

  test("guest-page add-on checkout is 503 when no add-on price is configured", async () => {
    const { token } = await bootstrapCouple("nostripe@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/billing/guest-page-addon/checkout",
      {},
      { token },
    );
    expect(r.status).toBe(503);
    expect(r.data.detail?.code).toBe("payment_not_launched");
  });

  test("billing status exposes the planner-managed + add-on flags", async () => {
    const { token, coupleId } = await bootstrapCouple("flags@weddly.test");
    const planner = await registerVerified("mgr3@weddly.test");
    makeManagingPlanner(planner.userId, coupleId, false);
    markGuestPagePrepaid(coupleId);

    const status = await req<{
      billing: { planner_managed: boolean; guest_page_prepaid: boolean; guest_page_addon: boolean };
    }>("GET", "/api/billing/status", undefined, { token });
    expect(status.status).toBe(200);
    expect(status.data.billing.planner_managed).toBe(true);
    expect(status.data.billing.guest_page_prepaid).toBe(true);
    expect(status.data.billing.guest_page_addon).toBe(false);
  });
});
