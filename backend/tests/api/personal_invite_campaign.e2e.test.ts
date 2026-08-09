// Personal-invite campaign: the admin console, the CSV/JSON import with its
// dedup, the language detection, the paced sender that re-checks eligibility at
// send time, and address-level opt-out.
//
// Covers (major-change rule: new endpoints + new schema + new state machine):
//   - import dedups against registered users, opt-outs, in-file duplicates and
//     invalid addresses, one row per (campaign, email)
//   - locale detection: HU default, EN only on a non-HU country TLD
//   - the paced sender honours the rolling-24h daily_cap
//   - a contact who registers (or opts out) between import and send is skipped,
//     never mailed
//   - opting out suppresses the address for good, and a re-import drops it
//   - every admin endpoint is admin-only

import "../setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  PersonalInviteCampaign,
  PersonalInviteCampaignDetail,
  PersonalInviteImportResult,
} from "@shared/personal_invite_campaign";
import { db, now } from "../../src/db";
import { runPersonalInviteCampaignSweep } from "../../src/domain/emails/worker";
import { buildEmail } from "../../src/domain/emails/templates";
import {
  getCampaignRow,
  isOptedOut,
  listSends,
  makeInviteClickToken,
  makeInviteOptOutToken,
  makeInvitePixelToken,
  sendCampaignBatch,
} from "../../src/domain/personal_invite_campaign";
import { registerAndVerify, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

let token = "";

async function raw(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body };
}

beforeAll(async () => {
  await wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "password123",
    full_name: "Ádám Nagy",
  });
  token = reg.data.token;
});

afterAll(() => {
  db.prepare("DELETE FROM personal_invite_campaign_sends").run();
  db.prepare("DELETE FROM personal_invite_campaigns").run();
});

async function createCampaign(slug: string, dailyCap = 50): Promise<PersonalInviteCampaign> {
  const r = await req<{ campaign: PersonalInviteCampaign }>(
    "POST",
    "/api/admin/personal-invite/campaigns",
    { slug, daily_cap: dailyCap },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.campaign;
}

describe("personal-invite campaign", () => {
  test("the Hungarian invite renders the personal-source copy, register CTA and email-use note", () => {
    const built = buildEmail(
      "personal_invite",
      {
        name: "Anna",
        ctaUrl: "https://weddly.test/r/invite/42.signed",
        locale: "hu",
      },
      { recipientName: "Anna", recipientLocale: "hu" },
    );

    const text = built.rendered.text;
    const opener =
      "A Weddly csapatából személyesen ismerünk, ezért szeretnénk röviden bemutatni nektek a Weddlyt.";
    const forward =
      "Ha egy családtagod vagy barátod szervezi az esküvőjét, ezt a levelet neki is továbbíthatod.";
    expect(text).toContain(opener);
    expect(text).toContain("Ha te vagy valaki a környezetedben esküvőt szervez, nézz körül:");
    expect(text).toContain("Regisztrálok a Weddlyre:");
    expect(text).toContain(forward);
    expect(text).toContain(
      "Az e-mail-címedet kizárólag ennek az e-mailnek a kiküldéséhez használjuk. Ha a jövőben is szeretnél leveleket kapni tőlünk, regisztrálj a Weddly-n.",
    );
    expect(text).toContain("Üdv,\na Weddly csapata");
    expect(text.indexOf(opener)).toBeLessThan(text.indexOf("Regisztrálok a Weddlyre:"));
    expect(text.indexOf("Regisztrálok a Weddlyre:")).toBeLessThan(text.indexOf(forward));
    expect(text).not.toContain("a Weddly egyik felhasználója megadta az e-mail-címedet");
  });

  test("every admin endpoint is admin-only", async () => {
    const reg = await registerAndVerify({
      email: "notadmin@test.test",
      password: "password123",
      full_name: "Nóra Barta",
    });
    const outsider = reg.data.token;
    const probes: Array<[string, string]> = [
      ["GET", "/api/admin/personal-invite/campaigns"],
      ["POST", "/api/admin/personal-invite/campaigns"],
      ["GET", "/api/admin/personal-invite/campaigns/1"],
      ["PATCH", "/api/admin/personal-invite/campaigns/1"],
      ["POST", "/api/admin/personal-invite/campaigns/1/import"],
      ["POST", "/api/admin/personal-invite/campaigns/1/send-batch"],
    ];
    for (const [method, path] of probes) {
      const r = await req(method, path, method === "GET" ? undefined : {}, { token: outsider });
      expect(r.status).toBe(403);
    }
  });

  test("import dedups against users, opt-outs, dupes and invalid, and detects locale", async () => {
    // A registered address the import must skip.
    await registerAndVerify({
      email: "already@test.test",
      password: "password123",
      full_name: "Registered",
    });
    const campaign = await createCampaign("friends-a");

    const r = await req<{ result: PersonalInviteImportResult; stats: { hu: number; en: number } }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      {
        contacts: [
          { name: "Zöld Anna", email: "anna@gmail.com" }, // HU (diacritic)
          { name: "Kis Pál", email: "pal@valami.hu" }, // HU (.hu)
          { name: "Bob Plain", email: "bob@gmail.com" }, // HU (default)
          { name: "John Smith", email: "john@studio.co.uk" }, // EN (non-HU ccTLD)
          { name: "Dup", email: "ANNA@gmail.com" }, // duplicate (case-insensitive)
          { name: "Registered", email: "already@test.test" }, // already has a users row
          { name: "Bad", email: "not-an-email" }, // invalid
        ],
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.result).toEqual({
      imported: 4,
      skipped_registered: 1,
      skipped_optout: 0,
      skipped_duplicate: 1,
      skipped_invalid: 1,
    });
    expect(r.data.stats.hu).toBe(3);
    expect(r.data.stats.en).toBe(1);

    const sends = listSends(campaign.id, 100);
    const en = sends.find((s) => s.email === "john@studio.co.uk");
    expect(en?.locale).toBe("en");
    const hu = sends.find((s) => s.email === "anna@gmail.com");
    expect(hu?.locale).toBe("hu");
  });

  test("paced sender honours the daily cap and drains over multiple windows", async () => {
    const campaign = await createCampaign("friends-paced", 2);
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      {
        contacts: [
          { name: "A", email: "a@paced.test" },
          { name: "B", email: "b@paced.test" },
          { name: "C", email: "c@paced.test" },
          { name: "D", email: "d@paced.test" },
          { name: "E", email: "e@paced.test" },
        ],
      },
      { token },
    );
    const row = getCampaignRow(campaign.id)!;
    const t0 = now();
    // First window: cap = 2.
    const sent1 = await sendCampaignBatch(row, 100, t0);
    expect(sent1).toBe(2);
    // Same window: budget exhausted.
    const sent2 = await sendCampaignBatch(row, 100, t0 + 1000);
    expect(sent2).toBe(0);
    // A day later: two more.
    const sent3 = await sendCampaignBatch(row, 100, t0 + 25 * 60 * 60 * 1000);
    expect(sent3).toBe(2);

    const stats = getCampaignRow(campaign.id)!;
    expect(stats).toBeTruthy();
    const detail = await req<PersonalInviteCampaignDetail>(
      "GET",
      `/api/admin/personal-invite/campaigns/${campaign.id}`,
      undefined,
      { token },
    );
    expect(detail.data.stats.sent).toBe(4);
    expect(detail.data.stats.queued).toBe(1);
  });

  test("a contact who registers between import and send is skipped, never mailed", async () => {
    const campaign = await createCampaign("friends-latereg");
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      {
        contacts: [
          { name: "Later", email: "later@reg.test" },
          { name: "Ok", email: "ok@reg.test" },
        ],
      },
      { token },
    );
    // They sign up on their own before the sweep reaches them.
    await registerAndVerify({
      email: "later@reg.test",
      password: "password123",
      full_name: "Later Reg",
    });
    const row = getCampaignRow(campaign.id)!;
    await sendCampaignBatch(row, 100, now());
    const sends = listSends(campaign.id, 100);
    const later = sends.find((s) => s.email === "later@reg.test");
    const ok = sends.find((s) => s.email === "ok@reg.test");
    expect(later?.status).toBe("skipped");
    expect(later?.sent_at).toBeNull();
    expect(ok?.status).toBe("sent");
  });

  test("running campaign gets paced by the worker sweep", async () => {
    const campaign = await createCampaign("friends-sweep", 5);
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      {
        contacts: [
          { name: "S1", email: "s1@sweep.test" },
          { name: "S2", email: "s2@sweep.test" },
        ],
      },
      { token },
    );
    // Paused campaigns are ignored by the sweep.
    let swept = await runPersonalInviteCampaignSweep(now());
    const beforeStart = listSends(campaign.id, 100).filter((s) => s.status === "sent").length;
    expect(beforeStart).toBe(0);
    // Start it.
    const patched = await req<{ campaign: PersonalInviteCampaign }>(
      "PATCH",
      `/api/admin/personal-invite/campaigns/${campaign.id}`,
      { status: "running" },
      { token },
    );
    expect(patched.data.campaign.status).toBe("running");
    swept = await runPersonalInviteCampaignSweep(now());
    expect(swept.invites).toBeGreaterThanOrEqual(1);
  });

  test("opting out suppresses the address and a re-import drops it", async () => {
    const campaign = await createCampaign("friends-optout");
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      { contacts: [{ name: "Quit", email: "quit@optout.test" }] },
      { token },
    );
    const send = listSends(campaign.id, 100).find((s) => s.email === "quit@optout.test")!;
    expect(isOptedOut("quit@optout.test")).toBe(false);

    const res = await raw(`/api/emails/optout-invite/${makeInviteOptOutToken(send.id)}`);
    expect(res.status).toBe(200);
    expect(isOptedOut("quit@optout.test")).toBe(true);

    // A fresh campaign re-importing the same address now skips it.
    const c2 = await createCampaign("friends-optout-2");
    const r = await req<{ result: PersonalInviteImportResult }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${c2.id}/import`,
      { contacts: [{ name: "Quit", email: "quit@optout.test" }] },
      { token },
    );
    expect(r.data.result.skipped_optout).toBe(1);
    expect(r.data.result.imported).toBe(0);
  });

  test("import accepts a raw CSV string with a name,email header", async () => {
    const campaign = await createCampaign("friends-csv");
    const csv = 'name,email\n"Nagy Béla","bela@csv.test"\n"Foreign Guy","guy@x.de"\n';
    const r = await req<{ result: PersonalInviteImportResult }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      { csv },
      { token },
    );
    expect(r.data.result.imported).toBe(2);
    const sends = listSends(campaign.id, 100);
    expect(sends.find((s) => s.email === "guy@x.de")?.locale).toBe("en");
    expect(sends.find((s) => s.email === "bela@csv.test")?.locale).toBe("hu");
  });

  // Opens + clicks. The family shipped blind, attributed only by the users-row
  // join at the far end, so a campaign that converted nobody could not be told
  // apart from one nobody opened.
  test("the pixel stamps opened once, and only for a signed token", async () => {
    const campaign = await createCampaign("friends-pixel");
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      { contacts: [{ name: "P", email: "p@pixel.test" }] },
      { token },
    );
    await sendCampaignBatch(getCampaignRow(campaign.id)!, 100, now());
    const sendId = listSends(campaign.id, 10)[0]?.id as number;
    expect(sendId).toBeGreaterThan(0);
    expect(listSends(campaign.id, 10)[0]?.opened_at).toBeNull();

    const hit = await raw(`/api/emails/track/invite-campaign?t=${makeInvitePixelToken(sendId)}`);
    expect(hit.status).toBe(200);
    const first = listSends(campaign.id, 10)[0]?.opened_at;
    expect(first).toBeGreaterThan(0);

    // First open wins: a mail client re-fetching the image is not a second
    // reader, so the timestamp must not move.
    await raw(`/api/emails/track/invite-campaign?t=${makeInvitePixelToken(sendId)}`);
    expect(listSends(campaign.id, 10)[0]?.opened_at).toBe(first as number);

    // A forged token still gets a pixel back (never leak which ids exist) but
    // stamps nothing.
    const forged = await raw(`/api/emails/track/invite-campaign?t=${sendId}.deadbeef`);
    expect(forged.status).toBe(200);
  });

  test("the CTA redirect stamps the click and lands on the UTM'd register URL", async () => {
    const campaign = await createCampaign("friends-click");
    await req(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      { contacts: [{ name: "C", email: "c@click.test" }] },
      { token },
    );
    await sendCampaignBatch(getCampaignRow(campaign.id)!, 100, now());
    const sendId = listSends(campaign.id, 10)[0]?.id as number;

    const res = await fetch(`${BASE}/r/invite/${makeInviteClickToken(sendId)}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const dest = res.headers.get("location") ?? "";
    // The tracking must not cost the attribution that was already working.
    expect(dest).toContain("utm_source=invite");
    expect(dest).toContain("utm_campaign=friends-click");
    expect(listSends(campaign.id, 10)[0]?.clicked_at).toBeGreaterThan(0);

    const detail = await req<PersonalInviteCampaignDetail>(
      "GET",
      `/api/admin/personal-invite/campaigns/${campaign.id}`,
      undefined,
      { token },
    );
    expect(detail.data.stats.clicked).toBe(1);
    expect(detail.data.stats.opened).toBe(0);
  });

  test("an unknown click token redirects home rather than dead-ending", async () => {
    const res = await fetch(`${BASE}/r/invite/999999.deadbeef`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBeTruthy();
  });
});
