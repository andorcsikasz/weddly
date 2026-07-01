import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import type { PlannerClientView, PlannerEvent, PlannerStats } from "@shared/types";
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

// Consent withdrawal must cut LIVE access, not just delete the link. A planner
// who is currently inside a workspace (handleEnterClient pins users.couple_id)
// keeps deriving that tenant on every request until couple_id is reset. Both
// the couple-side revoke and the planner-side unlink now clear it.
describe("planner consent withdrawal evicts a live session", () => {
  beforeEach(() => {
    wipeAll();
  });

  async function linkedAndInside(plannerEmail: string, coupleEmail: string) {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(plannerEmail);
    const { token: coupleToken, coupleId } = await bootstrapCouple(coupleEmail);
    // Planner requests, couple approves, planner enters (couple_id pinned).
    await req("POST", "/api/planner/clients", { email: coupleEmail }, { token: plannerToken });
    await req("POST", `/api/couples/planners/${plannerId}/accept`, {}, { token: coupleToken });
    const enter = await req(
      "POST",
      `/api/planner/clients/${coupleId}/enter`,
      {},
      {
        token: plannerToken,
      },
    );
    expect(enter.status).toBe(200);
    const pinned = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(plannerId) as {
      couple_id: number | null;
    };
    expect(pinned.couple_id).toBe(coupleId);
    return { plannerToken, plannerId, coupleToken, coupleId };
  }

  test("couple revoke clears the planner's pinned couple_id and cuts workspace reads", async () => {
    const { plannerToken, plannerId, coupleToken } = await linkedAndInside(
      "evict-planner@weddly.test",
      "evict-couple@weddly.test",
    );

    const revoke = await req("DELETE", `/api/couples/planners/${plannerId}`, undefined, {
      token: coupleToken,
    });
    expect(revoke.status).toBe(200);

    const after = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(plannerId) as {
      couple_id: number | null;
    };
    expect(after.couple_id).toBeNull();

    // The planner's next couple-scoped read no longer resolves a tenant.
    const guests = await req("GET", "/api/guests", undefined, { token: plannerToken });
    expect(guests.status).toBeGreaterThanOrEqual(400);
  });

  test("planner self-unlink clears their own pinned couple_id", async () => {
    const { plannerToken, plannerId, coupleId } = await linkedAndInside(
      "selfunlink-planner@weddly.test",
      "selfunlink-couple@weddly.test",
    );

    const remove = await req("DELETE", `/api/planner/clients/${coupleId}`, undefined, {
      token: plannerToken,
    });
    expect(remove.status).toBe(200);

    const after = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(plannerId) as {
      couple_id: number | null;
    };
    expect(after.couple_id).toBeNull();
  });

  test("revoking one client does not evict a planner sitting in a different workspace", async () => {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(
      "multi-planner@weddly.test",
    );
    const { token: coupleAToken, coupleId: coupleA } = await bootstrapCouple("mp-a@weddly.test");
    const { coupleId: coupleB } = await bootstrapCouple("mp-b@weddly.test");
    // Link + approve both, then enter B.
    for (const [email, coupleId, coupleToken] of [
      ["mp-a@weddly.test", coupleA, coupleAToken],
    ] as const) {
      await req("POST", "/api/planner/clients", { email }, { token: plannerToken });
      await req("POST", `/api/couples/planners/${plannerId}/accept`, {}, { token: coupleToken });
      void coupleId;
    }
    // Link B directly to active so the planner can enter it.
    db.prepare(
      "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, 'active', 'couple', ?)",
    ).run(plannerId, coupleB, Math.floor(Date.now() / 1000));
    await req("POST", `/api/planner/clients/${coupleB}/enter`, {}, { token: plannerToken });

    // Couple A revokes while the planner is inside couple B.
    const revoke = await req("DELETE", `/api/couples/planners/${plannerId}`, undefined, {
      token: coupleAToken,
    });
    expect(revoke.status).toBe(200);

    const after = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(plannerId) as {
      couple_id: number | null;
    };
    expect(after.couple_id).toBe(coupleB);
  });
});

describe("planner client cap on the couple-invite accept path", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("accepting a couple invite is refused once the planner is at capacity", async () => {
    const { token: plannerToken, userId: plannerId } =
      await bootstrapPlanner("cap-planner@weddly.test");
    // Pin the cap at 1 so the second accept must fail.
    db.prepare("UPDATE users SET planner_max_clients = 1 WHERE id = ?").run(plannerId);

    const { token: coupleAToken, coupleId: coupleA } = await bootstrapCouple("cap-a@weddly.test");
    const { token: coupleBToken, coupleId: coupleB } = await bootstrapCouple("cap-b@weddly.test");

    await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_email: "cap-planner@weddly.test" },
      { token: coupleAToken },
    );
    await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_email: "cap-planner@weddly.test" },
      { token: coupleBToken },
    );

    const acceptA = await req(
      "POST",
      `/api/planner/invites/${coupleA}/accept`,
      {},
      {
        token: plannerToken,
      },
    );
    expect(acceptA.status).toBe(200);

    const acceptB = await req(
      "POST",
      `/api/planner/invites/${coupleB}/accept`,
      {},
      {
        token: plannerToken,
      },
    );
    expect(acceptB.status).toBe(422);

    const rowB = db
      .prepare("SELECT status FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(plannerId, coupleB) as { status: string };
    expect(rowB.status).toBe("pending");
  });
});

describe("planner inbox is scoped to active links", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a revoked couple disappears from the planner inbox", async () => {
    const { token: plannerToken, userId: plannerId } = await bootstrapPlanner(
      "inbox-planner@weddly.test",
    );
    const { token: coupleToken, coupleId } = await bootstrapCouple("inbox-couple@weddly.test");
    await req(
      "POST",
      "/api/planner/clients",
      { email: "inbox-couple@weddly.test" },
      { token: plannerToken },
    );
    await req("POST", `/api/couples/planners/${plannerId}/accept`, {}, { token: coupleToken });

    const send = await req(
      "POST",
      `/api/planner/messages/${coupleId}`,
      { subject: "Hello", body_text: "Body", recipient_email: "inbox-couple@weddly.test" },
      { token: plannerToken },
    );
    expect(send.status).toBe(200);

    const before = await req<{ threads: unknown[] }>("GET", "/api/planner/messages", undefined, {
      token: plannerToken,
    });
    expect(before.data.threads.length).toBe(1);

    await req("DELETE", `/api/couples/planners/${plannerId}`, undefined, { token: coupleToken });

    const after = await req<{ threads: unknown[] }>("GET", "/api/planner/messages", undefined, {
      token: plannerToken,
    });
    expect(after.data.threads.length).toBe(0);
  });
});

describe("planner onboarding prefill from waitlist", () => {
  beforeEach(() => {
    wipeAll();
  });

  function seedWaitlist(email: string, selectedPlan: string): void {
    db.prepare(
      `INSERT INTO planner_waitlist
         (full_name, email, phone, company_name, city, message, selected_plan, website,
          weddings_per_year, km_radius, wedding_style_1, wedding_style_2, other_style,
          reference_links, early_bird, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "Eszter Nagy",
      email,
      "+36301234567",
      "Nagy Eszter Events",
      "Budapest",
      "We run 20 weddings a year and need one workspace for all of them.",
      selectedPlan,
      "https://nagyeszter.hu",
      20,
      80,
      "elegant",
      "rustic",
      "industrial",
      "https://instagram.com/nagyeszter",
      1,
      Math.floor(Date.now() / 1000),
    );
  }

  test("GET /api/planner/profile — surfaces the full waitlist application as prefill", async () => {
    const email = "prefill@weddly.test";
    seedWaitlist(email, "unlimited");
    const { token } = await bootstrapPlanner(email);

    const r = await req<{
      planner_plan: string;
      waitlist_prefill: {
        company_name: string | null;
        city: string | null;
        phone: string | null;
        website: string | null;
        bio: string | null;
        weddings_per_year: number | null;
        km_radius: number | null;
        styles: string[];
        reference_links: string | null;
        selected_plan: string | null;
        mapped_plan: string;
      } | null;
    }>("GET", "/api/planner/profile", undefined, { token });

    expect(r.status).toBe(200);
    const wl = r.data.waitlist_prefill;
    expect(wl).not.toBeNull();
    expect(wl?.company_name).toBe("Nagy Eszter Events");
    expect(wl?.city).toBe("Budapest");
    expect(wl?.phone).toBe("+36301234567");
    expect(wl?.website).toBe("https://nagyeszter.hu");
    expect(wl?.bio).toContain("20 weddings");
    expect(wl?.weddings_per_year).toBe(20);
    expect(wl?.km_radius).toBe(80);
    // wedding_style_1/2 + other_style collapse into one clean array.
    expect(wl?.styles).toEqual(["elegant", "rustic", "industrial"]);
    expect(wl?.reference_links).toBe("https://instagram.com/nagyeszter");
    expect(wl?.selected_plan).toBe("unlimited");
    expect(wl?.mapped_plan).toBe("premium"); // unlimited → premium
    // The account plan itself is still the default until the planner confirms.
    expect(r.data.planner_plan).toBe("starter");
  });

  test("PATCH /api/planner/profile — confirm persists the chosen plan, cap, and CRM extras", async () => {
    const email = "confirm@weddly.test";
    seedWaitlist(email, "unlimited");
    const { token } = await bootstrapPlanner(email);

    const patch = await req<{
      planner_plan: string;
      planner_km_radius: number | null;
      planner_weddings_per_year: number | null;
      planner_styles: string[] | null;
      planner_bio: string | null;
    }>(
      "PATCH",
      "/api/planner/profile",
      {
        business_name: "Nagy Eszter Events",
        planner_city: "Budapest",
        planner_bio: "We run 20 weddings a year.",
        planner_weddings_per_year: 20,
        planner_km_radius: 80,
        planner_styles: ["elegant", "rustic"],
        planner_plan: "premium",
      },
      { token },
    );

    expect(patch.status).toBe(200);
    expect(patch.data.planner_plan).toBe("premium");
    expect(patch.data.planner_km_radius).toBe(80);
    expect(patch.data.planner_weddings_per_year).toBe(20);
    expect(patch.data.planner_styles).toEqual(["elegant", "rustic"]);

    // max_clients moves in lockstep with the plan (premium → 10).
    const stats = await req<{ stats: { plan: string; max_clients: number } }>(
      "GET",
      "/api/planner/stats",
      undefined,
      { token },
    );
    expect(stats.data.stats.plan).toBe("premium");
    expect(stats.data.stats.max_clients).toBe(10);
  });

  test("PATCH /api/planner/profile — rejects an invalid plan", async () => {
    const { token } = await bootstrapPlanner("badplan@weddly.test");
    const r = await req("PATCH", "/api/planner/profile", { planner_plan: "enterprise" }, { token });
    expect(r.status).toBe(400);
  });
});

/** Insert a planning task straight into a couple's workspace. */
function insertTask(
  coupleId: number,
  opts: { done?: boolean; dueDate?: string | null } = {},
): void {
  const ts = Date.now();
  db.prepare(
    "INSERT INTO planning_items (couple_id, kind, title, done, due_date, position, created_at, updated_at) VALUES (?, 'task', 'T', ?, ?, 0, ?, ?)",
  ).run(coupleId, opts.done ? 1 : 0, opts.dueDate ?? null, ts, ts);
}

/** Insert a planner↔couple link row directly with a chosen status. */
function linkClient(plannerUserId: number, coupleId: number, status: "active" | "pending"): void {
  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, ?, 'planner', ?)",
  ).run(plannerUserId, coupleId, status, Date.now());
}

describe("planner stats KPI consistency", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("dashboard + roster count ONLY active (consented) clients, never pending links", async () => {
    const { token, userId } = await bootstrapPlanner("kpi-planner@weddly.test");
    const { coupleId: activeCouple } = await bootstrapCouple("kpi-active@weddly.test");
    const { coupleId: pendingCouple } = await bootstrapCouple("kpi-pending@weddly.test");

    linkClient(userId, activeCouple, "active");
    linkClient(userId, pendingCouple, "pending");

    // 3 tasks for the active client, 2 for the pending one. A PENDING link is
    // inert (consent invariant): the pending couple's data must never surface in
    // the planner's stats or roster, so only the 3 active tasks count.
    insertTask(activeCouple, { done: true });
    insertTask(activeCouple, { done: false, dueDate: "2020-01-01" }); // overdue
    insertTask(activeCouple, { done: false });
    insertTask(pendingCouple, { done: false });
    insertTask(pendingCouple, { done: true });

    const r = await req<{ stats: PlannerStats }>("GET", "/api/planner/stats", undefined, { token });
    expect(r.status).toBe(200);
    const { stats } = r.data;

    // Only the active client appears — the pending couple is not leaked.
    expect(stats.per_client.length).toBe(1);
    expect(stats.per_client[0]?.couple_id).toBe(activeCouple);
    const sumTotal = stats.per_client.reduce((acc, c) => acc + c.task_total, 0);
    const sumDone = stats.per_client.reduce((acc, c) => acc + c.task_done, 0);
    const sumOverdue = stats.per_client.reduce((acc, c) => acc + c.task_overdue, 0);

    // The invariant: aggregate KPIs reconcile with the per-client breakdown, and
    // both exclude the pending couple's 2 tasks.
    expect(stats.total_tasks).toBe(3);
    expect(stats.total_tasks).toBe(sumTotal);
    expect(stats.done_tasks).toBe(sumDone);
    expect(stats.overdue_tasks).toBe(sumOverdue);

    // Client cards (handleListClients) count the same active-only set.
    const clients = await req<{ clients: PlannerClientView[] }>(
      "GET",
      "/api/planner/clients",
      undefined,
      { token },
    );
    expect(clients.data.clients.length).toBe(1);
    const cardTotal = clients.data.clients.reduce((acc, c) => acc + c.task_summary.total, 0);
    expect(cardTotal).toBe(stats.total_tasks);
  });
});

describe("planner calendar events", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("requires a planner account", async () => {
    const { token } = await bootstrapCouple("ev-couple@weddly.test");
    const r = await req("GET", "/api/planner/events?from=2026-01-01&to=2026-12-31", undefined, {
      token,
    });
    expect(r.status).toBe(403);
  });

  test("create, list-in-range, update, delete", async () => {
    const { token } = await bootstrapPlanner("ev-planner@weddly.test");

    const created = await req<PlannerEvent>(
      "POST",
      "/api/planner/events",
      {
        title: "Venue scouting",
        event_date: "2026-07-15",
        start_time: "10:30",
        notes: "Bring camera",
      },
      { token },
    );
    expect(created.status).toBe(200);
    expect(created.data.id).toBeGreaterThan(0);
    expect(created.data.title).toBe("Venue scouting");
    expect(created.data.start_time).toBe("10:30");
    expect(created.data.couple_id).toBeNull();
    const eventId = created.data.id;

    // An out-of-range event must NOT appear in the July window.
    await req<PlannerEvent>(
      "POST",
      "/api/planner/events",
      { title: "Far future", event_date: "2027-01-01" },
      { token },
    );

    const inRange = await req<{ events: PlannerEvent[] }>(
      "GET",
      "/api/planner/events?from=2026-07-01&to=2026-07-31",
      undefined,
      { token },
    );
    expect(inRange.status).toBe(200);
    expect(inRange.data.events.length).toBe(1);
    expect(inRange.data.events[0]!.id).toBe(eventId);

    const updated = await req<PlannerEvent>(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { title: "Venue scouting (rescheduled)", start_time: null },
      { token },
    );
    expect(updated.status).toBe(200);
    expect(updated.data.title).toBe("Venue scouting (rescheduled)");
    expect(updated.data.start_time).toBeNull();

    const del = await req<{ ok: boolean }>("DELETE", `/api/planner/events/${eventId}`, undefined, {
      token,
    });
    expect(del.status).toBe(200);
    expect(del.data.ok).toBe(true);

    const after = await req<{ events: PlannerEvent[] }>(
      "GET",
      "/api/planner/events?from=2026-07-01&to=2026-07-31",
      undefined,
      { token },
    );
    expect(after.data.events.length).toBe(0);
  });

  test("end_time round-trips, requires a start, and must follow it", async () => {
    const { token } = await bootstrapPlanner("ev-end@weddly.test");

    // Create with a start+end range.
    const created = await req<PlannerEvent>(
      "POST",
      "/api/planner/events",
      { title: "Client meeting", event_date: "2026-07-20", start_time: "14:00", end_time: "15:30" },
      { token },
    );
    expect(created.status).toBe(200);
    expect(created.data.start_time).toBe("14:00");
    expect(created.data.end_time).toBe("15:30");
    const eventId = created.data.id;

    // end before/equal to start → 400.
    const backwards = await req(
      "POST",
      "/api/planner/events",
      { title: "x", event_date: "2026-07-20", start_time: "14:00", end_time: "14:00" },
      { token },
    );
    expect(backwards.status).toBe(400);

    // end without a start → 400.
    const orphanEnd = await req(
      "POST",
      "/api/planner/events",
      { title: "x", event_date: "2026-07-20", end_time: "15:00" },
      { token },
    );
    expect(orphanEnd.status).toBe(400);

    // Malformed end → 400.
    const badEnd = await req(
      "POST",
      "/api/planner/events",
      { title: "x", event_date: "2026-07-20", start_time: "10:00", end_time: "26:70" },
      { token },
    );
    expect(badEnd.status).toBe(400);

    // PATCH: moving the end is validated against the STORED start.
    const badPatch = await req(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { end_time: "13:00" },
      {
        token,
      },
    );
    expect(badPatch.status).toBe(400);
    const okPatch = await req<PlannerEvent>(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { end_time: "16:00" },
      { token },
    );
    expect(okPatch.status).toBe(200);
    expect(okPatch.data.end_time).toBe("16:00");

    // PATCH: keeping an end while clearing the start is rejected...
    const clearBoth = await req(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { start_time: null, end_time: "16:00" },
      { token },
    );
    expect(clearBoth.status).toBe(400);

    // ...but clearing just the start silently drops the stored end too.
    const cleared = await req<PlannerEvent>(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { start_time: null },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.start_time).toBeNull();
    expect(cleared.data.end_time).toBeNull();
  });

  test("rejects a bad date and a bad time", async () => {
    const { token } = await bootstrapPlanner("ev-bad@weddly.test");
    const badDate = await req(
      "POST",
      "/api/planner/events",
      { title: "x", event_date: "2026-13-40" },
      {
        token,
      },
    );
    expect(badDate.status).toBe(400);
    const badTime = await req(
      "POST",
      "/api/planner/events",
      { title: "x", event_date: "2026-07-15", start_time: "25:99" },
      { token },
    );
    expect(badTime.status).toBe(400);
  });

  test("couple_id must belong to one of the planner's linked clients", async () => {
    const { token, userId } = await bootstrapPlanner("ev-link@weddly.test");
    const { coupleId: linked } = await bootstrapCouple("ev-linked@weddly.test");
    const { coupleId: stranger } = await bootstrapCouple("ev-stranger@weddly.test");
    linkClient(userId, linked, "active");

    // Linked couple → allowed.
    const ok = await req<PlannerEvent>(
      "POST",
      "/api/planner/events",
      { title: "Tasting", event_date: "2026-08-01", couple_id: linked },
      { token },
    );
    expect(ok.status).toBe(200);
    expect(ok.data.couple_id).toBe(linked);

    // Unlinked couple → 400.
    const bad = await req(
      "POST",
      "/api/planner/events",
      { title: "Tasting", event_date: "2026-08-01", couple_id: stranger },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("cross-planner isolation: B cannot see, update, or delete A's event", async () => {
    const { token: tokenA } = await bootstrapPlanner("ev-a@weddly.test");
    const { token: tokenB } = await bootstrapPlanner("ev-b@weddly.test");

    const created = await req<PlannerEvent>(
      "POST",
      "/api/planner/events",
      { title: "A's event", event_date: "2026-09-09" },
      { token: tokenA },
    );
    const eventId = created.data.id;

    // B's range list does not include A's event.
    const bList = await req<{ events: PlannerEvent[] }>(
      "GET",
      "/api/planner/events?from=2026-01-01&to=2026-12-31",
      undefined,
      { token: tokenB },
    );
    expect(bList.data.events.length).toBe(0);

    const bPatch = await req(
      "PATCH",
      `/api/planner/events/${eventId}`,
      { title: "hijack" },
      {
        token: tokenB,
      },
    );
    expect(bPatch.status).toBe(404);

    const bDelete = await req("DELETE", `/api/planner/events/${eventId}`, undefined, {
      token: tokenB,
    });
    expect(bDelete.status).toBe(404);

    // A's event is untouched.
    const aList = await req<{ events: PlannerEvent[] }>(
      "GET",
      "/api/planner/events?from=2026-01-01&to=2026-12-31",
      undefined,
      { token: tokenA },
    );
    expect(aList.data.events.length).toBe(1);
    expect(aList.data.events[0]!.title).toBe("A's event");
  });
});

describe("planner notify-plans", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("requires a planner account", async () => {
    const { token } = await bootstrapCouple("np-couple@weddly.test");
    const r = await req("POST", "/api/planner/notify-plans", {}, { token });
    expect(r.status).toBe(403);
  });

  test("sets planner_plan_notify and is idempotent", async () => {
    const { token, userId } = await bootstrapPlanner("np-planner@weddly.test");

    const first = await req<{ ok: boolean }>("POST", "/api/planner/notify-plans", {}, { token });
    expect(first.status).toBe(200);
    expect(first.data.ok).toBe(true);
    let flag = (
      db.prepare("SELECT planner_plan_notify AS f FROM users WHERE id = ?").get(userId) as {
        f: number;
      }
    ).f;
    expect(flag).toBe(1);

    // Repeat call stays idempotent (still 1, still 200).
    const second = await req<{ ok: boolean }>("POST", "/api/planner/notify-plans", {}, { token });
    expect(second.status).toBe(200);
    flag = (
      db.prepare("SELECT planner_plan_notify AS f FROM users WHERE id = ?").get(userId) as {
        f: number;
      }
    ).f;
    expect(flag).toBe(1);
  });
});

describe("planner hard client unlink", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("removes only this planner's link, leaving the couple intact", async () => {
    const { token, userId } = await bootstrapPlanner("unlink-planner@weddly.test");
    const { coupleId } = await bootstrapCouple("unlink-couple@weddly.test");
    linkClient(userId, coupleId, "active");
    insertTask(coupleId, { done: false });

    const del = await req<{ ok: boolean }>(
      "DELETE",
      `/api/planner/clients/${coupleId}`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.ok).toBe(true);

    // Link gone.
    const link = db
      .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(userId, coupleId);
    expect(link).toBeNull();

    // Couple + their tasks untouched.
    const couple = db.prepare("SELECT id FROM couples WHERE id = ?").get(coupleId);
    expect(couple).not.toBeNull();
    const taskCount = (
      db.prepare("SELECT COUNT(*) AS c FROM planning_items WHERE couple_id = ?").get(coupleId) as {
        c: number;
      }
    ).c;
    expect(taskCount).toBe(1);
  });

  test("404 when the planner has no such link", async () => {
    const { token } = await bootstrapPlanner("unlink-none@weddly.test");
    const { coupleId } = await bootstrapCouple("unlink-none-couple@weddly.test");
    const r = await req("DELETE", `/api/planner/clients/${coupleId}`, undefined, { token });
    expect(r.status).toBe(404);
  });

  test("cross-planner isolation: B cannot unlink A's client", async () => {
    const { token: tokenA, userId: idA } = await bootstrapPlanner("unlink-a@weddly.test");
    const { token: tokenB } = await bootstrapPlanner("unlink-b@weddly.test");
    const { coupleId } = await bootstrapCouple("unlink-shared@weddly.test");
    linkClient(idA, coupleId, "active");

    // B tries to unlink A's client → 404 (no link owned by B).
    const bDel = await req("DELETE", `/api/planner/clients/${coupleId}`, undefined, {
      token: tokenB,
    });
    expect(bDel.status).toBe(404);

    // A's link survives.
    const link = db
      .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(idA, coupleId);
    expect(link).not.toBeNull();

    // A can still unlink their own.
    const aDel = await req<{ ok: boolean }>(
      "DELETE",
      `/api/planner/clients/${coupleId}`,
      undefined,
      { token: tokenA },
    );
    expect(aDel.status).toBe(200);
  });
});

describe("planner avatar + portfolio uploads", () => {
  beforeEach(() => {
    wipeAll();
  });

  const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
  // 1x1 transparent PNG (valid magic bytes for the sniffer).
  const PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
    "base64",
  );
  function pngFile(name = "ref.png"): File {
    return new File([PNG_BYTES], name, { type: "image/png" });
  }
  async function postForm(path: string, token: string, form: FormData): Promise<Response> {
    return fetch(BASE + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "x-test-client-ip": "10.9.9.9" },
      body: form,
    });
  }

  test("POST /api/planner/profile/avatar — stores an uploaded photo on the profile", async () => {
    const { token } = await bootstrapPlanner("avatar@weddly.test");

    const before = await req<{ planner_avatar_url: string | null }>(
      "GET",
      "/api/planner/profile",
      undefined,
      { token },
    );
    expect(before.data.planner_avatar_url).toBeNull();

    const form = new FormData();
    form.append("file", pngFile("me.png"));
    const res = await postForm("/api/planner/profile/avatar", token, form);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as { planner_avatar_url: string | null };
    expect(profile.planner_avatar_url).toContain("/uploads/planners/");
    expect(profile.planner_avatar_url).toContain("/avatar.png");

    // Delete clears it.
    const del = await req<{ planner_avatar_url: string | null }>(
      "DELETE",
      "/api/planner/profile/avatar",
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.planner_avatar_url).toBeNull();
  });

  test("POST /api/planner/profile/avatar — rejects a non-image", async () => {
    const { token } = await bootstrapPlanner("avatar-bad@weddly.test");
    const form = new FormData();
    form.append("file", new File([Buffer.from("not an image")], "x.png", { type: "image/png" }));
    const res = await postForm("/api/planner/profile/avatar", token, form);
    expect(res.status).toBe(415);
  });

  test("portfolio — add (with image + text) then delete", async () => {
    const { token } = await bootstrapPlanner("portfolio@weddly.test");

    const form = new FormData();
    form.append("title", "Anna & Bence");
    form.append("description", "A rustic barn wedding for 120 guests.");
    form.append("file", pngFile());
    const res = await postForm("/api/planner/profile/portfolio", token, form);
    expect(res.status).toBe(200);
    const { portfolio } = (await res.json()) as {
      portfolio: Array<{
        id: number;
        title: string;
        description: string;
        image_url: string | null;
      }>;
    };
    expect(portfolio.length).toBe(1);
    const item = portfolio[0]!;
    expect(item.title).toBe("Anna & Bence");
    expect(item.description).toContain("rustic barn");
    expect(item.image_url).toContain("/uploads/planners/");

    // It rides along on the profile DTO.
    const prof = await req<{ portfolio: Array<{ id: number }> }>(
      "GET",
      "/api/planner/profile",
      undefined,
      { token },
    );
    expect(prof.data.portfolio.length).toBe(1);

    // Delete removes it.
    const del = await req<{ portfolio: unknown[] }>(
      "DELETE",
      `/api/planner/profile/portfolio/${item.id}`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.portfolio.length).toBe(0);
  });

  test("portfolio — text-only entry is allowed (no image)", async () => {
    const { token } = await bootstrapPlanner("portfolio-text@weddly.test");
    const form = new FormData();
    form.append("title", "Reference without a photo");
    form.append("description", "Just a written testimonial.");
    const res = await postForm("/api/planner/profile/portfolio", token, form);
    expect(res.status).toBe(200);
    const { portfolio } = (await res.json()) as {
      portfolio: Array<{ image_url: string | null; title: string }>;
    };
    expect(portfolio.length).toBe(1);
    expect(portfolio[0]!.image_url).toBeNull();
    expect(portfolio[0]!.title).toBe("Reference without a photo");
  });
});
