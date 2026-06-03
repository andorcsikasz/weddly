// Admin financial planner overview — admin-gated billing rollup that feeds the
// client-side revenue forecast.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  type AdminFinancialPlannerOverview,
  subscriptionUnitEconomics,
} from "@shared/admin_financial_planner";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

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
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
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
    expect(r.data.mrr_eur_total).toBe(5); // one EUR subscriber at 5 EUR
    expect(r.data.arr_eur_total).toBe(60);
    expect(r.data.founding_spots_left).toBe(200);
    expect(r.data.price_huf).toBe(1990);
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
