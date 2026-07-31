// Every account-creation path owes the new account a welcome mail, and the
// admin email history has to be able to FIND it.
//
// The bug this suite pins: the admin user drawer showed "no email history" for
// brand-new couples. Two causes stacked on top of each other.
//
//   1. `welcome_verify` is sent while the signup is still a `pending_signups`
//      row, so it logs with `user_id = NULL` and a `WHERE user_id = ?` lookup
//      can never see it. Same for `partner_invite`, addressed to someone who
//      only becomes a user minutes later.
//   2. Google/Apple signups skip `welcome_verify` entirely (the provider
//      attests the address), so those accounts genuinely received nothing, and
//      neither did a partner who accepted an invite.
//
// Fixes: `welcome_account` at every account birth, `partner_welcome` on join,
// and an address-stitched admin history query.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION } from "@shared/legal";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

interface LogRow {
  kind: string;
  user_id: number | null;
  couple_id: number | null;
  to_email: string;
  status: string;
}

function logFor(email: string): LogRow[] {
  return db
    .prepare(
      `SELECT kind, user_id, couple_id, to_email, status
         FROM email_log WHERE to_email = ? COLLATE NOCASE ORDER BY id`,
    )
    .all(email) as LogRow[];
}

function userIdFor(email: string): number {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`no user for ${email}`);
  return row.id;
}

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  expect(reg.status).toBe(201);
  return reg.data.token;
}

async function adminHistory(token: string, userId: number): Promise<Array<{ kind: string }>> {
  const r = await req<{ emails: Array<{ kind: string }> }>(
    "GET",
    `/api/admin/users/${userId}/emails`,
    undefined,
    { token },
  );
  expect(r.status).toBe(200);
  return r.data.emails;
}

describe("welcome mail on every account-creation path", () => {
  beforeEach(() => wipeAll());

  test("password signup: verify mints the account AND sends welcome_account under its user_id", async () => {
    const email = "welcome-pw@weddly.test";
    await registerAndVerify({ email, password: "supersafe123", full_name: "Fanni" });

    const rows = logFor(email);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain("welcome_verify");
    expect(kinds).toContain("welcome_account");

    // The verify mail predates the account, so it can only be NULL-keyed. The
    // welcome mail is the first one that carries the real user_id.
    const verify = rows.find((r) => r.kind === "welcome_verify");
    expect(verify?.user_id).toBeNull();
    const welcome = rows.find((r) => r.kind === "welcome_account");
    expect(welcome?.user_id).toBe(userIdFor(email));
  });

  test("Google signup gets welcome_account — it never sees welcome_verify", async () => {
    const { mintTestBearer } = await import("../../src/lib/google_oauth");
    const email = "welcome-google@weddly.test";
    const credential = mintTestBearer({ sub: "g-welcome-1", email, name: "G Welcome" });
    const r = await req("POST", "/api/auth/google", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(r.status).toBe(201);

    const rows = logFor(email);
    expect(rows.map((x) => x.kind)).toEqual(["welcome_account"]);
    expect(rows[0]?.user_id).toBe(userIdFor(email));
  });

  test("the legacy verify branch (an account that already exists) does NOT re-welcome", async () => {
    // Vendor register mints a real unverified user + an email_verification_tokens
    // row, so its verify click takes the other branch of handleConsume. That
    // branch must stay silent: the account was not born here.
    const email = "welcome-vendor@weddly.test";
    const reg = await req("POST", "/api/vendor/register", {
      email,
      password: "supersafe123",
      full_name: "Vendor Person",
      business_name: "Vendor Co",
      category: "photography",
      locale: "en",
    });
    expect(reg.status).toBe(201);

    const { verifyUserEmail } = await import("../helpers");
    await verifyUserEmail(email);

    expect(logFor(email).map((x) => x.kind)).not.toContain("welcome_account");
  });
});

describe("partner_welcome on join", () => {
  beforeEach(() => wipeAll());

  test("the partner who accepts the invite is welcomed, not just the inviter", async () => {
    const ownerEmail = "pw-owner@weddly.test";
    const partnerEmail = "pw-partner@weddly.test";
    const { token, coupleId } = await bootstrapCouple(ownerEmail);

    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: partnerEmail },
      { token },
    );
    expect(inv.status).toBe(201);

    const partner = await registerAndVerify({
      email: partnerEmail,
      password: "supersafe123",
      full_name: "Balázs",
    });
    expect(partner.status).toBe(201);
    const acc = await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept`,
      {},
      { token: partner.data.token },
    );
    expect(acc.status).toBe(200);

    const partnerRows = logFor(partnerEmail);
    const welcome = partnerRows.find((r) => r.kind === "partner_welcome");
    expect(welcome).toBeDefined();
    expect(welcome?.user_id).toBe(userIdFor(partnerEmail));
    expect(welcome?.couple_id).toBe(coupleId);

    // The inviter's side is unchanged.
    expect(logFor(ownerEmail).map((r) => r.kind)).toContain("partner_invite_accepted");
  });
});

describe("admin email history stitches pre-account mail by address", () => {
  beforeEach(() => wipeAll());

  test("a freshly verified couple has a non-empty history, welcome_verify included", async () => {
    const email = "history-couple@weddly.test";
    await registerAndVerify({ email, password: "supersafe123", full_name: "Fanni" });
    const token = await adminToken();

    const kinds = (await adminHistory(token, userIdFor(email))).map((e) => e.kind);
    // welcome_verify only shows up via the address stitch — its row is NULL-keyed.
    expect(kinds).toContain("welcome_verify");
    expect(kinds).toContain("welcome_account");
  });

  test("the invited partner's history shows the invite that predates their account", async () => {
    const ownerEmail = "history-owner@weddly.test";
    const partnerEmail = "history-partner@weddly.test";
    const { token: ownerTok } = await bootstrapCouple(ownerEmail);
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: partnerEmail },
      { token: ownerTok },
    );
    expect(inv.status).toBe(201);

    // The invite mail is logged with user_id = NULL: at send time this address
    // had no account at all.
    expect(logFor(partnerEmail).find((r) => r.kind === "partner_invite")?.user_id).toBeNull();

    await registerAndVerify({
      email: partnerEmail,
      password: "supersafe123",
      full_name: "Balázs",
    });
    const token = await adminToken();
    const kinds = (await adminHistory(token, userIdFor(partnerEmail))).map((e) => e.kind);
    expect(kinds).toContain("partner_invite");
  });

  test("one user's history never leaks another user's mail", async () => {
    const a = "leak-a@weddly.test";
    const b = "leak-b@weddly.test";
    await registerAndVerify({ email: a, password: "supersafe123", full_name: "Aliz" });
    await registerAndVerify({ email: b, password: "supersafe123", full_name: "Bence" });
    const token = await adminToken();

    const r = await req<{ emails: Array<{ to_email: string }> }>(
      "GET",
      `/api/admin/users/${userIdFor(a)}/emails`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.emails.length).toBeGreaterThan(0);
    for (const e of r.data.emails) expect(e.to_email.toLowerCase()).toBe(a);
  });
});
