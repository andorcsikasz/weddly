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
  test("the Hungarian invite renders the couple-source copy, register CTA and consent note", () => {
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
    const opener = "Egy éppen esküvőt tervező pár a Weddly oldalán megadta az e-mail-címedet.";
    const forward =
      "Ha pedig nem te készülsz esküvőre, de van a környezetedben valaki, aki éppen szervezi a nagy napot, nyugodtan továbbítsd neki ezt a levelet. 💌";
    expect(text).toContain(opener);
    expect(text).toContain(
      "A Weddly egy online esküvőtervező, ahol egy helyen kezelheted a költségvetést, a vendéglistát, az online RSVP-t, az ülésrendet, a szolgáltatókat és az esküvői weboldalatokat.",
    );
    expect(text).toContain("Ha te is esküvőt tervezel, nézz körül, és próbáld ki:");
    expect(text).toContain("Regisztrálok a Weddlyre:");
    expect(text).toContain(forward);
    expect(text).toContain(
      "Az e-mail-címedet kizárólag ennek az üzenetnek az elküldéséhez kaptuk meg és használjuk. Fiókot nem hoztunk létre számodra – az csak a te jóváhagyásoddal, regisztráció után jön létre.",
    );
    expect(text).toContain("Üdv,\na Weddly csapata");
    expect(text).toContain("Kérdésed van? hello@tryweddly.com");
    expect(text).toContain("Instagram:");
    expect(text).toContain("Facebook:");
    expect(text).toContain("TikTok:");
    expect(text).toContain("Weddly · tryweddly.com");
    expect(text).not.toContain("Bemutatkozó levél a Weddly esküvőtervezőtől");
    expect(text.indexOf(opener)).toBeLessThan(text.indexOf("Regisztrálok a Weddlyre:"));
    expect(text.indexOf("Regisztrálok a Weddlyre:")).toBeLessThan(text.indexOf(forward));
    expect(text).not.toContain("A Weddly csapatából személyesen ismerünk");
  });

  test("the English invite renders the same couple-source and consent message", () => {
    const built = buildEmail(
      "personal_invite",
      {
        name: "Anna",
        ctaUrl: "https://weddly.test/r/invite/43.signed",
        locale: "en",
      },
      { recipientName: "Anna", recipientLocale: "en" },
    );

    const text = built.rendered.text;
    const opener = "A couple currently planning their wedding on Weddly shared your email address.";
    const forward =
      "If you're not the one getting married but know someone who is planning their big day, please forward this email to them. 💌";
    expect(text).toContain("Hi Anna,");
    expect(text).toContain(opener);
    expect(text).toContain(
      "Weddly is an online wedding planner where you can manage your budget, guest list, online RSVPs, seating plan, vendors and wedding website in one place.",
    );
    expect(text).toContain("If you're planning a wedding too, take a look and give it a try:");
    expect(text).toContain("Sign up for Weddly:");
    expect(text).toContain(forward);
    expect(text).toContain(
      "We received and use your email address solely to send this message. We have not created an account for you – one will only be created with your approval, after you register.",
    );
    expect(text).toContain("Best,\nthe Weddly team");
    expect(text).toContain("Questions? hello@tryweddly.com");
    expect(text).not.toContain("An introduction from Weddly");
    expect(text.indexOf(opener)).toBeLessThan(text.indexOf("Sign up for Weddly:"));
    expect(text.indexOf("Sign up for Weddly:")).toBeLessThan(text.indexOf(forward));
  });

  test('the greeting uses the given name only, never the whole imported "Family Given" string', () => {
    // Hungarian order: given name is LAST.
    const hu = buildEmail(
      "personal_invite",
      { name: "Szigeti Kristóf", ctaUrl: "https://weddly.test/r/invite/1.signed", locale: "hu" },
      { recipientName: "Szigeti Kristóf", recipientLocale: "hu" },
    );
    expect(hu.rendered.text).toContain("Szia Kristóf!");
    expect(hu.rendered.text).not.toContain("Szigeti Kristóf");

    // Assumed Western order for the EN branch: given name is FIRST.
    const en = buildEmail(
      "personal_invite",
      { name: "John Smith", ctaUrl: "https://weddly.test/r/invite/2.signed", locale: "en" },
      { recipientName: "John Smith", recipientLocale: "en" },
    );
    expect(en.rendered.text).toContain("Hi John,");
    expect(en.rendered.text).not.toContain("Smith");

    // A single-word name is already just a given name, either branch.
    const solo = buildEmail(
      "personal_invite",
      { name: "Anna", ctaUrl: "https://weddly.test/r/invite/3.signed", locale: "hu" },
      { recipientName: "Anna", recipientLocale: "hu" },
    );
    expect(solo.rendered.text).toContain("Szia Anna!");
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
      skipped_bad_name: 0,
    });
    expect(r.data.stats.hu).toBe(3);
    expect(r.data.stats.en).toBe(1);

    const sends = listSends(campaign.id, 100);
    const en = sends.find((s) => s.email === "john@studio.co.uk");
    expect(en?.locale).toBe("en");
    const hu = sends.find((s) => s.email === "anna@gmail.com");
    expect(hu?.locale).toBe("hu");
  });

  test("a name with digits or punctuation is never imported, and admin is alerted", async () => {
    const campaign = await createCampaign("friends-bad-name");

    const r = await req<{ result: PersonalInviteImportResult }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${campaign.id}/import`,
      {
        contacts: [
          { name: "Zöld Anna", email: "clean@gmail.com" },
          // The 2026-08-24 incident shape: a source CSV that quoted a whole
          // export row (price, order id, timestamp, name) into the name field.
          { name: "0.0000,56955,6/11/21 21:13,Szigeti Kristóf", email: "kristof@gmail.com" },
          { name: "dr. Kiss Bernadett", email: "bernadett@gmail.com" }, // legit: period allowed
          { name: "Balla Réka- Erzsébet", email: "reka@gmail.com" }, // legit: hyphen allowed
        ],
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.result).toEqual({
      imported: 3,
      skipped_registered: 0,
      skipped_optout: 0,
      skipped_duplicate: 0,
      skipped_invalid: 0,
      skipped_bad_name: 1,
    });

    const sends = listSends(campaign.id, 100);
    expect(sends.some((s) => s.email === "kristof@gmail.com")).toBe(false);
    expect(sends.some((s) => s.email === "bernadett@gmail.com")).toBe(true);
    expect(sends.some((s) => s.email === "reka@gmail.com")).toBe(true);

    const alert = db
      .prepare(
        "SELECT kind, to_email FROM email_log WHERE kind = 'personal_invite_bad_name_admin_alert' ORDER BY id DESC LIMIT 1",
      )
      .get() as { kind: string; to_email: string } | undefined;
    expect(alert?.to_email).toBe("admin@test.test");

    const audit = db
      .prepare(
        "SELECT action, note FROM audit_log WHERE action = 'personal_invite.campaign.bad_name_detected' ORDER BY id DESC LIMIT 1",
      )
      .get() as { action: string; note: string } | undefined;
    expect(audit?.note).toBe("friends-bad-name");
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
          { name: "Sweep One", email: "s1@sweep.test" },
          { name: "Sweep Two", email: "s2@sweep.test" },
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
