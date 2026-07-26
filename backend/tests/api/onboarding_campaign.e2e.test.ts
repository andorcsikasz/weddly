// Onboarding re-engagement campaign: an admin-run, paced blast to registered
// couples who verified their email but never onboarded (no workspace). Mirrors
// the personal-invite suite, but the audience is a LIVE orphan query (synced,
// not imported) and conversion is onboarded-ness, plus a reminder wave gated on
// still-not-onboarded. See domain/onboarding_campaign.ts + routes/admin_onboarding_campaign.ts.

import "../setup";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import {
  getCampaignRow,
  makeOnboardingOptOutToken,
  sendCampaignBatch,
  sendCampaignReminders,
  syncTargets,
} from "../../src/domain/onboarding_campaign";
import { runOnboardingCampaignSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import type {
  OnboardingCampaign,
  OnboardingCampaignDetail,
  OnboardingCampaignSend,
  OnboardingCampaignSyncResult,
} from "@shared/onboarding_campaign";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/** A non-app GET (opt-out HTML) with redirects disabled; drains the body so Bun
 *  doesn't leak the keep-alive connection into the next request. */
async function raw(path: string): Promise<number> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  await res.text();
  return res.status;
}

/** Insert a user directly (fast + deterministic, no argon2). Defaults produce an
 *  eligible orphan: verified couple account with no workspace. */
function insertUser(o: {
  email: string;
  role?: string;
  userType?: string;
  verified?: boolean;
  coupleId?: number | null;
  locale?: string;
}): number {
  const ts = Date.now();
  const res = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, role, user_type, verified_email, couple_id, locale, created_at, updated_at)
       VALUES (?, 'x', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.email.toLowerCase(),
      "Test Person",
      o.role ?? "owner",
      o.userType ?? "couple",
      o.verified === false ? 0 : 1,
      o.coupleId ?? null,
      o.locale ?? "hu",
      ts,
      ts,
    );
  return Number(res.lastInsertRowid);
}

let adminToken: string;
let adminCoupleId: number;

beforeEach(async () => {
  wipeAll();
  db.exec("DELETE FROM onboarding_campaign_sends; DELETE FROM onboarding_campaigns;");
  // Admin owns a workspace (so it is NOT itself an orphan target); its couple id
  // doubles as a valid FK to mark test orphans "onboarded".
  const admin = await bootstrapCouple("admin@test.test");
  adminToken = admin.token;
  adminCoupleId = admin.coupleId;
});

afterAll(() => {
  db.exec(
    "DROP TABLE IF EXISTS onboarding_campaign_sends; DROP TABLE IF EXISTS onboarding_campaigns;",
  );
});

async function createCampaign(slug: string, dailyCap = 50): Promise<OnboardingCampaign> {
  const r = await req<{ campaign: OnboardingCampaign }>(
    "POST",
    "/api/admin/onboarding-campaigns",
    { slug, daily_cap: dailyCap },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.campaign;
}

describe("onboarding campaign: admin-only", () => {
  test("every endpoint 403s for a non-admin", async () => {
    const camp = await createCampaign("admin-gate");
    const { token } = await bootstrapCouple("nonadmin@weddly.test");
    const base = "/api/admin/onboarding-campaigns";
    const calls: Array<Promise<{ status: number }>> = [
      req("GET", base, undefined, { token }),
      req("POST", base, { slug: "x2" }, { token }),
      req("GET", `${base}/${camp.id}`, undefined, { token }),
      req("PATCH", `${base}/${camp.id}`, { status: "running" }, { token }),
      req("POST", `${base}/${camp.id}/sync`, {}, { token }),
      req("GET", `${base}/${camp.id}/sends`, undefined, { token }),
      req("POST", `${base}/${camp.id}/send-batch`, { limit: 5 }, { token }),
    ];
    for (const c of await Promise.all(calls)) expect(c.status).toBe(403);
  });
});

describe("onboarding campaign: sync targets only the orphan segment", () => {
  test("verified workspace-less couples are targeted; onboarded / vendor / planner / unverified / demo are not", async () => {
    const o1 = insertUser({ email: "orphan1@weddly.test", locale: "hu" });
    const o2 = insertUser({ email: "orphan2@weddly.test", locale: "en" });
    const o3 = insertUser({ email: "orphan3@weddly.test", locale: "hu" });
    // Excluded populations:
    insertUser({ email: "onboarded@weddly.test", coupleId: adminCoupleId }); // has a workspace
    insertUser({ email: "vendor@weddly.test", role: "vendor" });
    insertUser({ email: "planner@weddly.test", userType: "planner" });
    insertUser({ email: "unverified@weddly.test", verified: false });
    insertUser({ email: "someone@demo.weddly.local" }); // demo suffix

    const camp = await createCampaign("segment-test");
    const sync = await req<{
      result: OnboardingCampaignSyncResult;
      stats: OnboardingCampaignDetail["stats"];
    }>("POST", `/api/admin/onboarding-campaigns/${camp.id}/sync`, {}, { token: adminToken });
    expect(sync.status).toBe(200);
    expect(sync.data.result.added).toBe(3);
    expect(sync.data.stats.total).toBe(3);
    expect(sync.data.stats.queued).toBe(3);
    expect(sync.data.stats.hu).toBe(2);
    expect(sync.data.stats.en).toBe(1);

    const list = await req<{ sends: OnboardingCampaignSend[] }>(
      "GET",
      `/api/admin/onboarding-campaigns/${camp.id}/sends`,
      undefined,
      { token: adminToken },
    );
    const emails = list.data.sends.map((s) => s.email).sort();
    expect(emails).toEqual(["orphan1@weddly.test", "orphan2@weddly.test", "orphan3@weddly.test"]);
    // user_id is captured so conversion can join on it.
    expect(list.data.sends.every((s) => s.user_id != null)).toBe(true);
    expect(new Set([o1, o2, o3]).size).toBe(3);

    // A second sync is idempotent (no new rows, everyone already present).
    const sync2 = await req<{ result: OnboardingCampaignSyncResult }>(
      "POST",
      `/api/admin/onboarding-campaigns/${camp.id}/sync`,
      {},
      { token: adminToken },
    );
    expect(sync2.data.result.added).toBe(0);
    expect(sync2.data.result.skipped_existing).toBe(3);
  });
});

describe("onboarding campaign: paced sender honours the daily cap", () => {
  test("batch drains up to the rolling-24h budget, then resets after 24h", async () => {
    for (let i = 0; i < 5; i++) insertUser({ email: `paced${i}@weddly.test` });
    const camp = await createCampaign("paced", 2);
    syncTargets(camp.id);

    const row = getCampaignRow(camp.id);
    if (!row) throw new Error("campaign vanished");
    const t0 = Date.now();
    expect(await sendCampaignBatch(row, 100, t0)).toBe(2); // budget = 2
    expect(await sendCampaignBatch(row, 100, t0)).toBe(0); // budget spent
    expect(await sendCampaignBatch(row, 100, t0 + 25 * 60 * 60 * 1000)).toBe(2); // window rolled

    const detail = await req<OnboardingCampaignDetail>(
      "GET",
      `/api/admin/onboarding-campaigns/${camp.id}`,
      undefined,
      { token: adminToken },
    );
    expect(detail.data.stats.sent).toBe(4);
    expect(detail.data.stats.queued).toBe(1);
  });
});

describe("onboarding campaign: onboarded-between-sync-and-send is skipped", () => {
  test("a recipient who gains a workspace after sync is never mailed", async () => {
    const uid = insertUser({ email: "racer@weddly.test" });
    const camp = await createCampaign("race");
    syncTargets(camp.id);

    // They onboard before the batch runs.
    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(adminCoupleId, uid);

    const row = getCampaignRow(camp.id);
    if (!row) throw new Error("campaign vanished");
    expect(await sendCampaignBatch(row, 100)).toBe(0);

    const list = await req<{ sends: OnboardingCampaignSend[] }>(
      "GET",
      `/api/admin/onboarding-campaigns/${camp.id}/sends`,
      undefined,
      { token: adminToken },
    );
    const send = list.data.sends.find((s) => s.email === "racer@weddly.test");
    expect(send?.status).toBe("skipped");
    expect(send?.sent_at).toBeNull();
    expect(send?.converted).toBe(true); // they did onboard, just not via this mail
  });
});

describe("onboarding campaign: worker sweep respects status", () => {
  test("a paused campaign sends nothing; launching it lets the sweep pace it", async () => {
    for (let i = 0; i < 3; i++) insertUser({ email: `sweep${i}@weddly.test` });
    const camp = await createCampaign("sweep", 50);
    syncTargets(camp.id);

    // Paused (created default): the sweep skips it.
    expect((await runOnboardingCampaignSweep(Date.now())).invites).toBe(0);

    await req(
      "PATCH",
      `/api/admin/onboarding-campaigns/${camp.id}`,
      { status: "running" },
      {
        token: adminToken,
      },
    );
    expect((await runOnboardingCampaignSweep(Date.now())).invites).toBeGreaterThanOrEqual(1);
  });
});

describe("onboarding campaign: opt-out suppresses and blocks re-sync", () => {
  test("hitting the opt-out link flips suppression; a later sync won't re-add", async () => {
    insertUser({ email: "leaver@weddly.test" });
    const camp = await createCampaign("optout");
    syncTargets(camp.id);

    const send = db
      .prepare("SELECT id FROM onboarding_campaign_sends WHERE email = ?")
      .get("leaver@weddly.test") as { id: number };
    expect(await raw(`/api/emails/optout-onboarding/${makeOnboardingOptOutToken(send.id)}`)).toBe(
      200,
    );

    const optedOut = db
      .prepare("SELECT 1 FROM email_optouts WHERE email = ?")
      .get("leaver@weddly.test");
    expect(optedOut).toBeTruthy();

    // Re-sync into a fresh campaign: the opted-out address is skipped, not added.
    const camp2 = await createCampaign("optout-2");
    const result = syncTargets(camp2.id);
    expect(result.added).toBe(0);
    expect(result.skipped_optout).toBe(1);
  });
});

describe("onboarding campaign: reminder wave", () => {
  test("reminds a still-not-onboarded recipient after the gap, but not one who onboarded", async () => {
    const stay = insertUser({ email: "stay@weddly.test" });
    const gone = insertUser({ email: "converted@weddly.test" });
    const camp = await createCampaign("reminders");
    syncTargets(camp.id);
    // Launch so the campaign is non-paused (reminders only fire for non-paused).
    await req(
      "PATCH",
      `/api/admin/onboarding-campaigns/${camp.id}`,
      { status: "running" },
      {
        token: adminToken,
      },
    );

    const row = getCampaignRow(camp.id);
    if (!row) throw new Error("campaign vanished");
    await sendCampaignBatch(row, 100); // both get the initial send

    // Backdate both sends past the reminder gap.
    db.prepare("UPDATE onboarding_campaign_sends SET sent_at = ? WHERE campaign_id = ?").run(
      Date.now() - 5 * ONE_DAY_MS,
      camp.id,
    );
    // One of them onboards before the reminder wave.
    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(adminCoupleId, gone);

    const reminded = await sendCampaignReminders(100, Date.now());
    expect(reminded).toBe(1); // only the still-orphan gets reminded

    const stayRow = db
      .prepare("SELECT reminder_sent_at FROM onboarding_campaign_sends WHERE user_id = ?")
      .get(stay) as { reminder_sent_at: number | null };
    const goneRow = db
      .prepare("SELECT reminder_sent_at FROM onboarding_campaign_sends WHERE user_id = ?")
      .get(gone) as { reminder_sent_at: number | null };
    expect(stayRow.reminder_sent_at).not.toBeNull();
    expect(goneRow.reminder_sent_at).toBeNull();

    // A second wave is a no-op (already reminded once).
    expect(await sendCampaignReminders(100, Date.now())).toBe(0);
  });
});

describe("onboarding campaign: conversion stat", () => {
  test("a recipient who onboards after the send counts as converted", async () => {
    const uid = insertUser({ email: "willconvert@weddly.test" });
    const camp = await createCampaign("convert");
    syncTargets(camp.id);
    const row = getCampaignRow(camp.id);
    if (!row) throw new Error("campaign vanished");
    await sendCampaignBatch(row, 100);

    let detail = await req<OnboardingCampaignDetail>(
      "GET",
      `/api/admin/onboarding-campaigns/${camp.id}`,
      undefined,
      { token: adminToken },
    );
    expect(detail.data.stats.sent).toBe(1);
    expect(detail.data.stats.converted).toBe(0);

    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(adminCoupleId, uid);
    detail = await req<OnboardingCampaignDetail>(
      "GET",
      `/api/admin/onboarding-campaigns/${camp.id}`,
      undefined,
      { token: adminToken },
    );
    expect(detail.data.stats.converted).toBe(1);
  });
});
