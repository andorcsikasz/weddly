// Verified-visitor email confirmation: request → pending row + verify token,
// consume → verified + a per-device token, /me resolves the device token. No
// `users` row and no session are ever created. The request endpoint always
// answers a bare 200 so it can't probe who is already verified.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { VisitorSession } from "@shared/verified_visitors";
import { __testPlaintextForHash } from "../../src/auth/tokens";
import { db, VISITOR_SYSTEM_USER_EMAIL } from "../../src/db";
import { req } from "../helpers";

interface VisitorRow {
  id: number;
  email: string;
  full_name: string | null;
  locale: string;
  status: string;
  verify_token_hash: string | null;
  verified_at: number | null;
}

function visitor(email: string): VisitorRow | null {
  return (
    (db.prepare("SELECT * FROM verified_visitors WHERE email = ?").get(email) as
      | VisitorRow
      | undefined) ?? null
  );
}

/** Resolve the plaintext verify link token for an address (hashed at rest). */
function verifyTokenFor(email: string): string {
  const row = visitor(email);
  if (!row?.verify_token_hash) throw new Error(`no verify token for ${email}`);
  const plain = __testPlaintextForHash(row.verify_token_hash);
  if (!plain) throw new Error(`plaintext not captured for ${email}`);
  return plain;
}

function sessionCount(visitorId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM verified_visitor_sessions WHERE visitor_id = ?")
      .get(visitorId) as { n: number }
  ).n;
}

beforeEach(() => {
  db.prepare("DELETE FROM verified_visitors").run();
});

describe("verified visitor email confirmation", () => {
  test("request creates a pending row and returns a bare ok", async () => {
    const res = await req("POST", "/api/visitors/verify/request", {
      email: "vv1@example.com",
      full_name: "Anna Kovács",
      locale: "hu",
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });

    const row = visitor("vv1@example.com");
    expect(row?.status).toBe("pending");
    expect(row?.locale).toBe("hu");
    expect(row?.full_name).toBe("Anna Kovács");
    expect(row?.verify_token_hash).toBeTruthy();
    expect(row?.verified_at).toBeNull();
  });

  test("consume verifies the visitor and mints a device token; no user row", async () => {
    await req("POST", "/api/visitors/verify/request", { email: "vv2@example.com" });
    const token = verifyTokenFor("vv2@example.com");

    const res = await req<VisitorSession>("POST", `/api/visitors/verify/${token}`);
    expect(res.status).toBe(201);
    expect(res.data.visitor.email).toBe("vv2@example.com");
    expect(res.data.visitor.verified_at).toBeGreaterThan(0);
    expect(res.data.token).toBeTruthy();

    const row = visitor("vv2@example.com");
    expect(row?.status).toBe("verified");
    expect(row?.verify_token_hash).toBeNull(); // single-use: cleared
    expect(sessionCount(row?.id ?? -1)).toBe(1);

    // Verifying never creates a real account for the address.
    const asUser = db.prepare("SELECT id FROM users WHERE email = ?").get("vv2@example.com") as {
      id: number;
    } | null;
    expect(asUser).toBeNull();
  });

  test("device token resolves via /me; missing/invalid token is 401", async () => {
    await req("POST", "/api/visitors/verify/request", { email: "vv3@example.com" });
    const verify = verifyTokenFor("vv3@example.com");
    const consumed = await req<VisitorSession>("POST", `/api/visitors/verify/${verify}`);
    const deviceToken = consumed.data.token;

    const me = await req("GET", "/api/visitors/me", undefined, {
      headers: { "X-Visitor-Token": deviceToken },
    });
    expect(me.status).toBe(200);
    expect((me.data as { visitor: { email: string } }).visitor.email).toBe("vv3@example.com");

    const anon = await req("GET", "/api/visitors/me");
    expect(anon.status).toBe(401);

    const bad = await req("GET", "/api/visitors/me", undefined, {
      headers: { "X-Visitor-Token": "not-a-real-token" },
    });
    expect(bad.status).toBe(401);
  });

  test("re-request for a verified visitor lets a second device verify", async () => {
    await req("POST", "/api/visitors/verify/request", { email: "vv4@example.com" });
    const first = verifyTokenFor("vv4@example.com");
    await req("POST", `/api/visitors/verify/${first}`);
    const id = visitor("vv4@example.com")?.id ?? -1;
    expect(sessionCount(id)).toBe(1);

    // Same address, new device: a fresh link mints a second device session and
    // keeps the visitor verified (idempotent, verified_at unchanged).
    await req("POST", "/api/visitors/verify/request", { email: "vv4@example.com" });
    const second = verifyTokenFor("vv4@example.com");
    const res = await req<VisitorSession>("POST", `/api/visitors/verify/${second}`);
    expect(res.status).toBe(201);
    expect(sessionCount(id)).toBe(2);
    expect(visitor("vv4@example.com")?.status).toBe("verified");
  });

  test("unknown / superseded token is 404", async () => {
    const res = await req("POST", "/api/visitors/verify/deadbeefdeadbeef");
    expect(res.status).toBe(404);
  });

  test("the reserved visitor system user exists and is login-disabled", async () => {
    const sys = db
      .prepare("SELECT status, password_set FROM users WHERE email = ?")
      .get(VISITOR_SYSTEM_USER_EMAIL) as { status: string; password_set: number } | undefined;
    expect(sys?.status).toBe("suspended");
    expect(sys?.password_set).toBe(0);
  });
});
