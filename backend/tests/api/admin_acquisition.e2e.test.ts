// Admin Acquisition analytics — where signups come from, joined to the
// onboarding funnel. Built from the users.signup_country / device_type /
// locale / utm_* columns captured at registration and replayed onto the users
// row by the verify click (hence `registerAndVerify` for every seeded signup —
// an unverified signup has no users row to roll up). Country is always null in
// the suite (no GeoLite2 DB — see signup_acquisition.e2e.test.ts), so this
// asserts the channel / device / campaign rollups and the admin gate.
//
// Pairs with backend/src/routes/admin_analytics.ts:acquisitionAnalytics.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminAcquisitionAnalytics } from "@shared/admin_analytics";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

function find(rows: AdminAcquisitionAnalytics["by_channel"], key: string | null) {
  return rows.find((r) => r.key === key);
}

describe("admin analytics — acquisition", () => {
  test("rolls up channel / device / campaign across seeded signups", async () => {
    wipeAll();
    const iPhone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148";
    const desktop =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537";

    // Two paid/Google signups (one mobile, one desktop), both on a "spring"
    // campaign; one untagged signup (→ direct channel).
    await registerAndVerify(
      {
        email: "paid-mobile@example.com",
        password: "supersafe123",
        full_name: "Petra Márton",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring",
      },
      { headers: { "user-agent": iPhone } },
    );
    await registerAndVerify(
      {
        email: "paid-desktop@example.com",
        password: "supersafe123",
        full_name: "Pál Dobos",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring",
      },
      { headers: { "user-agent": desktop } },
    );
    await registerAndVerify(
      { email: "organic@example.com", password: "supersafe123", full_name: "Org" },
      { headers: { "user-agent": desktop } },
    );

    const token = await bootstrapAdmin();
    const res = await req<AdminAcquisitionAnalytics>(
      "GET",
      "/api/admin/analytics/acquisition",
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    const d = res.data;

    // Admin (admin@test.test) is excluded by the real-users-only audience, so
    // only the three seeded signups count.
    expect(d.window_days).toBe(30);
    expect(d.total_signups).toBe(3);

    // Channel: 2 paid (utm_medium=cpc) + 1 direct (no utm).
    expect(find(d.by_channel, "paid")?.signups).toBe(2);
    expect(find(d.by_channel, "direct")?.signups).toBe(1);

    // Device: 1 mobile + 2 desktop.
    expect(find(d.by_device, "mobile")?.signups).toBe(1);
    expect(find(d.by_device, "desktop")?.signups).toBe(2);

    // Campaign: only tagged signups (skipNull), so just "spring" with 2.
    expect(d.by_campaign).toHaveLength(1);
    expect(find(d.by_campaign, "spring")?.signups).toBe(2);

    // Country never resolves in tests → all unknown.
    expect(d.unknown_country).toBe(3);
    expect(find(d.by_country, null)?.signups).toBe(3);

    // None onboarded (no couple created) → conversion columns are zero.
    expect(find(d.by_channel, "paid")?.onboarded).toBe(0);
  });

  test("country × locale: unresolved country stays null, never masquerades as HU", async () => {
    // Regression: by_country and the country_locale cross-tab used to default a
    // null signup_country to "HU" *in the displayed cell* while the grouping key
    // kept it null — so a null-country signup rendered as a second row visually
    // identical to the real "HU" row (duplicate "HU / xx" rows in the admin UI),
    // and unknown_country was stuck at 0. Country never resolves in the suite,
    // so every row here must carry country === null (→ "unknown" in the UI).
    wipeAll();
    const desktop =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537";
    for (const email of ["cl-a@example.com", "cl-b@example.com", "cl-c@example.com"]) {
      await registerAndVerify(
        { email, password: "supersafe123", full_name: "Csilla Lakatos" },
        { headers: { "user-agent": desktop } },
      );
    }

    const token = await bootstrapAdmin();
    const res = await req<AdminAcquisitionAnalytics>(
      "GET",
      "/api/admin/analytics/acquisition",
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    const d = res.data;

    // No row defaults an unresolved country to "HU", and the cross-tab dedupes:
    // the displayed (country, locale) pairs are unique.
    expect(d.country_locale.length).toBeGreaterThan(0);
    expect(d.country_locale.every((r) => r.country === null)).toBe(true);
    const pairs = d.country_locale.map((r) => `${r.country ?? "∅"}|${r.locale ?? "∅"}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    // by_country agrees: the only bucket is the null (unknown) one.
    expect(d.by_country.every((r) => r.key === null)).toBe(true);
  });

  test("admin gate — anon 401, non-admin couple-role 403", async () => {
    // Wipe so this file leaves no lingering admin@test.test for the next
    // suite's bootstrapAdmin to collide with (matches admin_growth_funnel).
    wipeAll();
    const anon = await req("GET", "/api/admin/analytics/acquisition");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-admin-acq@weddly.test");
    const couple = await req("GET", "/api/admin/analytics/acquisition", undefined, { token });
    expect(couple.status).toBe(403);
  });
});
