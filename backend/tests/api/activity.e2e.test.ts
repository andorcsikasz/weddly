import "../setup";

import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// Feeds AdminUserView.activity.total_active_seconds / AdminCoupleView's
// workspace total on the admin users page — see domain/activity.ts. The
// server credits a fixed ACTIVITY_HEARTBEAT_INTERVAL_S per accepted
// heartbeat, never a client-reported duration, so these tests assert on
// that constant (imported from the same shared module the route uses)
// rather than any elapsed wall-clock time.
const ACTIVITY_HEARTBEAT_INTERVAL_S = 25;

/** Register the ADMIN_EMAILS allowlist email, verify it, return the bearer.
 *  setup.ts sets ADMIN_EMAILS=admin@test.test. Wipes the DB up front. */
async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

interface UsersListResp {
  users: AdminUserView[];
}
interface CouplesListResp {
  couples: AdminCoupleView[];
}

describe("POST /api/activity/heartbeat", () => {
  test("requires a session", async () => {
    wipeAll();
    const r = await req("POST", "/api/activity/heartbeat", {});
    expect(r.status).toBe(401);
  });

  test("a fresh account has zero total time before its first heartbeat", async () => {
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("fresh@weddly.test");
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const row = list.data.users.find((u) => u.email === "fresh@weddly.test");
    expect(row?.activity.total_active_seconds).toBe(0);
  });

  test("one accepted heartbeat credits exactly the fixed interval, never a caller-supplied duration", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("ping-once@weddly.test");

    // A caller-supplied duration must be ignored even if sent — the server
    // is the only clock.
    const hb = await req("POST", "/api/activity/heartbeat", { seconds: 999_999 }, { token });
    expect(hb.status).toBe(200);

    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const row = list.data.users.find((u) => u.email === "ping-once@weddly.test");
    expect(row?.activity.total_active_seconds).toBe(ACTIVITY_HEARTBEAT_INTERVAL_S);
  });

  test("repeated heartbeats accumulate on the same day", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("ping-many@weddly.test");

    for (let i = 0; i < 3; i++) {
      const hb = await req("POST", "/api/activity/heartbeat", {}, { token });
      expect(hb.status).toBe(200);
    }

    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const row = list.data.users.find((u) => u.email === "ping-many@weddly.test");
    expect(row?.activity.total_active_seconds).toBe(3 * ACTIVITY_HEARTBEAT_INTERVAL_S);
  });

  test("the workspace total on the couples list sums this member's credited time", async () => {
    const adminToken = await bootstrapAdmin();
    const { token, coupleId } = await bootstrapCouple("workspace-time@weddly.test");
    await req("POST", "/api/activity/heartbeat", {}, { token });
    await req("POST", "/api/activity/heartbeat", {}, { token });

    const list = await req<CouplesListResp>("GET", "/api/admin/couples", undefined, {
      token: adminToken,
    });
    const row = list.data.couples.find((c) => c.id === coupleId);
    expect(row?.total_active_seconds).toBe(2 * ACTIVITY_HEARTBEAT_INTERVAL_S);
  });

  test("is rate-limited so a runaway retry loop can't inflate the total unbounded", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hammer@weddly.test");

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await req("POST", "/api/activity/heartbeat", {}, { token });
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(6);
    expect(statuses).toContain(429);
  });

  test("is scoped to the calling user", async () => {
    const adminToken = await bootstrapAdmin();
    const { token: tokenA } = await bootstrapCouple("scope-a@weddly.test");
    await bootstrapCouple("scope-b@weddly.test");

    await req("POST", "/api/activity/heartbeat", {}, { token: tokenA });

    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const a = list.data.users.find((u) => u.email === "scope-a@weddly.test");
    const b = list.data.users.find((u) => u.email === "scope-b@weddly.test");
    expect(a?.activity.total_active_seconds).toBe(ACTIVITY_HEARTBEAT_INTERVAL_S);
    expect(b?.activity.total_active_seconds).toBe(0);
  });
});
