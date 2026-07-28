// "A user suggested you" planner invites: parsing a pasted list, provisioning
// the dormant accounts, the invite mail, and the opt-out that erases what we
// created. See domain/planner_invite_batch.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { PlannerInviteBatchResult } from "@shared/types";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { addOptOut } from "../../src/domain/emails/optouts";
import {
  guessInviteLocale,
  makePlannerInviteOptOutToken,
  parsePlannerInviteList,
  verifyPlannerInviteOptOutToken,
} from "../../src/domain/planner_invite_batch";
import { registerAndVerify, req, wipeAll } from "../helpers";

/** Same base the shared `req` helper uses; these two probes hit non-API paths
 *  (the pretty opt-out alias) so they go out through raw fetch. */
const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

/** The exact shape a founder pastes: a three-column table that lost its tabs on
 *  the way out of the doc, header row included, one entry with no phone. */
const PASTED = `Név
Email
Telefon
Koncsár Andi (Szellő Lovastanya)
mailto:szellotanya@autent.hu
06-30-588-4576
Barbara Kiss (Exclusive Wedding)
mailto:exkluziveskuvo@outlook.hu
+36 70 904 5064
Backstagency
mailto:info@backstagency.com
–`;

const invite = (token: string, body: Record<string, unknown>) =>
  req<PlannerInviteBatchResult>("POST", "/api/admin/planners/invite-batch", body, { token });

describe("planner invite batch: parsing", () => {
  test("reads a flattened three-column paste, header and all", () => {
    const rows = parsePlannerInviteList(PASTED);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      email: "szellotanya@autent.hu",
      fullName: "Koncsár Andi",
      businessName: "Szellő Lovastanya",
      phone: "06-30-588-4576",
    });
    // No parenthesis: the single name plays both parts.
    expect(rows[2]).toEqual({
      email: "info@backstagency.com",
      fullName: "Backstagency",
      businessName: "Backstagency",
      phone: null,
    });
  });

  test("reads the same list tab-separated, one row per line", () => {
    const rows = parsePlannerInviteList(
      "Név\tEmail\tTelefon\nDorka Böröcz (BD Wedding)\tevent@bdwedding.hu\t+36 30 443-1015",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("event@bdwedding.hu");
    expect(rows[0]?.businessName).toBe("BD Wedding");
    expect(rows[0]?.phone).toBe("+36 30 443-1015");
  });

  test("collapses a repeated address so nobody is mailed twice from one paste", () => {
    const rows = parsePlannerInviteList(
      "Anna (Anna Weddings)\nhello@anna.hu\n+36 30 111 2222\nAnna again\nHELLO@anna.hu\n+36 30 111 2222",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("hello@anna.hu");
  });

  test("falls back to the domain when a line has an address and nothing else", () => {
    const rows = parsePlannerInviteList("hello@rekadanko.events");
    expect(rows[0]?.fullName).toBe("Rekadanko");
  });

  test("guesses HU from a Hungarian phone or a .hu address, English otherwise", () => {
    const base = { email: "a@example.com", fullName: "A", businessName: "A" };
    expect(guessInviteLocale({ ...base, phone: "+36 30 111 2222" })).toBe("hu");
    expect(guessInviteLocale({ ...base, phone: "06-30-588-4576" })).toBe("hu");
    expect(guessInviteLocale({ ...base, email: "a@studio.hu", phone: null })).toBe("hu");
    expect(guessInviteLocale({ ...base, phone: "+44 20 7946 0000" })).toBe("en");
  });
});

describe("planner invite batch: dry run", () => {
  test("previews without creating an account or sending anything", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await invite(adminToken, { text: PASTED, dry_run: true });
    expect(res.status).toBe(200);
    expect(res.data.dry_run).toBe(true);
    expect(res.data.rows).toHaveLength(3);
    expect(res.data.rows.every((r) => r.status === "ready")).toBe(true);
    // Per-row guess: the two HU phone numbers pick Hungarian, the .com with no
    // phone falls back to English. Forcing one language is the admin's call.
    expect(res.data.rows.map((r) => r.locale)).toEqual(["hu", "hu", "en"]);

    const created = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .get("szellotanya@autent.hu") as { n: number };
    expect(created.n).toBe(0);
    const mails = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'planner_suggested_invite'")
      .get() as { n: number };
    expect(mails.n).toBe(0);
  });

  test("defaults to a dry run when the caller omits the flag", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await invite(adminToken, { text: PASTED });
    expect(res.data.dry_run).toBe(true);
  });

  test("flags an address that already belongs to somebody", async () => {
    const adminToken = await bootstrapAdmin();
    await registerAndVerify({
      email: "event@bdwedding.hu",
      password: "supersafe123",
      full_name: "Taken",
    });
    const res = await invite(adminToken, {
      text: "Dorka Böröcz (BD Wedding)\nevent@bdwedding.hu\n+36 30 443-1015",
      dry_run: true,
    });
    expect(res.data.rows[0]?.status).toBe("existing");
  });

  test("rejects an empty list and requires an admin", async () => {
    const adminToken = await bootstrapAdmin();
    const empty = await invite(adminToken, { text: "   " });
    expect(empty.status).toBe(400);

    const reg = await registerAndVerify({
      email: "notadmin@weddly.test",
      password: "supersafe123",
      full_name: "Nope",
    });
    const forbidden = await invite(reg.data.token, { text: PASTED });
    expect(forbidden.status).toBe(403);
  });
});

describe("planner invite batch: send", () => {
  test("provisions a dormant planner per row and mails the take-over invite", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await invite(adminToken, { text: PASTED, dry_run: false });
    expect(res.status).toBe(200);
    expect(res.data.rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);

    const user = db
      .prepare(
        `SELECT id, full_name, business_name, planner_phone, locale, user_type,
                verified_email, password_set, status
           FROM users WHERE email = ?`,
      )
      .get("szellotanya@autent.hu") as
      | {
          id: number;
          full_name: string;
          business_name: string;
          planner_phone: string;
          locale: string;
          user_type: string;
          verified_email: number;
          password_set: number;
          status: string;
        }
      | undefined;
    expect(user).toBeDefined();
    const userId = user?.id ?? 0;
    expect(user?.full_name).toBe("Koncsár Andi");
    expect(user?.business_name).toBe("Szellő Lovastanya");
    expect(user?.planner_phone).toBe("06-30-588-4576");
    expect(user?.locale).toBe("hu");
    expect(user?.user_type).toBe("planner");
    // Dormant until the CTA is clicked: no password login, no reset, no session.
    expect(user?.verified_email).toBe(0);
    expect(user?.password_set).toBe(0);

    // 2-year comp that does NOT burn a founding slot.
    const sub = db
      .prepare(
        "SELECT subscription_status, is_founding_member, founding_until FROM planner_subscriptions WHERE user_id = ?",
      )
      .get(userId) as
      | { subscription_status: string; is_founding_member: number; founding_until: number }
      | undefined;
    expect(sub?.subscription_status).toBe("founding");
    expect(sub?.is_founding_member).toBe(0);
    expect(sub?.founding_until).toBeGreaterThan(Date.now());

    // One activation token, unconsumed: the mail's CTA is the only way in.
    const tokens = db
      .prepare(
        "SELECT COUNT(*) AS n FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL",
      )
      .get(userId) as { n: number };
    expect(tokens.n).toBe(1);

    const logged = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_log WHERE kind = 'planner_suggested_invite' AND to_email = ?",
      )
      .get("szellotanya@autent.hu") as { n: number };
    expect(logged.n).toBe(1);
  });

  test("re-running the same list mails nobody twice", async () => {
    const adminToken = await bootstrapAdmin();
    await invite(adminToken, { text: PASTED, dry_run: false });
    const again = await invite(adminToken, { text: PASTED, dry_run: false });
    expect(again.data.rows.every((r) => r.status === "existing")).toBe(true);

    const logged = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'planner_suggested_invite'")
      .get() as { n: number };
    expect(logged.n).toBe(3);
  });

  test("a suppressed address gets neither an account nor a mail", async () => {
    const adminToken = await bootstrapAdmin();
    addOptOut("info@backstagency.com", "test");
    const res = await invite(adminToken, { text: PASTED, dry_run: false });
    const row = res.data.rows.find((r) => r.email === "info@backstagency.com");
    expect(row?.status).toBe("opted_out");
    const created = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .get("info@backstagency.com") as { n: number };
    expect(created.n).toBe(0);
  });

  test("an explicit locale overrides the per-row guess", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await invite(adminToken, { text: PASTED, dry_run: false, locale: "en" });
    expect(res.data.rows.every((r) => r.locale === "en")).toBe(true);
    const locale = db
      .prepare("SELECT locale FROM users WHERE email = ?")
      .get("szellotanya@autent.hu") as { locale: string };
    expect(locale.locale).toBe("en");
  });
});

describe("planner invite batch: opt-out", () => {
  test("one click suppresses the address and erases the account we prepared", async () => {
    const adminToken = await bootstrapAdmin();
    await invite(adminToken, { text: PASTED, dry_run: false });
    const user = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("szellotanya@autent.hu") as { id: number };

    const token = makePlannerInviteOptOutToken(user.id);
    const res = await fetch(`${BASE}/planner-optout/${token}`);
    expect(res.status).toBe(200);
    await res.text();

    const after = db
      .prepare(
        "SELECT email, full_name, business_name, planner_phone, status FROM users WHERE id = ?",
      )
      .get(user.id) as {
      email: string;
      full_name: string;
      business_name: string | null;
      planner_phone: string | null;
      status: string;
    };
    expect(after.email).toBe(`deleted-${user.id}@purged.local`);
    expect(after.business_name).toBeNull();
    expect(after.planner_phone).toBeNull();
    expect(after.status).toBe("suspended");

    // The activation link is dead, and the address is suppressed for good.
    const tokens = db
      .prepare("SELECT COUNT(*) AS n FROM planner_activation_tokens WHERE user_id = ?")
      .get(user.id) as { n: number };
    expect(tokens.n).toBe(0);
    const suppressed = db
      .prepare("SELECT COUNT(*) AS n FROM email_optouts WHERE email = ?")
      .get("szellotanya@autent.hu") as { n: number };
    expect(suppressed.n).toBe(1);

    // And a re-invite from the same list is refused by the suppression list.
    const retry = await invite(adminToken, { text: PASTED, dry_run: false });
    expect(retry.data.rows[0]?.status).toBe("opted_out");
  });

  test("leaves an activated account alone, suppression only", async () => {
    const adminToken = await bootstrapAdmin();
    await invite(adminToken, { text: PASTED, dry_run: false });
    const user = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("szellotanya@autent.hu") as { id: number };
    db.prepare("UPDATE users SET password_set = 1, verified_email = 1 WHERE id = ?").run(user.id);

    const res = await fetch(`${BASE}/planner-optout/${makePlannerInviteOptOutToken(user.id)}`);
    expect(res.status).toBe(200);
    await res.text();

    const after = db.prepare("SELECT email, status FROM users WHERE id = ?").get(user.id) as {
      email: string;
      status: string;
    };
    expect(after.email).toBe("szellotanya@autent.hu");
    expect(after.status).toBe("active");
    const suppressed = db
      .prepare("SELECT COUNT(*) AS n FROM email_optouts WHERE email = ?")
      .get("szellotanya@autent.hu") as { n: number };
    expect(suppressed.n).toBe(1);
  });

  test("rejects a forged token", async () => {
    const res = await fetch(`${BASE}/planner-optout/1.deadbeef`);
    expect(res.status).toBe(404);
    await res.text();
    expect(verifyPlannerInviteOptOutToken("1.deadbeef")).toBeNull();
  });
});

describe("planner invite email", () => {
  const payload = {
    plannerName: "Koncsár Andi",
    businessName: "Szellő Lovastanya",
    activateUrl: "https://tryweddly.com/planner/activate/tok",
    optOutUrl: "https://tryweddly.com/planner-optout/1.sig",
    guestUntil: "2028. július 28.",
    locale: "hu" as const,
  };

  test("HU render carries the recommendation, the CTA, the data notice and the way out", () => {
    const built = buildEmail("planner_suggested_invite", payload, {
      recipientName: "Koncsár Andi",
      recipientLocale: "hu",
    });
    expect(built.subject).toContain("Ajánlottak");
    const { html, text } = built.rendered;
    expect(html).toContain("Szellő Lovastanya");
    expect(text).toContain("javasolta a nevedet");
    expect(text).toContain("GDPR 6. cikk");
    expect(text).toContain("nyilvánosan");
    // Activation link, untagged: a single-use account link must stay clean.
    expect(text).toContain(payload.activateUrl);
    expect(html).not.toContain("utm_campaign");
    // The way out is reachable in both renderings, not just the HTML one, but
    // it is a bare label: the body copy never points at it.
    expect(text).toContain(payload.optOutUrl);
    expect(text).not.toContain("kattints lent");
    // The stock outreach footer would claim they have no account. This one
    // doesn't have to lie.
    expect(text).not.toContain("Nincs fiókod nálunk");
  });

  test("EN render is single-language and keeps the same promises", () => {
    const built = buildEmail(
      "planner_suggested_invite",
      { ...payload, locale: "en", guestUntil: "28 July 2028" },
      { recipientName: "Koncsár Andi", recipientLocale: "en" },
    );
    expect(built.subject).toContain("recommended");
    const { text } = built.rendered;
    expect(text).toContain("Article 6(1)(f) GDPR");
    expect(text).toContain("Unsubscribe:");
    expect(text).not.toContain("Szia");
  });

  test("says nothing about the price being free, per the copy rule", () => {
    for (const locale of ["hu", "en"] as const) {
      const { rendered } = buildEmail(
        "planner_suggested_invite",
        { ...payload, locale },
        { recipientName: "Koncsár Andi", recipientLocale: locale },
      );
      const body = rendered.text.toLowerCase();
      expect(body).not.toContain("ingyen");
      expect(body).not.toContain("free");
      expect(body).not.toContain("bankkártya");
      expect(body).not.toContain("—");
    }
  });
});
