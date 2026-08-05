import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import type { PlannerDataExport } from "@shared/types";
import { db, now } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

function promoteToPlanner(email: string): void {
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
}

async function bootstrapPlanner(
  email = "planner@weddly.test",
): Promise<{ token: string; userId: number }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  expect(reg.status).toBe(201);
  promoteToPlanner(email);
  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;
  return { token: reg.data.token, userId };
}

/** Link a planner to a couple as an ACTIVE client, the state every couple-scoped
 *  planner endpoint gates on. */
function linkClient(plannerUserId: number, coupleId: number): void {
  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'active', ?)",
  ).run(plannerUserId, coupleId, now());
}

describe("planner data export", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("GET /api/planner/export — refuses a couple account", async () => {
    const { token } = await bootstrapCouple("notplanner@weddly.test");
    const r = await req("GET", "/api/planner/export", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("GET /api/planner/export — refuses an anonymous caller", async () => {
    const r = await req("GET", "/api/planner/export");
    expect(r.status).toBe(401);
  });

  test("GET /api/planner/export — returns the planner's own rows", async () => {
    const { token, userId } = await bootstrapPlanner();
    const { coupleId } = await bootstrapCouple("client@weddly.test");
    linkClient(userId, coupleId);
    db.prepare(
      "INSERT INTO planner_events (planner_user_id, couple_id, title, event_date, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, coupleId, "Venue walkthrough", "2026-09-01", now());

    const r = await req<PlannerDataExport>("GET", "/api/planner/export", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.schema_version).toBe(1);
    expect(r.data.user.email).toBe("planner@weddly.test");
    expect(r.data.clients.length).toBe(1);
    expect(r.data.events.length).toBe(1);
    expect(r.data.events[0]?.title).toBe("Venue walkthrough");
    // Every declared table is present as an array even when it has no rows —
    // an absent key would read as "we hold nothing" vs "this is empty".
    expect(Array.isArray(r.data.packages)).toBe(true);
    expect(Array.isArray(r.data.portfolio)).toBe(true);
    expect(Array.isArray(r.data.points_ledger)).toBe(true);
    expect(Array.isArray(r.data.reviews)).toBe(true);
    // The profile block carries the planner columns, not the whole users row:
    // no password hash may ever ride out in a takeout.
    expect(r.data.profile.password_hash).toBeUndefined();
    expect(r.data.profile.user_type).toBe("planner");
  });

  test("GET /api/planner/export — sees only its OWN rows, never another planner's", async () => {
    const a = await bootstrapPlanner("a@weddly.test");
    const b = await bootstrapPlanner("b@weddly.test");
    const { coupleId } = await bootstrapCouple("shared-client@weddly.test");
    linkClient(b.userId, coupleId);

    const r = await req<PlannerDataExport>("GET", "/api/planner/export", undefined, {
      token: a.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.clients.length).toBe(0);
  });

  test("GET /api/planner/export — a LAPSED planner can still take their data out", async () => {
    const { token, userId } = await bootstrapPlanner();
    // Expired trial, no founding window: read-only on every edit surface.
    db.prepare(
      `INSERT INTO planner_subscriptions
         (user_id, subscription_status, trial_ends_at, founding_until, is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'trialing', ?, NULL, 0, 'EUR', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET subscription_status = 'trialing', trial_ends_at = excluded.trial_ends_at`,
    ).run(userId, now() - 1000, now(), now());

    const r = await req<PlannerDataExport>("GET", "/api/planner/export", undefined, { token });
    expect(r.status).toBe(200);
  });
});

describe("planner account deletion", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("DELETE /api/planner/account — refuses a couple account", async () => {
    const { token } = await bootstrapCouple("notplanner2@weddly.test");
    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("DELETE /api/planner/account — refuses an anonymous caller", async () => {
    // This is the bug the endpoint was built for: the settings page used to
    // send an unauthenticated fetch at a route that did not exist, ignore the
    // response, and log the planner out as though erasure had happened.
    const r = await req("DELETE", "/api/planner/account");
    expect(r.status).toBe(401);
  });

  test("DELETE /api/planner/account — erases the planner's own data", async () => {
    const { token, userId } = await bootstrapPlanner();
    const { coupleId } = await bootstrapCouple("client2@weddly.test");
    linkClient(userId, coupleId);
    db.prepare(
      "INSERT INTO planner_events (planner_user_id, couple_id, title, event_date, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, coupleId, "Tasting", "2026-08-20", now());
    db.prepare(
      "INSERT INTO planner_client_notes (planner_user_id, couple_id, body, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, coupleId, "Budget is tight", now());
    db.prepare(
      "INSERT INTO planner_messages (planner_user_id, couple_id, subject, body_text, recipient_email, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, coupleId, "Hello", "Body", "client2@weddly.test", now());

    const r = await req<{ ok: boolean }>("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);

    for (const table of [
      "planner_clients",
      "planner_client_notes",
      "planner_messages",
      "planner_events",
      "planner_portfolio",
      "planner_packages",
      "planner_unavailable_dates",
      "planner_points_ledger",
      "planner_event_outbox",
    ]) {
      const left = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE planner_user_id = ?`)
        .get(userId) as { n: number };
      expect(`${table}:${left.n}`).toBe(`${table}:0`);
    }

    // The identity row survives as an audit_log FK target, scrubbed.
    const user = db
      .prepare("SELECT email, full_name, status, planner_bio, planner_city FROM users WHERE id = ?")
      .get(userId) as {
      email: string;
      full_name: string;
      status: string;
      planner_bio: string | null;
      planner_city: string | null;
    };
    expect(user.email).toBe(`deleted-${userId}@purged.local`);
    expect(user.full_name).toBe("Purged user");
    expect(user.status).toBe("suspended");
    expect(user.planner_bio).toBeNull();
    expect(user.planner_city).toBeNull();
  });

  test("DELETE /api/planner/account — the CLIENT's workspace survives untouched", async () => {
    // The settings page promises exactly this: "Your clients' workspaces and
    // data are kept." Only the link goes.
    const { token, userId } = await bootstrapPlanner();
    const { coupleId, token: coupleToken } = await bootstrapCouple("kept@weddly.test");
    linkClient(userId, coupleId);

    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);

    const couple = db
      .prepare("SELECT display_name, status FROM couples WHERE id = ?")
      .get(coupleId) as { display_name: string; status: string };
    expect(couple.display_name).toBe("Mia & Lucas");
    expect(couple.status).not.toBe("deleting");

    // And the couple can still use their workspace.
    const stillThere = await req("GET", "/api/couples/current", undefined, { token: coupleToken });
    expect(stillThere.status).toBe(200);
  });

  test("DELETE /api/planner/account — a planner INSIDE a client workspace does not take it down", async () => {
    // `handleEnterClient` parks the CLIENT's couple id on `users.couple_id`.
    // Routed through the generic user purge, that pointer reads as "this
    // planner's workspace" and erases somebody else's wedding.
    const { token, userId } = await bootstrapPlanner();
    const { coupleId, token: coupleToken } = await bootstrapCouple("inside@weddly.test");
    linkClient(userId, coupleId);

    const entered = await req("POST", `/api/planner/clients/${coupleId}/enter`, {}, { token });
    expect(entered.status).toBe(200);
    const pointer = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as {
      couple_id: number | null;
    };
    expect(pointer.couple_id).toBe(coupleId);

    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);

    const couple = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(coupleId) as { status: string; display_name: string };
    expect(couple.status).not.toBe("deleting");
    expect(couple.display_name).toBe("Mia & Lucas");
    // The guest list is the sharpest proof the sweep never ran on them.
    const guests = await req("GET", "/api/guests", undefined, { token: coupleToken });
    expect(guests.status).toBe(200);
  });

  test("DELETE /api/planner/account — the session is dead afterwards", async () => {
    const { token } = await bootstrapPlanner();
    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);
    const after = await req("GET", "/api/planner/export", undefined, { token });
    expect(after.status).toBe(401);
  });

  test("DELETE /api/planner/account — a LAPSED planner can still erase themselves", async () => {
    const { token, userId } = await bootstrapPlanner();
    db.prepare(
      `INSERT INTO planner_subscriptions
         (user_id, subscription_status, trial_ends_at, founding_until, is_founding_member, currency, created_at, updated_at)
       VALUES (?, 'trialing', ?, NULL, 0, 'EUR', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET subscription_status = 'trialing', trial_ends_at = excluded.trial_ends_at`,
    ).run(userId, now() - 1000, now(), now());

    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);
  });

  test("DELETE /api/planner/account — leaves an audit trail naming who asked", async () => {
    const { token, userId } = await bootstrapPlanner();
    const r = await req("DELETE", "/api/planner/account", undefined, { token });
    expect(r.status).toBe(200);
    const entries = db
      .prepare("SELECT action FROM audit_log WHERE target_id = ? AND target_kind = 'user'")
      .all(userId) as { action: string }[];
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("planner.self_delete");
    expect(actions).toContain("planner.purge");
  });
});
