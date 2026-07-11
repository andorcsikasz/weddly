// Planner directory analytics — the couple-facing rail records card impressions
// + click-throughs (POST /api/planners/events), and the admin Szervezők list
// surfaces per-planner reach (views / clicks / connect conversions).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminPlannerView, PlannerEventInput } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, latestCredentialToken, req, verifyUserEmail, wipeAll } from "../helpers";

/** Register + verify a planner user, return its id. */
async function makePlanner(email: string): Promise<number> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Rita Kruczli",
  });
  const t = latestCredentialToken("email_verification_tokens", email);
  await req("POST", `/api/auth/verify/${t}`, {});
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
  return reg.data.user.id;
}

/** Register + verify the ADMIN_EMAILS allowlist address; return the bearer. */
async function bootstrapAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

function adminPlanner(token: string, plannerUserId: number) {
  return req<{ planners: AdminPlannerView[] }>("GET", "/api/admin/planners", undefined, {
    token,
  }).then((r) => {
    const p = r.data.planners.find(
      (x): x is Extract<AdminPlannerView, { state: "active" }> =>
        x.state === "active" && x.user_id === plannerUserId,
    );
    return { status: r.status, planner: p };
  });
}

describe("planner directory analytics", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("records impressions + click-throughs and surfaces them on the admin card", async () => {
    const plannerId = await makePlanner("rita@weddly.test");
    const adminToken = await bootstrapAdmin();
    const { token: coupleToken } = await bootstrapCouple("reach-couple@weddly.test");

    const events: PlannerEventInput[] = [
      { planner_user_id: plannerId, type: "impression" },
      { planner_user_id: plannerId, type: "impression" },
      { planner_user_id: plannerId, type: "profile_click" },
      { planner_user_id: plannerId, type: "website_click" },
      { planner_user_id: plannerId, type: "connect_click" },
    ];
    const rec = await req<{ recorded: number }>("POST", "/api/planners/events", { events }, {
      token: coupleToken,
    });
    expect(rec.status).toBe(200);
    expect(rec.data.recorded).toBe(5);

    const { status, planner } = await adminPlanner(adminToken, plannerId);
    expect(status).toBe(200);
    expect(planner?.analytics).toBeDefined();
    // 2 impressions → 2 views; the other 3 fold into clicks; 1 connect isolated.
    expect(planner?.analytics?.views_total).toBe(2);
    expect(planner?.analytics?.clicks_total).toBe(3);
    expect(planner?.analytics?.connect_clicks_total).toBe(1);
    expect(planner?.analytics?.views_30d).toBe(2);
    expect(planner?.analytics?.last_event_at).not.toBeNull();
  });

  test("silently drops events for an unknown planner id or a bad type", async () => {
    const plannerId = await makePlanner("real@weddly.test");
    const { token: coupleToken } = await bootstrapCouple("drop-couple@weddly.test");

    const rec = await req<{ recorded: number }>(
      "POST",
      "/api/planners/events",
      {
        events: [
          { planner_user_id: plannerId, type: "impression" }, // ok
          { planner_user_id: 999999, type: "impression" }, // unknown planner
          { planner_user_id: plannerId, type: "not_a_type" }, // bad type
        ],
      },
      { token: coupleToken },
    );
    expect(rec.status).toBe(200);
    expect(rec.data.recorded).toBe(1);
  });

  test("requires auth and rejects a non-array body", async () => {
    const anon = await req("POST", "/api/planners/events", { events: [] });
    expect(anon.status).toBe(401);

    const { token: coupleToken } = await bootstrapCouple("bad-body@weddly.test");
    const bad = await req(
      "POST",
      "/api/planners/events",
      { events: "nope" },
      { token: coupleToken },
    );
    expect(bad.status).toBe(400);
  });
});
