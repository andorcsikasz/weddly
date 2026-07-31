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
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import type { AdminTrafficAnalytics } from "@shared/admin_analytics";
import { assembleTrafficPayload, type TrafficReports } from "../../src/routes/admin_analytics";
import type { Ga4ReportResponse } from "../../src/lib/ga4";

/** Build a GA4 report response from compact {dimensions, metrics} rows. GA4
 *  returns every value as a string, so coerce here. */
function rep(rows: Array<{ d: string[]; m: Array<string | number> }>): Ga4ReportResponse {
  return {
    rows: rows.map((r) => ({
      dimensionValues: r.d.map((value) => ({ value })),
      metricValues: r.m.map((v) => ({ value: String(v) })),
    })),
  };
}

/** A single-row totals report in TRAFFIC_METRICS order. */
function totals(au: number, se: number, pv: number, er: number, asd: number): Ga4ReportResponse {
  return rep([{ d: [], m: [au, se, pv, er, asd] }]);
}

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

describe("admin analytics — traffic (GA4)", () => {
  test("returns configured:false with an empty shape when GA4 is unset", async () => {
    // Reset first so admin@test.test registers cleanly regardless of which
    // other admin file ran before us in the shared test process.
    wipeAll();
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
    expect(d.totals_prev_7d.active_users).toBe(0);
    expect(d.new_vs_returning).toEqual({ new_users: 0, returning_users: 0 });
    expect(d.active_users_daily).toEqual([]);
    expect(d.top_pages).toEqual([]);
    expect(d.channels).toEqual([]);
    expect(d.first_touch_channels).toEqual([]);
    expect(d.events).toEqual([]);
    expect(d.countries).toEqual([]);
    expect(d.devices).toEqual([]);
    expect(d.realtime).toEqual({ active_users: 0, by_country: [] });
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

// The GA4 Data API can't be reached from the suite, so the row→DTO mapping is
// covered directly with fixture rows. `now` is pinned so the 14-day zero-fill
// window is deterministic.
describe("admin analytics — traffic GA4 row mapping", () => {
  const NOW = Date.UTC(2026, 5, 15); // 2026-06-15 00:00 UTC

  test("maps every GA4 report into the DTO", () => {
    const reports: TrafficReports = {
      t7: totals(500, 620, 994, 0.5, 75),
      t28: totals(1800, 2100, 4200, 0.45, 70),
      tPrev7: totals(300, 400, 600, 0.4, 60),
      daily: rep([
        { d: ["20260615"], m: [55] },
        { d: ["20260614"], m: [40] },
      ]),
      pages: rep([
        { d: ["/app/guests"], m: [300, 100, 18000] }, // 18000/100 = 180s avg
        { d: ["/"], m: [600, 400, 6000] }, //            6000/400 = 15s avg
        { d: ["/orphan"], m: [10, 0, 999] }, //          users 0 → guard to 0
      ]),
      channels: rep([
        { d: ["Direct"], m: [114] },
        { d: ["Organic Social"], m: [55] },
      ]),
      firstTouch: rep([
        { d: ["Organic Social"], m: [265] },
        { d: ["Direct"], m: [147] },
      ]),
      events: rep([
        { d: ["page_view"], m: [994] },
        { d: ["form_start"], m: [32] },
      ]),
      newReturning: rep([
        { d: ["new"], m: [454] },
        { d: ["returning"], m: [47] },
        { d: ["(not set)"], m: [3] }, // dropped
      ]),
      countries: rep([
        { d: ["Hungary"], m: [320] },
        { d: ["Italy"], m: [40] },
      ]),
      devices: rep([
        { d: ["desktop"], m: [280] },
        { d: ["mobile"], m: [210] },
      ]),
      realtime: rep([
        { d: ["Hungary"], m: [2] },
        { d: ["Italy"], m: [1] },
      ]),
    };

    const d = assembleTrafficPayload(NOW, reports);

    expect(d.configured).toBe(true);
    expect(d.error).toBeNull();
    expect(d.totals_7d).toEqual({
      active_users: 500,
      sessions: 620,
      page_views: 994,
      engagement_rate: 0.5,
      avg_session_seconds: 75,
    });
    expect(d.totals_28d.active_users).toBe(1800);
    expect(d.totals_prev_7d.active_users).toBe(300);

    // new vs returning — "(not set)" bucket dropped.
    expect(d.new_vs_returning).toEqual({ new_users: 454, returning_users: 47 });

    // 14-day window, zero-filled, matched dates landed regardless of row order.
    expect(d.active_users_daily).toHaveLength(14);
    expect(d.active_users_daily[0]?.date).toBe("2026-06-02");
    expect(d.active_users_daily[13]).toEqual({ date: "2026-06-15", count: 55 });
    expect(d.active_users_daily[12]).toEqual({ date: "2026-06-14", count: 40 });
    expect(d.active_users_daily[5]?.count).toBe(0);

    // per-page average engagement = round(userEngagementDuration / activeUsers).
    expect(d.top_pages[0]).toEqual({
      path: "/app/guests",
      views: 300,
      users: 100,
      avg_engagement_seconds: 180,
    });
    expect(d.top_pages[1]?.avg_engagement_seconds).toBe(15);
    expect(d.top_pages[2]?.avg_engagement_seconds).toBe(0); // div-by-zero guard

    expect(d.channels).toEqual([
      { channel: "Direct", sessions: 114 },
      { channel: "Organic Social", sessions: 55 },
    ]);
    expect(d.first_touch_channels[0]).toEqual({ channel: "Organic Social", users: 265 });
    expect(d.events[1]).toEqual({ name: "form_start", count: 32 });
    expect(d.countries[0]).toEqual({ country: "Hungary", users: 320 });
    expect(d.devices).toEqual([
      { device: "desktop", users: 280 },
      { device: "mobile", users: 210 },
    ]);

    // realtime total is the sum of the per-country rows.
    expect(d.realtime.active_users).toBe(3);
    expect(d.realtime.by_country).toHaveLength(2);
    expect(d.generated_at).toBe(NOW);
  });

  test("tolerates empty and partial reports without throwing", () => {
    const empty: Ga4ReportResponse = {};
    const reports: TrafficReports = {
      t7: empty,
      t28: empty,
      tPrev7: empty,
      daily: empty,
      pages: empty,
      channels: empty,
      firstTouch: empty,
      events: empty,
      newReturning: rep([{ d: ["new"], m: [10] }]), // returning bucket absent
      countries: empty,
      devices: empty,
      realtime: empty, // realtime API unavailable → folded to empty upstream
    };

    const d = assembleTrafficPayload(NOW, reports);

    expect(d.totals_7d.active_users).toBe(0);
    expect(d.active_users_daily).toHaveLength(14);
    expect(d.active_users_daily.every((p) => p.count === 0)).toBe(true);
    expect(d.new_vs_returning).toEqual({ new_users: 10, returning_users: 0 });
    expect(d.top_pages).toEqual([]);
    expect(d.devices).toEqual([]);
    expect(d.realtime).toEqual({ active_users: 0, by_country: [] });
  });
});
