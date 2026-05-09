import "./setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../src/db";
import { runEmailSweep } from "../src/domain/emails/worker";
import { runPurgeSweep } from "../src/domain/purge";

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
    "password_reset_tokens",
    "email_verification_tokens",
    "email_log",
    "email_dispatches",
    "email_preferences",
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

// ─── helpers for the v1-feature suites below ─────────────────────────────────

async function bootstrapCouple(
  email = "couple@weddly.test",
): Promise<{ token: string; coupleId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Owner",
  });
  expect(reg.status).toBe(201);
  const ob = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Anna & Bence",
      wedding_date: "2026-09-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return { token: reg.data.token, coupleId: ob.data.couple.id };
}

describe("guests", () => {
  test("CRUD + invite code uniqueness", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();

    const c = await req<{ guest: { id: number; invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Eszter", group_tag: "her_family" },
      { token },
    );
    expect(c.status).toBe(201);
    expect(c.data.guest.invite_code.length).toBeGreaterThan(0);

    const list = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(list.data.guests.length).toBe(1);

    const u = await req<{ guest: { full_name: string } }>(
      "PATCH",
      `/api/guests/${c.data.guest.id}`,
      { full_name: "Eszter K.", rsvp_status: "yes", meal_choice: "vegetarian" },
      { token },
    );
    expect(u.data.guest.full_name).toBe("Eszter K.");

    const d = await req("DELETE", `/api/guests/${c.data.guest.id}`, undefined, { token });
    expect(d.status).toBe(200);
    const list2 = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    expect(list2.data.guests.length).toBe(0);
  });

  test("CSV import creates rows + reports errors", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv@weddly.test");
    const csv =
      "full_name,email,group_tag\nAnna,a@x.com,her_family\nBence,b@x.com,his_family\n,no_name@x.com,other\n";
    const r = await req<{ created_count: number; errors: { row: number }[] }>(
      "POST",
      "/api/guests/import",
      { csv },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.created_count).toBe(2);
    expect(r.data.errors.length).toBe(1);
  });

  test("guest endpoints require auth", async () => {
    wipeAll();
    const r = await req("GET", "/api/guests");
    expect(r.status).toBe(401);
  });
});

describe("budget", () => {
  test("seeded lines + add/update/snapshot", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("budget@weddly.test");

    const list = await req<{ lines: { id: number; category: string; planned_huf: number }[] }>(
      "GET",
      "/api/budget/lines",
      undefined,
      { token },
    );
    expect(list.data.lines.length).toBeGreaterThan(0);
    const venue = list.data.lines.find((l) => l.category === "venue");
    expect(venue?.planned_huf).toBe(1_250_000);

    const add = await req<{ line: { id: number } }>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "DJ extra", planned_huf: 100_000, actual_huf: 0 },
      { token },
    );
    expect(add.status).toBe(201);

    const upd = await req<{ line: { actual_huf: number } }>(
      "PATCH",
      `/api/budget/lines/${add.data.line.id}`,
      { category: "other", label: "DJ extra", planned_huf: 100_000, actual_huf: 95_000 },
      { token },
    );
    expect(upd.data.line.actual_huf).toBe(95_000);

    const snap = await req<{ snapshot: { id: number; payload_json: string } }>(
      "POST",
      "/api/budget/snapshots",
      { name: "120-fő variáció" },
      { token },
    );
    expect(snap.status).toBe(201);
    const arr = JSON.parse(snap.data.snapshot.payload_json) as { label: string }[];
    expect(arr.length).toBeGreaterThan(0);
  });
});

describe("rsvp", () => {
  test("public lookup + submit updates the guest", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rsvp@weddly.test");
    const created = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Public Guest" },
      { token },
    );
    const code = created.data.guest.invite_code;

    const get = await req<{ rsvp: { full_name: string; couple_display_name: string } }>(
      "GET",
      `/api/rsvp/${code}`,
    );
    expect(get.status).toBe(200);
    expect(get.data.rsvp.full_name).toBe("Public Guest");
    expect(get.data.rsvp.couple_display_name).toBe("Anna & Bence");

    const sub = await req<{ rsvp: { rsvp_status: string; meal_choice: string | null } }>(
      "POST",
      `/api/rsvp/${code}`,
      {
        rsvp_status: "yes",
        meal_choice: "vegetarian",
        plus_one_name: "Bence",
        plus_one_meal: "meat",
        accommodation_needed: true,
        song_request: "ABBA",
      },
    );
    expect(sub.status).toBe(200);
    expect(sub.data.rsvp.rsvp_status).toBe("yes");
    expect(sub.data.rsvp.meal_choice).toBe("vegetarian");

    // Couple-side list confirms the response landed.
    const list = await req<{ guests: { rsvp_status: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(list.data.guests[0]!.rsvp_status).toBe("yes");
  });

  test("unknown code returns 404", async () => {
    wipeAll();
    const r = await req("GET", "/api/rsvp/NOPECODE");
    expect(r.status).toBe(404);
  });
});

describe("seating", () => {
  test("table CRUD + seat assignment + conflict + couple isolation", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("seat@weddly.test");

    const g1 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", group_tag: "her_family" },
      { token },
    );
    const g2 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Bence", group_tag: "his_family" },
      { token },
    );

    const table = await req<{ table: { id: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "Asztal 1", shape: "round", seats: 8, x_mm: 50, y_mm: 50 },
      { token },
    );
    expect(table.status).toBe(201);

    const a1 = await req(
      "POST",
      "/api/seating/assign",
      { table_id: table.data.table.id, seat_index: 0, guest_id: g1.data.guest.id },
      { token },
    );
    expect(a1.status).toBe(200);

    // Re-assigning the same guest to a different seat moves them.
    const a2 = await req(
      "POST",
      "/api/seating/assign",
      { table_id: table.data.table.id, seat_index: 3, guest_id: g1.data.guest.id },
      { token },
    );
    expect(a2.status).toBe(200);

    const plan = await req<{ assignments: { seat_index: number }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(plan.data.assignments.length).toBe(1);
    expect(plan.data.assignments[0]!.seat_index).toBe(3);

    // Conflict between the two guests.
    const conf = await req<{ conflict: { id: number } }>(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: g1.data.guest.id, guest_b_id: g2.data.guest.id, kind: "split" },
      { token },
    );
    expect(conf.status).toBe(201);

    // Out-of-range seat rejected.
    const bad = await req(
      "POST",
      "/api/seating/assign",
      { table_id: table.data.table.id, seat_index: 99, guest_id: g2.data.guest.id },
      { token },
    );
    expect(bad.status).toBe(400);

    // Cross-couple isolation: a different couple can't access this table.
    const other = await bootstrapCouple("other@weddly.test");
    const otherG = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Outsider" },
      { token: other.token },
    );
    const cross = await req(
      "POST",
      "/api/seating/assign",
      {
        table_id: table.data.table.id,
        seat_index: 0,
        guest_id: otherG.data.guest.id,
      },
      { token: other.token },
    );
    expect(cross.status).toBe(404);
  });
});

describe("pause / breakup", () => {
  test("status → request → cancel flow", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause@weddly.test");

    const s0 = await req<{ couple_status: string; pause_request: unknown }>(
      "GET",
      "/api/couples/pause",
      undefined,
      { token },
    );
    expect(s0.data.couple_status).toBe("active");
    expect(s0.data.pause_request).toBeNull();

    const p = await req<{ pause_request: { status: string; scheduled_delete_at: number } }>(
      "POST",
      "/api/couples/pause",
      { reason: "thinking it over" },
      { token },
    );
    expect(p.status).toBe(201);
    expect(p.data.pause_request.status).toBe("pending");
    expect(p.data.pause_request.scheduled_delete_at).toBeGreaterThan(Date.now());

    const s1 = await req<{ couple_status: string }>("GET", "/api/couples/pause", undefined, {
      token,
    });
    expect(s1.data.couple_status).toBe("paused");

    // Double-pause rejected.
    const dup = await req("POST", "/api/couples/pause", {}, { token });
    expect(dup.status).toBe(409);

    // Cancel restores active.
    const cancel = await req("POST", "/api/couples/pause/cancel", {}, { token });
    expect(cancel.status).toBe(200);
    const s2 = await req<{ couple_status: string }>("GET", "/api/couples/pause", undefined, {
      token,
    });
    expect(s2.data.couple_status).toBe("active");
  });
});

describe("pause-to-delete purge job", () => {
  test("purges PII and stamps couple as deleting once the window expires", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("purge@weddly.test");
    await req("POST", "/api/guests", { full_name: "Will Be Purged" }, { token });

    const pause = await req<{ pause_request: { id: number } }>(
      "POST",
      "/api/couples/pause",
      {},
      { token },
    );
    expect(pause.status).toBe(201);
    // Force the deadline into the past so the sweep finds it.
    db.prepare("UPDATE couple_pause_requests SET scheduled_delete_at = 1 WHERE couple_id = ?").run(
      coupleId,
    );

    const result = runPurgeSweep();
    expect(result.purged).toBe(1);

    // Guest PII gone.
    const guests = db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE couple_id = ?")
      .get(coupleId) as { n: number };
    expect(guests.n).toBe(0);

    // Couple shell still exists, status = deleting, name scrubbed.
    const couple = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(coupleId) as { status: string; display_name: string };
    expect(couple.status).toBe("deleting");
    expect(couple.display_name).toBe("Purged workspace");

    // User email scrubbed; sessions revoked.
    const user = db
      .prepare("SELECT email, status FROM users WHERE couple_id = ?")
      .get(coupleId) as { email: string; status: string };
    expect(user.email).toMatch(/^deleted-\d+@purged\.local$/);
    expect(user.status).toBe("suspended");

    const sessions = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sessions WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
      )
      .get(coupleId) as { n: number };
    expect(sessions.n).toBe(0);

    // Audit log entry written.
    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'couple.purge'",
      )
      .get(coupleId) as { n: number };
    expect(audit.n).toBe(1);
  });

  test("does not purge couples whose deadline is still in the future", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notyet@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    // Default scheduled_delete_at is now + 30d — should not be picked up.
    const result = runPurgeSweep();
    expect(result.purged).toBe(0);
    const couple = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(couple.status).toBe("paused");
  });
});

describe("password reset", () => {
  test("forgot returns 200 even for unknown emails (no enumeration)", async () => {
    wipeAll();
    const r = await req<{ ok: true }>("POST", "/api/auth/forgot", { email: "ghost@nowhere.test" });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });

  test("end-to-end: request → use token → log in with new password", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "reset@weddly.test",
      password: "originalpw123",
      full_name: "Reset User",
    });

    const r = await req<{ ok: true }>("POST", "/api/auth/forgot", { email: "reset@weddly.test" });
    expect(r.status).toBe(200);

    // Pull the token straight from the DB (the email is stubbed in tests).
    const tokenRow = db
      .prepare(
        "SELECT token FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("reset@weddly.test") as { token: string } | undefined;
    expect(tokenRow?.token).toBeDefined();

    const reset = await req<{ ok: true }>("POST", "/api/auth/reset", {
      token: tokenRow!.token,
      password: "brandnewpw456",
    });
    expect(reset.status).toBe(200);

    // Old password should fail.
    const oldLogin = await req("POST", "/api/auth/login", {
      email: "reset@weddly.test",
      password: "originalpw123",
    });
    expect(oldLogin.status).toBe(401);

    // New password should succeed.
    const newLogin = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "reset@weddly.test",
      password: "brandnewpw456",
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.data.token).toContain(".");

    // Re-using the same token must fail.
    const reuse = await req("POST", "/api/auth/reset", {
      token: tokenRow!.token,
      password: "anotherpw789",
    });
    expect(reuse.status).toBe(400);
  });

  test("reset rejects expired tokens", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "expired@weddly.test",
      password: "supersafe123",
      full_name: "Expired",
    });
    await req("POST", "/api/auth/forgot", { email: "expired@weddly.test" });
    db.prepare(
      "UPDATE password_reset_tokens SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    ).run("expired@weddly.test");
    const tokenRow = db
      .prepare(
        "SELECT token FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("expired@weddly.test") as { token: string };
    const r = await req("POST", "/api/auth/reset", {
      token: tokenRow.token,
      password: "newpassword123",
    });
    expect(r.status).toBe(400);
  });
});

describe("email verification", () => {
  test("register issues a verification token (welcome email)", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "verify-new@weddly.test",
      password: "supersafe123",
      full_name: "Verify New",
    });

    const tokenRow = db
      .prepare(
        "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("verify-new@weddly.test") as { token: string } | undefined;
    expect(tokenRow?.token).toBeDefined();
    expect(tokenRow!.token.length).toBeGreaterThanOrEqual(32);
  });

  test("consume token flips verified_email and is single-use", async () => {
    wipeAll();
    const reg = await req<{ token: string; user: { id: number; verified_email: boolean } }>(
      "POST",
      "/api/auth/register",
      {
        email: "verify-flip@weddly.test",
        password: "supersafe123",
        full_name: "Verify Flip",
      },
    );
    expect(reg.data.user.verified_email).toBe(false);

    const tokenRow = db
      .prepare(
        "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("verify-flip@weddly.test") as { token: string };

    const consume = await req<{ ok: true }>("POST", `/api/auth/verify/${tokenRow.token}`, {});
    expect(consume.status).toBe(200);

    // /me reflects the flip.
    const me = await req<{ user: { verified_email: boolean } }>("GET", "/api/auth/me", undefined, {
      token: reg.data.token,
    });
    expect(me.data.user.verified_email).toBe(true);

    // Re-using the same token must fail.
    const reuse = await req("POST", `/api/auth/verify/${tokenRow.token}`, {});
    expect(reuse.status).toBe(400);
  });

  test("expired tokens are rejected", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "verify-expired@weddly.test",
      password: "supersafe123",
      full_name: "Verify Expired",
    });
    db.prepare(
      "UPDATE email_verification_tokens SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    ).run("verify-expired@weddly.test");
    const tokenRow = db
      .prepare(
        "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .get("verify-expired@weddly.test") as { token: string };

    const r = await req("POST", `/api/auth/verify/${tokenRow.token}`, {});
    expect(r.status).toBe(400);
  });

  test("resend issues a fresh token for an authenticated unverified user", async () => {
    wipeAll();
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "verify-resend@weddly.test",
      password: "supersafe123",
      full_name: "Verify Resend",
    });

    const before = db
      .prepare(
        "SELECT id FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .all("verify-resend@weddly.test") as { id: number }[];
    expect(before.length).toBe(1);

    const resend = await req<{ ok: true; already_verified?: boolean }>(
      "POST",
      "/api/auth/verify/request",
      {},
      { token: reg.data.token },
    );
    expect(resend.status).toBe(200);
    expect(resend.data.already_verified).toBeFalsy();

    const after = db
      .prepare(
        "SELECT id FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .all("verify-resend@weddly.test") as { id: number }[];
    expect(after.length).toBe(2);
  });

  test("resend short-circuits for already-verified users", async () => {
    wipeAll();
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "verify-already@weddly.test",
      password: "supersafe123",
      full_name: "Verify Already",
    });
    const tokenRow = db
      .prepare(
        "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
      )
      .get("verify-already@weddly.test") as { token: string };
    await req("POST", `/api/auth/verify/${tokenRow.token}`, {});

    const resend = await req<{ ok: true; already_verified?: boolean }>(
      "POST",
      "/api/auth/verify/request",
      {},
      { token: reg.data.token },
    );
    expect(resend.status).toBe(200);
    expect(resend.data.already_verified).toBe(true);
  });

  test("resend rejects unauthenticated callers", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/verify/request", {});
    expect(r.status).toBe(401);
  });
});

describe("data export (GDPR Article 20)", () => {
  test("returns full workspace JSON without password hashes", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("export@weddly.test");
    await req("POST", "/api/guests", { full_name: "Export Guest" }, { token });

    const r = await req<{
      schema_version: number;
      couple: { id: number };
      partners: { partner_a: { email: string; password_hash?: unknown }; partner_b: unknown };
      guests: { full_name: string }[];
      budget: { lines: unknown[]; snapshots: unknown[] };
      seating: { tables: unknown[]; assignments: unknown[]; conflicts: unknown[] };
    }>("GET", "/api/couples/export", undefined, { token });

    expect(r.status).toBe(200);
    expect(r.data.schema_version).toBe(1);
    expect(r.data.couple.id).toBe(coupleId);
    expect(r.data.partners.partner_a.email).toBe("export@weddly.test");
    // Critical: password hashes must not leak.
    expect(r.data.partners.partner_a.password_hash).toBeUndefined();
    expect(r.data.guests.length).toBe(1);
    expect(r.data.guests[0]?.full_name).toBe("Export Guest");
    expect(r.data.budget.lines.length).toBeGreaterThan(0); // seeded by onboarding
  });

  test("rejects unauthenticated request", async () => {
    const r = await req("GET", "/api/couples/export");
    expect(r.status).toBe(401);
  });
});

describe("suppliers + print", () => {
  test("suppliers directory is public", async () => {
    const r = await req<{ suppliers: { id: string; category: string }[] }>("GET", "/api/suppliers");
    expect(r.status).toBe(200);
    expect(r.data.suppliers.length).toBeGreaterThan(0);
  });

  test("suppliers filter by category", async () => {
    const r = await req<{ suppliers: { category: string }[] }>(
      "GET",
      "/api/suppliers?category=venue",
    );
    expect(r.status).toBe(200);
    expect(r.data.suppliers.every((s) => s.category === "venue")).toBe(true);
  });

  test("PDF print endpoints return application/pdf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pdf@weddly.test");
    await req("POST", "/api/guests", { full_name: "PDF Guest" }, { token });

    const res = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
    // pdf-lib output begins with %PDF-
    const head = new TextDecoder().decode(buf.slice(0, 5));
    expect(head).toBe("%PDF-");
  });
});

describe("email pipeline", () => {
  test("register persists welcome_verify in email_log", async () => {
    wipeAll();
    await req("POST", "/api/auth/register", {
      email: "elog@weddly.test",
      password: "supersafe123",
      full_name: "Email Log",
    });
    const rows = db
      .prepare(
        "SELECT kind, category, status, to_email FROM email_log WHERE to_email = ? ORDER BY id",
      )
      .all("elog@weddly.test") as {
      kind: string;
      category: string;
      status: string;
      to_email: string;
    }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("welcome_verify");
    expect(rows[0]!.category).toBe("transactional");
    // Tests run without a real Resend key, so the dispatcher records "skipped_no_provider".
    expect(rows[0]!.status).toBe("skipped_no_provider");
  });

  test("register seeds email_preferences with a stable unsubscribe token", async () => {
    wipeAll();
    const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
      email: "prefs@weddly.test",
      password: "supersafe123",
      full_name: "Prefs",
    });
    const prefs = db
      .prepare(
        "SELECT unsubscribe_token, lifecycle_opt_out FROM email_preferences WHERE user_id = ?",
      )
      .get(reg.data.user.id) as { unsubscribe_token: string; lifecycle_opt_out: number };
    expect(prefs.unsubscribe_token.length).toBeGreaterThanOrEqual(32);
    expect(prefs.lifecycle_opt_out).toBe(0);
  });

  test("one-click unsubscribe flips the lifecycle flag", async () => {
    wipeAll();
    const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
      email: "unsub@weddly.test",
      password: "supersafe123",
      full_name: "Unsub",
    });
    const prefs = db
      .prepare("SELECT unsubscribe_token FROM email_preferences WHERE user_id = ?")
      .get(reg.data.user.id) as { unsubscribe_token: string };

    const res = await fetch(`${BASE}/api/unsubscribe/${prefs.unsubscribe_token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.startsWith("text/html")).toBe(true);

    const after = db
      .prepare("SELECT lifecycle_opt_out FROM email_preferences WHERE user_id = ?")
      .get(reg.data.user.id) as { lifecycle_opt_out: number };
    expect(after.lifecycle_opt_out).toBe(1);
  });

  test("opted-out users get lifecycle skipped, transactional still sent", async () => {
    wipeAll();
    const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
      email: "optout@weddly.test",
      password: "supersafe123",
      full_name: "Opt Out",
    });
    // Flip lifecycle off via the dashboard endpoint.
    const flip = await req<{ ok: boolean; lifecycle_opt_out: boolean }>(
      "POST",
      "/api/account/email-preferences",
      { lifecycle_opt_out: true },
      { token: reg.data.token },
    );
    expect(flip.status).toBe(200);
    expect(flip.data.lifecycle_opt_out).toBe(true);

    // Force this user to look 25h old so the nudge sweep picks them up.
    db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(
      now() - 1000 * 60 * 60 * 25,
      reg.data.user.id,
    );

    const sweep = runEmailSweep();
    expect(sweep.nudges).toBe(1);

    const logRow = db
      .prepare("SELECT status, kind FROM email_log WHERE user_id = ? AND kind = 'onboarding_nudge'")
      .get(reg.data.user.id) as { status: string; kind: string } | undefined;
    expect(logRow?.status).toBe("skipped_opt_out");
  });

  test("onboarding nudge fires once per user (idempotent)", async () => {
    wipeAll();
    const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
      email: "nudge@weddly.test",
      password: "supersafe123",
      full_name: "Nudge",
    });
    db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(
      now() - 1000 * 60 * 60 * 30,
      reg.data.user.id,
    );

    const first = runEmailSweep();
    expect(first.nudges).toBe(1);
    const second = runEmailSweep();
    expect(second.nudges).toBe(0);

    const logs = db
      .prepare("SELECT id FROM email_log WHERE user_id = ? AND kind = 'onboarding_nudge'")
      .all(reg.data.user.id) as { id: number }[];
    expect(logs.length).toBe(1);
  });

  test("milestone reminders fire for couples whose wedding is in 7/30/90 days", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("milestones@weddly.test");
    // Force wedding date to be exactly 30 days from today (UTC midnight).
    const target = isoUtcDate(now() + 30 * 86_400_000);
    db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(target, coupleId);

    const sweep = runEmailSweep();
    expect(sweep.milestones).toBe(1);
    const log = db
      .prepare("SELECT kind, status FROM email_log WHERE couple_id = ? AND kind = 'milestone_t30'")
      .get(coupleId) as { kind: string; status: string } | undefined;
    expect(log?.kind).toBe("milestone_t30");
  });

  test("RSVP submission triggers couple notification + guest thank-you", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rsvpmail@weddly.test");
    const created = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Mail Guest", email: "guest-mail@example.com" },
      { token },
    );
    const code = created.data.guest.invite_code;

    const sub = await req("POST", `/api/rsvp/${code}`, { rsvp_status: "yes", meal_choice: "meat" });
    expect(sub.status).toBe(200);

    const couplesNotice = db
      .prepare(
        "SELECT to_email FROM email_log WHERE couple_id = ? AND kind = 'rsvp_received_for_couple'",
      )
      .all(coupleId) as { to_email: string }[];
    expect(couplesNotice.length).toBe(1);
    expect(couplesNotice[0]!.to_email).toBe("rsvpmail@weddly.test");

    const guestThanks = db
      .prepare("SELECT to_email FROM email_log WHERE kind = 'rsvp_thanks_for_guest'")
      .all() as { to_email: string }[];
    expect(guestThanks.length).toBe(1);
    expect(guestThanks[0]!.to_email).toBe("guest-mail@example.com");
  });

  test("partner invite email logs against the couple", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("invite-mail@weddly.test");
    const inv = await req("POST", "/api/couples/invites", { invited_email: "b@x.test" }, { token });
    expect(inv.status).toBe(201);
    const log = db
      .prepare(
        "SELECT to_email, kind FROM email_log WHERE couple_id = ? AND kind = 'partner_invite'",
      )
      .get(coupleId) as { to_email: string; kind: string } | undefined;
    expect(log?.to_email).toBe("b@x.test");
  });

  test("purge clears email_log + preferences for the deleted couple", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("purge-mail@weddly.test");
    await req("POST", "/api/couples/invites", { invited_email: "c@x.test" }, { token });

    await req("POST", "/api/couples/pause", {}, { token });
    db.prepare("UPDATE couple_pause_requests SET scheduled_delete_at = 1 WHERE couple_id = ?").run(
      coupleId,
    );
    runPurgeSweep();

    const logCount = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ?")
      .get(coupleId) as { n: number };
    expect(logCount.n).toBe(0);
    const prefsCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_preferences WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
      )
      .get(coupleId) as { n: number };
    expect(prefsCount.n).toBe(0);
  });
});

function isoUtcDate(ts: number): string {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
