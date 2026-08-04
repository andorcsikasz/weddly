// Admin financial planner overview — admin-gated billing rollup that feeds the
// client-side revenue forecast.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  type AdminFinancialPlannerOverview,
  type StripeHealth,
  subscriptionUnitEconomics,
} from "@shared/admin_financial_planner";
import { MONTHLY_PRICE, TRIAL_GRACE_MS } from "@shared/billing";
import { db } from "../../src/db";
import { recordGrowthEvent } from "../../src/domain/growth_events";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Seed N placeholder non-demo couples (negative ids) so later real couples
 *  land past the founding cap and get the trial instead of founding. */
function seedCouples(n: number): void {
  const insert = db.prepare(
    `INSERT INTO couples (id, partner_a_id, display_name, bride_name, groom_name,
       style_tags_json, frozen_categories_json, status, created_at, updated_at, is_demo)
     VALUES (?, 1, 'x', '', '', '[]', '[]', 'active', 1, 1, 0)`,
  );
  db.transaction(() => {
    for (let i = 1; i <= n; i++) insert.run(-i);
  })();
}

async function addAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

describe("GET /api/admin/financial-planner/overview", () => {
  test("requires admin", async () => {
    const { token } = await bootstrapCouple("fin-nonadmin@weddly.test");
    const r = await req("GET", "/api/admin/financial-planner/overview", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("reports cohorts, founding spots, and MRR for paying couples", async () => {
    wipeAll();
    // Seed past the founding cap so these real couples start as trialing, not
    // founding — then force one into an active EUR subscription.
    seedCouples(200);
    await bootstrapCouple("fin-trial@weddly.test");
    const { coupleId } = await bootstrapCouple("fin-active@weddly.test");
    db.prepare(
      "UPDATE couples SET subscription_status = 'active', currency = 'EUR' WHERE id = ?",
    ).run(coupleId);
    const adminToken = await addAdmin();

    const r = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.counts.trialing).toBeGreaterThanOrEqual(1);
    expect(r.data.counts.active).toBe(1);
    expect(r.data.paying_subscribers).toBe(1);
    expect(r.data.mrr_eur_total).toBe(MONTHLY_PRICE.EUR); // one EUR subscriber
    expect(r.data.arr_eur_total).toBe(MONTHLY_PRICE.EUR * 12);
    expect(r.data.founding_spots_left).toBe(200);
    expect(r.data.price_huf).toBe(MONTHLY_PRICE.HUF);
  });

  test("counts checkout-started couples (distinct) and total attempts", async () => {
    wipeAll();
    const a = await bootstrapCouple("fin-checkout-a@weddly.test");
    const b = await bootstrapCouple("fin-checkout-b@weddly.test");
    // Couple A reached the pay screen twice (re-tried), couple B once. The
    // headline counts distinct couples; total includes the repeat.
    recordGrowthEvent("checkout.started", { couple_id: a.coupleId });
    recordGrowthEvent("checkout.started", { couple_id: a.coupleId });
    recordGrowthEvent("checkout.started", { couple_id: b.coupleId });
    const adminToken = await addAdmin();

    const r = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.checkout_started_couples).toBe(2);
    expect(r.data.checkout_started_total).toBe(3);
  });

  test("buckets founding-window expiries by month", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("fin-founding@weddly.test");
    const until = new Date("2027-09-15T00:00:00Z").getTime();
    db.prepare(
      "UPDATE couples SET subscription_status = 'founding', is_founding_member = 1, founding_until = ? WHERE id = ?",
    ).run(until, coupleId);
    const adminToken = await addAdmin();

    const r = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    expect(r.data.founding_active).toBe(1);
    expect(r.data.founding_expiry).toContainEqual({ month: "2027-09", count: 1 });
  });

  test("enforcement_impact counts who a flip would freeze, exempting beta and admin", async () => {
    wipeAll();
    // Lapsed: past its trial AND past the 7-day grace, nothing exempting it.
    // Inside the grace it would still be editable, so the preview must not count
    // it — the date has to clear both windows to be a real freeze.
    const dead = Date.now() - (TRIAL_GRACE_MS + 86_400_000);
    const lapsed = await bootstrapCouple("fin-impact-lapsed@weddly.test");
    db.prepare(
      "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?",
    ).run(dead, lapsed.coupleId);
    // Equally lapsed, but a beta tester — never payment-obligated, so the flip
    // does not touch them and neither may the count, or the founder is quoted a
    // freeze bigger than the one that happens.
    const beta = await bootstrapCouple("fin-impact-beta@weddly.test");
    db.prepare(
      "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?",
    ).run(dead, beta.coupleId);
    db.prepare("UPDATE users SET is_beta_tester = 1 WHERE email = ?").run(
      "fin-impact-beta@weddly.test",
    );
    // Healthy trial: unaffected either way.
    const live = await bootstrapCouple("fin-impact-live@weddly.test");
    db.prepare(
      "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?",
    ).run(Date.now() + 86_400_000, live.coupleId);

    const adminToken = await addAdmin();
    const r = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.enforcement_impact.couples).toBe(1);
    // The count is derived, not stored, so it is honest about the other two
    // aggregates as well — neither has a row in this fixture.
    expect(r.data.enforcement_impact.vendors).toBe(0);
    expect(r.data.enforcement_impact.planners).toBe(0);
  });
});

describe("POST /api/admin/financial-planner/enforcement", () => {
  test("pressing the button starts the clocks: lapsed couples enter grace and get mailed", async () => {
    // The whole go-live story, end to end, through the endpoint the admin
    // button actually calls rather than the domain function under it.
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("golive-story@weddly.test");
    // A couple whose trial lapsed long ago, i.e. the shape 111 of the 176 live
    // workspaces are in right now.
    db.prepare(
      "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?",
    ).run(Date.now() - 120 * 86_400_000, coupleId);
    const adminToken = await addAdmin();

    // BEFORE: the freeze is deferred, so they edit freely and hear nothing.
    expect(runEmailSweep().trialEnded).toBe(0);
    const beforeOverview = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    // The button quotes this number before it is pressed.
    expect(beforeOverview.data.enforcement_impact.couples).toBe(1);
    expect(beforeOverview.data.billing_enforcement_on).toBe(false);

    // PRESS.
    const flip = await req<AdminFinancialPlannerOverview>(
      "POST",
      "/api/admin/financial-planner/enforcement",
      { on: true },
      { token: adminToken },
    );
    expect(flip.status).toBe(200);
    expect(flip.data.billing_enforcement_on).toBe(true);

    // AFTER: the clock started, it did not expire. They are still editable...
    const stillEditing = await req(
      "PATCH",
      "/api/couples/current",
      { display_name: "Still planning" },
      { token },
    );
    expect(stillEditing.status).toBe(200);

    // ...and the notice goes out on the very next sweep, naming their deadline.
    expect(runEmailSweep().trialEnded).toBe(1);
    const mailed = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = 'trial_ended'")
      .get(coupleId) as { n: number };
    expect(mailed.n).toBe(1);
  });

  test("go-live is not gated on reaching the 200-couple cap", async () => {
    wipeAll();
    // Far below FOUNDING_CAP: the readiness signal is false, and the flip must
    // still be allowed — starting to charge is a date the founder picks, not a
    // headcount the app reaches.
    await bootstrapCouple("fin-golive@weddly.test");
    const adminToken = await addAdmin();

    const before = await req<AdminFinancialPlannerOverview>(
      "GET",
      "/api/admin/financial-planner/overview",
      undefined,
      { token: adminToken },
    );
    expect(before.data.enforcement_ready).toBe(false);
    expect(before.data.billing_enforcement_on).toBe(false);

    const on = await req<AdminFinancialPlannerOverview>(
      "POST",
      "/api/admin/financial-planner/enforcement",
      { on: true },
      { token: adminToken },
    );
    expect(on.status).toBe(200);
    expect(on.data.billing_enforcement_on).toBe(true);

    // And it is reversible, which is what makes the button safe to offer early.
    const off = await req<AdminFinancialPlannerOverview>(
      "POST",
      "/api/admin/financial-planner/enforcement",
      { on: false },
      { token: adminToken },
    );
    expect(off.status).toBe(200);
    expect(off.data.billing_enforcement_on).toBe(false);
  });

  test("requires admin", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("fin-golive-nonadmin@weddly.test");
    const r = await req(
      "POST",
      "/api/admin/financial-planner/enforcement",
      { on: true },
      { token },
    );
    expect(r.status).toBe(403);
  });
});

describe("GET /api/admin/financial-planner/stripe-health", () => {
  test("requires admin", async () => {
    const { token } = await bootstrapCouple("stripe-nonadmin@weddly.test");
    const r = await req("GET", "/api/admin/financial-planner/stripe-health", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("reports disabled with config flags when Stripe is unset (test env)", async () => {
    wipeAll();
    const token = await addAdmin();
    const r = await req<StripeHealth>(
      "GET",
      "/api/admin/financial-planner/stripe-health",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    // setup.ts pins every STRIPE_* env empty, so billing is disabled and the
    // endpoint must never reach the network — config flags only, no ping.
    expect(r.data.enabled).toBe(false);
    expect(r.data.mode).toBeNull();
    expect(r.data.connection).toBeNull();
    expect(r.data.config).toEqual({
      secretKey: false,
      webhookSecret: false,
      priceEur: false,
      priceHuf: false,
    });
    expect(typeof r.data.checkedAt).toBe("number");
  });
});

describe("GET /api/admin/financial-planner/fx", () => {
  test("requires admin", async () => {
    const { token } = await bootstrapCouple("fx-nonadmin@weddly.test");
    const r = await req("GET", "/api/admin/financial-planner/fx", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("returns null without hitting the network in test env", async () => {
    wipeAll();
    const token = await addAdmin();
    // setup.ts pins FX_DISABLED=1 so the endpoint never makes an outbound FX
    // call — it returns null and the strip just hides.
    const r = await req<unknown>("GET", "/api/admin/financial-planner/fx", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data).toBeNull();
  });
});

// Per-subscription unit economics — the gross HUF price waterfall on the
// planner page. Pins the founder's reference figures so a rate tweak can't
// silently drift the breakdown.
describe("subscriptionUnitEconomics", () => {
  test("1 990 Ft breaks down to ~1 278 Ft in-company / 920 Ft in-hand", () => {
    const e = subscriptionUnitEconomics(1990);
    expect(e).toEqual({
      grossHuf: 1990,
      vatHuf: 423,
      netRevenueHuf: 1567,
      stripeCardHuf: 115,
      stripeBillingHuf: 14,
      afterStripeHuf: 1438,
      hipaHuf: 31,
      taoHuf: 129,
      inCompanyHuf: 1278,
      dividendTaxHuf: 358,
      inHandHuf: 920,
    });
  });

  test("2 490 Ft breaks down to ~1 619 Ft in-company / 1 166 Ft in-hand", () => {
    const e = subscriptionUnitEconomics(2490);
    expect(e).toEqual({
      grossHuf: 2490,
      vatHuf: 529,
      netRevenueHuf: 1961,
      stripeCardHuf: 122,
      stripeBillingHuf: 17,
      afterStripeHuf: 1822,
      hipaHuf: 39,
      taoHuf: 164,
      inCompanyHuf: 1619,
      dividendTaxHuf: 453,
      inHandHuf: 1166,
    });
  });

  test("zero price yields an all-zero breakdown (no fixed Stripe fee on nothing)", () => {
    const e = subscriptionUnitEconomics(0);
    expect(e.grossHuf).toBe(0);
    expect(e.stripeCardHuf).toBe(0);
    expect(e.inCompanyHuf).toBe(0);
    expect(e.inHandHuf).toBe(0);
  });

  test("in-hand is always less than in-company, which is less than net revenue", () => {
    for (const price of [990, 1990, 2490, 4990, 9990]) {
      const e = subscriptionUnitEconomics(price);
      expect(e.inHandHuf).toBeLessThan(e.inCompanyHuf);
      expect(e.inCompanyHuf).toBeLessThan(e.netRevenueHuf);
      expect(e.netRevenueHuf).toBeLessThan(e.grossHuf);
    }
  });
});
