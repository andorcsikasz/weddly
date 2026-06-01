// Admin Traffic analytics (Google Analytics 4). The GA4 Data API is NOT
// reachable from the test suite — setup.ts pins GA4_PROPERTY_ID and
// GA4_SERVICE_ACCOUNT_JSON empty — so the endpoint must degrade to a
// `configured:false` payload with zeroed totals + empty arrays, never throw
// or hit the network. The admin gate is verified the same way as the other
// analytics rollups (401 anon, 403 non-admin).
//
// Pairs with backend/src/routes/admin_analytics.ts:trafficAnalytics.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail } from "../helpers";
import type { AdminTrafficAnalytics } from "@shared/admin_analytics";

async function bootstrapAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

describe("admin analytics — traffic (GA4)", () => {
  test("returns configured:false with an empty shape when GA4 is unset", async () => {
    const token = await bootstrapAdmin();
    const res = await req<AdminTrafficAnalytics>("GET", "/api/admin/analytics/traffic", undefined, {
      token,
    });
    expect(res.status).toBe(200);
    const d = res.data;
    expect(d.configured).toBe(false);
    expect(d.error).toBeNull();
    expect(d.property_id).toBe("");
    expect(d.totals_7d.active_users).toBe(0);
    expect(d.totals_28d.sessions).toBe(0);
    expect(d.active_users_daily).toEqual([]);
    expect(d.top_pages).toEqual([]);
    expect(d.channels).toEqual([]);
    expect(d.countries).toEqual([]);
    expect(typeof d.generated_at).toBe("number");
  });

  test("admin gate — anon 401, non-admin couple-role 403", async () => {
    const anon = await req("GET", "/api/admin/analytics/traffic");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-admin-traffic@weddly.test");
    const couple = await req("GET", "/api/admin/analytics/traffic", undefined, { token });
    expect(couple.status).toBe(403);
  });
});
