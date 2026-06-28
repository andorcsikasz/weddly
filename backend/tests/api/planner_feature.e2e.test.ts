import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { db } from "../../src/db";
import { bootstrapCouple, latestCredentialToken, req, wipeAll } from "../helpers";

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

  // Verify email via the captured plaintext token (stored hashed now).
  const verifyToken = latestCredentialToken("email_verification_tokens", email);
  await req("POST", `/api/auth/verify/${verifyToken}`, {});

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

  test("POST /api/planner/clients — 422 when the client cap (4) is reached (pending counts)", async () => {
    const { token } = await bootstrapPlanner("caplanner@weddly.test");

    // Request 4 couples — each lands as a pending consent request, and pending
    // requests count toward the cap so a planner can't blast unlimited emails.
    for (let i = 1; i <= 4; i++) {
      const email = `couple${i}@weddly.test`;
      await bootstrapCouple(email);
      const add = await req<{ ok: boolean }>("POST", "/api/planner/clients", { email }, { token });
      expect(add.status).toBe(200);
    }

    // 5th couple should be rejected — 4 pending already fill the cap.
    const email5 = "couple5@weddly.test";
    await bootstrapCouple(email5);
    const over = await req("POST", "/api/planner/clients", { email: email5 }, { token });
    expect(over.status).toBe(422);
    expect((over.data as { error: string }).error).toContain("limit");

    // Stats: 0 active (none approved yet), 4 pending.
    const stats = await req<{
      stats: { active_clients: number; pending_invites: number; max_clients: number };
    }>("GET", "/api/planner/stats", undefined, { token });
    expect(stats.data.stats.active_clients).toBe(0);
    expect(stats.data.stats.pending_invites).toBe(4);
    expect(stats.data.stats.max_clients).toBe(4);
  });

  test("POST /api/planner/clients — request reflects as a pending invite in stats", async () => {
    const { token } = await bootstrapPlanner("link@weddly.test");
    const { coupleId } = await bootstrapCouple("clientcouple@weddly.test");

    const add = await req<{ ok: boolean; status: string; couple_id: number }>(
      "POST",
      "/api/planner/clients",
      { email: "clientcouple@weddly.test" },
      { token },
    );
    expect(add.status).toBe(200);
    expect(add.data.ok).toBe(true);
    expect(add.data.status).toBe("pending");
    expect(add.data.couple_id).toBe(coupleId);

    const stats = await req<{ stats: { active_clients: number; pending_invites: number } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(stats.data.stats.active_clients).toBe(0);
    expect(stats.data.stats.pending_invites).toBe(1);
  });
});

// Security: a planner-initiated link must NOT grant access until the couple
// approves. Before this flow, handleAddClient inserted status='active',
// letting any approved planner read/write any couple's workspace knowing only
// their email — a consent-less cross-tenant exposure.
describe("planner consent flow (planner-initiated request)", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("request is pending; planner cannot enter until the couple approves", async () => {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(
      "consent-planner@weddly.test",
    );
    const { token: coupleToken, coupleId } = await bootstrapCouple("consent-couple@weddly.test");

    const add = await req<{ ok: boolean; status: string }>(
      "POST",
      "/api/planner/clients",
      { email: "consent-couple@weddly.test" },
      { token: plannerToken },
    );
    expect(add.status).toBe(200);
    expect(add.data.status).toBe("pending");

    const row = db
      .prepare(
        "SELECT status, initiated_by FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?",
      )
      .get(plannerId, coupleId) as { status: string; initiated_by: string };
    expect(row.status).toBe("pending");
    expect(row.initiated_by).toBe("planner");

    // No access yet.
    const enterBlocked = await req(
      "POST",
      `/api/planner/clients/${coupleId}/enter`,
      {},
      { token: plannerToken },
    );
    expect(enterBlocked.status).toBe(403);

    // Not shown as a planner-side "invite to accept" (that's the other direction).
    const invites = await req<{ invites: unknown[] }>("GET", "/api/planner/invites", undefined, {
      token: plannerToken,
    });
    expect(invites.data.invites.length).toBe(0);

    // The couple sees the pending request, flagged as planner-initiated.
    const planners = await req<{
      planners: { planner_user_id: number; status: string; initiated_by: string }[];
    }>("GET", "/api/couples/planners", undefined, { token: coupleToken });
    const link = planners.data.planners.find((p) => p.planner_user_id === plannerId);
    expect(link?.status).toBe("pending");
    expect(link?.initiated_by).toBe("planner");

    // Couple approves → planner can now enter.
    const accept = await req(
      "POST",
      `/api/couples/planners/${plannerId}/accept`,
      {},
      { token: coupleToken },
    );
    expect(accept.status).toBe(200);
    const enterOk = await req(
      "POST",
      `/api/planner/clients/${coupleId}/enter`,
      {},
      { token: plannerToken },
    );
    expect(enterOk.status).toBe(200);
  });

  test("planner cannot self-accept their own request via the planner accept-invite path", async () => {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(
      "self-planner@weddly.test",
    );
    const { coupleId } = await bootstrapCouple("self-couple@weddly.test");
    await req(
      "POST",
      "/api/planner/clients",
      { email: "self-couple@weddly.test" },
      { token: plannerToken },
    );

    // The planner-side accept must reject a planner-initiated row (404).
    const selfAccept = await req(
      "POST",
      `/api/planner/invites/${coupleId}/accept`,
      {},
      { token: plannerToken },
    );
    expect(selfAccept.status).toBe(404);
    const row = db
      .prepare("SELECT status FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(plannerId, coupleId) as { status: string };
    expect(row.status).toBe("pending");
  });

  test("couple accept 404s when there is no planner-initiated pending request", async () => {
    const { userId: plannerId } = await bootstrapPlanner("noreq-planner@weddly.test");
    const { token: coupleToken } = await bootstrapCouple("noreq-couple@weddly.test");
    const r = await req(
      "POST",
      `/api/couples/planners/${plannerId}/accept`,
      {},
      { token: coupleToken },
    );
    expect(r.status).toBe(404);
  });

  test("couple decline (revoke) removes the pending request", async () => {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(
      "decline-planner@weddly.test",
    );
    const { token: coupleToken, coupleId } = await bootstrapCouple("decline-couple@weddly.test");
    await req(
      "POST",
      "/api/planner/clients",
      { email: "decline-couple@weddly.test" },
      { token: plannerToken },
    );
    const revoke = await req("DELETE", `/api/couples/planners/${plannerId}`, undefined, {
      token: coupleToken,
    });
    expect(revoke.status).toBe(200);
    const row = db
      .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(plannerId, coupleId);
    expect(row).toBeNull();
  });

  test("couple-initiated invite still lets the PLANNER accept (regression)", async () => {
    const { token: plannerToken } = await bootstrapPlanner("inv-planner@weddly.test");
    const { token: coupleToken, coupleId } = await bootstrapCouple("inv-couple@weddly.test");

    const invite = await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_email: "inv-planner@weddly.test" },
      { token: coupleToken },
    );
    expect(invite.status).toBe(200);

    const invites = await req<{ invites: { couple_id: number }[] }>(
      "GET",
      "/api/planner/invites",
      undefined,
      { token: plannerToken },
    );
    expect(invites.data.invites.some((i) => i.couple_id === coupleId)).toBe(true);

    const accept = await req(
      "POST",
      `/api/planner/invites/${coupleId}/accept`,
      {},
      { token: plannerToken },
    );
    expect(accept.status).toBe(200);
    const enterOk = await req(
      "POST",
      `/api/planner/clients/${coupleId}/enter`,
      {},
      { token: plannerToken },
    );
    expect(enterOk.status).toBe(200);
  });
});
