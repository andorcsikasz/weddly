// Campaign schedules — the standing plan that composes the next campaign of
// each family so an operator only has to press Run.
//
// Covers (major-change rule: new endpoints + new schema + new state machine):
//   - the three schedules are seeded from the shared recipes, admin-only
//   - the operator knobs patch, and shortening the interval re-bases the next
//     due date off the last preparation instead of the old, longer wait
//   - preparing builds a PAUSED campaign of the right family, carrying the
//     schedule's daily cap, with its targets resolved
//   - the cooldown suppresses addresses the same family mailed recently, which
//     is what makes "repeat" safe: a second round reaches the people the first
//     one did not
//   - a thin segment waits (min_targets) and a campaign still in flight blocks
//     the next one, so a forgotten plan cannot stack up queues
//   - auto_start launches what it builds; the due sweep respects both the
//     repeat switch and the due date
//   - Run launches the prepared campaign

import "../setup";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  CAMPAIGN_SCHEDULE_DAY_MS,
  CAMPAIGN_SCHEDULE_RECIPES,
  type CampaignPlanView,
  type CampaignScheduleKind,
  type CampaignScheduleView,
} from "@shared/campaign_schedules";
import { db, now } from "../../src/db";
import { ensureDefaultSchedules, prepareDueSchedules } from "../../src/domain/campaign_schedules";
import { bootstrapCouple, req, wipeAll } from "../helpers";

let adminToken = "";
let adminCoupleId = 0;

const ONBOARDING = CAMPAIGN_SCHEDULE_RECIPES.onboarding;
const CLAIM = CAMPAIGN_SCHEDULE_RECIPES.vendor_claim;

interface ScheduleRow {
  id: number;
  kind: string;
  enabled: number;
  interval_days: number;
  daily_cap: number;
  auto_start: number;
  next_due_at: number;
  last_campaign_id: number | null;
}

function rowFor(kind: CampaignScheduleKind): ScheduleRow {
  const row = db.prepare("SELECT * FROM campaign_schedules WHERE kind = ?").get(kind) as
    | ScheduleRow
    | undefined;
  if (!row) throw new Error(`no schedule for ${kind}`);
  return row;
}

function idFor(kind: CampaignScheduleKind): number {
  return rowFor(kind).id;
}

/** An eligible orphan: verified, active, no workspace. The onboarding family is
 *  the one whose whole audience a test can create from scratch. */
function insertOrphan(email: string): number {
  const ts = now();
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role, user_type, verified_email, couple_id, locale, created_at, updated_at)
         VALUES (?, 'x', 'Test Person', 'owner', 'couple', 1, NULL, 'hu', ?, ?)`,
      )
      .run(email.toLowerCase(), ts, ts).lastInsertRowid,
  );
}

/** An unclaimed curated listing with an address on file: a claim-invite target. */
function insertUnclaimedListing(id: string, email: string): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings (id, source, vendor_account_id, category, name, city, contact_email, status, created_at, updated_at)
     VALUES (?, 'curated', NULL, 'photography', ?, 'Budapest', ?, 'active', ?, ?)`,
  ).run(id, `Fixture ${id}`, email.toLowerCase(), ts, ts);
}

async function plan(): Promise<CampaignScheduleView[]> {
  const r = await req<CampaignPlanView>("GET", "/api/admin/campaign-schedules", undefined, {
    token: adminToken,
  });
  expect(r.status).toBe(200);
  return r.data.items;
}

async function itemFor(kind: CampaignScheduleKind): Promise<CampaignScheduleView> {
  const items = await plan();
  const item = items.find((i) => i.schedule.kind === kind);
  if (!item) throw new Error(`no plan item for ${kind}`);
  return item;
}

async function prepare(kind: CampaignScheduleKind) {
  return req<{
    result: {
      prepared: boolean;
      reason: string | null;
      campaign_id: number | null;
      reach: number;
      suppressed: number;
    };
    item: CampaignScheduleView;
  }>("POST", `/api/admin/campaign-schedules/${idFor(kind)}/prepare`, {}, { token: adminToken });
}

beforeEach(async () => {
  wipeAll();
  db.exec(`
    DELETE FROM onboarding_campaign_sends;
    DELETE FROM onboarding_campaigns;
    DELETE FROM campaign_schedules;
    -- Curated rows survive wipeAll (the boot backfill owns them), so this
    -- suite's own fixtures have to be swept by hand or the P2.A backfill test
    -- counts them as directory entries that aren't in suppliers_data.ts.
    DELETE FROM listings WHERE id LIKE 'sched-claim-%';
  `);
  ensureDefaultSchedules();
  const admin = await bootstrapCouple("admin@test.test");
  adminToken = admin.token;
  adminCoupleId = admin.coupleId;
  expect(adminCoupleId).toBeGreaterThan(0);
});

afterAll(() => {
  db.exec("DELETE FROM campaign_schedules");
  db.exec("DELETE FROM listings WHERE id LIKE 'sched-claim-%'");
});

describe("campaign schedules: admin-only", () => {
  test("every endpoint 403s for a non-admin", async () => {
    const { token } = await bootstrapCouple("nonadmin@weddly.test");
    const id = idFor("onboarding");
    const calls = [
      req("GET", "/api/admin/campaign-schedules", undefined, { token }),
      req("PATCH", `/api/admin/campaign-schedules/${id}`, { enabled: false }, { token }),
      req("POST", `/api/admin/campaign-schedules/${id}/prepare`, {}, { token }),
      req("POST", `/api/admin/campaign-schedules/${id}/run`, {}, { token }),
    ];
    for (const c of await Promise.all(calls)) expect(c.status).toBe(403);
  });
});

describe("campaign schedules: the seeded plan", () => {
  test("one schedule per family, carrying its recipe's defaults", async () => {
    const items = await plan();
    expect(items.map((i) => i.schedule.kind).sort()).toEqual([
      "onboarding",
      "vendor_claim",
      "vendor_review",
    ]);
    const onboarding = items.find((i) => i.schedule.kind === "onboarding");
    expect(onboarding?.schedule.enabled).toBe(true);
    expect(onboarding?.schedule.auto_start).toBe(false);
    expect(onboarding?.schedule.interval_days).toBe(ONBOARDING.interval_days);
    expect(onboarding?.schedule.daily_cap).toBe(ONBOARDING.daily_cap);
    expect(onboarding?.prepared).toBeNull();
    // The cooldown is a recipe constant, not an operator knob, and the console
    // needs it to explain a suppressed count.
    expect(onboarding?.recipe.cooldown_days).toBe(ONBOARDING.cooldown_days);
  });

  test("re-seeding never overwrites a tuned schedule", async () => {
    await req(
      "PATCH",
      `/api/admin/campaign-schedules/${idFor("onboarding")}`,
      {
        interval_days: 7,
      },
      { token: adminToken },
    );
    ensureDefaultSchedules();
    expect(rowFor("onboarding").interval_days).toBe(7);
  });
});

describe("campaign schedules: the operator knobs", () => {
  test("repeat, interval, cap and auto-start all patch", async () => {
    const r = await req<CampaignScheduleView>(
      "PATCH",
      `/api/admin/campaign-schedules/${idFor("onboarding")}`,
      { enabled: false, interval_days: 45, daily_cap: 25, auto_start: true },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.schedule.enabled).toBe(false);
    expect(r.data.schedule.interval_days).toBe(45);
    expect(r.data.schedule.daily_cap).toBe(25);
    expect(r.data.schedule.auto_start).toBe(true);
  });

  test("a shorter interval re-bases the next due date instead of waiting out the old one", async () => {
    const id = idFor("onboarding");
    // Prepare once so there is a last_prepared_at to measure from.
    for (let i = 0; i < ONBOARDING.min_targets; i++) insertOrphan(`rebase${i}@weddly.test`);
    const p = await prepare("onboarding");
    expect(p.data.result.prepared).toBe(true);
    const afterPrepare = rowFor("onboarding");
    expect(afterPrepare.next_due_at).toBeGreaterThan(Date.now());

    const r = await req<CampaignScheduleView>(
      "PATCH",
      `/api/admin/campaign-schedules/${id}`,
      { interval_days: 1 },
      { token: adminToken },
    );
    // last_prepared_at + 1 day, i.e. tomorrow — not "the old 21 days from now".
    expect(r.data.schedule.next_due_at).toBeLessThan(
      afterPrepare.next_due_at - 10 * CAMPAIGN_SCHEDULE_DAY_MS,
    );
  });

  test("a nonsense interval is rejected", async () => {
    const r = await req(
      "PATCH",
      `/api/admin/campaign-schedules/${idFor("onboarding")}`,
      { interval_days: 0 },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });
});

describe("campaign schedules: preparing a round", () => {
  test("builds a PAUSED campaign with the schedule's cap and its targets synced", async () => {
    for (let i = 0; i < 6; i++) insertOrphan(`prep${i}@weddly.test`);
    await req(
      "PATCH",
      `/api/admin/campaign-schedules/${idFor("onboarding")}`,
      { daily_cap: 17 },
      { token: adminToken },
    );

    const r = await prepare("onboarding");
    expect(r.status).toBe(200);
    expect(r.data.result.prepared).toBe(true);
    expect(r.data.result.reach).toBe(6);

    const prepared = r.data.item.prepared;
    expect(prepared?.status).toBe("paused");
    expect(prepared?.remaining).toBe(6); // synced, queued, waiting
    expect(prepared?.sent).toBe(0);

    const campaign = db
      .prepare("SELECT * FROM onboarding_campaigns WHERE id = ?")
      .get(r.data.result.campaign_id ?? 0) as { daily_cap: number; slug: string };
    expect(campaign.daily_cap).toBe(17);
    expect(campaign.slug.startsWith(ONBOARDING.slug_prefix)).toBe(true);
  });

  test("a thin segment waits for the next round instead of minting a tiny campaign", async () => {
    insertOrphan("lonely@weddly.test");
    const r = await prepare("onboarding");
    expect(r.data.result.prepared).toBe(false);
    expect(r.data.result.reason).toBe("too_few_targets");
    expect(r.data.item.prepared).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM onboarding_campaigns").get()).toEqual({ n: 0 });
  });

  test("an unrun campaign blocks the next one, a finished one does not", async () => {
    for (let i = 0; i < 8; i++) insertOrphan(`inflight${i}@weddly.test`);
    expect((await prepare("onboarding")).data.result.prepared).toBe(true);

    const second = await prepare("onboarding");
    expect(second.data.result.prepared).toBe(false);
    expect(second.data.result.reason).toBe("in_flight");
    expect(db.prepare("SELECT COUNT(*) AS n FROM onboarding_campaigns").get()).toEqual({ n: 1 });

    // Retire it; the family is free again (the addresses are not, see cooldown).
    db.prepare("UPDATE onboarding_campaigns SET status = 'done' WHERE id = ?").run(
      rowFor("onboarding").last_campaign_id,
    );
    for (let i = 0; i < 8; i++) insertOrphan(`wave2-${i}@weddly.test`);
    expect((await prepare("onboarding")).data.result.prepared).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM onboarding_campaigns").get()).toEqual({ n: 2 });
  });

  test("the claim family builds into its own table", async () => {
    for (let i = 0; i < CLAIM.min_targets + 2; i++) {
      insertUnclaimedListing(`sched-claim-${i}`, `claimtarget${i}@vendor.test`);
    }
    const r = await prepare("vendor_claim");
    expect(r.data.result.prepared).toBe(true);
    const campaign = db
      .prepare("SELECT * FROM vendor_claim_campaigns WHERE id = ?")
      .get(r.data.result.campaign_id) as { status: string; slug: string; daily_cap: number };
    expect(campaign.status).toBe("paused");
    expect(campaign.daily_cap).toBe(CLAIM.daily_cap);
    expect(campaign.slug.startsWith(CLAIM.slug_prefix)).toBe(true);
  });
});

describe("campaign schedules: the cooldown is what makes repeat safe", () => {
  test("a second round skips the addresses the first one mailed", async () => {
    for (let i = 0; i < 9; i++) insertOrphan(`cool${i}@weddly.test`);
    expect((await prepare("onboarding")).data.result.prepared).toBe(true);
    const firstId = rowFor("onboarding").last_campaign_id;

    // Three of them actually got the mail; the rest never went out.
    db.prepare(
      `UPDATE onboarding_campaign_sends
          SET status = 'sent', sent_at = ?
        WHERE campaign_id = ? AND email IN ('cool0@weddly.test','cool1@weddly.test','cool2@weddly.test')`,
    ).run(now(), firstId);
    db.prepare("UPDATE onboarding_campaigns SET status = 'done' WHERE id = ?").run(firstId);

    const second = await prepare("onboarding");
    expect(second.data.result.prepared).toBe(true);
    // 9 eligible, 3 inside the cooldown window.
    expect(second.data.result.reach).toBe(6);
    expect(second.data.result.suppressed).toBe(3);
    expect(second.data.item.cooling_down).toBe(3);
    expect(second.data.item.prepared?.remaining).toBe(6);

    const secondId = rowFor("onboarding").last_campaign_id;
    const skipped = db
      .prepare(
        "SELECT email FROM onboarding_campaign_sends WHERE campaign_id = ? AND status = 'skipped' ORDER BY email",
      )
      .all(secondId) as Array<{ email: string }>;
    expect(skipped.map((s) => s.email)).toEqual([
      "cool0@weddly.test",
      "cool1@weddly.test",
      "cool2@weddly.test",
    ]);
  });

  test("an address mailed longer ago than the cooldown comes back into range", async () => {
    for (let i = 0; i < 9; i++) insertOrphan(`aged${i}@weddly.test`);
    expect((await prepare("onboarding")).data.result.prepared).toBe(true);
    const firstId = rowFor("onboarding").last_campaign_id;
    const longAgo = now() - (ONBOARDING.cooldown_days + 5) * CAMPAIGN_SCHEDULE_DAY_MS;
    db.prepare(
      "UPDATE onboarding_campaign_sends SET status = 'sent', sent_at = ? WHERE campaign_id = ?",
    ).run(longAgo, firstId);
    db.prepare("UPDATE onboarding_campaigns SET status = 'done' WHERE id = ?").run(firstId);

    const second = await prepare("onboarding");
    expect(second.data.result.reach).toBe(9);
    expect(second.data.result.suppressed).toBe(0);
  });
});

describe("campaign schedules: running", () => {
  test("Run launches the prepared campaign", async () => {
    for (let i = 0; i < 6; i++) insertOrphan(`run${i}@weddly.test`);
    await prepare("onboarding");

    const r = await req<{ item: CampaignScheduleView }>(
      "POST",
      `/api/admin/campaign-schedules/${idFor("onboarding")}/run`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.item.prepared?.status).toBe("running");
    expect(r.data.item.prepared?.started_at).not.toBeNull();
  });

  test("Run with nothing prepared is a 409, not a silent no-op", async () => {
    const r = await req(
      "POST",
      `/api/admin/campaign-schedules/${idFor("onboarding")}/run`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("auto_start launches what it builds", async () => {
    for (let i = 0; i < 6; i++) insertOrphan(`auto${i}@weddly.test`);
    await req(
      "PATCH",
      `/api/admin/campaign-schedules/${idFor("onboarding")}`,
      { auto_start: true },
      { token: adminToken },
    );
    const r = await prepare("onboarding");
    expect(r.data.item.prepared?.status).toBe("running");
  });
});

describe("campaign schedules: the due sweep", () => {
  test("prepares what is due, skips what is not, and skips a paused plan", async () => {
    for (let i = 0; i < 6; i++) insertOrphan(`due${i}@weddly.test`);
    // The curated directory that boots with the test DB is a live claim-invite
    // audience this suite does not control, so park the other two families and
    // let the assertion be about the sweep, not about the fixture data.
    db.exec("DELETE FROM campaign_schedules WHERE kind != 'onboarding'");

    // Not due yet: nothing happens.
    db.exec(`UPDATE campaign_schedules SET next_due_at = ${now() + 5 * CAMPAIGN_SCHEDULE_DAY_MS}`);
    expect(prepareDueSchedules().prepared).toBe(0);

    // Due, but repeat is off.
    db.exec(`UPDATE campaign_schedules SET next_due_at = ${now() - 1000}, enabled = 0`);
    expect(prepareDueSchedules().prepared).toBe(0);

    // Due and repeating: the onboarding family composes (the other two have no
    // audience in this suite, so exactly one campaign appears).
    db.exec("UPDATE campaign_schedules SET enabled = 1");
    expect(prepareDueSchedules().prepared).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM onboarding_campaigns").get()).toEqual({ n: 1 });
    // And it stays paused: the sweep never launches anything by itself.
    const prepared = (await itemFor("onboarding")).prepared;
    expect(prepared?.status).toBe("paused");
    // The next round is one interval out, not immediately due again.
    expect(rowFor("onboarding").next_due_at).toBeGreaterThan(Date.now());
  });
});
