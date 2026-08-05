// Vendor review-invite campaign: the admin console, the paced sender, the
// click/open tracking, the 7-day reminder, the "collected a review" metric, and
// address-level suppression.
//
// Covers (major-change rule, new endpoints + new schema + new state machine):
//   - targeting hits only CLAIMED, active listings whose owner account is active
//     and reachable; unclaimed / hidden / suspended-owner rows are skipped
//   - one send per campaign per address (re-sending is idempotent)
//   - locale follows the vendor's account locale, else their country
//   - the CTA redirect stamps clicked_at and lands on the vendor's public page
//   - the pixel stamps opened_at
//   - reminders gate on NEITHER clicked NOR opened (the stricter gate), fire
//     exactly once, skip a vendor who already collected a review, and respect
//     pause as the emergency brake
//   - `collected` counts vendors whose listing gained a review after the send
//   - opting out suppresses the address for good
//   - every admin endpoint is admin-only

import "../setup";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  VendorReviewCampaign,
  VendorReviewCampaignDetail,
  VendorReviewCampaignSegments,
  VendorReviewCampaignSend,
  VendorReviewCampaignTarget,
} from "@shared/vendor_review_campaign";
import { VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS } from "@shared/vendor_review_campaign";
import { db, now } from "../../src/db";
import { runReviewCampaignSweep } from "../../src/domain/emails/worker";
import { backfillListings } from "../../src/domain/listings";
import {
  getCampaignRow,
  isOptedOut,
  makeReviewClickToken,
  makeReviewOptOutToken,
  makeReviewPixelToken,
  sendCampaignBatch,
  sendCampaignReminders,
} from "../../src/domain/vendor_review_campaign";
import { registerAndVerify, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

let token = "";
let adminUserId = 0;

/** Raw fetch for the non-JSON endpoints (pixel, CTA redirect, opt-out page).
 *  Always drains the body so the keep-alive socket frees for the next request. */
async function raw(path: string): Promise<{ status: number; location: string; body: string }> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location") ?? "", body };
}

let seedCounter = 0;

/** A fully claimed vendor: an active owner user + a vendor_accounts row + an
 *  active `v{N}` listing. This is exactly the audience the campaign writes to,
 *  so every field the targeting query reads is set. */
function seedClaimedVendor(
  opts: {
    name?: string;
    city?: string;
    country?: string | null;
    locale?: string | null;
    email?: string;
    listingStatus?: string;
    ownerStatus?: string;
  } = {},
): { accountId: number; listingId: string; email: string; name: string } {
  seedCounter++;
  const ts = now();
  const name = opts.name ?? `Studio ${seedCounter}`;
  const email = opts.email ?? `vendor${seedCounter}@shop.test`;
  const uid = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, locale, created_at, updated_at)
         VALUES (?, 'x', ?, ?, 'vendor', 1, ?, ?, ?)`,
      )
      .run(email, name, opts.ownerStatus ?? "active", opts.locale ?? null, ts, ts).lastInsertRowid,
  );
  const accountId = Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, country, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(uid, name, opts.country ?? null, ts, ts).lastInsertRowid,
  );
  const listingId = `v${accountId}`;
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, contact_email, status, created_at, updated_at)
     VALUES (?, 'claimed', ?, 'photography', ?, ?, ?, ?, ?, ?)`,
  ).run(
    listingId,
    accountId,
    name,
    opts.city ?? "Budapest",
    email,
    opts.listingStatus ?? "active",
    ts,
    ts,
  );
  return { accountId, listingId, email, name };
}

/** An UNCLAIMED directory listing (vendor_account_id NULL) — should never be a
 *  target of this campaign. */
function seedUnclaimedListing(): void {
  seedCounter++;
  const ts = now();
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, contact_email, status, created_at, updated_at)
     VALUES (?, 'curated', NULL, 'photography', ?, 'Budapest', ?, 'active', ?, ?)`,
  ).run(`curated-${seedCounter}`, `Cold ${seedCounter}`, `cold${seedCounter}@x.test`, ts, ts);
}

/** A published review on a listing, dated `createdAt`, to exercise `collected`. */
function seedReview(supplierId: string, createdAt: number): void {
  db.prepare(
    `INSERT INTO supplier_reviews
       (supplier_id, author_user_id, author_kind, rating, body, published, created_at, updated_at)
     VALUES (?, ?, 'visitor', 5, 'lovely', 1, ?, ?)`,
  ).run(supplierId, adminUserId, createdAt, createdAt);
}

let slugCounter = 0;

async function makeCampaign(body: Record<string, unknown> = {}): Promise<VendorReviewCampaign> {
  slugCounter++;
  const r = await req<{ campaign: VendorReviewCampaign }>(
    "POST",
    "/api/admin/vendor-review-campaigns",
    { slug: `reviews-${slugCounter}`, ...body },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.campaign;
}

function rowOf(campaign: VendorReviewCampaign) {
  const row = getCampaignRow(campaign.id);
  if (!row) throw new Error("campaign vanished");
  return row;
}

async function start(campaign: VendorReviewCampaign): Promise<void> {
  const r = await req(
    "PATCH",
    `/api/admin/vendor-review-campaigns/${campaign.id}`,
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
  review_url: string;
  status: string;
  sent_at: number | null;
  clicked_at: number | null;
  opened_at: number | null;
  reminder_sent_at: number | null;
}

function sendRows(): RawSend[] {
  return db
    .prepare("SELECT * FROM vendor_review_campaign_sends ORDER BY id ASC")
    .all() as RawSend[];
}

function firstSend(): RawSend {
  const row = sendRows()[0];
  if (!row) throw new Error("expected a send row");
  return row;
}

function lastSubjectTo(email: string): string {
  const row = db
    .prepare("SELECT subject FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
    .get(email) as { subject: string } | undefined;
  return row?.subject ?? "";
}

function ageSendsPastReminderWindow(): void {
  db.prepare("UPDATE vendor_review_campaign_sends SET sent_at = ?").run(
    now() - VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS - 1000,
  );
}

describe("vendor review-invite campaign", () => {
  beforeAll(async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    token = reg.data.token;
    adminUserId = reg.data.user.id;
  });

  afterAll(() => {
    backfillListings();
  });

  beforeEach(() => {
    // Leave users/sessions alone (the admin token must survive). Orphaned
    // vendor_accounts/users from prior tests are harmless once their listing is
    // gone, since targeting JOINs through listings.
    db.exec("DELETE FROM vendor_review_campaign_sends");
    db.exec("DELETE FROM vendor_review_campaigns");
    db.exec("DELETE FROM supplier_reviews");
    db.exec("DELETE FROM email_optouts");
    db.exec("DELETE FROM email_preferences");
    db.exec("DELETE FROM listings");
    db.exec("DELETE FROM email_log");
  });

  test("targets only claimed, active listings with an active, reachable owner", async () => {
    const wanted = seedClaimedVendor({ name: "Keep Me" });
    seedUnclaimedListing(); // vendor_account_id NULL → skipped
    seedClaimedVendor({ name: "Hidden", listingStatus: "hidden" }); // not public → skipped
    seedClaimedVendor({ name: "Suspended", ownerStatus: "suspended" }); // frozen owner → skipped

    const campaign = await makeCampaign();
    const r = await req<{ targets: VendorReviewCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-review-campaigns/${campaign.id}/targets`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.targets).toHaveLength(1);
    expect(r.data.targets[0]?.email).toBe(wanted.email);
    expect(r.data.targets[0]?.listing_id).toBe(wanted.listingId);
  });

  test("a vendor who muted product mail is not targeted", async () => {
    const wanted = seedClaimedVendor({ name: "Reachable" });
    const muted = seedClaimedVendor({ name: "Muted" });
    const uid = (
      db.prepare("SELECT id FROM users WHERE email = ?").get(muted.email) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO email_preferences (user_id, unsubscribe_token, lifecycle_opt_out, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    ).run(uid, `tok-${uid}`, now(), now());

    const campaign = await makeCampaign();
    const r = await req<{ targets: VendorReviewCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-review-campaigns/${campaign.id}/targets`,
      undefined,
      { token },
    );
    const emails = r.data.targets.map((tg) => tg.email);
    expect(emails).toContain(wanted.email);
    expect(emails).not.toContain(muted.email);
  });

  test("creates paused, and a duplicate slug is a 409", async () => {
    const c = await makeCampaign({ slug: "dup-slug" });
    expect(c.status).toBe("paused");
    const r = await req(
      "POST",
      "/api/admin/vendor-review-campaigns",
      { slug: "dup-slug" },
      { token },
    );
    expect(r.status).toBe(409);
  });

  test("stamps launched on first run, keeps it across re-launch, ends on Done", async () => {
    const c = await makeCampaign();
    expect(c.started_at).toBeNull();
    expect(c.ended_at).toBeNull();

    const patch = (status: string) =>
      req<{ campaign: VendorReviewCampaign }>(
        "PATCH",
        `/api/admin/vendor-review-campaigns/${c.id}`,
        { status },
        { token },
      );

    // Launch → started_at set, still no end.
    const running = await patch("running");
    const launchedAt = running.data.campaign.started_at;
    expect(launchedAt).not.toBeNull();
    expect(running.data.campaign.ended_at).toBeNull();

    // Pause then re-launch must NOT move the original launch stamp.
    await patch("paused");
    const relaunched = await patch("running");
    expect(relaunched.data.campaign.started_at).toBe(launchedAt);
    expect(relaunched.data.campaign.ended_at).toBeNull();

    // Explicit Done stamps the end.
    const done = await patch("done");
    expect(done.data.campaign.ended_at).not.toBeNull();
  });

  test("segments break the audience down by country", async () => {
    seedClaimedVendor({ country: "HU", locale: "hu" });
    seedClaimedVendor({ country: "HU", locale: "hu" });
    seedClaimedVendor({ country: "DE", locale: "en" });

    const r = await req<VendorReviewCampaignSegments>(
      "GET",
      "/api/admin/vendor-review-campaigns/segments",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.total).toBe(3);
    const hu = r.data.segments.find((s) => s.country === "HU");
    const de = r.data.segments.find((s) => s.country === "DE");
    expect(hu?.addresses).toBe(2);
    expect(hu?.locale).toBe("hu");
    expect(de?.addresses).toBe(1);
    // German ships as a UI language, so a German segment is written to in
    // German. This used to read "en" back when every non-HU country collapsed
    // to English.
    expect(de?.locale).toBe("de");
  });

  test("send batch delivers one mail per vendor, in their language", async () => {
    const hu = seedClaimedVendor({ locale: "hu" });
    const en = seedClaimedVendor({ locale: "en", country: "DE" });
    const campaign = await makeCampaign();

    const sent = await sendCampaignBatch(rowOf(campaign), 10);
    expect(sent).toBe(2);
    const rows = sendRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((s) => s.status === "sent")).toBe(true);

    // Subject language follows the resolved per-vendor locale.
    expect(lastSubjectTo(hu.email)).toContain("értékelő linketek");
    expect(lastSubjectTo(en.email)).toContain("review link is ready");

    // Re-running writes nothing new: one send per (campaign, address).
    const again = await sendCampaignBatch(rowOf(campaign), 10);
    expect(again).toBe(0);
    expect(sendRows()).toHaveLength(2);
  });

  test("the pixel stamps opened_at (first open wins)", async () => {
    seedClaimedVendor();
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const s = firstSend();
    expect(s.opened_at).toBeNull();

    await raw(`/api/emails/track/review-campaign?t=${makeReviewPixelToken(s.id)}`);
    const opened = firstSend().opened_at;
    expect(opened).not.toBeNull();

    // A second open must not rewrite the timestamp.
    await raw(`/api/emails/track/review-campaign?t=${makeReviewPixelToken(s.id)}`);
    expect(firstSend().opened_at).toBe(opened);
  });

  test("the CTA redirect stamps clicked_at and lands on the public page", async () => {
    const v = seedClaimedVendor();
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const s = firstSend();
    expect(s.clicked_at).toBeNull();

    const res = await raw(`/r/vendor-review/${makeReviewClickToken(s.id)}`);
    expect(res.status).toBe(302);
    expect(res.location).toBe(s.review_url);
    expect(res.location).toContain(`/vendors/`);
    expect(res.location).toContain(v.listingId);
    expect(firstSend().clicked_at).not.toBeNull();
  });

  test("a forged CTA token redirects to the directory, never crashes", async () => {
    const res = await raw(`/r/vendor-review/999.deadbeef`);
    expect(res.status).toBe(302);
    expect(res.location).toContain("/vendors");
  });

  test("reminder fires once for an untouched send after the window", async () => {
    seedClaimedVendor();
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    ageSendsPastReminderWindow();

    const first = await sendCampaignReminders(10);
    expect(first).toBe(1);
    expect(firstSend().reminder_sent_at).not.toBeNull();

    // Exactly one nudge ever.
    const second = await sendCampaignReminders(10);
    expect(second).toBe(0);
  });

  test("an OPENED (or clicked) mail suppresses the reminder", async () => {
    seedClaimedVendor();
    const opened = await makeCampaign();
    await start(opened);
    await sendCampaignBatch(rowOf(opened), 10);
    ageSendsPastReminderWindow();
    // Merely opening it is enough to mute the nudge for THIS campaign.
    await raw(`/api/emails/track/review-campaign?t=${makeReviewPixelToken(firstSend().id)}`);
    expect(await sendCampaignReminders(10)).toBe(0);
    expect(firstSend().reminder_sent_at).toBeNull();
  });

  test("a vendor who already collected a review gets no reminder", async () => {
    const v = seedClaimedVendor();
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    ageSendsPastReminderWindow();
    // A review landed after the send → the ask is done.
    seedReview(v.listingId, now());
    expect(await sendCampaignReminders(10)).toBe(0);
  });

  test("pause halts the reminder wave", async () => {
    seedClaimedVendor();
    const campaign = await makeCampaign();
    await start(campaign);
    await sendCampaignBatch(rowOf(campaign), 10);
    ageSendsPastReminderWindow();
    await req(
      "PATCH",
      `/api/admin/vendor-review-campaigns/${campaign.id}`,
      { status: "paused" },
      { token },
    );
    expect(await sendCampaignReminders(10)).toBe(0);
  });

  test("`collected` counts vendors whose listing gained a review after the send", async () => {
    const v = seedClaimedVendor();
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    // A review dated after the send.
    seedReview(v.listingId, now() + 1000);

    const r = await req<VendorReviewCampaignDetail>(
      "GET",
      `/api/admin/vendor-review-campaigns/${campaign.id}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.stats.collected).toBe(1);
    expect(r.data.stats.sent).toBe(1);
  });

  test("opt-out suppresses the address and removes it from targeting", async () => {
    const v = seedClaimedVendor();
    const campaign = await makeCampaign();
    await sendCampaignBatch(rowOf(campaign), 10);
    const s = firstSend();

    const res = await raw(`/review-optout/${makeReviewOptOutToken(s.id)}`);
    expect(res.status).toBe(200);
    expect(isOptedOut(v.email)).toBe(true);

    // A brand-new campaign no longer sees the suppressed address.
    const next = await makeCampaign();
    const r = await req<{ targets: VendorReviewCampaignTarget[] }>(
      "GET",
      `/api/admin/vendor-review-campaigns/${next.id}/targets`,
      undefined,
      { token },
    );
    expect(r.data.targets.some((tg) => tg.email === v.email)).toBe(false);
  });

  test("the worker sweep sends for running campaigns", async () => {
    seedClaimedVendor();
    const campaign = await makeCampaign();
    await start(campaign);
    const r = await runReviewCampaignSweep();
    expect(r.invites).toBe(1);
    expect(firstSend().status).toBe("sent");
  });

  test("a campaign with nobody left retires itself to done and stamps the end", async () => {
    const campaign = await makeCampaign();
    const sent = await sendCampaignBatch(rowOf(campaign), 10);
    expect(sent).toBe(0);
    const row = getCampaignRow(campaign.id);
    expect(row?.status).toBe("done");
    expect(row?.ended_at).not.toBeNull();
  });

  test("every admin endpoint is admin-only", async () => {
    const campaign = await makeCampaign();
    const paths: Array<[string, string]> = [
      ["GET", "/api/admin/vendor-review-campaigns"],
      ["POST", "/api/admin/vendor-review-campaigns"],
      ["GET", "/api/admin/vendor-review-campaigns/segments"],
      ["GET", `/api/admin/vendor-review-campaigns/${campaign.id}`],
      ["PATCH", `/api/admin/vendor-review-campaigns/${campaign.id}`],
      ["GET", `/api/admin/vendor-review-campaigns/${campaign.id}/targets`],
      ["GET", `/api/admin/vendor-review-campaigns/${campaign.id}/sends`],
      ["POST", `/api/admin/vendor-review-campaigns/${campaign.id}/send-batch`],
      ["POST", "/api/admin/vendor-review-campaigns/reminders"],
      ["POST", "/api/admin/vendor-review-campaigns/optout"],
    ];
    for (const [method, path] of paths) {
      const r = await req(method, path, method === "GET" ? undefined : {}, {});
      expect(r.status === 401 || r.status === 403).toBe(true);
    }
  });
});
