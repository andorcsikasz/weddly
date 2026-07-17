// Admin analytics rollups — the derived adoption / retention fields layered on
// top of the picks, weddings, and engagement endpoints. Asserts the new fields
// exist, reconcile against their denominators, and move when the underlying
// data does.
//
// Pairs with backend/src/routes/admin_analytics.ts (picksAnalytics,
// weddingAnalytics, engagementAnalytics).

import "../setup";

import { describe, expect, test } from "bun:test";
import type {
  AdminActivityAnalytics,
  AdminEngagementAnalytics,
  AdminPicksAnalytics,
  AdminWeddingAnalytics,
} from "@shared/admin_analytics";
import { registerAndVerify, req, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

// A real couple onboarded WITH style tags — style_tags is only writable at
// onboarding (it's not in the PATCH allowlist), so bootstrapCouple's empty
// default can't exercise the style-adoption rollup.
async function bootstrapCoupleWithStyle(email: string): Promise<{ token: string }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Owner",
  });
  expect(reg.status).toBe(201);
  const ob = await req(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mia & Lucas",
      wedding_date: "2026-09-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: ["rustic", "boho"],
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return { token: reg.data.token };
}

describe("admin analytics — adoption + retention rollups", () => {
  test("style + picks adoption count real couples; retention exposes D+60", async () => {
    wipeAll();
    // A genuine (non-admin, non-test) couple so the real-users-only baseline
    // admits it, onboarded with style tags, then making one supplier pick.
    const { token } = await bootstrapCoupleWithStyle("rollup-couple@example.com");

    const pick = await req(
      "PUT",
      "/api/picks/venue",
      { supplier_id: "curated-venue-1" },
      { token },
    );
    expect(pick.status).toBe(200);

    const admin = await bootstrapAdmin();

    // Weddings: style adoption counts the couple once, never above the total.
    const weddings = await req<AdminWeddingAnalytics>(
      "GET",
      "/api/admin/analytics/weddings",
      undefined,
      { token: admin },
    );
    expect(weddings.status).toBe(200);
    expect(weddings.data.couples_with_style).toBe(1);
    expect(weddings.data.couples_with_style).toBeLessThanOrEqual(weddings.data.total_couples);

    // Planning-time cohort trend: 6 calendar months, current month (last entry)
    // holds the fresh couple with a future wedding date → positive median.
    const cohorts = weddings.data.lead_time_by_cohort;
    expect(cohorts).toHaveLength(6);
    const current = cohorts[cohorts.length - 1];
    expect(current?.count).toBeGreaterThanOrEqual(1);
    expect(current?.median).toBeGreaterThan(0);

    // Picks: the new adoption denominator (total_couples) and numerator
    // (couples_with_any_pick) reconcile.
    const picks = await req<AdminPicksAnalytics>("GET", "/api/admin/analytics/picks", undefined, {
      token: admin,
    });
    expect(picks.status).toBe(200);
    expect(picks.data.total_couples).toBeGreaterThanOrEqual(1);
    expect(picks.data.couples_with_any_pick).toBe(1);
    expect(picks.data.couples_with_any_pick).toBeLessThanOrEqual(picks.data.total_couples);

    // Weekly trend: 12 buckets, the just-made pick lands in the latest week.
    expect(picks.data.picks_weekly).toHaveLength(12);
    expect(picks.data.picks_weekly[11]?.count).toBeGreaterThanOrEqual(1);

    // Engagement: D+60 is present and reconciles with the cohort. Every test
    // user is fresh, so no one is >=60d old → a null rate over a 0 sub-cohort.
    const engagement = await req<AdminEngagementAnalytics>(
      "GET",
      "/api/admin/analytics/engagement",
      undefined,
      { token: admin },
    );
    expect(engagement.status).toBe(200);
    const ret = engagement.data.retention;
    expect(ret.cohort_size_d60).toBeLessThanOrEqual(ret.cohort_size);
    expect(ret.cohort_size_d60).toBe(0);
    expect(ret.d60).toBeNull();

    // Activity: signups carry previous-period counts. The couple + admin both
    // registered just now, so the current windows are populated and the
    // immediately-preceding windows are empty in a freshly-wiped DB.
    const activity = await req<AdminActivityAnalytics>(
      "GET",
      "/api/admin/analytics/activity",
      undefined,
      { token: admin },
    );
    expect(activity.status).toBe(200);
    expect(activity.data.signups.last_7d).toBeGreaterThanOrEqual(1);
    expect(activity.data.signups.prev_7d).toBe(0);
    expect(activity.data.signups.prev_30d).toBe(0);
  });
});
