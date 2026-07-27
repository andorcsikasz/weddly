// The three analytics lenses added on top of the couple-shaped ones: planners,
// campaigns, and users/workspaces. Each surfaces data that already existed in
// an admin TABLE but had no trend or rate anywhere.
//
// Asserts the numbers reconcile against their denominators and move when the
// underlying rows do — the failure mode for a reporting endpoint is not a
// crash, it is a plausible number that is wrong.
//
// Pairs with backend/src/routes/admin_analytics.ts (plannerAnalytics,
// campaignAnalytics, userAnalytics).

import "../setup";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  AdminCampaignAnalytics,
  AdminPlannerAnalytics,
  AdminUserAnalytics,
} from "@shared/admin_analytics";
import { db, now } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

let adminToken = "";

/** A planner account, straight into the table: the real path (waitlist accept →
 *  provision → activation email → set password) costs an argon2 hash per
 *  fixture and proves nothing this suite is about. */
function insertPlanner(o: {
  email: string;
  plan?: string;
  maxClients?: number;
  passwordSet?: boolean;
  status?: string;
  createdAt?: number;
}): number {
  const ts = o.createdAt ?? now();
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role, user_type, status,
                            verified_email, password_set, planner_plan, planner_max_clients,
                            created_at, updated_at)
         VALUES (?, 'x', 'Planner', 'owner', 'planner', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.email.toLowerCase(),
        o.status ?? "active",
        o.passwordSet === false ? 0 : 1,
        o.plan ?? "starter",
        o.maxClients ?? 4,
        ts,
        ts,
      ).lastInsertRowid,
  );
}

function insertWaitlist(email: string, status: string): void {
  db.prepare(
    `INSERT INTO planner_waitlist (full_name, email, phone, status, created_at)
     VALUES ('Applicant', ?, '+3612345678', ?, ?)`,
  ).run(email.toLowerCase(), status, Math.floor(now() / 1000));
}

function insertSubscription(userId: number, status: string, patch: Record<string, number> = {}) {
  const ts = now();
  db.prepare(
    `INSERT INTO planner_subscriptions
       (user_id, subscription_status, trial_ends_at, founding_until, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'HUF', ?, ?)`,
  ).run(userId, status, patch.trial_ends_at ?? null, patch.founding_until ?? null, ts, ts);
}

/** A plain user with no workspace, for the composition + recency buckets. */
function insertUser(email: string, lastSeen: number | null): number {
  const ts = now();
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role, user_type, status,
                            verified_email, last_seen_at, created_at, updated_at)
         VALUES (?, 'x', 'Person', 'owner', 'couple', 'active', 1, ?, ?, ?)`,
      )
      .run(email.toLowerCase(), lastSeen, ts, ts).lastInsertRowid,
  );
}

beforeEach(async () => {
  wipeAll();
  db.exec(`
    DELETE FROM personal_invite_campaign_sends;
    DELETE FROM personal_invite_campaigns;
    DELETE FROM onboarding_campaign_sends;
    DELETE FROM onboarding_campaigns;
    DELETE FROM vendor_review_campaign_sends;
    DELETE FROM vendor_review_campaigns;
  `);
  const admin = await bootstrapCouple("admin@test.test");
  adminToken = admin.token;
});

afterAll(() => {
  db.exec(`
    DELETE FROM personal_invite_campaign_sends;
    DELETE FROM personal_invite_campaigns;
  `);
});

async function planners(): Promise<AdminPlannerAnalytics> {
  const r = await req<AdminPlannerAnalytics>("GET", "/api/admin/analytics/planners", undefined, {
    token: adminToken,
  });
  expect(r.status).toBe(200);
  return r.data;
}

describe("admin analytics — the three new lenses are admin-only", () => {
  test("a non-admin gets 403 from all three", async () => {
    const { token } = await bootstrapCouple("notadmin@weddly.test");
    const calls = [
      req("GET", "/api/admin/analytics/planners", undefined, { token }),
      req("GET", "/api/admin/analytics/campaigns", undefined, { token }),
      req("GET", "/api/admin/analytics/users", undefined, { token }),
    ];
    for (const c of await Promise.all(calls)) expect(c.status).toBe(403);
  });
});

describe("admin analytics — planners", () => {
  test("the KPI split, the waitlist funnel and tier capacity all reconcile", async () => {
    const activeOne = insertPlanner({ email: "p-active@weddly.test", plan: "pro", maxClients: 10 });
    insertPlanner({ email: "p-pending@weddly.test", passwordSet: false });
    insertPlanner({ email: "p-suspended@weddly.test", status: "suspended" });

    // One of them applied through the waitlist and was accepted; a second
    // applicant was accepted but never got an account.
    insertWaitlist("p-active@weddly.test", "accepted");
    insertWaitlist("waiting@weddly.test", "accepted");
    insertWaitlist("rejected@weddly.test", "rejected");

    // The active planner has one client, so the "has a client" step is 1.
    const couple = await bootstrapCouple("planner-client@weddly.test");
    db.prepare(
      "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'active', ?)",
    ).run(activeOne, couple.coupleId, now());

    const p = await planners();
    expect(p.total).toBe(3);
    expect(p.active).toBe(1);
    expect(p.pending_registration).toBe(1);
    expect(p.suspended).toBe(1);
    // Accepted (2) minus the one that has an account.
    expect(p.accepted_awaiting_account).toBe(1);

    const step = (key: string) => p.funnel.find((f) => f.key === key);
    expect(step("applied")?.count).toBe(3); // every distinct applicant
    expect(step("accepted")?.count).toBe(2);
    expect(step("account")?.count).toBe(1);
    expect(step("with_client")?.count).toBe(1);
    // No step may exceed the first, and the percentages are of that first step.
    for (const s of p.funnel) {
      expect(s.pct_of_first).toBe(Math.round((s.count / 3) * 100));
    }

    // Capacity: one pro planner with a 10-client cap and one client on it.
    const pro = p.by_tier.find((tier) => tier.plan === "pro");
    expect(pro?.planners).toBe(1);
    expect(pro?.cap).toBe(10);
    expect(pro?.clients).toBe(1);
    expect(pro?.utilisation).toBeCloseTo(0.1, 5);
    // A tier nobody is on reports null rather than a fake 0%.
    expect(p.by_tier.find((tier) => tier.plan === "premium")?.utilisation).toBeNull();

    // The daily trend always spans 30 buckets and holds today's signups.
    expect(p.signups_daily).toHaveLength(30);
    expect(p.signups_daily[29]?.count).toBe(3);
  });

  test("free window vs paying is decided by the window's end, not the label", async () => {
    const trialing = insertPlanner({ email: "p-trial@weddly.test" });
    const lapsed = insertPlanner({ email: "p-lapsed@weddly.test" });
    const paying = insertPlanner({ email: "p-paying@weddly.test" });
    insertSubscription(trialing, "trialing", { trial_ends_at: now() + 3 * 86_400_000 });
    insertSubscription(lapsed, "trialing", { trial_ends_at: now() - 86_400_000 });
    insertSubscription(paying, "active");

    const p = await planners();
    expect(p.in_free_window).toBe(1); // only the one whose trial is still open
    expect(p.paying).toBe(1);
    expect(p.converted_after_free).toBe(1);
    expect(p.avg_days_to_paid_approx).not.toBeNull();
    expect(p.subscription_status.find((s) => s.status === "trialing")?.count).toBe(2);
    expect(p.subscription_status.find((s) => s.status === "none")?.count).toBeUndefined();
  });
});

describe("admin analytics — campaigns", () => {
  test("per-campaign funnel counts, family totals and the daily series line up", async () => {
    const ts = now();
    const campaignId = Number(
      db
        .prepare(
          `INSERT INTO personal_invite_campaigns (slug, status, daily_cap, created_at, updated_at, started_at)
           VALUES ('analytics-invite', 'running', 50, ?, ?, ?)`,
        )
        .run(ts, ts, ts).lastInsertRowid,
    );
    // Three sent, one of which belongs to an address that now owns an account
    // (the family's conversion rule), plus one failure.
    const converted = "converted@weddly.test";
    insertUser(converted, ts);
    for (const email of [converted, "cold1@weddly.test", "cold2@weddly.test"]) {
      db.prepare(
        `INSERT INTO personal_invite_campaign_sends (campaign_id, name, email, locale, status, sent_at, created_at)
         VALUES (?, '', ?, 'hu', 'sent', ?, ?)`,
      ).run(campaignId, email, ts, ts);
    }
    db.prepare(
      `INSERT INTO personal_invite_campaign_sends (campaign_id, name, email, locale, status, created_at)
       VALUES (?, '', 'bounced@weddly.test', 'hu', 'failed', ?)`,
    ).run(campaignId, ts);

    const r = await req<AdminCampaignAnalytics>(
      "GET",
      "/api/admin/analytics/campaigns",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    const c = r.data;

    const row = c.campaigns.find((x) => x.slug === "analytics-invite");
    expect(row?.family).toBe("personal_invite");
    expect(row?.sent).toBe(3);
    expect(row?.converted).toBe(1);
    expect(row?.failed).toBe(1);
    // Personal invite carries no pixel and no click redirect; the absent signal
    // reads as 0 rather than being faked from opens elsewhere.
    expect(row?.opened).toBe(0);
    expect(row?.clicked).toBe(0);

    const family = c.by_family.find((f) => f.family === "personal_invite");
    expect(family?.campaigns).toBe(1);
    expect(family?.sent).toBe(3);
    expect(family?.converted).toBe(1);
    // All four families are always present, even the ones with no campaigns.
    expect(c.by_family).toHaveLength(4);

    expect(c.daily).toHaveLength(c.window_days);
    const today = c.daily[c.daily.length - 1];
    expect(today?.sent).toBe(3);
    expect(today?.converted).toBe(1);
    // A conversion can never outrun the sends it was measured from.
    for (const d of c.daily) expect(d.converted).toBeLessThanOrEqual(d.sent);
  });

  test("a signup tagged with the campaign slug shows up as UTM attribution", async () => {
    const ts = now();
    db.prepare(
      `INSERT INTO personal_invite_campaigns (slug, status, daily_cap, created_at, updated_at)
       VALUES ('utm-tagged', 'paused', 50, ?, ?)`,
    ).run(ts, ts);
    const uid = insertUser("utm-signup@weddly.test", ts);
    db.prepare(
      "UPDATE users SET utm_campaign = 'utm-tagged', utm_medium = 'email' WHERE id = ?",
    ).run(uid);

    const r = await req<AdminCampaignAnalytics>(
      "GET",
      "/api/admin/analytics/campaigns",
      undefined,
      { token: adminToken },
    );
    expect(r.data.campaigns.find((x) => x.slug === "utm-tagged")?.utm_signups).toBe(1);
  });
});

describe("admin analytics — users and workspaces", () => {
  test("paired vs solo, the pairing rate, and the recency buckets", async () => {
    // bootstrapCouple leaves a solo workspace (owner only). Admin's own
    // workspace is filtered out by the default real-users-only lens.
    const solo = await bootstrapCouple("solo@weddly.test");
    const pairedOwner = await bootstrapCouple("paired@weddly.test");
    const partner = insertUser("partner@weddly.test", now());
    db.prepare(
      "INSERT INTO couple_members (couple_id, user_id, role, created_at) VALUES (?, ?, 'partner', ?)",
    ).run(pairedOwner.coupleId, partner, now() + 2 * 86_400_000);
    expect(solo.coupleId).not.toBe(pairedOwner.coupleId);

    // Recency fixtures: one dormant, one that has never loaded the app.
    insertUser("dormant@weddly.test", now() - 45 * 86_400_000);
    insertUser("never@weddly.test", null);

    const r = await req<AdminUserAnalytics>("GET", "/api/admin/analytics/users", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(200);
    const u = r.data;

    expect(u.paired_workspaces).toBe(1);
    expect(u.solo_workspaces).toBe(1);
    expect(u.paired_rate).toBeCloseTo(0.5, 5);
    // The partner joined two days after the workspace was created.
    expect(u.median_days_to_pair).toBe(2);

    expect(u.recency.dormant_30d).toBeGreaterThanOrEqual(1);
    expect(u.recency.never).toBeGreaterThanOrEqual(1);
    const bucketed =
      u.recency.week +
      u.recency.month +
      u.recency.dormant_30d +
      u.recency.dormant_90d +
      u.recency.never;
    expect(bucketed).toBe(u.total_users);

    // The workspace-less accounts are the onboarding-campaign audience; the
    // two loose fixtures above plus the partner are exactly that.
    expect(u.users_without_workspace).toBeGreaterThanOrEqual(2);

    // Six monthly cohorts, and this month holds both workspaces.
    expect(u.cohorts).toHaveLength(6);
    expect(u.cohorts[5]?.workspaces).toBe(2);
  });

  test("the cohort counters ignore the audience filter, which is their whole job", async () => {
    const beta = insertUser("beta@weddly.test", now());
    db.prepare("UPDATE users SET is_beta_tester = 1 WHERE id = ?").run(beta);

    const r = await req<AdminUserAnalytics>("GET", "/api/admin/analytics/users", undefined, {
      token: adminToken,
    });
    // The beta account is excluded from total_users (default lens) but the
    // standing counter still reports it.
    expect(r.data.test_accounts).toBe(1);
    expect(r.data.admins).toBeGreaterThanOrEqual(1);
  });
});
