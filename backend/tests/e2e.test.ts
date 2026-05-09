import "./setup";

import { describe, expect, test } from "bun:test";
import { db } from "../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface ReqOpts {
  token?: string;
  clientIp?: string;
}

interface ApiResult<T> {
  status: number;
  data: T;
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: ReqOpts = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Spoof a unique IP per call so rate-limit buckets don't bleed between tests.
    "x-test-client-ip":
      opts.clientIp ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data: data as T };
}

function wipeAll() {
  // Order matters — children before parents. Wrap so a missing table doesn't
  // crash the whole suite (we add tables over time).
  const tables = [
    "audit_log",
    "couple_pause_requests",
    "seat_assignments",
    "seating_conflicts",
    "seating_tables",
    "guests",
    "budget_snapshots",
    "budget_lines",
    "couple_invites",
    "sessions",
    "rate_limit_buckets",
    "users",
    "couples",
  ];
  for (const t of tables) {
    try {
      db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist yet
    }
  }
}

describe("auth", () => {
  test("register → me → logout (happy path)", async () => {
    wipeAll();

    const reg = await req<{ token: string; user: { id: number; email: string } }>(
      "POST",
      "/api/auth/register",
      { email: "anna@example.com", password: "supersafe123", full_name: "Anna" },
    );
    expect(reg.status).toBe(201);
    expect(reg.data.token).toContain(".");
    expect(reg.data.user.email).toBe("anna@example.com");

    const me = await req<{ user: { email: string } }>("GET", "/api/auth/me", undefined, {
      token: reg.data.token,
    });
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe("anna@example.com");

    const out = await req("POST", "/api/auth/logout", {}, { token: reg.data.token });
    expect(out.status).toBe(200);

    // Token is now invalid.
    const meAfter = await req("GET", "/api/auth/me", undefined, { token: reg.data.token });
    expect(meAfter.status).toBe(401);
  });

  test("register rejects short password", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "x@example.com",
      password: "short",
      full_name: "X",
    });
    expect(r.status).toBe(400);
  });

  test("register rejects duplicate email", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "dup@example.com",
      password: "supersafe123",
      full_name: "First",
    });
    const r = await req("POST", "/api/auth/register", {
      email: "dup@example.com",
      password: "supersafe123",
      full_name: "Second",
    });
    expect(r.status).toBe(409);
  });

  test("login rejects wrong password", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "login@example.com",
      password: "supersafe123",
      full_name: "L",
    });
    const r = await req("POST", "/api/auth/login", {
      email: "login@example.com",
      password: "wrongguess",
    });
    expect(r.status).toBe(401);
  });
});

describe("onboarding + invites", () => {
  test("onboard → get current → invite → accept (full partner-B flow)", async () => {
    wipeAll();

    // Partner A registers + onboards.
    const a = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "anna@weddly.test",
      password: "supersafe123",
      full_name: "Anna",
    });
    expect(a.status).toBe(201);

    const onboard = await req<{ couple: { id: number; display_name: string } }>(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Anna & Bence",
        wedding_date: "2026-09-12",
        target_guest_count: 80,
        budget_ceiling_huf: 5_000_000,
        style_tags: ["modern", "minimalist", "not-a-real-tag"],
      },
      { token: a.data.token },
    );
    expect(onboard.status).toBe(201);
    expect(onboard.data.couple.display_name).toBe("Anna & Bence");

    // Budget lines are seeded from DEFAULT_BUDGET_SPLIT.
    const lines = db
      .prepare("SELECT category, planned_huf FROM budget_lines WHERE couple_id = ?")
      .all(onboard.data.couple.id) as { category: string; planned_huf: number }[];
    expect(lines.length).toBeGreaterThan(0);
    const venueLine = lines.find((l) => l.category === "venue");
    expect(venueLine?.planned_huf).toBe(1_250_000); // 25% of 5M

    // Audit log has the onboarding event.
    const audit = db
      .prepare("SELECT action FROM audit_log WHERE couple_id = ? ORDER BY id")
      .all(onboard.data.couple.id) as { action: string }[];
    expect(audit.some((r) => r.action === "couple.onboard")).toBe(true);

    // Re-onboarding the same user is rejected.
    const dup = await req(
      "POST",
      "/api/couples/onboard",
      { display_name: "Trying again" },
      { token: a.data.token },
    );
    expect(dup.status).toBe(409);

    // Partner A invites partner B.
    const inv = await req<{ invite: { token: string; expires_at: number } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "bence@weddly.test" },
      { token: a.data.token },
    );
    expect(inv.status).toBe(201);
    expect(inv.data.invite.token.length).toBeGreaterThan(0);

    // Public lookup of the invite (no auth).
    const lookup = await req<{ couple_display_name: string }>(
      "GET",
      `/api/invites/${inv.data.invite.token}`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.data.couple_display_name).toBe("Anna & Bence");

    // Partner B registers + accepts.
    const b = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "bence@weddly.test",
      password: "supersafe123",
      full_name: "Bence",
    });
    expect(b.status).toBe(201);

    const accept = await req<{ couple: { partner_b_id: number } }>(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept`,
      {},
      { token: b.data.token },
    );
    expect(accept.status).toBe(200);
    expect(accept.data.couple.partner_b_id).toBeGreaterThan(0);

    // Both users now see the same couple via /current.
    const aCouple = await req<{ couple: { id: number } | null }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token: a.data.token },
    );
    const bCouple = await req<{ couple: { id: number } | null }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token: b.data.token },
    );
    expect(aCouple.data.couple?.id).toBe(bCouple.data.couple?.id);

    // Re-using the now-consumed invite token fails.
    const reuse = await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept`,
      {},
      { token: b.data.token },
    );
    expect(reuse.status).toBe(410);
  });

  test("invite endpoint requires onboarding first", async () => {
    wipeAll();
    const u = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "solo@weddly.test",
      password: "supersafe123",
      full_name: "Solo",
    });
    const r = await req("POST", "/api/couples/invites", {}, { token: u.data.token });
    expect(r.status).toBe(400);
  });

  test("get-current returns null couple before onboarding", async () => {
    wipeAll();
    const u = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "fresh@weddly.test",
      password: "supersafe123",
      full_name: "Fresh",
    });
    const r = await req<{ couple: unknown }>("GET", "/api/couples/current", undefined, {
      token: u.data.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.couple).toBeNull();
  });
});

describe("health", () => {
  test("returns ok:true with db:true", async () => {
    const r = await req<{ ok: boolean; db: boolean }>("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(r.data.db).toBe(true);
  });
});
