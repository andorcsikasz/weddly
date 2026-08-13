import "../setup";

import { UI_LOCALES } from "@shared/locales";
import { describe, expect, test } from "bun:test";
import {
  req,
  wipeAll,
  verifyUserEmail,
  bootstrapCouple,
  latestPendingSignupToken,
  plaintextForStoredToken,
  registerAndVerify,
} from "../helpers";
import { hashPassword } from "../../src/auth/password";
import { issueSession } from "../../src/auth/session";
import { db, now } from "../../src/db";

/** Mint a genuinely UNVERIFIED `users` row.
 *
 *  Register can't produce one any more: it parks the signup in
 *  `pending_signups` and the account is only minted — already verified — by the
 *  verify click. The shape is still real, though: vendor register, and every
 *  account that pre-dates the split, live here. It's the exact cohort the login
 *  gate and the resend paths exist for, so the tests below build it directly
 *  rather than through an endpoint that can no longer emit it. */
async function createUnverifiedUser(
  email: string,
  password = "supersafe123",
  fullName = "Unverified",
): Promise<number> {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email,
                          password_set, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, 1, ?, ?)`,
    )
    .run(email, await hashPassword(password), fullName, ts, ts);
  return Number(result.lastInsertRowid);
}

// ─── /api/auth/register ─────────────────────────────────────────────────────

describe("POST /api/auth/register — validation", () => {
  test("missing email returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      password: "supersafe123",
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("non-string email returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: 42,
      password: "supersafe123",
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("email without @ returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "not-an-email",
      password: "supersafe123",
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("email starting with @ returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "@example.com",
      password: "supersafe123",
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("missing password returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "ok@example.com",
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("password longer than 1024 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "long@example.com",
      password: "a".repeat(1025),
      full_name: "Xénia",
    });
    expect(r.status).toBe(400);
  });

  test("missing full_name returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "noname@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(400);
  });

  test("empty/whitespace full_name returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "blank@example.com",
      password: "supersafe123",
      full_name: "   ",
    });
    expect(r.status).toBe(400);
  });

  test("full_name longer than 200 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "long-name@example.com",
      password: "supersafe123",
      full_name: "Anita".repeat(201),
    });
    expect(r.status).toBe(400);
  });

  test("stale privacy_version returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "stale@example.com",
      password: "supersafe123",
      full_name: "Stale",
      privacy_version: "1999-01-01",
    });
    expect(r.status).toBe(400);
  });

  test("missing privacy_version returns 400 (sentinel: null pass-through)", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "noprivacy@example.com",
      password: "supersafe123",
      full_name: "NoPrivacy",
      privacy_version: null,
    });
    expect(r.status).toBe(400);
  });

  test("invalid JSON body returns 400", async () => {
    wipeAll();
    const res = await fetch(`http://localhost:${process.env.PORT ?? "8791"}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-client-ip": "10.99.0.1",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("email is normalized to lowercase + trimmed", async () => {
    wipeAll();
    const r = await registerAndVerify({
      email: "  MiXeD@Example.COM  ",
      password: "supersafe123",
      full_name: "Mixed",
    });
    expect(r.status).toBe(201);
    expect(r.data.user.email).toBe("mixed@example.com");
  });
});

describe("POST /api/auth/register — rate limit (5/min/IP)", () => {
  test("6th attempt from the same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.0.5";
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/register",
        {
          email: `rl${i}@example.com`,
          password: "supersafe123",
          full_name: `Rita Lakatos ${i}`,
        },
        { clientIp: ip },
      );
      // 202, not 201: register parks a pending signup and creates nothing.
      expect(r.status).toBe(202);
    }
    const sixth = await req(
      "POST",
      "/api/auth/register",
      {
        email: "rl6@example.com",
        password: "supersafe123",
        full_name: "Rita Lakatos",
      },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/login ────────────────────────────────────────────────────────

describe("POST /api/auth/login — validation + errors", () => {
  test("missing email returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/login", { password: "supersafe123" });
    expect(r.status).toBe(400);
  });

  test("missing password returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/login", { email: "x@x.test" });
    expect(r.status).toBe(400);
  });

  test("unknown email returns 401 (no enumeration)", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/login", {
      email: "nobody@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(401);
  });

  test("login is case-insensitive on email", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "case@example.com",
      password: "supersafe123",
      full_name: "Case",
    });
    await verifyUserEmail("case@example.com");
    const r = await req("POST", "/api/auth/login", {
      email: "CASE@Example.COM",
      password: "supersafe123",
    });
    expect(r.status).toBe(200);
  });

  test("rejects suspended user with 403", async () => {
    wipeAll();
    await registerAndVerify({
      email: "suspended@example.com",
      password: "supersafe123",
      full_name: "Suspended",
    });
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(
      "suspended@example.com",
    );
    const r = await req("POST", "/api/auth/login", {
      email: "suspended@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(403);
  });

  test("returns fresh token + user payload on success", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "fresh@example.com",
      password: "supersafe123",
      full_name: "Fresh",
    });
    await verifyUserEmail("fresh@example.com");
    const r = await req<{ token: string; user: { email: string } }>("POST", "/api/auth/login", {
      email: "fresh@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(200);
    expect(r.data.token).toContain(".");
    expect(r.data.user.email).toBe("fresh@example.com");
  });

  test("6th login attempt from same IP hits 429", async () => {
    wipeAll();
    const ip = "10.42.1.10";
    await registerAndVerify({
      email: "ratelimit@example.com",
      password: "supersafe123",
      full_name: "RL Login",
    });
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/login",
        { email: "ratelimit@example.com", password: "wrong-guess" },
        { clientIp: ip },
      );
      expect(r.status).toBe(401);
    }
    const sixth = await req(
      "POST",
      "/api/auth/login",
      { email: "ratelimit@example.com", password: "wrong-guess" },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/login — verified-email gate ──────────────────────────────────

describe("POST /api/auth/login — verified-email gate", () => {
  test("unverified account is blocked with 403 + email_unverified code", async () => {
    wipeAll();
    await createUnverifiedUser("gate-unverified@example.com");
    const r = await req<{ detail?: { code?: string } }>("POST", "/api/auth/login", {
      email: "gate-unverified@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("email_unverified");
  });

  test("blocked login does NOT issue a session token", async () => {
    wipeAll();
    await createUnverifiedUser("gate-notoken@example.com");
    const r = await req<{ token?: string }>("POST", "/api/auth/login", {
      email: "gate-notoken@example.com",
      password: "supersafe123",
    });
    expect(r.status).toBe(403);
    expect(r.data.token).toBeUndefined();
  });

  test("blocked login auto-sends a fresh verification link", async () => {
    wipeAll();
    await createUnverifiedUser("gate-resend@example.com");
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("gate-resend@example.com") as { n: number };
    await req("POST", "/api/auth/login", {
      email: "gate-resend@example.com",
      password: "supersafe123",
    });
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("gate-resend@example.com") as { n: number };
    expect(after.n).toBe(before.n + 1);
  });

  test("a wrong password on an unverified account still returns 401 (not 403)", async () => {
    wipeAll();
    await createUnverifiedUser("gate-wrongpw@example.com");
    const r = await req("POST", "/api/auth/login", {
      email: "gate-wrongpw@example.com",
      password: "this-is-wrong",
    });
    // Password is checked before the verify gate — no verification oracle for
    // someone who doesn't even know the password.
    expect(r.status).toBe(401);
  });

  test("once verified, the previously-blocked account logs in normally", async () => {
    wipeAll();
    await createUnverifiedUser("gate-then-ok@example.com");
    const blocked = await req("POST", "/api/auth/login", {
      email: "gate-then-ok@example.com",
      password: "supersafe123",
    });
    expect(blocked.status).toBe(403);
    await verifyUserEmail("gate-then-ok@example.com");
    const ok = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "gate-then-ok@example.com",
      password: "supersafe123",
    });
    expect(ok.status).toBe(200);
    expect(ok.data.token).toContain(".");
  });
});

// ─── /api/auth/verify/request-public — unauthenticated resend ───────────────

describe("POST /api/auth/verify/request-public", () => {
  test("unknown email returns 200 and creates no token (no enumeration)", async () => {
    wipeAll();
    const r = await req<{ ok: true }>("POST", "/api/auth/verify/request-public", {
      email: "nobody-public@example.com",
    });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM email_verification_tokens").get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });

  test("malformed email (no @) returns 200 silently", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/verify/request-public", { email: "not-an-email" });
    expect(r.status).toBe(200);
  });

  test("unverified account gets a brand-new token + verify_resend email", async () => {
    wipeAll();
    await createUnverifiedUser("public-unverified@example.com", "supersafe123", "PU");
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("public-unverified@example.com") as { n: number };
    const r = await req("POST", "/api/auth/verify/request-public", {
      email: "public-unverified@example.com",
    });
    expect(r.status).toBe(200);
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("public-unverified@example.com") as { n: number };
    expect(after.n).toBe(before.n + 1);
    const mail = db
      .prepare("SELECT to_email FROM email_log WHERE kind = 'verify_resend' AND to_email = ?")
      .all("public-unverified@example.com") as { to_email: string }[];
    expect(mail.length).toBeGreaterThanOrEqual(1);
  });

  test("pending signup (no users row yet) gets a freshly re-issued link", async () => {
    wipeAll();
    // The cohort this endpoint now mainly serves: register parked the signup and
    // the welcome mail held the only copy of the link. There's no users row, so
    // the branch above can't see them — the token rotates on the pending row.
    const reg = await req("POST", "/api/auth/register", {
      email: "public-pending@example.com",
      password: "supersafe123",
      full_name: "Panna Papp",
    });
    expect(reg.status).toBe(202);
    const before = latestPendingSignupToken("public-pending@example.com");

    const r = await req("POST", "/api/auth/verify/request-public", {
      email: "public-pending@example.com",
    });
    expect(r.status).toBe(200);
    const mail = db
      .prepare("SELECT to_email FROM email_log WHERE kind = 'verify_resend' AND to_email = ?")
      .all("public-pending@example.com") as { to_email: string }[];
    expect(mail.length).toBeGreaterThanOrEqual(1);

    // The re-issued link is the live one; the superseded token is dead.
    const after = latestPendingSignupToken("public-pending@example.com");
    expect(after).not.toBe(before);
    const stale = await req("POST", `/api/auth/verify/${before}`, {});
    expect(stale.status).toBe(400);
    const fresh = await req("POST", `/api/auth/verify/${after}`, {});
    expect(fresh.status).toBe(201);
  });

  test("already-verified account gets no new token (silent 200)", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "public-verified@example.com",
      password: "supersafe123",
      full_name: "Péter Vas",
    });
    await verifyUserEmail("public-verified@example.com");
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("public-verified@example.com") as { n: number };
    const r = await req("POST", "/api/auth/verify/request-public", {
      email: "public-verified@example.com",
    });
    expect(r.status).toBe(200);
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("public-verified@example.com") as { n: number };
    expect(after.n).toBe(before.n);
  });

  test("6th request-public from the same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.7.70";
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/verify/request-public",
        { email: `pubrl${i}@example.com` },
        { clientIp: ip },
      );
      expect(r.status).toBe(200);
    }
    const sixth = await req(
      "POST",
      "/api/auth/verify/request-public",
      { email: "pubrl6@example.com" },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/logout ────────────────────────────────────────────────────────

describe("POST /api/auth/logout", () => {
  test("unauthenticated logout returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/logout", {});
    expect(r.status).toBe(401);
  });

  test("logout with bad bearer returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/logout", {}, { token: "abc.def" });
    expect(r.status).toBe(401);
  });

  test("logout invalidates only the current token; other sessions stay alive", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "multi@example.com",
      password: "supersafe123",
      full_name: "Multi",
    });
    await verifyUserEmail("multi@example.com");
    const a = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "multi@example.com",
      password: "supersafe123",
    });
    const b = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "multi@example.com",
      password: "supersafe123",
    });
    expect(a.data.token).not.toBe(b.data.token);

    const out = await req("POST", "/api/auth/logout", {}, { token: a.data.token });
    expect(out.status).toBe(200);

    const meA = await req("GET", "/api/auth/me", undefined, { token: a.data.token });
    expect(meA.status).toBe(401);

    const meB = await req("GET", "/api/auth/me", undefined, { token: b.data.token });
    expect(meB.status).toBe(200);
  });

  test("logout is idempotent — second call with same token returns 401", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "idem-logout@example.com",
      password: "supersafe123",
      full_name: "IL",
    });
    const first = await req("POST", "/api/auth/logout", {}, { token: reg.data.token });
    expect(first.status).toBe(200);
    const second = await req("POST", "/api/auth/logout", {}, { token: reg.data.token });
    expect(second.status).toBe(401);
  });
});

// ─── /api/auth/change-password ──────────────────────────────────────────────

describe("POST /api/auth/change-password", () => {
  test("unauthenticated change-password returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/change-password", {
      current_password: "supersafe123",
      new_password: "evenmoresafer456",
    });
    expect(r.status).toBe(401);
  });

  test("missing current_password returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "cp-missing@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    const r = await req(
      "POST",
      "/api/auth/change-password",
      { new_password: "evenmoresafer456" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("missing new_password returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "cp-missing-new@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    const r = await req(
      "POST",
      "/api/auth/change-password",
      { current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("new_password shorter than 8 chars returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "cp-short@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    const r = await req(
      "POST",
      "/api/auth/change-password",
      { current_password: "supersafe123", new_password: "short" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("change-password revokes ALL sessions for the user", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "cp-revoke@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    await verifyUserEmail("cp-revoke@example.com");
    // Three concurrent sessions, then we change the password using #1.
    const s1 = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "cp-revoke@example.com",
      password: "supersafe123",
    });
    const s2 = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "cp-revoke@example.com",
      password: "supersafe123",
    });
    const s3 = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "cp-revoke@example.com",
      password: "supersafe123",
    });

    const change = await req<{ token: string }>(
      "POST",
      "/api/auth/change-password",
      { current_password: "supersafe123", new_password: "rotated-pw-456" },
      { token: s1.data.token },
    );
    expect(change.status).toBe(200);
    expect(change.data.token).not.toBe(s1.data.token);

    for (const tok of [s1.data.token, s2.data.token, s3.data.token]) {
      const me = await req("GET", "/api/auth/me", undefined, { token: tok });
      expect(me.status).toBe(401);
    }
    // The freshly-issued post-change token works.
    const meFresh = await req("GET", "/api/auth/me", undefined, { token: change.data.token });
    expect(meFresh.status).toBe(200);
  });

  test("change-password issues a password_changed email", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "cp-mail@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    const r = await req(
      "POST",
      "/api/auth/change-password",
      { current_password: "supersafe123", new_password: "rotated-pw-456" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(200);
    const mail = db
      .prepare("SELECT to_email FROM email_log WHERE kind = 'password_changed'")
      .all() as Array<{ to_email: string }>;
    expect(mail.length).toBe(1);
    expect(mail[0]!.to_email).toBe("cp-mail@example.com");
  });

  test("6th change-password attempt from same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.2.20";
    const reg = await registerAndVerify({
      email: "cp-rl@example.com",
      password: "supersafe123",
      full_name: "Csaba Pintér",
    });
    // Each call rotates password + token, so we have to keep the latest token + pw.
    let token = reg.data.token;
    let pw = "supersafe123";
    for (let i = 0; i < 5; i++) {
      const next = `rotated-pw-${i}-xx`;
      const r = await req<{ token: string }>(
        "POST",
        "/api/auth/change-password",
        { current_password: pw, new_password: next },
        { token, clientIp: ip },
      );
      expect(r.status).toBe(200);
      token = r.data.token;
      pw = next;
    }
    const sixth = await req(
      "POST",
      "/api/auth/change-password",
      { current_password: pw, new_password: "rotated-pw-final" },
      { token, clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/me ───────────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  test("missing bearer returns 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/auth/me");
    expect(r.status).toBe(401);
  });

  test("malformed bearer returns 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/auth/me", undefined, { token: "not-a-real-token" });
    expect(r.status).toBe(401);
  });

  test("bearer with bad signature returns 401", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "me-sig@example.com",
      password: "supersafe123",
      full_name: "Sig",
    });
    const [id] = reg.data.token.split(".");
    const tampered = `${id}.${"f".repeat(64)}`;
    const r = await req("GET", "/api/auth/me", undefined, { token: tampered });
    expect(r.status).toBe(401);
  });

  test("returns sanitized user payload (no password_hash)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "me-shape@example.com",
      password: "supersafe123",
      full_name: "Shape",
    });
    const r = await req<{
      user: { id: number; email: string; password_hash?: unknown; is_admin: boolean };
    }>("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(r.status).toBe(200);
    expect(r.data.user.email).toBe("me-shape@example.com");
    expect(r.data.user.password_hash).toBeUndefined();
    expect(r.data.user.is_admin).toBe(false);
  });

  test("suspended user's bearer stops working immediately", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "me-susp@example.com",
      password: "supersafe123",
      full_name: "Susp",
    });
    // Token works initially.
    const before = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(before.status).toBe(200);

    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run("me-susp@example.com");

    const after = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(after.status).toBe(401);
  });

  test("admin allowlisted user has is_admin = true", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    const r = await req<{ user: { is_admin: boolean } }>("GET", "/api/auth/me", undefined, {
      token: reg.data.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.user.is_admin).toBe(true);
  });
});

// ─── /api/auth/verify/:token (consume) ──────────────────────────────────────

describe("POST /api/auth/verify/:token — consume", () => {
  test("unknown token returns 400", async () => {
    wipeAll();
    const r = await req("POST", `/api/auth/verify/${"a".repeat(64)}`, {});
    expect(r.status).toBe(400);
  });

  test("token shorter than 16 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/verify/short", {});
    expect(r.status).toBe(400);
  });

  test("expired token (>7 days) returns 400", async () => {
    wipeAll();
    const reg = await req("POST", "/api/auth/register", {
      email: "verify-exp@example.com",
      password: "supersafe123",
      full_name: "VE",
    });
    expect(reg.status).toBe(202);
    // A password signup's link redeems a pending_signups row, so that's the row
    // whose expiry has to lapse. Same 7-day TTL, same opaque 400.
    const token = latestPendingSignupToken("verify-exp@example.com");
    db.prepare("UPDATE pending_signups SET expires_at = 1 WHERE email = ?").run(
      "verify-exp@example.com",
    );
    const r = await req("POST", `/api/auth/verify/${token}`, {});
    expect(r.status).toBe(400);
    // The dead link minted nothing.
    expect(
      db.prepare("SELECT id FROM users WHERE email = ?").get("verify-exp@example.com"),
    ).toBeNull();
  });

  test("already-consumed token returns 400", async () => {
    wipeAll();
    const reg = await req("POST", "/api/auth/register", {
      email: "verify-once@example.com",
      password: "supersafe123",
      full_name: "VO",
    });
    expect(reg.status).toBe(202);
    const token = latestPendingSignupToken("verify-once@example.com");
    // The first click mints the account (201) and deletes the pending row it
    // redeemed, so re-clicking the link can't replay the signup.
    const first = await req("POST", `/api/auth/verify/${token}`, {});
    expect(first.status).toBe(201);
    const second = await req("POST", `/api/auth/verify/${token}`, {});
    expect(second.status).toBe(400);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .get("verify-once@example.com") as { n: number };
    expect(count.n).toBe(1);
  });

  test("consuming a signup link mints the account already verified", async () => {
    wipeAll();
    const reg = await req("POST", "/api/auth/register", {
      email: "verify-flip2@example.com",
      password: "supersafe123",
      full_name: "Viola Fehér",
    });
    expect(reg.status).toBe(202);
    // No users row can hold verified_email = 0 here any more: register parks the
    // signup and the click is what creates the account. The old "0 → 1 flip" is
    // now "nothing → an already-verified row".
    expect(
      db.prepare("SELECT id FROM users WHERE email = ?").get("verify-flip2@example.com"),
    ).toBeNull();

    await verifyUserEmail("verify-flip2@example.com");

    const after = db
      .prepare("SELECT verified_email FROM users WHERE email = ?")
      .get("verify-flip2@example.com") as { verified_email: number };
    expect(after.verified_email).toBe(1);
  });
});

describe("POST /api/auth/verify/request — resend", () => {
  test("unauthenticated resend returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/verify/request", {});
    expect(r.status).toBe(401);
  });

  test("resend with bad bearer returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/verify/request", {}, { token: "garbage" });
    expect(r.status).toBe(401);
  });

  test("resend for an already-verified user short-circuits with already_verified=true", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "verify-already-v@example.com",
      password: "supersafe123",
      full_name: "Already V",
    });
    const r = await req<{ ok: true; already_verified?: boolean }>(
      "POST",
      "/api/auth/verify/request",
      {},
      { token: reg.data.token },
    );
    expect(r.status).toBe(200);
    expect(r.data.already_verified).toBe(true);
  });

  test("6th resend from the same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.3.30";
    const reg = await registerAndVerify({
      email: "resend-rl@example.com",
      password: "supersafe123",
      full_name: "Réka Rózsa",
    });
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/verify/request",
        {},
        { token: reg.data.token, clientIp: ip },
      );
      expect(r.status).toBe(200);
    }
    const sixth = await req(
      "POST",
      "/api/auth/verify/request",
      {},
      { token: reg.data.token, clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });

  test("each successful resend adds a brand-new token row", async () => {
    wipeAll();
    // Only an UNVERIFIED account actually resends — a verified one short-circuits
    // on already_verified. Register can't produce that shape any more, so build
    // the row directly and hand it the session vendor-register would have issued
    // (that path, plus pre-split accounts, is who still reaches this endpoint).
    const userId = await createUnverifiedUser("resend-fresh@example.com", "supersafe123", "RF");
    const token = issueSession(userId, "activation");
    await req("POST", "/api/auth/verify/request", {}, { token });
    await req("POST", "/api/auth/verify/request", {}, { token });
    const rows = db
      .prepare("SELECT id FROM email_verification_tokens WHERE user_id = ?")
      .all(userId) as { id: number }[];
    // Two resends, two rows. Register contributes none: a pending signup's link
    // lives in pending_signups, not here.
    expect(rows.length).toBe(2);
  });
});

// ─── /api/auth/forgot ───────────────────────────────────────────────────────

describe("POST /api/auth/forgot", () => {
  test("unknown email returns 200 (no enumeration)", async () => {
    wipeAll();
    const r = await req<{ ok: true }>("POST", "/api/auth/forgot", {
      email: "nobody@example.test",
    });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });

  test("missing email field still returns 200 (no enumeration)", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/forgot", {});
    expect(r.status).toBe(200);
  });

  test("malformed email (no @) returns 200 silently", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/forgot", { email: "not-an-email" });
    expect(r.status).toBe(200);
  });

  test("unknown email does NOT create a token row", async () => {
    wipeAll();
    await req("POST", "/api/auth/forgot", { email: "nobody2@example.test" });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM password_reset_tokens").get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });

  test("suspended account doesn't get a reset token (silent 200)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "susp-reset@example.com",
      password: "supersafe123",
      full_name: "Susp",
    });
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(reg.data.user.id);
    const r = await req("POST", "/api/auth/forgot", { email: "susp-reset@example.com" });
    expect(r.status).toBe(200);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ?")
      .get(reg.data.user.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  test("known email writes a single-use token + sends a password_reset email", async () => {
    wipeAll();
    await registerAndVerify({
      email: "forgot-ok@example.com",
      password: "supersafe123",
      full_name: "FO",
    });
    const r = await req("POST", "/api/auth/forgot", { email: "forgot-ok@example.com" });
    expect(r.status).toBe(200);
    const tokenRow = db
      .prepare(
        "SELECT token, consumed_at FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("forgot-ok@example.com") as { token: string; consumed_at: number | null };
    expect(tokenRow.token.length).toBeGreaterThan(32);
    expect(tokenRow.consumed_at).toBeNull();

    const mail = db
      .prepare("SELECT to_email FROM email_log WHERE kind = 'password_reset' AND to_email = ?")
      .all("forgot-ok@example.com") as { to_email: string }[];
    expect(mail.length).toBe(1);
  });

  test("6th forgot attempt from same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.4.40";
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/forgot",
        { email: `forgot${i}@example.com` },
        { clientIp: ip },
      );
      expect(r.status).toBe(200);
    }
    const sixth = await req(
      "POST",
      "/api/auth/forgot",
      { email: "forgot6@example.com" },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/reset ────────────────────────────────────────────────────────

describe("POST /api/auth/reset", () => {
  test("missing token returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", { password: "newpassword123" });
    expect(r.status).toBe(400);
  });

  test("token shorter than 16 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", {
      token: "shorty",
      password: "newpassword123",
    });
    expect(r.status).toBe(400);
  });

  test("missing password returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", { token: "a".repeat(64) });
    expect(r.status).toBe(400);
  });

  test("password shorter than 8 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", {
      token: "a".repeat(64),
      password: "short",
    });
    expect(r.status).toBe(400);
  });

  test("password longer than 1024 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", {
      token: "a".repeat(64),
      password: "a".repeat(1025),
    });
    expect(r.status).toBe(400);
  });

  test("unknown token returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/reset", {
      token: "unknown".padEnd(64, "x"),
      password: "newpassword123",
    });
    expect(r.status).toBe(400);
  });

  test("consumed token cannot be reused (single-use)", async () => {
    wipeAll();
    await registerAndVerify({
      email: "reset-once@example.com",
      password: "supersafe123",
      full_name: "RO",
    });
    await req("POST", "/api/auth/forgot", { email: "reset-once@example.com" });
    const tokenRow = db
      .prepare(
        "SELECT token FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("reset-once@example.com") as { token: string };
    const first = await req("POST", "/api/auth/reset", {
      token: plaintextForStoredToken(tokenRow.token),
      password: "newpassword-1",
    });
    expect(first.status).toBe(200);
    const second = await req("POST", "/api/auth/reset", {
      token: plaintextForStoredToken(tokenRow.token),
      password: "newpassword-2",
    });
    expect(second.status).toBe(400);
  });

  test("successful reset revokes all sessions for the user", async () => {
    wipeAll();
    await registerAndVerify({
      email: "reset-rev@example.com",
      password: "supersafe123",
      full_name: "Réka Rózsa",
    });
    const s1 = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "reset-rev@example.com",
      password: "supersafe123",
    });
    const s2 = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "reset-rev@example.com",
      password: "supersafe123",
    });

    await req("POST", "/api/auth/forgot", { email: "reset-rev@example.com" });
    const tokenRow = db
      .prepare(
        "SELECT token FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("reset-rev@example.com") as { token: string };

    const reset = await req("POST", "/api/auth/reset", {
      token: plaintextForStoredToken(tokenRow.token),
      password: "rotated-after-reset-1",
    });
    expect(reset.status).toBe(200);

    const meA = await req("GET", "/api/auth/me", undefined, { token: s1.data.token });
    expect(meA.status).toBe(401);
    const meB = await req("GET", "/api/auth/me", undefined, { token: s2.data.token });
    expect(meB.status).toBe(401);
  });

  test("6th reset attempt from same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.5.50";
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/reset",
        { token: `not-real-${i}`.padEnd(64, "x"), password: "newpassword123" },
        { clientIp: ip },
      );
      expect(r.status).toBe(400);
    }
    const sixth = await req(
      "POST",
      "/api/auth/reset",
      { token: "not-real-final".padEnd(64, "x"), password: "newpassword123" },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });

  test("a token issued before suspension can't reset a suspended account", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "reset-susp@example.com",
      password: "supersafe123",
      full_name: "Roland Sárdi",
    });
    await req("POST", "/api/auth/forgot", { email: "reset-susp@example.com" });
    const tokenRow = db
      .prepare("SELECT token FROM password_reset_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(reg.data.user.id) as { token: string };
    const before = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(reg.data.user.id) as { password_hash: string };

    // Suspend AFTER the token was issued — the pre-existing-token hole.
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(reg.data.user.id);

    const r = await req("POST", "/api/auth/reset", {
      token: plaintextForStoredToken(tokenRow.token),
      password: "attacker-chosen-pw",
    });
    // Same opaque error as an invalid token — no suspension oracle.
    expect(r.status).toBe(400);
    // Password unchanged and token not consumed.
    const after = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(reg.data.user.id) as { password_hash: string };
    expect(after.password_hash).toBe(before.password_hash);
    const consumed = db
      .prepare("SELECT consumed_at FROM password_reset_tokens WHERE token = ?")
      .get(tokenRow.token) as { consumed_at: number | null };
    expect(consumed.consumed_at).toBeNull();
  });
});

// ─── /api/auth/change-email-request ────────────────────────────────────────

describe("POST /api/auth/change-email-request", () => {
  test("unauthenticated returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/change-email-request", {
      new_email: "x@y.test",
      current_password: "supersafe123",
    });
    expect(r.status).toBe(401);
  });

  test("missing new_email returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-missing@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("invalid new_email format returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-bad@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "not-an-email", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("missing current_password returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-nopw@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "fresh@example.com" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("cannot reuse current email (400)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-same@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "CE-Same@Example.COM", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("cannot collide with another active user (409)", async () => {
    wipeAll();
    await registerAndVerify({
      email: "ce-other@example.com",
      password: "supersafe123",
      full_name: "Other",
    });
    const reg = await registerAndVerify({
      email: "ce-me@example.com",
      password: "supersafe123",
      full_name: "Móni",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "ce-other@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(409);
  });

  test("collision with a suspended account is allowed (does NOT 409)", async () => {
    wipeAll();
    const susp = await registerAndVerify({
      email: "ce-suspended@example.com",
      password: "supersafe123",
      full_name: "Suspended",
    });
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(susp.data.user.id);

    const reg = await registerAndVerify({
      email: "ce-me2@example.com",
      password: "supersafe123",
      full_name: "Móni",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "ce-suspended@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(200);
  });

  test("wrong current_password returns 401", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-wrongpw@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    const r = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "fresh@example.com", current_password: "this-is-wrong" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(401);
  });

  test("new request supersedes prior pending token (old is deleted)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-super@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "first@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "second@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    const rows = db
      .prepare(
        "SELECT new_email FROM email_change_tokens WHERE user_id = ? AND consumed_at IS NULL",
      )
      .all(reg.data.user.id) as { new_email: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.new_email).toBe("second@example.com");
  });

  test("6th request from same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.6.60";
    const reg = await registerAndVerify({
      email: "ce-rl@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    for (let i = 0; i < 5; i++) {
      const r = await req(
        "POST",
        "/api/auth/change-email-request",
        { new_email: `new${i}@example.com`, current_password: "supersafe123" },
        { token: reg.data.token, clientIp: ip },
      );
      expect(r.status).toBe(200);
    }
    const sixth = await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "new6@example.com", current_password: "supersafe123" },
      { token: reg.data.token, clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/change-email/:token (confirm) ───────────────────────────────

describe("POST /api/auth/change-email/:token — confirm", () => {
  test("unknown token returns 400", async () => {
    wipeAll();
    const r = await req("POST", `/api/auth/change-email/${"a".repeat(64)}`, {});
    expect(r.status).toBe(400);
  });

  test("token shorter than 16 chars returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/change-email/short", {});
    expect(r.status).toBe(400);
  });

  test("expired token (>1h) returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-exp@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "fresh-exp@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    db.prepare(
      "UPDATE email_change_tokens SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    ).run("ce-exp@example.com");
    const tokenRow = db
      .prepare(
        "SELECT token FROM email_change_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("ce-exp@example.com") as { token: string };
    const r = await req(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    expect(r.status).toBe(400);
  });

  test("already-consumed token returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-twice@example.com",
      password: "supersafe123",
      full_name: "CE",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "fresh-twice@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    const tokenRow = db
      .prepare(
        "SELECT token FROM email_change_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("ce-twice@example.com") as { token: string };
    const first = await req(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    expect(first.status).toBe(200);
    const second = await req(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    expect(second.status).toBe(400);
  });

  test("a token issued before suspension can't change a suspended account's email", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-susp@example.com",
      password: "supersafe123",
      full_name: "CES",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "ce-susp-new@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    const tokenRow = db
      .prepare("SELECT token FROM email_change_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(reg.data.user.id) as { token: string };

    // Suspend AFTER the token was issued.
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(reg.data.user.id);

    const r = await req(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    // Same opaque error as an invalid token — no suspension oracle.
    expect(r.status).toBe(400);
    // Email is unchanged and the token wasn't consumed.
    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(reg.data.user.id) as {
      email: string;
    };
    expect(user.email).toBe("ce-susp@example.com");
    const consumed = db
      .prepare("SELECT consumed_at FROM email_change_tokens WHERE token = ?")
      .get(tokenRow.token) as { consumed_at: number | null };
    expect(consumed.consumed_at).toBeNull();
  });

  test("clash during the request→confirm window returns 409", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-race@example.com",
      password: "supersafe123",
      full_name: "Race",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "race-target@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    // Someone else snatches the target email before confirm.
    await registerAndVerify({
      email: "race-target@example.com",
      password: "supersafe123",
      full_name: "Snatched",
    });
    const tokenRow = db
      .prepare(
        "SELECT token FROM email_change_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("ce-race@example.com") as { token: string };
    const r = await req(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    expect(r.status).toBe(409);
  });

  test("confirm flips users.email + verified_email = 1", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ce-flip@example.com",
      password: "supersafe123",
      full_name: "Flip",
    });
    await req(
      "POST",
      "/api/auth/change-email-request",
      { new_email: "flipped@example.com", current_password: "supersafe123" },
      { token: reg.data.token },
    );
    const tokenRow = db
      .prepare("SELECT token FROM email_change_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(reg.data.user.id) as { token: string };
    const r = await req<{ ok: true; email: string }>(
      "POST",
      `/api/auth/change-email/${plaintextForStoredToken(tokenRow.token)}`,
      {},
    );
    expect(r.status).toBe(200);
    expect(r.data.email).toBe("flipped@example.com");
    const row = db
      .prepare("SELECT email, verified_email FROM users WHERE id = ?")
      .get(reg.data.user.id) as { email: string; verified_email: number };
    expect(row.email).toBe("flipped@example.com");
    expect(row.verified_email).toBe(1);
  });
});

// ─── /api/account/email-preferences ────────────────────────────────────────

describe("GET /api/account/email-preferences", () => {
  test("unauthenticated returns 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/account/email-preferences");
    expect(r.status).toBe(401);
  });

  test("returns lifecycle_opt_out + unsubscribe_token", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "prefs-get@example.com",
      password: "supersafe123",
      full_name: "Prefs",
    });
    const r = await req<{ lifecycle_opt_out: boolean; unsubscribe_token: string }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: reg.data.token },
    );
    expect(r.status).toBe(200);
    expect(r.data.lifecycle_opt_out).toBe(false);
    expect(r.data.unsubscribe_token.length).toBeGreaterThan(16);
  });

  test("preferences are stable across calls (token does not rotate)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "prefs-stable@example.com",
      password: "supersafe123",
      full_name: "Stable",
    });
    const first = await req<{ unsubscribe_token: string }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: reg.data.token },
    );
    const second = await req<{ unsubscribe_token: string }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: reg.data.token },
    );
    expect(second.data.unsubscribe_token).toBe(first.data.unsubscribe_token);
  });
});

describe("POST /api/account/email-preferences", () => {
  test("unauthenticated returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/account/email-preferences", { lifecycle_opt_out: true });
    expect(r.status).toBe(401);
  });

  test("missing lifecycle_opt_out returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "prefs-missing@example.com",
      password: "supersafe123",
      full_name: "Prefs",
    });
    const r = await req("POST", "/api/account/email-preferences", {}, { token: reg.data.token });
    expect(r.status).toBe(400);
  });

  test("non-boolean lifecycle_opt_out returns 400", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "prefs-bad@example.com",
      password: "supersafe123",
      full_name: "Prefs",
    });
    const r = await req(
      "POST",
      "/api/account/email-preferences",
      { lifecycle_opt_out: "yes" },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
  });

  test("opt-in → opt-out round-trip persists", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "prefs-rt@example.com",
      password: "supersafe123",
      full_name: "Prefs",
    });
    const off = await req<{ lifecycle_opt_out: boolean }>(
      "POST",
      "/api/account/email-preferences",
      { lifecycle_opt_out: true },
      { token: reg.data.token },
    );
    expect(off.data.lifecycle_opt_out).toBe(true);
    const back = await req<{ lifecycle_opt_out: boolean }>(
      "POST",
      "/api/account/email-preferences",
      { lifecycle_opt_out: false },
      { token: reg.data.token },
    );
    expect(back.data.lifecycle_opt_out).toBe(false);

    const re = await req<{ lifecycle_opt_out: boolean }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: reg.data.token },
    );
    expect(re.data.lifecycle_opt_out).toBe(false);
  });
});

// ─── /api/unsubscribe/:token ────────────────────────────────────────────────

/** The unsubscribe token a user's email footer would carry.
 *
 *  The preferences row is created lazily on first send (domain/emails/
 *  preferences.ts), and the welcome mail no longer creates it: at register there
 *  is no users row to hang it off. So mint it the way the app does — through the
 *  endpoint, which get-or-creates exactly as the first real lifecycle send will. */
async function unsubscribeTokenFor(sessionToken: string): Promise<string> {
  const r = await req<{ unsubscribe_token: string }>(
    "GET",
    "/api/account/email-preferences",
    undefined,
    { token: sessionToken },
  );
  expect(r.status).toBe(200);
  return r.data.unsubscribe_token;
}

describe("GET /api/unsubscribe/:token", () => {
  test("valid token returns 200 HTML + flips flag", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "unsub-ok@example.com",
      password: "supersafe123",
      full_name: "Unsub",
    });
    const unsubToken = await unsubscribeTokenFor(reg.data.token);

    const res = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/unsubscribe/${unsubToken}`,
      { headers: { "x-test-client-ip": "10.99.0.10" } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);

    const after = db
      .prepare("SELECT lifecycle_opt_out FROM email_preferences WHERE user_id = ?")
      .get(reg.data.user.id) as { lifecycle_opt_out: number };
    expect(after.lifecycle_opt_out).toBe(1);
  });

  test("unknown token returns 404 HTML (not 4xx JSON)", async () => {
    wipeAll();
    const res = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/unsubscribe/${"x".repeat(48)}`,
      { headers: { "x-test-client-ip": "10.99.0.11" } },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);
  });

  test("re-using the same token still 200s (idempotent)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "unsub-idem@example.com",
      password: "supersafe123",
      full_name: "Idem",
    });
    const unsubToken = await unsubscribeTokenFor(reg.data.token);

    const first = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/unsubscribe/${unsubToken}`,
      { headers: { "x-test-client-ip": "10.99.0.12" } },
    );
    expect(first.status).toBe(200);
    const second = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/unsubscribe/${unsubToken}`,
      { headers: { "x-test-client-ip": "10.99.0.13" } },
    );
    expect(second.status).toBe(200);
  });
});

describe("POST /api/unsubscribe/:token — RFC 8058", () => {
  test("valid token returns 204 + flips flag", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "unsub-rfc@example.com",
      password: "supersafe123",
      full_name: "Rita Fodor",
    });
    const unsubToken = await unsubscribeTokenFor(reg.data.token);
    const r = await req("POST", `/api/unsubscribe/${unsubToken}`, {});
    expect(r.status).toBe(204);
    const after = db
      .prepare("SELECT lifecycle_opt_out FROM email_preferences WHERE user_id = ?")
      .get(reg.data.user.id) as { lifecycle_opt_out: number };
    expect(after.lifecycle_opt_out).toBe(1);
  });

  test("invalid token still returns 204 (spec compliance — don't feed the bot a 4xx)", async () => {
    wipeAll();
    const r = await req("POST", `/api/unsubscribe/${"y".repeat(48)}`, {});
    expect(r.status).toBe(204);
  });
});

// ─── /unsubscribe/:token (pretty alias used by email footer links) ─────────

describe("GET /unsubscribe/:token — non-API alias", () => {
  test("valid token returns 200 HTML + flips flag (matches before SPA fallback)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "unsub-alias@example.com",
      password: "supersafe123",
      full_name: "Alias",
    });
    const unsubToken = await unsubscribeTokenFor(reg.data.token);

    const res = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/unsubscribe/${unsubToken}`,
      { headers: { "x-test-client-ip": "10.99.0.14" } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);

    const after = db
      .prepare("SELECT lifecycle_opt_out FROM email_preferences WHERE user_id = ?")
      .get(reg.data.user.id) as { lifecycle_opt_out: number };
    expect(after.lifecycle_opt_out).toBe(1);
  });

  test("one-click POST on the alias returns 204", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "unsub-alias-post@example.com",
      password: "supersafe123",
      full_name: "AliasPost",
    });
    const unsubToken = await unsubscribeTokenFor(reg.data.token);
    const r = await req("POST", `/unsubscribe/${unsubToken}`, {});
    expect(r.status).toBe(204);
  });
});

// ─── /api/auth/google ──────────────────────────────────────────────────────

describe("POST /api/auth/google", () => {
  const importMint = () => import("../../src/lib/google_oauth");

  test("missing credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/google", {});
    expect(r.status).toBe(400);
  });

  test("empty credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/google", { credential: "" });
    expect(r.status).toBe(400);
  });

  test("non-string credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/google", { credential: 42 });
    expect(r.status).toBe(400);
  });

  test("malformed JWT (not three segments) returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/google", {
      credential: "abc.def",
    });
    expect(r.status).toBe(401);
  });

  test("garbage credential returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/google", {
      credential: "totally-not-a-jwt-or-bypass",
    });
    expect(r.status).toBe(401);
  });

  test("test bypass with wrong HMAC returns 401", async () => {
    wipeAll();
    const tampered = "test:sub-x:tamper%40example.com:Name:1:" + "0".repeat(64);
    const r = await req("POST", "/api/auth/google", { credential: tampered });
    expect(r.status).toBe(401);
  });

  test("valid bypass + new email creates verified user", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-new-001",
      email: "g-new@example.com",
      name: "G New",
    });
    const r = await req<{ token: string; user: { email: string; verified_email: boolean } }>(
      "POST",
      "/api/auth/google",
      { credential, privacy_version: PRIVACY_VERSION },
    );
    expect(r.status).toBe(201);
    expect(r.data.user.email).toBe("g-new@example.com");
    expect(r.data.user.verified_email).toBe(true);
  });

  test("brand-new Google sign-in WITHOUT privacy_version returns 400", async () => {
    wipeAll();
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-noprivacy",
      email: "g-noprivacy@example.com",
      name: "NP",
    });
    const r = await req("POST", "/api/auth/google", {
      credential,
      privacy_version: "1999-01-01",
    });
    expect(r.status).toBe(400);
  });

  test("links to an existing verified email-only account (no duplicate)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "g-link@example.com",
      password: "supersafe123",
      full_name: "Link",
    });
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-link-001",
      email: "g-link@example.com",
      name: "Link",
    });
    // Link path doesn't need privacy_version (existing user) — leave it off.
    const r = await req<{ user: { id: number } }>("POST", "/api/auth/google", { credential });
    expect(r.status).toBe(200);
    expect(r.data.user.id).toBe(reg.data.user.id);
    const row = db
      .prepare("SELECT google_sub FROM users WHERE email = ?")
      .get("g-link@example.com") as { google_sub: string | null };
    expect(row.google_sub).toBe("g-link-001");
  });

  test("refuses to link onto an unverified password account (409)", async () => {
    wipeAll();
    await createUnverifiedUser("g-unverified@example.com");
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-unv-001",
      email: "g-unverified@example.com",
      name: "U",
    });
    const r = await req("POST", "/api/auth/google", { credential });
    expect(r.status).toBe(409);
  });

  test("rejects an unverified Google email claim (400)", async () => {
    wipeAll();
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-unverif-claim",
      email: "g-unverif@example.com",
      name: "U",
      emailVerified: false,
    });
    const r = await req("POST", "/api/auth/google", { credential });
    expect(r.status).toBe(400);
  });

  test("rejects suspended Google-linked account (403)", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-susp-001",
      email: "g-susp@example.com",
      name: "S",
    });
    // First sign-in creates the user — needs the privacy version.
    const first = await req("POST", "/api/auth/google", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(first.status).toBe(201);
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run("g-susp@example.com");
    const second = await req("POST", "/api/auth/google", { credential });
    expect(second.status).toBe(403);
  });

  test("rejects suspended email-only account (403, even if Google claim matches)", async () => {
    wipeAll();
    await registerAndVerify({
      email: "g-susp-email@example.com",
      password: "supersafe123",
      full_name: "Susp",
    });
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(
      "g-susp-email@example.com",
    );
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-susp-email-001",
      email: "g-susp-email@example.com",
      name: "S",
    });
    const r = await req("POST", "/api/auth/google", { credential });
    expect(r.status).toBe(403);
  });

  test("repeat Google sign-in for an existing google_sub is 200 (login), not 201", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "g-repeat-001",
      email: "g-repeat@example.com",
      name: "R",
    });
    const a = await req<{ user: { id: number } }>("POST", "/api/auth/google", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(a.status).toBe(201);
    const b = await req<{ user: { id: number } }>("POST", "/api/auth/google", { credential });
    expect(b.status).toBe(200);
    expect(b.data.user.id).toBe(a.data.user.id);
  });

  test("6th Google call from same IP returns 429", async () => {
    wipeAll();
    const ip = "10.42.7.70";
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintTestBearer } = await importMint();
    for (let i = 0; i < 5; i++) {
      const credential = mintTestBearer({
        sub: `g-rl-${i}`,
        email: `g-rl-${i}@example.com`,
        name: "RL",
      });
      const r = await req(
        "POST",
        "/api/auth/google",
        { credential, privacy_version: PRIVACY_VERSION },
        { clientIp: ip },
      );
      expect(r.status).toBe(201);
    }
    const credential = mintTestBearer({
      sub: "g-rl-6",
      email: "g-rl-6@example.com",
      name: "RL",
    });
    const sixth = await req(
      "POST",
      "/api/auth/google",
      { credential, privacy_version: PRIVACY_VERSION },
      { clientIp: ip },
    );
    expect(sixth.status).toBe(429);
  });
});

// ─── /api/auth/apple ───────────────────────────────────────────────────────

describe("POST /api/auth/apple", () => {
  const importMint = () => import("../../src/lib/apple_oauth");

  test("missing credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/apple", {});
    expect(r.status).toBe(400);
  });

  test("empty credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/apple", { credential: "" });
    expect(r.status).toBe(400);
  });

  test("non-string credential returns 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/apple", { credential: 42 });
    expect(r.status).toBe(400);
  });

  test("malformed JWT (not three segments) returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/apple", { credential: "abc.def" });
    expect(r.status).toBe(401);
  });

  test("garbage credential returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/apple", {
      credential: "totally-not-a-jwt-or-bypass",
    });
    expect(r.status).toBe(401);
  });

  test("test bypass with wrong HMAC returns 401", async () => {
    wipeAll();
    const tampered = "apple-test:sub-x:tamper%40example.com:1:" + "0".repeat(64);
    const r = await req("POST", "/api/auth/apple", { credential: tampered });
    expect(r.status).toBe(401);
  });

  test("valid bypass + new email creates verified user with forwarded name", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-new-001",
      email: "a-new@example.com",
    });
    const r = await req<{
      token: string;
      user: { email: string; full_name: string; verified_email: boolean };
    }>("POST", "/api/auth/apple", {
      credential,
      full_name: "A New",
      privacy_version: PRIVACY_VERSION,
    });
    expect(r.status).toBe(201);
    expect(r.data.user.email).toBe("a-new@example.com");
    expect(r.data.user.full_name).toBe("A New");
    expect(r.data.user.verified_email).toBe(true);
  });

  test("new account without a forwarded name falls back to the email", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-noname-001",
      email: "a-noname@example.com",
    });
    const r = await req<{ user: { full_name: string } }>("POST", "/api/auth/apple", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(r.status).toBe(201);
    expect(r.data.user.full_name).toBe("a-noname@example.com");
  });

  test("brand-new Apple sign-in WITHOUT privacy_version returns 400", async () => {
    wipeAll();
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-noprivacy",
      email: "a-noprivacy@example.com",
    });
    const r = await req("POST", "/api/auth/apple", {
      credential,
      privacy_version: "1999-01-01",
    });
    expect(r.status).toBe(400);
  });

  test("links to an existing verified email-only account (no duplicate)", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "a-link@example.com",
      password: "supersafe123",
      full_name: "Link",
    });
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-link-001",
      email: "a-link@example.com",
    });
    // Link path doesn't need privacy_version (existing user) — leave it off.
    const r = await req<{ user: { id: number } }>("POST", "/api/auth/apple", { credential });
    expect(r.status).toBe(200);
    expect(r.data.user.id).toBe(reg.data.user.id);
    const row = db
      .prepare("SELECT apple_sub FROM users WHERE email = ?")
      .get("a-link@example.com") as { apple_sub: string | null };
    expect(row.apple_sub).toBe("a-link-001");
  });

  test("refuses to link onto an unverified password account (409)", async () => {
    wipeAll();
    await createUnverifiedUser("a-unverified@example.com");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-unv-001",
      email: "a-unverified@example.com",
    });
    const r = await req("POST", "/api/auth/apple", { credential });
    expect(r.status).toBe(409);
  });

  test("rejects an unverified Apple email claim (400)", async () => {
    wipeAll();
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-unverif-claim",
      email: "a-unverif@example.com",
      emailVerified: false,
    });
    const r = await req("POST", "/api/auth/apple", { credential });
    expect(r.status).toBe(400);
  });

  test("rejects suspended Apple-linked account (403)", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-susp-001",
      email: "a-susp@example.com",
    });
    const first = await req("POST", "/api/auth/apple", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(first.status).toBe(201);
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run("a-susp@example.com");
    const second = await req("POST", "/api/auth/apple", { credential });
    expect(second.status).toBe(403);
  });

  test("repeat Apple sign-in for an existing apple_sub is 200 (login), not 201", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-repeat-001",
      email: "a-repeat@example.com",
    });
    const a = await req<{ user: { id: number } }>("POST", "/api/auth/apple", {
      credential,
      privacy_version: PRIVACY_VERSION,
    });
    expect(a.status).toBe(201);
    const b = await req<{ user: { id: number } }>("POST", "/api/auth/apple", { credential });
    expect(b.status).toBe(200);
    expect(b.data.user.id).toBe(a.data.user.id);
  });

  test("a brand-new Apple account exposes has_apple = true", async () => {
    wipeAll();
    const { PRIVACY_VERSION } = await import("@shared/legal");
    const { mintAppleTestBearer } = await importMint();
    const credential = mintAppleTestBearer({
      sub: "a-flag-001",
      email: "a-flag@example.com",
    });
    const r = await req<{ user: { has_apple: boolean; password_set: boolean } }>(
      "POST",
      "/api/auth/apple",
      { credential, privacy_version: PRIVACY_VERSION },
    );
    expect(r.status).toBe(201);
    expect(r.data.user.has_apple).toBe(true);
    // Apple-only signup gets a synthetic placeholder hash — no real password.
    expect(r.data.user.password_set).toBe(false);
  });
});

// ─── Cross-couple isolation on email prefs ──────────────────────────────────

describe("cross-account isolation: email prefs", () => {
  test("user A's opt-out does not flip user B's flag", async () => {
    wipeAll();
    const a = await bootstrapCouple("iso-a@weddly.test");
    const b = await bootstrapCouple("iso-b@weddly.test");

    const flip = await req<{ lifecycle_opt_out: boolean }>(
      "POST",
      "/api/account/email-preferences",
      { lifecycle_opt_out: true },
      { token: a.token },
    );
    expect(flip.data.lifecycle_opt_out).toBe(true);

    const bPrefs = await req<{ lifecycle_opt_out: boolean }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: b.token },
    );
    expect(bPrefs.data.lifecycle_opt_out).toBe(false);
  });

  test("user A's unsubscribe token only flips user A's flag", async () => {
    wipeAll();
    const a = await bootstrapCouple("iso-a2@weddly.test");
    const b = await bootstrapCouple("iso-b2@weddly.test");

    const aPrefs = await req<{ unsubscribe_token: string }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: a.token },
    );
    const r = await req("POST", `/api/unsubscribe/${aPrefs.data.unsubscribe_token}`, {});
    expect(r.status).toBe(204);

    const bAfter = await req<{ lifecycle_opt_out: boolean }>(
      "GET",
      "/api/account/email-preferences",
      undefined,
      { token: b.token },
    );
    expect(bAfter.data.lifecycle_opt_out).toBe(false);
  });
});

// ─── Sliding session refresh ────────────────────────────────────────────────

describe("session sliding refresh", () => {
  test("session within first half of TTL is NOT extended on use", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "slide-fresh@example.com",
      password: "supersafe123",
      full_name: "Slide",
    });
    const id = reg.data.token.split(".")[0]!;
    const before = db.prepare("SELECT created_at, expires_at FROM sessions WHERE id = ?").get(id) as
      | { created_at: number; expires_at: number }
      | undefined;
    expect(before).toBeDefined();

    const me = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(me.status).toBe(200);

    const after = db.prepare("SELECT created_at, expires_at FROM sessions WHERE id = ?").get(id) as
      | { created_at: number; expires_at: number }
      | undefined;
    expect(after?.created_at).toBe(before!.created_at);
    expect(after?.expires_at).toBe(before!.expires_at);
  });

  test("session past half-life IS extended on next verified request", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "slide-old@example.com",
      password: "supersafe123",
      full_name: "Slide",
    });
    const id = reg.data.token.split(".")[0]!;

    // Backdate the session so it's well past half-life: created 20 days ago,
    // expires in 10 days. TTL is 30d, so created+TTL/2 was 5 days ago.
    const TWENTY_DAYS = 20 * 24 * 60 * 60 * 1000;
    const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;
    const tNow = Date.now();
    const backdatedCreated = tNow - TWENTY_DAYS;
    const stillValidExpires = tNow + TEN_DAYS;
    db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?").run(
      backdatedCreated,
      stillValidExpires,
      id,
    );

    const me = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(me.status).toBe(200);

    const after = db.prepare("SELECT created_at, expires_at FROM sessions WHERE id = ?").get(id) as
      | { created_at: number; expires_at: number }
      | undefined;
    expect(after).toBeDefined();
    // created_at bumped to ~now (within a few seconds), expires_at ~ now + 30d.
    expect(after!.created_at).toBeGreaterThan(backdatedCreated);
    expect(after!.expires_at).toBeGreaterThan(stillValidExpires);
    // Slack: at least 29 days from now to absorb test runtime.
    const TWENTY_NINE_DAYS = 29 * 24 * 60 * 60 * 1000;
    expect(after!.expires_at).toBeGreaterThan(Date.now() + TWENTY_NINE_DAYS);
  });

  test("expired session is NOT resurrected by sliding refresh", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "slide-dead@example.com",
      password: "supersafe123",
      full_name: "Slide",
    });
    const id = reg.data.token.split(".")[0]!;
    db.prepare("UPDATE sessions SET expires_at = 1 WHERE id = ?").run(id);

    const me = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(me.status).toBe(401);

    const row = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
    expect(row).toBeNull();
  });
});

// ─── per-account failed-login throttle ──────────────────────────────────────
// `req` spoofs a fresh random IP per call, so the per-IP AUTH_BUCKET never trips
// here — these tests exercise the per-account ceiling specifically (distributed
// credential-stuffing: many IPs, one target account).
describe("POST /api/auth/login — per-account throttle", () => {
  test("locks an account after repeated failures, then 429 regardless of IP", async () => {
    wipeAll();
    const email = "stuffing-target@example.com";
    await registerAndVerify({
      email,
      password: "supersafe123",
      full_name: "Target",
    });

    // 10 wrong-password attempts are allowed (each a 401), each from a new IP.
    for (let i = 0; i < 10; i++) {
      const r = await req("POST", "/api/auth/login", { email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    // The 11th trips the per-account ceiling — even with the correct password.
    const blocked = await req("POST", "/api/auth/login", { email, password: "supersafe123" });
    expect(blocked.status).toBe(429);
  });

  test("a successful login clears the failure counter", async () => {
    wipeAll();
    const email = "stuffing-reset@example.com";
    await req("POST", "/api/auth/register", {
      email,
      password: "supersafe123",
      full_name: "Reset",
    });
    await verifyUserEmail(email);

    // A few failures, then a success resets the counter.
    for (let i = 0; i < 5; i++) {
      const r = await req("POST", "/api/auth/login", { email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    const ok = await req("POST", "/api/auth/login", { email, password: "supersafe123" });
    expect(ok.status).toBe(200);

    // Counter was cleared — another batch of failures is allowed (not 429).
    for (let i = 0; i < 5; i++) {
      const r = await req("POST", "/api/auth/login", { email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
  });

  test("the per-account ceiling does not leak account existence (missing email too)", async () => {
    wipeAll();
    const email = "no-such-account@example.com";
    for (let i = 0; i < 10; i++) {
      const r = await req("POST", "/api/auth/login", { email, password: "whatever-123" });
      expect(r.status).toBe(401);
    }
    const blocked = await req("POST", "/api/auth/login", { email, password: "whatever-123" });
    expect(blocked.status).toBe(429);
  });
});

// ─── single-use credential tokens are hashed at rest ────────────────────────
describe("credential tokens — hashed at rest", () => {
  test("verification token is stored as a SHA-256 hash, link still works", async () => {
    wipeAll();
    const email = "hash-at-rest@example.com";
    const reg = await req("POST", "/api/auth/register", {
      email,
      password: "supersafe123",
      full_name: "Hashed",
    });
    expect(reg.status).toBe(202);
    // A password signup's link redeems a pending_signups row, so that's where
    // the hash-at-rest contract has to hold now.
    const stored = db.prepare("SELECT token FROM pending_signups WHERE email = ?").get(email) as {
      token: string;
    };
    const plaintext = plaintextForStoredToken(stored.token);
    // The DB holds the hash, never the value that was in the emailed link.
    expect(stored.token).not.toBe(plaintext);
    expect(stored.token).toMatch(/^[0-9a-f]{64}$/);
    // The endpoint still accepts the plaintext (it hashes on lookup) — and the
    // click is what mints the account, hence 201.
    const r = await req("POST", `/api/auth/verify/${plaintext}`, {});
    expect(r.status).toBe(201);
  });
});

// ─── /api/auth/locale — persist the UI-language pick ────────────────────────
describe("POST /api/auth/locale", () => {
  test("requires auth", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/locale", { locale: "hu" });
    expect(r.status).toBe(401);
  });

  test("rejects anything that is not a shipped UI locale", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("locale-bad@example.com");
    // "de" used to be in this list. It is a shipped locale now, so the guard
    // is UI_LOCALES rather than a hand-written hu/en pair — which is the whole
    // point: the write path and the switcher can no longer disagree about what
    // a valid language is.
    for (const locale of ["fr", "en-GB", "hu-HU", "", 42, null, undefined]) {
      const r = await req("POST", "/api/auth/locale", { locale }, { token });
      expect(r.status).toBe(400);
    }
  });

  test("accepts every shipped UI locale, not just hu/en", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("locale-all@example.com");
    // Spanish shipped as a UI locale in July 2026 but this endpoint still
    // refused it, so a vendor who picked Español had the choice saved only to
    // localStorage and came up English on their next device.
    for (const locale of UI_LOCALES) {
      const r = await req<{ user: { locale: string } }>(
        "POST",
        "/api/auth/locale",
        { locale },
        { token },
      );
      expect(r.status).toBe(200);
      expect(r.data.user.locale).toBe(locale);
      const me = await req<{ user: { locale: string } }>("GET", "/api/auth/me", undefined, {
        token,
      });
      expect(me.data.user.locale).toBe(locale);
    }
  });

  test("PATCH /api/users/me persists the same set, and null clears it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("locale-patch@example.com");
    for (const locale of UI_LOCALES) {
      const r = await req<{ user: { locale: string | null } }>(
        "PATCH",
        "/api/users/me",
        { locale },
        { token },
      );
      expect(r.status).toBe(200);
      expect(r.data.user.locale).toBe(locale);
    }
    const cleared = await req<{ user: { locale: string | null } }>(
      "PATCH",
      "/api/users/me",
      { locale: null },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.user.locale).toBeNull();
    const bad = await req("PATCH", "/api/users/me", { locale: "fr" }, { token });
    expect(bad.status).toBe(400);
  });

  test("persists the pick and /api/auth/me keeps serving it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("locale-hu@example.com");
    const set = await req<{ user: { locale: string } }>(
      "POST",
      "/api/auth/locale",
      { locale: "hu" },
      { token },
    );
    expect(set.status).toBe(200);
    expect(set.data.user.locale).toBe("hu");
    const me = await req<{ user: { locale: string } }>("GET", "/api/auth/me", undefined, {
      token,
    });
    expect(me.status).toBe(200);
    expect(me.data.user.locale).toBe("hu");
    // Flipping back works too — the endpoint is a plain setter, not one-way.
    const back = await req<{ user: { locale: string } }>(
      "POST",
      "/api/auth/locale",
      { locale: "en" },
      { token },
    );
    expect(back.status).toBe(200);
    expect(back.data.user.locale).toBe("en");
  });
});

/** The security mail must fire for a genuinely unfamiliar machine and stay
 *  silent for the user's own one. The fingerprint deliberately ignores the
 *  client IP: keying on it meant a dynamic-IP re-lease, a Wi-Fi/mobile switch
 *  or a VPN toggle mailed the user about the laptop they were already sitting
 *  at, which is the "this is spam" complaint that drove the rewrite. */
describe("new device sign-in", () => {
  const EMAIL = "device@weddly.test";
  const PASSWORD = "supersafe123";

  async function login(deviceId: string | null, clientIp: string) {
    return req(
      "POST",
      "/api/auth/login",
      { email: EMAIL, password: PASSWORD },
      { clientIp, headers: deviceId ? { "X-Weddly-Device": deviceId } : {} },
    );
  }

  function alertCount(): number {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind = 'new_device_signin'")
      .get() as { n: number };
    return row.n;
  }

  async function seedUser() {
    wipeAll();
    await registerAndVerify({ email: EMAIL, password: PASSWORD, full_name: "Device" });
  }

  test("same device keeps quiet however much the IP moves", async () => {
    await seedUser();

    // First sign-in registers the device silently, otherwise every new user
    // would be mailed about themselves.
    expect((await login("device-aaa", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(0);

    // Same browser, completely different networks: a different /16, then a
    // different address family entirely. Every one of these used to alert.
    expect((await login("device-aaa", "203.0.113.5")).status).toBe(200);
    expect((await login("device-aaa", "2001:db8::1")).status).toBe(200);
    expect((await login("device-aaa", "10.44.7.2")).status).toBe(200);
    expect(alertCount()).toBe(0);
  });

  test("an unfamiliar device alerts exactly once, then the cooldown holds", async () => {
    await seedUser();
    expect((await login("device-aaa", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(0);

    // Different machine on the SAME network. The old IP-only fingerprint
    // treated this as known and never alerted. It must alert.
    expect((await login("device-bbb", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(1);
    const alert = db
      .prepare(
        "SELECT to_email FROM email_log WHERE kind = 'new_device_signin' ORDER BY id DESC LIMIT 1",
      )
      .get() as { to_email: string } | undefined;
    expect(alert?.to_email).toBe(EMAIL);

    // A third unknown device inside the cooldown window is suppressed, so a
    // client that cannot persist its id can't mint one mail per sign-in.
    expect((await login("device-ccc", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(1);

    // Re-signing in on the already-known first device stays silent regardless.
    expect((await login("device-aaa", "198.51.100.7")).status).toBe(200);
    expect(alertCount()).toBe(1);

    // Once the window has passed, a genuinely new device alerts again.
    db.prepare("UPDATE users SET new_device_alert_at = ? WHERE email = ?").run(
      now() - 25 * 60 * 60 * 1000,
      EMAIL,
    );
    expect((await login("device-ddd", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(2);
  });

  test("devices recorded under the old fingerprint format migrate silently", async () => {
    await seedUser();
    // Shape written by the previous IP-based implementation: no `v` field. It
    // can never match the new hash, so without the version check every single
    // existing user would be mailed once purely because we changed the formula.
    db.prepare("UPDATE users SET known_devices_json = ? WHERE email = ?").run(
      JSON.stringify([
        { fp: "0123456789abcdef", last_seen_at: now() - 1000 },
        { fp: "fedcba9876543210", last_seen_at: now() - 2000 },
      ]),
      EMAIL,
    );

    expect((await login("device-aaa", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(0);

    // ...and the list is now re-seeded in the current format, so the NEXT
    // unfamiliar device is detected normally.
    expect((await login("device-bbb", "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(1);
  });

  test("a client that sends no device id falls back to the user agent", async () => {
    await seedUser();

    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const firefox =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";

    const uaLogin = (ua: string, clientIp: string) =>
      req(
        "POST",
        "/api/auth/login",
        { email: EMAIL, password: PASSWORD },
        { clientIp, headers: { "User-Agent": ua } },
      );

    expect((await uaLogin(chrome, "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(0);

    // Same browser family, roaming networks: still the same machine.
    expect((await uaLogin(chrome, "203.0.113.5")).status).toBe(200);
    expect(alertCount()).toBe(0);

    // A different browser is a different device under the fallback. Every
    // mainstream UA used to collapse to the literal token "Mozilla", so this
    // distinction did not exist at all before.
    expect((await uaLogin(firefox, "192.168.1.10")).status).toBe(200);
    expect(alertCount()).toBe(1);
  });

  /** The regression behind the "why does it keep mailing me, it is the same
   *  laptop" report. A browser known by its UA hash starts sending a device id
   *  the moment it loads the build that mints one. Nothing about the machine
   *  changed, so the handover must not alert. */
  test("a browser that starts sending a device id is not a new device", async () => {
    await seedUser();

    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const login2 = (deviceId: string | null, ua: string) =>
      req(
        "POST",
        "/api/auth/login",
        { email: EMAIL, password: PASSWORD },
        {
          clientIp: "192.168.1.10",
          headers: deviceId
            ? { "User-Agent": ua, "X-Weddly-Device": deviceId }
            : { "User-Agent": ua },
        },
      );

    // Yesterday's build: no device id, so the browser is filed under its UA.
    expect((await login2(null, chrome)).status).toBe(200);
    expect(alertCount()).toBe(0);

    // Today's build in the SAME browser: the id appears for the first time.
    expect((await login2("device-aaa", chrome)).status).toBe(200);
    expect(alertCount()).toBe(0);

    // The handover consumed the UA entry rather than adding a second one, so
    // the stored list still describes exactly one machine.
    const stored = db
      .prepare("SELECT known_devices_json AS j FROM users WHERE email = ?")
      .get(EMAIL) as { j: string };
    expect(JSON.parse(stored.j)).toHaveLength(1);

    // The id is now the identity, so further sign-ins stay quiet...
    expect((await login2("device-aaa", chrome)).status).toBe(200);
    expect(alertCount()).toBe(0);

    // ...while a genuinely different machine still alerts. This is the half the
    // leniency must not swallow: same browser and OS family, different device
    // id, and the UA entry is gone so nothing suppresses it.
    expect((await login2("device-bbb", chrome)).status).toBe(200);
    expect(alertCount()).toBe(1);
  });
});
