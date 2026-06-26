import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// Promote the most recently registered user to planner type.
function promoteToPlanner(email: string): void {
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
}

/** Register a user, verify email, promote to planner, and log in. */
async function bootstrapPlanner(
  email = "planner@weddly.test",
): Promise<{ token: string; userId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  expect(reg.status).toBe(201);

  // Verify email via token in DB
  const tokenRow = db
    .prepare(
      "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
    )
    .get(email.toLowerCase()) as { token: string } | undefined;
  if (!tokenRow) throw new Error(`no verification token for ${email}`);
  await req("POST", `/api/auth/verify/${tokenRow.token}`, {});

  promoteToPlanner(email);

  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;

  return { token: reg.data.token, userId };
}

describe("planner stats", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("GET /api/planner/stats — requires planner account", async () => {
    // Regular couple user
    const { token } = await bootstrapCouple("regular@weddly.test");
    const r = await req("GET", "/api/planner/stats", undefined, { token });
    expect(r.status).toBe(403);
  });

  test("GET /api/planner/stats — fresh planner returns zero counts and onboarding_done=false", async () => {
    const { token } = await bootstrapPlanner();
    const r = await req<{ stats: Record<string, unknown> }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    const { stats } = r.data;
    expect(stats.active_clients).toBe(0);
    expect(stats.pending_invites).toBe(0);
    expect(stats.total_tasks).toBe(0);
    expect(stats.onboarding_done).toBe(false);
    expect(stats.plan).toBe("starter");
    expect(stats.max_clients).toBe(4);
    expect(Array.isArray(stats.per_client)).toBe(true);
    expect((stats.per_client as unknown[]).length).toBe(0);
  });
});

describe("planner complete-onboarding", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("POST /api/planner/complete-onboarding — requires planner account", async () => {
    const { token } = await bootstrapCouple("regular2@weddly.test");
    const r = await req("POST", "/api/planner/complete-onboarding", {}, { token });
    expect(r.status).toBe(403);
  });

  test("POST /api/planner/complete-onboarding — sets onboarding_done to true", async () => {
    const { token } = await bootstrapPlanner("onboard@weddly.test");

    const before = await req<{ stats: { onboarding_done: boolean } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(before.data.stats.onboarding_done).toBe(false);

    const done = await req<{ ok: boolean }>(
      "POST",
      "/api/planner/complete-onboarding",
      {},
      { token },
    );
    expect(done.status).toBe(200);
    expect(done.data.ok).toBe(true);

    const after = await req<{ stats: { onboarding_done: boolean } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(after.data.stats.onboarding_done).toBe(true);
  });
});

describe("planner client limit", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("POST /api/planner/clients — 422 when starter client cap (4) is reached", async () => {
    const { token } = await bootstrapPlanner("caplanner@weddly.test");

    // Create 4 couples (one owner per couple) and link them all.
    for (let i = 1; i <= 4; i++) {
      const email = `couple${i}@weddly.test`;
      await bootstrapCouple(email);
      const add = await req<{ ok: boolean }>("POST", "/api/planner/clients", { email }, { token });
      expect(add.status).toBe(200);
    }

    // 5th couple should be rejected.
    const email5 = "couple5@weddly.test";
    await bootstrapCouple(email5);
    const over = await req("POST", "/api/planner/clients", { email: email5 }, { token });
    expect(over.status).toBe(422);
    expect((over.data as { error: string }).error).toContain("limit");

    // Stats should report 4 active clients.
    const stats = await req<{ stats: { active_clients: number; max_clients: number } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(stats.data.stats.active_clients).toBe(4);
    expect(stats.data.stats.max_clients).toBe(4);
  });

  test("POST /api/planner/clients — reflects linked client in stats", async () => {
    const { token } = await bootstrapPlanner("link@weddly.test");
    const { coupleId } = await bootstrapCouple("clientcouple@weddly.test");

    const add = await req<{ ok: boolean; couple_id: number }>(
      "POST",
      "/api/planner/clients",
      { email: "clientcouple@weddly.test" },
      { token },
    );
    expect(add.status).toBe(200);
    expect(add.data.ok).toBe(true);
    expect(add.data.couple_id).toBe(coupleId);

    const stats = await req<{ stats: { active_clients: number } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(stats.data.stats.active_clients).toBe(1);
  });
});
