// P6b — admin growth-funnel analytics. Verifies:
//   - GET /api/admin/analytics/growth-funnel returns the 6-step funnel in
//     order: signup.started → signup.completed → couple.created
//          → wedding_site.view → rsvp.page.view → rsvp.submitted
//   - signup.started fires at register (user_id NULL — no account exists yet)
//     and signup.completed at the verify click that mints the account, so
//     step 1's conversion IS the email-confirm rate
//   - count_7d / count_24h reflect the rolling windows
//   - conversion_from_prev is null on step 0, computed as ratio elsewhere,
//     null when the previous step is 0 (avoids NaN on a fresh deploy)
//   - referrers_7d aggregates `signup.from_referrer` payload.referrer values
//   - stalled_couple_ids surfaces couples created in last 7d with no
//     wedding_site.view yet (and excludes those that have one)
//   - empty DB returns zero-filled steps + empty arrays without throwing
//   - admin gate stays — 401 anon, 403 non-admin
//
// Pairs with backend/src/routes/admin_analytics.ts:growthFunnelAnalytics.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, verifyUserEmail, wipeAll } from "../helpers";
import { db, now } from "../../src/db";
import type { AdminGrowthFunnelAnalytics } from "@shared/admin_analytics";

/** Register + verify the admin and immediately wipe the growth_events rows the
 *  signup recorded — `signup.started` at register plus `signup.completed` at the
 *  verify click. Every assertion below pins specific event counts, so we need a
 *  clean substrate. wipeAll() runs in the caller BEFORE we register, so we can't
 *  rely on it alone. */
async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  db.exec("DELETE FROM growth_events");
  return reg.data.token;
}

/** Direct-insert a growth_events row with full control over kind, created_at,
 *  couple_id, and payload. Bypasses the recordGrowthEvent helper because the
 *  funnel tests need to backdate rows (the 24h vs 7d windows are the point). */
function insertGrowth(opts: {
  kind: string;
  createdAt: number;
  coupleId?: number | null;
  userId?: number | null;
  payload?: Record<string, unknown> | null;
}): void {
  db.prepare(
    `INSERT INTO growth_events
       (kind, couple_id, user_id, household_id, referrer, user_agent_hash, payload_json, created_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(
    opts.kind,
    opts.coupleId ?? null,
    opts.userId ?? null,
    opts.payload ? JSON.stringify(opts.payload) : null,
    opts.createdAt,
  );
}

/** Insert a minimal couples row so a growth_events row can carry its id
 *  without tripping the FK. We bypass `bootstrapCouple` because we just need
 *  an id reservation — none of the funnel queries read other couple columns.
 *  partner_a_id is NOT NULL but carries no DB-level FK (the comment in
 *  schema.sql calls it "FK lazily"), so any int satisfies the constraint. */
function ensureCoupleRow(id: number): void {
  const ts = now();
  db.prepare(
    `INSERT OR IGNORE INTO couples
       (id, partner_a_id, display_name, bride_name, groom_name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'A', 'B', 'active', ?, ?)`,
  ).run(id, id, `Couple-${id}`, ts, ts);
}

function countKind(kind: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM growth_events WHERE kind = ?").get(kind) as { n: number }
  ).n;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("admin analytics — growth funnel", () => {
  test("empty growth_events returns 6 zero-filled steps + empty referrers/stalled", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    const r = await req<AdminGrowthFunnelAnalytics>(
      "GET",
      "/api/admin/analytics/growth-funnel",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.steps.map((s) => s.kind)).toEqual([
      "signup.started",
      "signup.completed",
      "couple.created",
      "wedding_site.view",
      "rsvp.page.view",
      "rsvp.submitted",
    ]);
    for (const step of r.data.steps) {
      expect(step.count_7d).toBe(0);
      expect(step.count_24h).toBe(0);
    }
    // Step 0 always null; downstream steps null when prev=0 (fresh deploy).
    expect(r.data.steps[0]?.conversion_from_prev).toBeNull();
    expect(r.data.steps[1]?.conversion_from_prev).toBeNull();
    expect(r.data.referrers_7d).toEqual([]);
    expect(r.data.stalled_couple_ids).toEqual([]);
    expect(r.data.kinds).toEqual([]);
  });

  test("funnel ratios compute against the previous step in the chain", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    const ts = now();
    // 10 signups start; only 5 ever click the verify link. Backdate some of both
    // to >24h ago so the 24h window can also be distinguished from the 7d window
    // in one assertion.
    for (let i = 0; i < 6; i++) insertGrowth({ kind: "signup.started", createdAt: ts });
    for (let i = 0; i < 4; i++)
      insertGrowth({ kind: "signup.started", createdAt: ts - 2 * DAY_MS });
    insertGrowth({ kind: "signup.completed", createdAt: ts });
    insertGrowth({ kind: "signup.completed", createdAt: ts });
    insertGrowth({ kind: "signup.completed", createdAt: ts });
    insertGrowth({ kind: "signup.completed", createdAt: ts - 2 * DAY_MS });
    insertGrowth({ kind: "signup.completed", createdAt: ts - 2 * DAY_MS });
    for (const id of [1, 2, 3, 4]) ensureCoupleRow(id);
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 1 });
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 2 });
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 3 });
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 4 });
    insertGrowth({ kind: "wedding_site.view", createdAt: ts, coupleId: 1 });
    insertGrowth({ kind: "wedding_site.view", createdAt: ts, coupleId: 2 });
    insertGrowth({ kind: "rsvp.page.view", createdAt: ts, coupleId: 1 });
    insertGrowth({ kind: "rsvp.submitted", createdAt: ts, coupleId: 1 });

    const r = await req<AdminGrowthFunnelAnalytics>(
      "GET",
      "/api/admin/analytics/growth-funnel",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    const [started, signups, couples, sites, rsvpViews, rsvpSubs] = r.data.steps;
    // 7d counts catch everything we inserted (all rows are within last 2 days).
    expect(started?.count_7d).toBe(10);
    expect(signups?.count_7d).toBe(5);
    expect(couples?.count_7d).toBe(4);
    expect(sites?.count_7d).toBe(2);
    expect(rsvpViews?.count_7d).toBe(1);
    expect(rsvpSubs?.count_7d).toBe(1);
    // 24h counts skip the backdated rows.
    expect(started?.count_24h).toBe(6);
    expect(signups?.count_24h).toBe(3);
    expect(couples?.count_24h).toBe(4);
    // Conversion ratios — step 0 null, rest are count / prevCount.
    expect(started?.conversion_from_prev).toBeNull();
    // Step 1 is the verify drop-off: half the signups never confirmed.
    expect(signups?.conversion_from_prev).toBeCloseTo(5 / 10, 4);
    expect(couples?.conversion_from_prev).toBeCloseTo(4 / 5, 4);
    expect(sites?.conversion_from_prev).toBeCloseTo(2 / 4, 4);
    expect(rsvpViews?.conversion_from_prev).toBeCloseTo(1 / 2, 4);
    expect(rsvpSubs?.conversion_from_prev).toBeCloseTo(1 / 1, 4);
  });

  test("register fires signup.started (user_id NULL); only the verify click completes", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    // Two signups start...
    for (const email of ["funnel-a@example.com", "funnel-b@example.com"]) {
      const reg = await req("POST", "/api/auth/register", {
        email,
        password: "supersafe123",
        full_name: "Funnel",
      });
      expect(reg.status).toBe(202);
    }
    // ...both as pure intent: no account exists yet, so there is no id to
    // attribute them to.
    const started = db
      .prepare("SELECT user_id FROM growth_events WHERE kind = 'signup.started'")
      .all() as { user_id: number | null }[];
    expect(started.length).toBe(2);
    expect(started.every((e) => e.user_id === null)).toBe(true);
    expect(countKind("signup.completed")).toBe(0);

    // ...and only one clicks the link. That click is what mints the account, so
    // signup.completed can finally carry a real user_id.
    await verifyUserEmail("funnel-a@example.com");
    const completed = db
      .prepare("SELECT user_id FROM growth_events WHERE kind = 'signup.completed'")
      .all() as { user_id: number | null }[];
    expect(completed.length).toBe(1);
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("funnel-a@example.com") as {
        id: number;
      }
    ).id;
    expect(completed[0]?.user_id).toBe(userId);
    // funnel-b never clicked, so it never became an account — exactly the cohort
    // the started → completed ratio is there to surface.
    expect(
      db.prepare("SELECT id FROM users WHERE email = ?").get("funnel-b@example.com"),
    ).toBeNull();

    const r = await req<AdminGrowthFunnelAnalytics>(
      "GET",
      "/api/admin/analytics/growth-funnel",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.steps[0]?.count_7d).toBe(2);
    expect(r.data.steps[1]?.count_7d).toBe(1);
    expect(r.data.steps[1]?.conversion_from_prev).toBeCloseTo(0.5, 4);
  });

  test("referrers_7d aggregates payload.referrer + ignores rows outside the 7d window", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    const ts = now();
    insertGrowth({ kind: "signup.from_referrer", createdAt: ts, payload: { referrer: "rsvp" } });
    insertGrowth({ kind: "signup.from_referrer", createdAt: ts, payload: { referrer: "rsvp" } });
    insertGrowth({ kind: "signup.from_referrer", createdAt: ts, payload: { referrer: "site" } });
    insertGrowth({ kind: "signup.from_referrer", createdAt: ts, payload: { referrer: "share" } });
    insertGrowth({
      kind: "signup.from_referrer",
      // 10 days back — outside the 7d window.
      createdAt: ts - 10 * DAY_MS,
      payload: { referrer: "rsvp" },
    });
    // Malformed payload — should be ignored, not crash.
    insertGrowth({ kind: "signup.from_referrer", createdAt: ts, payload: { referrer: 42 } });

    const r = await req<AdminGrowthFunnelAnalytics>(
      "GET",
      "/api/admin/analytics/growth-funnel",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    // Ordered by count desc, rsvp (2) → site (1) → share (1).
    expect(r.data.referrers_7d[0]).toEqual({ source: "rsvp", count: 2 });
    expect(r.data.referrers_7d.find((x) => x.source === "site")?.count).toBe(1);
    expect(r.data.referrers_7d.find((x) => x.source === "share")?.count).toBe(1);
    // The 10-day-old + the malformed row are both omitted.
    expect(r.data.referrers_7d.reduce((s, x) => s + x.count, 0)).toBe(4);
  });

  test("stalled_couple_ids lists couples with couple.created but no wedding_site.view", async () => {
    wipeAll();
    const adminToken = await bootstrapAdmin();

    const ts = now();
    for (const id of [100, 101, 102, 103]) ensureCoupleRow(id);
    // Couples 100, 101, 102 all created within the last 7d.
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 100 });
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 101 });
    insertGrowth({ kind: "couple.created", createdAt: ts, coupleId: 102 });
    // 100 shared their site — drops out of the stalled list.
    insertGrowth({ kind: "wedding_site.view", createdAt: ts, coupleId: 100 });
    // 103 was created BEFORE the 7d window — also out of the list.
    insertGrowth({ kind: "couple.created", createdAt: ts - 10 * DAY_MS, coupleId: 103 });

    const r = await req<AdminGrowthFunnelAnalytics>(
      "GET",
      "/api/admin/analytics/growth-funnel",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    const stalled = r.data.stalled_couple_ids.sort((a, b) => a - b);
    expect(stalled).toEqual([101, 102]);
  });

  test("admin gate — anon 401, non-admin couple-role 403", async () => {
    wipeAll();

    const anon = await req("GET", "/api/admin/analytics/growth-funnel");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-admin@weddly.test");
    const couple = await req("GET", "/api/admin/analytics/growth-funnel", undefined, { token });
    expect(couple.status).toBe(403);
  });
});
