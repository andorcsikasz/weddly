// Planner subscription billing: the founding grant / trial state machine, the
// entitlement snapshot, the read-only gate once a planner lapses, and graceful
// degradation while Stripe is unconfigured.
//
// Stripe stays DISABLED in tests (STRIPE_ENABLED=false), so the live Checkout /
// Portal / webhook paths are only asserted to 503. Everything else runs against
// the pure entitlement math shared with couples + vendors.

import "../setup";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type PlannerBillingStatus,
  PLANNER_FOUNDING_CAP,
} from "@shared/planner_billing";
import { db, now } from "../../src/db";
import { setBillingEnforcement } from "../../src/domain/billing";
import { initPlannerBilling } from "../../src/domain/planner_billing";
import { req, verifyUserEmail, wipeAll } from "../helpers";

/** Register + verify a user, flip them to a planner, and open their billing
 *  lifecycle (founding grant while slots remain, else a 3-day trial). Returns a
 *  session token + the user id. */
async function makePlanner(email: string): Promise<{ token: string; userId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Planner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET user_type = 'planner' WHERE id = ?").run(userId);
  initPlannerBilling(userId);
  return { token: reg.data.token, userId };
}

/** Seed N founding planner subs (real user rows, since user_id has an enforced
 *  FK) so N of the PLANNER_FOUNDING_CAP slots are consumed. */
function seedFoundingPlanners(n: number): void {
  const ts = now();
  const until = ts + 1000 * 60 * 60 * 24 * 365 * 2;
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, user_type, created_at, updated_at)
     VALUES (?, 'x', 'Seed', 'planner', ?, ?)`,
  );
  const insertSub = db.prepare(
    `INSERT INTO planner_subscriptions
       (user_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, currency, created_at, updated_at)
     VALUES (?, 'founding', NULL, ?, 1, 'EUR', ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const r = insertUser.run(`seed-planner-${i}@weddly.test`, ts, ts);
      insertSub.run(Number(r.lastInsertRowid), until, ts, ts);
    }
  })();
}

const getBilling = (token: string) =>
  req<PlannerBillingStatus>("GET", "/api/planner/billing", undefined, { token });

/** Force a planner's sub past its window so the paywall would bite. */
function lapse(userId: number): void {
  db.prepare(
    `UPDATE planner_subscriptions
        SET subscription_status = 'trialing', trial_ends_at = 1,
            founding_until = NULL, is_founding_member = 0
      WHERE user_id = ?`,
  ).run(userId);
}

describe("planner subscription billing", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    // Never leak the global enforcement switch into other suites.
    setBillingEnforcement(false, 1);
  });

  test("the first planner gets a founding grant (free, no card)", async () => {
    const { token } = await makePlanner("founding@weddly.test");
    const r = await getBilling(token);
    expect(r.status).toBe(200);
    expect(r.data.enabled).toBe(false); // Stripe disabled in tests
    expect(r.data.billing.subscription_status).toBe("founding");
    expect(r.data.billing.is_founding_member).toBe(true);
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.founding_spots_left).toBe(PLANNER_FOUNDING_CAP - 1);
  });

  test("a planner past the founding cohort lands on a 3-day trial", async () => {
    seedFoundingPlanners(PLANNER_FOUNDING_CAP); // all 25 slots consumed
    const { token } = await makePlanner("trialer@weddly.test");
    const r = await getBilling(token);
    expect(r.data.billing.subscription_status).toBe("trialing");
    expect(r.data.billing.is_founding_member).toBe(false);
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.founding_spots_left).toBe(0);
    // Trial window is ~3 days out.
    const daysOut = (r.data.billing.trial_ends_at! - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysOut).toBeGreaterThan(2.5);
    expect(daysOut).toBeLessThan(3.5);
  });

  test("the founding cohort takes exactly the last slot at the boundary", async () => {
    seedFoundingPlanners(PLANNER_FOUNDING_CAP - 1); // one slot left
    const last = await makePlanner("last-founder@weddly.test");
    const over = await makePlanner("just-missed@weddly.test");
    const lastR = await getBilling(last.token);
    const overR = await getBilling(over.token);
    expect(lastR.data.billing.subscription_status).toBe("founding");
    expect(overR.data.billing.subscription_status).toBe("trialing");
    expect(lastR.data.founding_spots_left).toBe(0);
  });

  test("GET /api/planner/billing exposes per-tier prices in the planner currency", async () => {
    const { token } = await makePlanner("prices@weddly.test");
    const r = await getBilling(token);
    // Default (non-HU) locale → EUR pricing.
    expect(r.data.currency).toBe("EUR");
    expect(r.data.prices.starter).toBe(19);
    expect(r.data.prices.pro).toBe(29);
    expect(r.data.prices.premium).toBe(49);
  });

  test("an expired trial flips the planner workspace to read-only (402), reads still work", async () => {
    const { token, userId } = await makePlanner("lapse@weddly.test");
    lapse(userId);
    setBillingEnforcement(true, 1); // paywall live, otherwise the freeze is deferred

    // The billing status read still works and reports the lapse.
    const status = await getBilling(token);
    expect(status.status).toBe(200);
    expect(status.data.billing.entitled).toBe(false);
    expect(status.data.billing.reason).toBe("trial_expired");

    // A mutating request to a workspace edit surface is refused.
    const edit = await req<{ detail?: { code?: string; reason?: string } }>(
      "PATCH",
      "/api/planner/profile",
      { planner_bio: "New bio" },
      { token },
    );
    expect(edit.status).toBe(402);
    expect(edit.data.detail?.code).toBe("subscription_required");
    expect(edit.data.detail?.reason).toBe("trial_expired");
  });

  test("deferred freeze: while enforcement is OFF a lapsed planner still edits", async () => {
    const { token, userId } = await makePlanner("deferred@weddly.test");
    lapse(userId);
    // Leave enforcement OFF (the default) — nobody should be paywalled yet.
    const edit = await req("PATCH", "/api/planner/profile", { planner_bio: "Still editable" }, {
      token,
    });
    expect(edit.status).not.toBe(402);
  });

  test("checkout + webhook degrade gracefully while Stripe is unconfigured", async () => {
    const { token } = await makePlanner("nostripe@weddly.test");
    const checkout = await req("POST", "/api/planner/billing/checkout", { tier: "pro" }, { token });
    expect(checkout.status).toBe(503);
    const webhook = await req("POST", "/api/planner/billing/webhook", {});
    expect(webhook.status).toBe(503);
  });
});
