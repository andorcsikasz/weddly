// The couple "finish setting up your wedding" onboarding nudge is COUPLE-ONLY.
// A vendor (role='vendor') or a clientless planner (user_type='planner') has
// couple_id NULL too, but must never be treated as an un-onboarded couple — a
// real vendor got the nudge with a /onboarding CTA and landed on the couple
// "who's getting married?" wizard. Covers the sweep exclusion + the server-side
// 403 guard on the onboarding endpoint (previously untested).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { registerAndVerify, req, wipeAll } from "../helpers";

const HOUR = 1000 * 60 * 60;

async function register(email: string): Promise<{ id: number; token: string }> {
  const r = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Tamás Kovács",
  });
  expect(r.status).toBe(201);
  return { id: r.data.user.id, token: r.data.token };
}

function age(userId: number, ms: number): void {
  db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now() - ms, userId);
}

function gotEmail(userId: number, kind: string): boolean {
  return (
    db.prepare("SELECT 1 FROM email_log WHERE user_id = ? AND kind = ?").get(userId, kind) != null
  );
}

describe("onboarding nudge is couple-only", () => {
  test("a vendor and a clientless planner are NOT nudged; a couple owner is", async () => {
    wipeAll();
    const couple = await register("couple-owner@weddly.test");
    const vendor = await register("vendor-orphan@weddly.test");
    const planner = await register("planner-orphan@weddly.test");
    // Flip roles/types. All three keep couple_id NULL and are aged past 8 days,
    // so both the 24h nudge AND the 1-week nudge would fire if unfiltered.
    db.prepare("UPDATE users SET role = 'vendor' WHERE id = ?").run(vendor.id);
    db.prepare("UPDATE users SET user_type = 'planner' WHERE id = ?").run(planner.id);
    for (const u of [couple, vendor, planner]) age(u.id, 8 * 24 * HOUR);

    const sweep = runEmailSweep();
    // Only the couple owner is eligible → exactly one 24h + one week nudge.
    expect(sweep.nudges).toBe(1);
    expect(sweep.nudgesWeek).toBe(1);

    expect(gotEmail(couple.id, "onboarding_nudge")).toBe(true);
    expect(gotEmail(couple.id, "onboarding_nudge_week")).toBe(true);
    expect(gotEmail(vendor.id, "onboarding_nudge")).toBe(false);
    expect(gotEmail(vendor.id, "onboarding_nudge_week")).toBe(false);
    expect(gotEmail(planner.id, "onboarding_nudge")).toBe(false);
    expect(gotEmail(planner.id, "onboarding_nudge_week")).toBe(false);
  });
});

describe("couple onboarding API rejects non-couple accounts", () => {
  test("a vendor gets 403 onboarding_not_allowed", async () => {
    wipeAll();
    const vendor = await register("vendor-onboard@weddly.test");
    db.prepare("UPDATE users SET role = 'vendor', verified_email = 1 WHERE id = ?").run(vendor.id);
    const res = await req("POST", "/api/couples/onboard", {}, { token: vendor.token });
    expect(res.status).toBe(403);
    expect((res.data as { detail?: { code?: string } }).detail?.code).toBe(
      "onboarding_not_allowed",
    );
  });

  test("a planner gets 403 onboarding_not_allowed", async () => {
    wipeAll();
    const planner = await register("planner-onboard@weddly.test");
    db.prepare("UPDATE users SET user_type = 'planner', verified_email = 1 WHERE id = ?").run(
      planner.id,
    );
    const res = await req("POST", "/api/couples/onboard", {}, { token: planner.token });
    expect(res.status).toBe(403);
    expect((res.data as { detail?: { code?: string } }).detail?.code).toBe(
      "onboarding_not_allowed",
    );
  });
});
