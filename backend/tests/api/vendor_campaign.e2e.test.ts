// Vendor claim-invite campaign: the admin console, the paced sender, the
// click/open tracking, the 2-day reminder, and address-level suppression.
//
// Covers (major-change rule, new endpoints + new schema + new state machine):
//   - targeting excludes claimed / hidden / no-email / opted-out listings, and
//     any address that already has a users row (claim-complete would 409)
//   - one mail per ADDRESS: two listings sharing an inbox produce one send
//   - locale follows the listing's country (HU stays Hungarian, IT gets English)
//   - the invite link is genuinely one-click: the redirect lands on a live claim
//     token, and completing it creates the vendor account
//   - the redirect heals an EXPIRED claim instead of dead-ending
//   - reminders gate on clicks, not opens, and fire exactly once
//   - the rolling daily cap paces sends, and the worker only touches running
//     campaigns
//   - opting out suppresses the address for good
//   - every admin endpoint is admin-only

import "../setup";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { CLAIM_TOKEN_TTL_MS } from "@shared/vendor_claim";
import type {
  VendorCampaign,
  VendorCampaignDetail,
  VendorCampaignSegments,
  VendorCampaignSend,
  VendorCampaignTarget,
} from "@shared/vendor_campaign";
import { VENDOR_CAMPAIGN_REMINDER_AFTER_MS } from "@shared/vendor_campaign";
import { db, now } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { runCampaignSweep } from "../../src/domain/emails/worker";
import { backfillListings } from "../../src/domain/listings";
import {
  eligibleCampaignEmails,
  getCampaignRow,
  isOptedOut,
  makeCampaignOptOutToken,
  makeCampaignPixelToken,
  sendCampaignBatch,
  sendCampaignReminders,
} from "../../src/domain/vendor_campaign";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// Same convention as tests/helpers.ts: the port is pinned by setup.ts, with
// BUN_TEST_PORT as the worktree-parallel escape hatch.
const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// The admin (and the one couple fixture) are registered ONCE for the whole
// file. Argon2 costs ~2s per registration here, so re-minting them per test
// would dominate the runtime; `beforeEach` therefore wipes only what this
// suite dirties rather than calling the blanket wipeAll().
let token = "";

const EXISTING_USER_EMAIL = "already-a-user@example.com";

/** Raw fetch for the endpoints that are NOT JSON APIs (the tracking pixel, the
 *  invite redirect, the opt-out page). Always drains the body: an unread
 *  response body keeps its connection checked out of the keep-alive pool, and
 *  the next request in the test then waits on a socket that never frees. */
async function raw(path: string): Promise<{ status: number; location: string; body: string }> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location") ?? "", body };
}

/** The live claim token an invite redirect landed on. */
function claimTokenFromLocation(location: string): string {
  return decodeURIComponent(location.split("/vendor/claim/verify/")[1] ?? "");
}

/** Insert a curated listing directly. The campaign only ever reads `listings`,
 *  so walking the community submit + moderation flow for each fixture would add
 *  a lot of noise for no extra coverage. For curated rows the id is one of the
 *  country signals, so these ids are deliberately outside the Slovak/Austrian
 *  sets and country comes from the city suffix instead. */
function seedListing(patch: {
  id: string;
  name: string;
  city: string;
  contact_email: string | null;
  category?: string;
  status?: string;
  vendor_account_id?: number | null;
  source?: string;
  submitter_type?: string | null;
}): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, contact_email, submitter_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    patch.id,
    patch.source ?? "curated",
    patch.vendor_account_id ?? null,
    patch.category ?? "photography",
    patch.name,
    patch.city,
    patch.contact_email,
    patch.submitter_type ?? null,
    patch.status ?? "active",
    ts,
    ts,
  );
}

/** A real vendor_accounts row (with its owner user), for the "this listing is
 *  already claimed" fixture. Foreign keys are ON, so a made-up
 *  vendor_account_id would simply be rejected. */
function seedVendorAccount(tag: string): number {
  const ts = now();
  const uid = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
         VALUES (?, 'x', ?, 'active', 'vendor', 1, ?, ?)`,
      )
      .run(`${tag}@owner.test`, tag, ts, ts).lastInsertRowid,
  );
  return Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(uid, tag, ts, ts).lastInsertRowid,
  );
}

let slugCounter = 0;

async function makeCampaign(body: Record<string, unknown> = {}): Promise<VendorCampaign> {
  slugCounter++;
  const r = await req<{ campaign: VendorCampaign }>(
    "POST",
    "/api/admin/vendor-campaigns",
    { slug: `invite-${slugCounter}`, ...body },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.campaign;
}

/** Campaign row for the domain-level helpers, which take the row not the DTO. */
function rowOf(campaign: VendorCampaign) {
  const row = getCampaignRow(campaign.id);
  if (!row) throw new Error("campaign vanished");
  return row;
}

/** Flip a campaign to running. The reminder tests need it: the follow-up wave
 *  deliberately respects pause, so a campaign that only ever had a manual batch
 *  fired at it while paused is owed no reminders. */
async function start(campaign: VendorCampaign): Promise<void> {
  const r = await req(
    "PATCH",
    `/api/admin/vendor-campaigns/${campaign.id}`,
    { status: "running" },
    { token },
  );
  expect(r.status).toBe(200);
}

interface RawSend {
  id: number;
  email: string;
  locale: string;
  country: string | null;
  claim_token: string;
  status: string;
  sent_at: number | null;
  clicked_at: number | null;
  opened_at: number | null;
  reminder_sent_at: number | null;
}

function sendRows(): RawSend[] {
  return db.prepare("SELECT * FROM vendor_claim_campaign_sends ORDER BY id ASC").all() as RawSend[];
}

function firstSend(): RawSend {
  const row = sendRows()[0];
  if (!row) throw new Error("expected a send row");
  return row;
}

/** The mail body is only observable through email_log in tests (no provider
 *  key), which records the subject. That is enough to prove which language
 *  actually went out, since the subject is a single string per kind. */
function lastSubjectTo(email: string): string {
  const row = db
    .prepare("SELECT subject FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
    .get(email) as { subject: string } | undefined;
  return row?.subject ?? "";
}

/** Backdate every send past the reminder threshold. */
function ageSendsPastReminderWindow(): void {
  db.prepare("UPDATE vendor_claim_campaign_sends SET sent_at = ?").run(
    now() - VENDOR_CAMPAIGN_REMINDER_AFTER_MS - 1000,
  );
}

describe("vendor claim-invite campaign", () => {
  beforeAll(async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    token = reg.data.token;
    // A real account on a known address, so the targeting test can prove we
    // skip inboxes that claim-complete would reject with 409 email_taken.
    await bootstrapCouple(EXISTING_USER_EMAIL);
  });

  afterAll(() => {
    // MUST restore the curated directory. `bun test` runs every file in one
    // process against one DB, and the curated rows are materialised ONCE at
    // boot — so without this, the `beforeEach` wipe below leaves every later
    // test file staring at an empty `listings` table.
    backfillListings();
  });

  beforeEach(() => {
    // Deliberately NOT wipeAll(): it drops `users` and `sessions`, which would
    // invalidate the shared admin token and force a 2s re-registration per
    // test. Clear only what this suite writes. Listings go too, including the
    // curated boot snapshot (restored in afterAll), so the targeting
    // assertions aren't swamped by the ~500 real directory rows.
    db.exec("DELETE FROM vendor_claim_campaign_sends");
    db.exec("DELETE FROM vendor_claim_campaigns");
    db.exec("DELETE FROM email_optouts");
    db.exec("DELETE FROM listing_claims");
    db.exec("DELETE FROM listings");
    db.exec("DELETE FROM email_log");
  });

  test("targets only unclaimed, active, emailable, unsuppressed listings", async () => {
    seedListing({ id: "good-one", name: "Good One", city: "Budapest", contact_email: "a@good.hu" });
    seedListing({
      id: "already-claimed",
      name: "Claimed",
      city: "Budapest",
      contact_email: "b@claimed.hu",
      vendor_account_id: seedVendorAccount("claimed-owner"),
    });
    seedListing({
      id: "hidden-one",
      name: "Hidden",
      city: "Budapest",
      contact_email: "c@hidden.hu",
      status: "hidden",
    });
    seedListing({ id: "no-email", name: "No Email", city: "Budapest", contact_email: null });
    seedListing({
      id: "opted-out",
      name: "Opted Out",
      city: "Budapest",
      contact_email: "d@optout.hu",
    });
    db.prepare("INSERT INTO email_optouts (email, reason, created_at) VALUES (?, 'manual', ?)").run(
      "d@optout.hu",
      now(),
    );
    // An address that already owns a Weddly account: the claim form would 409
    // on it, so an invite would dead-end.
    seedListing({
      id: "taken-listing",
      name: "Taken",
      city: "Budapest",
      contact_email: EXISTING_USER_EMAIL,
    });

    const campaign = await makeCampaign();
    const r = await req<{ targets: VendorCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-campaigns/${campaign.id}/targets`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.targets.map((t) => t.listing_id)).toEqual(["good-one"]);
  });

  test("segments report the reachable audience per country, campaign-free", async () => {
    seedListing({ id: "hu-a", name: "HU A", city: "Budapest", contact_email: "a@hu.hu" });
    seedListing({ id: "hu-b", name: "HU B", city: "Szeged", contact_email: "b@hu.hu" });
    seedListing({ id: "it-a", name: "IT A", city: "Lake Como, IT", contact_email: "a@it.com" });
    // Excluded everywhere, so it must not inflate any count.
    seedListing({
      id: "muted",
      name: "Muted",
      city: "Budapest",
      contact_email: "quiet@hu.hu",
    });
    db.prepare("INSERT INTO email_optouts (email, reason, created_at) VALUES (?, 'manual', ?)").run(
      "quiet@hu.hu",
      now(),
    );

    const r = await req<VendorCampaignSegments>(
      "GET",
      "/api/admin/vendor-campaigns/segments",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.total).toBe(3);
    // Biggest segment first, so the picker leads with the useful option.
    expect(r.data.segments).toEqual([
      { country: "HU", addresses: 2, locale: "hu" },
      { country: "IT", addresses: 1, locale: "en" },
    ]);
  });

  test("segments ignore what an existing campaign already wrote to", async () => {
    seedListing({ id: "seg-1", name: "Seg 1", city: "Budapest", contact_email: "s1@hu.hu" });
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);

    // The create form asks "who could a NEW campaign reach?", and a new
    // campaign is not bound by an older one's history.
    const r = await req<VendorCampaignSegments>(
      "GET",
      "/api/admin/vendor-campaigns/segments",
      undefined,
      { token },
    );
    expect(r.data.total).toBe(1);
  });

  test("one mail per address when two listings share an inbox", async () => {
    seedListing({ id: "brand-a", name: "Brand A", city: "Budapest", contact_email: "hi@group.hu" });
    seedListing({ id: "brand-b", name: "Brand B", city: "Budapest", contact_email: "HI@group.hu" });

    const campaign = await makeCampaign();
    expect(await sendCampaignBatch(rowOf(campaign), 10)).toBe(1);
    expect(sendRows()).toHaveLength(1);
    // Case-insensitive: the second listing's address normalises onto the first.
    expect(firstSend().email).toBe("hi@group.hu");
  });

  test("writes Hungarian to a HU listing and English to a foreign one", async () => {
    seedListing({ id: "hu-studio", name: "HU Studio", city: "Budapest", contact_email: "hu@x.hu" });
    seedListing({
      id: "it-villa",
      name: "IT Villa",
      city: "Lake Como, IT",
      category: "venue",
      contact_email: "it@x.com",
    });

    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);

    const byEmail = new Map(sendRows().map((r) => [r.email, r]));
    expect(byEmail.get("hu@x.hu")?.locale).toBe("hu");
    expect(byEmail.get("hu@x.hu")?.country).toBe("HU");
    expect(byEmail.get("it@x.com")?.locale).toBe("en");
    expect(byEmail.get("it@x.com")?.country).toBe("IT");

    expect(lastSubjectTo("hu@x.hu")).toContain("egészítsétek ki a Weddly-profilotokat");
    expect(lastSubjectTo("it@x.com")).toContain("complete your Weddly profile");
  });

  test("the invite link is one click into a completable claim", async () => {
    seedListing({ id: "click-me", name: "Click Me", city: "Budapest", contact_email: "own@cm.hu" });
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const send = firstSend();

    const redirect = await raw(`/r/vendor-invite/${send.claim_token}`);
    expect(redirect.status).toBe(302);
    expect(redirect.location).toContain("/vendor/claim/verify/");
    // The click is recorded, which is what suppresses the reminder.
    expect(firstSend().clicked_at).toBeGreaterThan(0);

    const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
      token: claimTokenFromLocation(redirect.location),
      password: "vendorpass123",
      full_name: "Click Owner",
    });
    expect(complete.status).toBe(201);
    const listing = db
      .prepare("SELECT vendor_account_id FROM listings WHERE id = 'click-me'")
      .get() as { vendor_account_id: number | null };
    expect(listing.vendor_account_id).not.toBeNull();
  });

  test("an expired claim is healed by the redirect instead of dead-ending", async () => {
    seedListing({ id: "stale", name: "Stale Co", city: "Budapest", contact_email: "own@stale.hu" });
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const send = firstSend();

    // Age the claim past its TTL, as if the vendor clicked two weeks later.
    db.prepare("UPDATE listing_claims SET expires_at = ? WHERE token = ?").run(
      now() - CLAIM_TOKEN_TTL_MS,
      send.claim_token,
    );

    const redirect = await raw(`/r/vendor-invite/${send.claim_token}`);
    expect(redirect.status).toBe(302);
    const live = claimTokenFromLocation(redirect.location);
    expect(live).not.toBe(send.claim_token);
    expect(live.length).toBeGreaterThan(16);

    const verify = await req("POST", `/api/vendor/claim/verify/${live}`, {});
    expect(verify.status).toBe(200);
  });

  test("a claimed listing's invite link stops redirecting into the claim flow", async () => {
    seedListing({
      id: "gone",
      name: "Gone",
      city: "Budapest",
      contact_email: "own@gone.hu",
      vendor_account_id: seedVendorAccount("gone-owner"),
    });
    // Send BEFORE it was claimed: seed the send row by hand, since targeting
    // would (correctly) refuse to pick a claimed listing.
    const campaign = await makeCampaign();
    db.prepare(
      `INSERT INTO vendor_claim_campaign_sends
         (campaign_id, listing_id, email, locale, country, category, claim_token, status, sent_at, created_at)
       VALUES (?, 'gone', 'own@gone.hu', 'hu', 'HU', 'photography', 'tok-gone-1234567890', 'sent', ?, ?)`,
    ).run(campaign.id, now(), now());

    const redirect = await raw("/r/vendor-invite/tok-gone-1234567890");
    expect(redirect.status).toBe(302);
    expect(redirect.location).not.toContain("/vendor/claim/verify/");
    expect(redirect.location).toContain("/login");
  });

  test("the open pixel records an open but does NOT stop the reminder", async () => {
    seedListing({ id: "opener", name: "Opener", city: "Budapest", contact_email: "own@open.hu" });
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    const send = firstSend();

    const pixel = await raw(`/api/emails/track/campaign?t=${makeCampaignPixelToken(send.id)}`);
    expect(pixel.status).toBe(200);
    expect(firstSend().opened_at).toBeGreaterThan(0);

    // Apple MPP and the Gmail image proxy pre-fetch the pixel for people who
    // never read the mail, so an open must not suppress the nudge.
    ageSendsPastReminderWindow();
    expect(await sendCampaignReminders(10)).toBe(1);
  });

  test("a click suppresses the reminder, and the reminder fires only once", async () => {
    seedListing({ id: "clicked", name: "Clicked", city: "Budapest", contact_email: "c@one.hu" });
    seedListing({ id: "silent", name: "Silent", city: "Budapest", contact_email: "s@two.hu" });
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);

    const clicked = sendRows().find((r) => r.email === "c@one.hu");
    if (!clicked) throw new Error("missing send");
    await raw(`/r/vendor-invite/${clicked.claim_token}`);

    ageSendsPastReminderWindow();
    expect(await sendCampaignReminders(10)).toBe(1);
    const reminded = sendRows().filter((r) => r.reminder_sent_at != null);
    expect(reminded.map((r) => r.email)).toEqual(["s@two.hu"]);

    // Second pass sends nothing: reminder_sent_at is the one-shot guard.
    expect(await sendCampaignReminders(10)).toBe(0);
  });

  test("pausing a campaign stops its follow-up wave", async () => {
    seedListing({ id: "halted", name: "Halted", city: "Budapest", contact_email: "h@halt.hu" });
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    ageSendsPastReminderWindow();

    await req(
      "PATCH",
      `/api/admin/vendor-campaigns/${campaign.id}`,
      { status: "paused" },
      { token },
    );
    // Pause is the emergency brake: an operator who halts a campaign because
    // something is wrong must not have the second wave go out anyway.
    expect(await sendCampaignReminders(10)).toBe(0);

    // Resuming owes them the reminder they were still due.
    await start(campaign);
    expect(await sendCampaignReminders(10)).toBe(1);
  });

  test("no reminder before the 2-day mark", async () => {
    seedListing({ id: "fresh", name: "Fresh", city: "Budapest", contact_email: "f@fresh.hu" });
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    expect(await sendCampaignReminders(10)).toBe(0);
  });

  test("the rolling daily cap paces sends", async () => {
    for (let i = 0; i < 5; i++) {
      seedListing({
        id: `paced-${i}`,
        name: `Paced ${i}`,
        city: "Budapest",
        contact_email: `p${i}@paced.hu`,
      });
    }
    const campaign = await makeCampaign({ daily_cap: 2 });
    const row = rowOf(campaign);

    expect(await sendCampaignBatch(row, 10)).toBe(2);
    // Budget spent for the next 24h, even though 3 targets remain.
    expect(await sendCampaignBatch(row, 10)).toBe(0);

    // Roll the clock past the window and the next slice goes out.
    db.prepare("UPDATE vendor_claim_campaign_sends SET sent_at = sent_at - ?").run(
      25 * 60 * 60 * 1000,
    );
    expect(await sendCampaignBatch(row, 10)).toBe(2);
  });

  test("the worker sweep only paces campaigns that are running", async () => {
    seedListing({ id: "swept", name: "Swept", city: "Budapest", contact_email: "w@swept.hu" });
    const campaign = await makeCampaign({ daily_cap: 48 });

    // Created paused: nothing goes out until an operator starts it.
    expect((await runCampaignSweep()).invites).toBe(0);
    expect(sendRows()).toHaveLength(0);

    const start = await req<{ campaign: VendorCampaign }>(
      "PATCH",
      `/api/admin/vendor-campaigns/${campaign.id}`,
      { status: "running" },
      { token },
    );
    expect(start.status).toBe(200);
    expect(start.data.campaign.status).toBe("running");

    expect((await runCampaignSweep()).invites).toBe(1);
    expect(sendRows()).toHaveLength(1);
  });

  test("a campaign with nothing left to send retires itself", async () => {
    seedListing({ id: "only", name: "Only", city: "Budapest", contact_email: "o@only.hu" });
    const campaign = await makeCampaign();
    await req(
      "PATCH",
      `/api/admin/vendor-campaigns/${campaign.id}`,
      { status: "running" },
      { token },
    );

    await runCampaignSweep();
    await runCampaignSweep();
    expect(getCampaignRow(campaign.id)?.status).toBe("done");
  });

  test("opting out suppresses the address for good", async () => {
    seedListing({ id: "leaver", name: "Leaver", city: "Budapest", contact_email: "bye@leaver.hu" });
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    const send = firstSend();

    const optOut = await raw(`/email-optout/${makeCampaignOptOutToken(send.id)}`);
    expect(optOut.status).toBe(200);
    expect(isOptedOut("bye@leaver.hu")).toBe(true);

    // No reminder to a suppressed address, even though they never clicked.
    ageSendsPastReminderWindow();
    expect(await sendCampaignReminders(10)).toBe(0);

    // And a brand-new campaign won't target them either.
    const second = await makeCampaign();
    const targets = await req<{ targets: VendorCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-campaigns/${second.id}/targets`,
      undefined,
      { token },
    );
    expect(targets.data.targets).toHaveLength(0);
  });

  test("a forged opt-out token changes nothing", async () => {
    const r = await raw("/email-optout/1.deadbeefdeadbeefdeadbeefdeadbeef");
    expect(r.status).toBe(404);
    const count = db.prepare("SELECT COUNT(*) AS n FROM email_optouts").get() as { n: number };
    expect(count.n).toBe(0);
  });

  test("stats report the funnel, counting a claim as converted", async () => {
    seedListing({ id: "conv", name: "Conv", city: "Budapest", contact_email: "own@conv.hu" });
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const send = firstSend();

    const redirect = await raw(`/r/vendor-invite/${send.claim_token}`);
    await req("POST", "/api/vendor/claim/complete", {
      token: claimTokenFromLocation(redirect.location),
      password: "vendorpass123",
      full_name: "Conv Owner",
    });

    const detail = await req<VendorCampaignDetail>(
      "GET",
      `/api/admin/vendor-campaigns/${campaign.id}`,
      undefined,
      { token },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.stats.sent).toBe(1);
    expect(detail.data.stats.clicked).toBe(1);
    expect(detail.data.stats.claimed).toBe(1);
    expect(detail.data.stats.remaining).toBe(0);
    expect(detail.data.offer.tier).toBe("founding");

    const sends = await req<{ sends: VendorCampaignSend[] }>(
      "GET",
      `/api/admin/vendor-campaigns/${campaign.id}/sends`,
      undefined,
      { token },
    );
    expect(sends.data.sends[0]?.claimed).toBe(true);
    expect(sends.data.sends[0]?.listing_name).toBe("Conv");
  });

  test("duplicate slug is rejected", async () => {
    const first = await makeCampaign();
    const dup = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/admin/vendor-campaigns",
      { slug: first.slug },
      { token },
    );
    expect(dup.status).toBe(409);
    expect(dup.data.detail?.code).toBe("slug_taken");
  });

  test("every admin endpoint refuses a non-admin", async () => {
    const campaign = await makeCampaign();
    const login = await req<{ token: string }>("POST", "/api/auth/login", {
      email: EXISTING_USER_EMAIL,
      password: "supersafe123",
    });
    const coupleToken = login.data.token;

    for (const [method, path] of [
      ["GET", "/api/admin/vendor-campaigns"],
      ["GET", `/api/admin/vendor-campaigns/${campaign.id}`],
      ["GET", "/api/admin/vendor-campaigns/segments"],
      ["GET", `/api/admin/vendor-campaigns/${campaign.id}/targets`],
      ["GET", `/api/admin/vendor-campaigns/${campaign.id}/sends`],
      ["POST", `/api/admin/vendor-campaigns/${campaign.id}/send-batch`],
      ["PATCH", `/api/admin/vendor-campaigns/${campaign.id}`],
      ["POST", "/api/admin/vendor-campaigns/reminders"],
      ["POST", "/api/admin/vendor-campaigns/optout"],
    ] as const) {
      const asCouple = await req(method, path, method === "GET" ? undefined : {}, {
        token: coupleToken,
      });
      expect(asCouple.status).toBe(403);
      const anon = await req(method, path, method === "GET" ? undefined : {});
      expect(anon.status).toBe(401);
    }
  });
});

describe("vendor campaign — held-back addresses are never targeted", () => {
  test("no target carries a flagged listing's address", async () => {
    // The whole reason `contact_email_flag` exists. A group help desk or an
    // address that may belong to someone else must not receive a
    // "claim your business profile" invite, and this is the query that decides.
    const flagged = db
      .prepare(
        `SELECT id, contact_email FROM listings
          WHERE contact_email_flag IS NOT NULL AND contact_email IS NOT NULL`,
      )
      .all() as Array<{ id: string; contact_email: string }>;
    expect(flagged.length).toBeGreaterThan(0);

    const eligible = new Set(eligibleCampaignEmails().map((e) => e.toLowerCase()));
    expect(eligible.size).toBeGreaterThan(0); // the query works at all
    for (const row of flagged) {
      expect(eligible.has(row.contact_email.trim().toLowerCase())).toBe(false);
    }
  });
});

// Owner direction (2026-08-04): EVERY cold first-contact mail to a vendor opens
// with "a couple put you forward", whatever the listing's provenance. These
// tests pin that, because the previous rule was the opposite and the copy is
// one careless merge away from silently reverting to a per-row branch that
// nobody would notice was back.
describe("vendor campaign — every invite opens with the referral line", () => {
  /** Render the invite exactly as the sender would for one seeded listing. */
  function inviteBodyFor(target: VendorCampaignTarget): string {
    return buildEmail(
      "vendor_claim_campaign",
      {
        listingName: target.listing_name,
        categoryLabel: "Fotós",
        city: target.city,
        inviteUrl: "https://weddly.test/r/vendor-invite/tok",
        listingUrl: `https://weddly.test/suppliers/${target.listing_id}`,
        freeMonths: 12,
        locale: target.locale,
      },
      { recipientName: "", recipientLocale: target.locale },
    ).rendered.text;
  }

  async function targetsFor(): Promise<VendorCampaignTarget[]> {
    const campaign = await makeCampaign();
    const r = await req<{ targets: VendorCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-campaigns/${campaign.id}/targets`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    return r.data.targets;
  }

  function targetNamed(targets: VendorCampaignTarget[], id: string): VendorCampaignTarget {
    const found = targets.find((t) => t.listing_id === id);
    if (!found) throw new Error(`target ${id} missing`);
    return found;
  }

  test("a curated import opens with its verifiable public-data source", async () => {
    // "0"-prefixed so this fixture sorts before the whole real curated
    // directory (6,000+ rows now) under the target preview's `ORDER BY id`,
    // regardless of how large that directory grows.
    seedListing({
      id: "0curated-one",
      name: "Curated Studio",
      city: "Budapest",
      contact_email: "curated@example.hu",
    });

    const body = inviteBodyFor(targetNamed(await targetsFor(), "0curated-one"));
    expect(body).toContain("Nyilvánosan elérhető üzleti adatokkal");
    expect(body).not.toContain("ajánlotta");
    expect(body).toContain("egy év Weddly Pro");
    expect(body).toContain("díjmentesen fent marad");
    expect(body).toContain("/suppliers/0curated-one");
  });

  test("a community listing uses the same truthful campaign copy until provenance is passed", async () => {
    seedListing({
      id: "0c9001",
      name: "Couple Suggested Kft",
      city: "Budapest",
      contact_email: "suggested@example.hu",
      source: "community",
      submitter_type: "user",
    });

    const body = inviteBodyFor(targetNamed(await targetsFor(), "0c9001"));
    expect(body).toContain("Nyilvánosan elérhető üzleti adatokkal");
    expect(body).not.toContain("ajánlotta");
  });

  test("the subject leads with the profile action", () => {
    // Asserted through the builder: the end-to-end language case above already
    // proves which subject actually ships, and a second batch send here would
    // depend on how many listings earlier tests left in the shared table.
    const built = buildEmail(
      "vendor_claim_campaign",
      {
        listingName: "Lago Fiori",
        categoryLabel: "Wedding venue",
        city: "Como",
        inviteUrl: "https://weddly.test/r/vendor-invite/tok",
        listingUrl: "https://weddly.test/suppliers/lago-fiori",
        freeMonths: 12,
        locale: "en",
      },
      { recipientName: "", recipientLocale: "en" },
    );
    expect(built.subject).toContain("complete your Weddly profile");
    expect(built.subject).not.toContain("recommended");
  });
});
