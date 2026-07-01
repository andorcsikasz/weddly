import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminPlannerView } from "@shared/types";
import { db, now } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Seed a planner: a users row flipped to user_type='planner'. Returns userId. */
async function seedPlanner(email: string): Promise<number> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Planner Person",
  });
  await verifyUserEmail(email);
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE id = ?").run(userId);
  return userId;
}

describe("admin planner management", () => {
  test("lists planners with active-client counts", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner1@weddly.test");
    const { coupleId } = await bootstrapCouple("client1@weddly.test");
    db.prepare(
      "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'active', ?)",
    ).run(plannerId, coupleId, now());

    const res = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const planner = res.data.planners.find((p) => p.user_id === plannerId);
    expect(planner).toBeDefined();
    expect(planner?.client_count).toBe(1);
    expect(planner?.planner_plan).toBe("starter");
  });

  test("suspend + reactivate flips users.status", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner2@weddly.test");

    const suspend = await req("POST", `/api/admin/planners/${plannerId}/suspend`, {}, { token: adminToken });
    expect(suspend.status).toBe(200);
    let row = db.prepare("SELECT status FROM users WHERE id = ?").get(plannerId) as { status: string };
    expect(row.status).toBe("suspended");

    const reactivate = await req(
      "POST",
      `/api/admin/planners/${plannerId}/reactivate`,
      {},
      { token: adminToken },
    );
    expect(reactivate.status).toBe(200);
    row = db.prepare("SELECT status FROM users WHERE id = ?").get(plannerId) as { status: string };
    expect(row.status).toBe("active");
  });

  test("PATCH plan tier updates plan + max clients", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner3@weddly.test");

    const res = await req(
      "PATCH",
      `/api/admin/planners/${plannerId}`,
      { planner_plan: "premium" },
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT planner_plan, planner_max_clients FROM users WHERE id = ?")
      .get(plannerId) as { planner_plan: string; planner_max_clients: number };
    expect(row.planner_plan).toBe("premium");
    expect(row.planner_max_clients).toBe(10);
  });

  test("PATCH rejects an unknown plan", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner4@weddly.test");
    const res = await req(
      "PATCH",
      `/api/admin/planners/${plannerId}`,
      { planner_plan: "gold" },
      { token: adminToken },
    );
    expect(res.status).toBe(400);
  });

  test("DELETE purges the planner", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner5@weddly.test");
    const res = await req("DELETE", `/api/admin/planners/${plannerId}`, undefined, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    // purgeOneUser scrubs the user (email → purged) rather than hard-deleting.
    const row = db.prepare("SELECT email FROM users WHERE id = ?").get(plannerId) as
      | { email: string }
      | undefined;
    expect(row?.email.endsWith("@purged.local")).toBe(true);
  });

  test("targeting a non-planner user 404s", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("regular@weddly.test");
    const owner = db
      .prepare("SELECT id FROM users WHERE couple_id = ? LIMIT 1")
      .get(coupleId) as { id: number };
    const res = await req(
      "PATCH",
      `/api/admin/planners/${owner.id}`,
      { planner_plan: "pro" },
      { token: adminToken },
    );
    expect(res.status).toBe(404);
  });

  test("non-admin is rejected", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("notadmin2@weddly.test");
    const res = await req("GET", "/api/admin/planners", undefined, { token });
    expect(res.status).toBe(403);
  });
});
