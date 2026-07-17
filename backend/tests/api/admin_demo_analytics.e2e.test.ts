// Admin demo analytics — the per-kind split of /api/admin/analytics/demo.
// The three demo entry points (couple / planner / vendor) report into
// separate `by_type` buckets; the throwaway client couples a planner or
// vendor demo seeds are props and must count NOWHERE (before the split,
// one planner demo start inflated the couple headline by several rows).
//
// Pairs with backend/src/routes/admin_analytics.ts (demoAnalytics) and the
// three sweeps in domain/demo_seed.ts / planner_demo_seed.ts /
// vendor_demo_seed.ts.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminDemoAnalytics } from "@shared/admin_analytics";
import { registerAndVerify, req, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

async function startAllThreeDemos(): Promise<void> {
  const couple = await req("POST", "/api/demo/start", { locale: "en" });
  expect(couple.status).toBe(201);
  const planner = await req("POST", "/api/demo/planner/start", { locale: "en" });
  expect(planner.status).toBe(201);
  const vendor = await req("POST", "/api/demo/vendor/start", { locale: "en" });
  expect(vendor.status).toBe(201);
}

async function fetchDemoAnalytics(admin: string): Promise<AdminDemoAnalytics> {
  const res = await req<AdminDemoAnalytics>("GET", "/api/admin/analytics/demo", undefined, {
    token: admin,
  });
  expect(res.status).toBe(200);
  return res.data;
}

describe("admin demo analytics — per-kind split", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("live demos land in their own bucket; seeded client couples count nowhere", async () => {
    await startAllThreeDemos();
    const admin = await bootstrapAdmin();
    const d = await fetchDemoAnalytics(admin);

    // Exactly one live demo per kind. The planner + vendor demos each seed
    // several is_demo client couples — none of them may leak into the
    // couple bucket.
    expect(d.by_type.couple.total).toBe(1);
    expect(d.by_type.planner.total).toBe(1);
    expect(d.by_type.vendor.total).toBe(1);
    expect(d.total_demos).toBe(3);

    // Every start is fresh, so it shows in each window and in the daily
    // series' last bucket.
    for (const kind of ["couple", "planner", "vendor"] as const) {
      const s = d.by_type[kind];
      expect(s.new_demos.last_24h).toBe(1);
      expect(s.new_demos.last_7d).toBe(1);
      expect(s.served_total).toBe(1);
      expect(s.demos_daily[s.demos_daily.length - 1]?.count).toBe(1);
      // The demo.start / demo.start_planner / demo.start_vendor audit row
      // registers as activity for its own cohort.
      expect(s.events_30d).toBeGreaterThanOrEqual(1);
      expect(s.active_24h).toBe(1);
    }

    // Combined headline is the sum of the three kinds.
    expect(d.new_demos.last_24h).toBe(3);
    expect(d.active_demos_24h).toBe(3);
    expect(d.total_demos_served).toBe(3);
    expect(d.demos_daily[d.demos_daily.length - 1]?.count).toBe(3);
  });

  test("purge snapshots preserve per-kind served counts and daily series", async () => {
    await startAllThreeDemos();

    // Force-reap everything, planners + vendors BEFORE couples (the
    // ordering contract from routes/demo.ts).
    const { purgeStalePlannerDemos } = await import("../../src/domain/planner_demo_seed");
    const { purgeStaleVendorDemos } = await import("../../src/domain/vendor_demo_seed");
    const { purgeStaleDemoCouples } = await import("../../src/domain/demo_seed");
    expect(purgeStalePlannerDemos(0)).toBe(1);
    expect(purgeStaleVendorDemos(0)).toBe(1);
    // The couples sweep reaps the visitor demo AND the seeded clients.
    expect(purgeStaleDemoCouples(0)).toBeGreaterThanOrEqual(3);

    const admin = await bootstrapAdmin();
    const d = await fetchDemoAnalytics(admin);

    // Nothing live anymore, but each kind keeps exactly one served demo —
    // the purged client-couple snapshots (kind '*_client') stay out.
    for (const kind of ["couple", "planner", "vendor"] as const) {
      const s = d.by_type[kind];
      expect(s.total).toBe(0);
      expect(s.served_total).toBe(1);
      // Starts survive the reaper via the demo_usage snapshot, so the
      // daily chart still shows today's demo.
      expect(s.new_demos.last_24h).toBe(1);
      expect(s.demos_daily[s.demos_daily.length - 1]?.count).toBe(1);
    }
    expect(d.total_demos).toBe(0);
    expect(d.total_demos_served).toBe(3);
  });
});
