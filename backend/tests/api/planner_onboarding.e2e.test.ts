import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { PRIVACY_VERSION } from "@shared/legal";
import type { PlannerInvitation } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

/** Register + verify a plain user; returns their token + id + email. */
async function registerVerified(
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ token: string; userId: number; email: string }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Test Person",
    ...extra,
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  return { token: reg.data.token, userId: reg.data.user.id, email };
}

/** Submit the planner waitlist. Anonymous unless a token is supplied. */
async function submitWaitlist(
  email: string,
  opts: { token?: string; selected_plan?: string } = {},
): Promise<{ status: number; entryStatus?: string }> {
  const r = await req<{ entry: { status: string } }>(
    "POST",
    "/api/planners/waitlist",
    {
      full_name: "Planner Person",
      email,
      phone: "+36 1 234 5678",
      privacy_version: PRIVACY_VERSION,
      selected_plan: opts.selected_plan,
    },
    opts.token ? { token: opts.token } : {},
  );
  return { status: r.status, entryStatus: r.data?.entry?.status };
}

function isPlanner(email: string): boolean {
  const row = db.prepare("SELECT user_type FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as
    | { user_type: string | null }
    | undefined;
  return row?.user_type === "planner";
}

// ─── M1: waitlist auto-accept (no admin approval) ────────────────────────────

describe("planner waitlist auto-accept", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("anonymous submit lands as 'accepted' (no admin gate)", async () => {
    const r = await submitWaitlist("anon-planner@weddly.test");
    expect(r.status).toBe(201);
    expect(r.entryStatus).toBe("accepted");
  });

  test("a logged-in submitter is promoted to a planner account immediately", async () => {
    const { token, email } = await registerVerified("soon-planner@weddly.test");
    expect(isPlanner(email)).toBe(false);

    const r = await submitWaitlist(email, { token, selected_plan: "pro" });
    expect(r.status).toBe(201);
    expect(isPlanner(email)).toBe(true);

    // Plan/cap stay at the default until the planner confirms one in onboarding
    // (the waitlist choice only SUGGESTS a plan via the profile prefill).
    const stats = await req<{ stats: { plan: string; max_clients: number } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(stats.status).toBe(200);
    expect(stats.data.stats.plan).toBe("starter");
    expect(stats.data.stats.max_clients).toBe(4);
  });

  test("a brand-new signup whose email is on the waitlist auto-promotes at register", async () => {
    // Apply anonymously first, then register with the same email.
    await submitWaitlist("future@weddly.test", { selected_plan: "unlimited" });
    const { token, email } = await registerVerified("future@weddly.test");
    expect(isPlanner(email)).toBe(true);
    const stats = await req<{ stats: { plan: string } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    // Promoted to a planner; plan stays default until confirmed in onboarding.
    expect(stats.data.stats.plan).toBe("starter");
  });
});

// ─── M2: invite-by-email → signup → couple approval → planner edit ───────────

/** Bootstrap a planner via the (now self-serve) waitlist. */
async function bootstrapPlanner(
  email = "agency@weddly.test",
): Promise<{ token: string; userId: number; email: string }> {
  const user = await registerVerified(email);
  await submitWaitlist(email, { token: user.token, selected_plan: "pro" });
  expect(isPlanner(email)).toBe(true);
  return user;
}

describe("planner email invitations", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("full flow: invite a stranger → they sign up + onboard → couple approves → planner enters", async () => {
    const planner = await bootstrapPlanner();

    // 1. Planner invites a not-yet-registered email.
    const invite = await req<{ kind: string; invitation: PlannerInvitation }>(
      "POST",
      "/api/planner/invitations",
      { email: "bride@weddly.test" },
      { token: planner.token },
    );
    expect(invite.status).toBe(200);
    expect(invite.data.kind).toBe("invite");
    expect(invite.data.invitation.status).toBe("pending");

    // It shows up in the planner's invitation list.
    const list = await req<{ invitations: PlannerInvitation[] }>(
      "GET",
      "/api/planner/invitations",
      undefined,
      { token: planner.token },
    );
    expect(list.data.invitations.length).toBe(1);
    expect(list.data.invitations[0]?.email).toBe("bride@weddly.test");

    // Public token lookup resolves the inviting planner.
    const token = (
      db.prepare("SELECT token FROM planner_invitations WHERE LOWER(email) = ?").get(
        "bride@weddly.test",
      ) as { token: string }
    ).token;
    const lookup = await req<{ planner_label: string; email: string }>(
      "GET",
      `/api/planner-invites/${token}`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.data.email).toBe("bride@weddly.test");

    // 2. The invitee registers (carrying the token) and onboards a workspace.
    const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
      email: "bride@weddly.test",
      password: "supersafe123",
      full_name: "Bride",
      planner_invite: token,
    });
    expect(reg.status).toBe(201);
    await verifyUserEmail("bride@weddly.test");
    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Bride & Groom",
        wedding_date: "2027-05-01",
        target_guest_count: 60,
        budget_ceiling_huf: 4_000_000,
        style_tags: [],
      },
      { token: reg.data.token },
    );
    expect(ob.status).toBe(201);
    const coupleId = ob.data.couple.id;

    // The onboarding hook created a PENDING planner link (initiated_by planner).
    const link = db
      .prepare(
        "SELECT status, initiated_by FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?",
      )
      .get(planner.userId, coupleId) as { status: string; initiated_by: string } | undefined;
    expect(link?.status).toBe("pending");
    expect(link?.initiated_by).toBe("planner");

    // The invitation is now marked accepted.
    const invStatus = (
      db.prepare("SELECT status FROM planner_invitations WHERE LOWER(email) = ?").get(
        "bride@weddly.test",
      ) as { status: string }
    ).status;
    expect(invStatus).toBe("accepted");

    // 3. The planner CANNOT enter yet — consent still required.
    const enterBefore = await req("POST", `/api/planner/clients/${coupleId}/enter`, {}, {
      token: planner.token,
    });
    expect(enterBefore.status).toBe(403);

    // 4. The couple sees the pending request and approves it.
    const couplePlanners = await req<{ planners: Array<{ planner_user_id: number; status: string }> }>(
      "GET",
      "/api/couples/planners",
      undefined,
      { token: reg.data.token },
    );
    expect(couplePlanners.data.planners[0]?.status).toBe("pending");
    const accept = await req(
      "POST",
      `/api/couples/planners/${planner.userId}/accept`,
      {},
      { token: reg.data.token },
    );
    expect(accept.status).toBe(200);

    // 5. The planner can now enter and gets full edit access (couple_id set).
    const enterAfter = await req<{ couple: { id: number } }>(
      "POST",
      `/api/planner/clients/${coupleId}/enter`,
      {},
      { token: planner.token },
    );
    expect(enterAfter.status).toBe(200);
    expect(enterAfter.data.couple.id).toBe(coupleId);
  });

  test("inviting an email that already has a workspace falls through to a consent request", async () => {
    const planner = await bootstrapPlanner("agency2@weddly.test");
    const { coupleId } = await bootstrapCouple("existing@weddly.test");

    const r = await req<{ kind: string; couple_id: number }>(
      "POST",
      "/api/planner/invitations",
      { email: "existing@weddly.test" },
      { token: planner.token },
    );
    expect(r.status).toBe(200);
    expect(r.data.kind).toBe("request");
    expect(r.data.couple_id).toBe(coupleId);

    const link = db
      .prepare("SELECT status, initiated_by FROM planner_clients WHERE couple_id = ?")
      .get(coupleId) as { status: string; initiated_by: string } | undefined;
    expect(link?.status).toBe("pending");
    expect(link?.initiated_by).toBe("planner");
  });

  test("duplicate invitation to the same email is rejected (409)", async () => {
    const planner = await bootstrapPlanner("agency3@weddly.test");
    const first = await req("POST", "/api/planner/invitations", { email: "dup@weddly.test" }, {
      token: planner.token,
    });
    expect(first.status).toBe(200);
    const second = await req("POST", "/api/planner/invitations", { email: "dup@weddly.test" }, {
      token: planner.token,
    });
    expect(second.status).toBe(409);
  });

  test("pending invitations count against the plan cap", async () => {
    // Default starter cap = 4. Invite 4 distinct strangers, then the 5th 422s.
    const planner = await bootstrapPlanner("agency4@weddly.test");
    for (let i = 0; i < 4; i++) {
      const r = await req("POST", "/api/planner/invitations", { email: `c${i}@weddly.test` }, {
        token: planner.token,
      });
      expect(r.status).toBe(200);
    }
    const over = await req("POST", "/api/planner/invitations", { email: "c4@weddly.test" }, {
      token: planner.token,
    });
    expect(over.status).toBe(422);
  });

  test("revoking an invitation frees the seat and hides it from the list", async () => {
    const planner = await bootstrapPlanner("agency5@weddly.test");
    const inv = await req<{ invitation: PlannerInvitation }>(
      "POST",
      "/api/planner/invitations",
      { email: "revoke-me@weddly.test" },
      { token: planner.token },
    );
    const id = inv.data.invitation.id;
    const del = await req("DELETE", `/api/planner/invitations/${id}`, undefined, {
      token: planner.token,
    });
    expect(del.status).toBe(200);
    const list = await req<{ invitations: PlannerInvitation[] }>(
      "GET",
      "/api/planner/invitations",
      undefined,
      { token: planner.token },
    );
    expect(list.data.invitations.length).toBe(0);
  });

  test("a non-planner cannot send invitations", async () => {
    const { token } = await bootstrapCouple("notaplanner@weddly.test");
    const r = await req("POST", "/api/planner/invitations", { email: "x@weddly.test" }, { token });
    expect(r.status).toBe(403);
  });
});
