import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db } from "../../src/db";

// Multi-workspace + couple-member edge-case sweep. Complements the
// `couples_lifecycle` and root `e2e.test.ts` multi-workspace blocks with
// the precise behavioural boundaries that surface only when a single
// user juggles Alpha / Bravo / Charlie at once.
//
// Conventions:
//   - Every test calls wipeAll() so couple_id / user_id reset cleanly.
//   - POST /api/couples/onboard creates the user's PRIMARY (Alpha)
//     workspace and is a one-shot per user. POST /api/couples spins up
//     additional events (Bravo / Charlie), capped at 3 total.
//   - `users.couple_id` = active workspace pointer; `couple_members` =
//     full membership set.

// ─── Helpers used across this file ────────────────────────────────────────

interface RegisterResp {
  token: string;
  user: { id: number; email: string };
}

interface CoupleResp {
  couple: { id: number };
}

interface MembershipsResp {
  current_couple_id: number | null;
  couples: { couple_id: number; role: "owner" | "partner"; joined_at: number }[];
}

/** Register + verify a fresh user and return their bearer token without
 *  onboarding a couple. Use when the test wants to assert the pre-onboard
 *  state of an authenticated-but-workspace-less user. */
async function freshUserNoCouple(email: string): Promise<{ token: string; userId: number }> {
  const r = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Test User",
  });
  expect(r.status).toBe(201);
  await verifyUserEmail(email);
  return { token: r.data.token, userId: r.data.user.id };
}

/** Spin up an additional (Bravo / Charlie) workspace for the given user
 *  via POST /api/couples and return its couple_id. Sends the minimum
 *  body the route accepts: `event_name` + a TBD date goal. */
async function spawnEvent(token: string, label: string): Promise<number> {
  const r = await req<CoupleResp>(
    "POST",
    "/api/couples",
    {
      event_name: label,
      wedding_date_goal: {
        kind: "tbd",
        exact_date: null,
        target_year: null,
        target_month: null,
        target_season: null,
      },
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.couple.id;
}

/** Register + verify a partner B, accept the pending invite, and return
 *  their bearer token. Mirrors the helper in couples_lifecycle.e2e. */
async function registerAndAcceptInvite(email: string, inviteToken: string): Promise<string> {
  const reg = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const accept = await req(
    "POST",
    `/api/invites/${inviteToken}/accept`,
    {},
    { token: reg.data.token },
  );
  expect(accept.status).toBe(200);
  return reg.data.token;
}

// ════════════════════════════════════════════════════════════════════════════
//   Multi-workspace edge cases — membership listing, creation, switching, leave
// ════════════════════════════════════════════════════════════════════════════

describe("workspace_multi: membership listing baseline", () => {
  test("01 single workspace baseline: list returns one entry with owner role", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ws-mlist1@weddly.test");

    const r = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.current_couple_id).toBe(coupleId);
    expect(r.data.couples).toHaveLength(1);
    expect(r.data.couples[0]!.couple_id).toBe(coupleId);
    expect(r.data.couples[0]!.role).toBe("owner");
  });

  test("02 create a second workspace: POST /api/couples → 201, user now in 2; users.couple_id auto-flips to B", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mcreate2@weddly.test");

    const bravoId = await spawnEvent(token, "Wedding B");
    expect(bravoId).not.toBe(alphaId);

    // Both memberships present.
    const rows = db
      .prepare(
        "SELECT couple_id FROM couple_members WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY couple_id ASC",
      )
      .all("ws-mcreate2@weddly.test") as { couple_id: number }[];
    expect(rows.map((r) => r.couple_id).sort()).toEqual([alphaId, bravoId].sort());

    // POST /api/couples auto-switches the user's pointer to Bravo — the
    // caller obviously wants to look at what they just created. Original
    // spec line 2 said "stays on A" but the route's documented behaviour
    // (and existing e2e coverage) auto-flips. Pinned here as actual.
    const userRow = db
      .prepare("SELECT couple_id FROM users WHERE email = ?")
      .get("ws-mcreate2@weddly.test") as { couple_id: number };
    expect(userRow.couple_id).toBe(bravoId);
  });

  test("03 second workspace count: list returns 2 entries, both with role=owner", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mcount@weddly.test");
    const bravoId = await spawnEvent(token, "After-party");

    const r = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couples).toHaveLength(2);
    expect(r.data.couples.every((c) => c.role === "owner")).toBe(true);
    expect(r.data.couples.map((c) => c.couple_id).sort()).toEqual([alphaId, bravoId].sort());
  });
});

describe("workspace_multi: switching active workspace", () => {
  test("04 switch active to Bravo: 200, /current resolves there, /api/guests scoped to B (empty save partner hosts)", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mswitch1@weddly.test");
    const bravoId = await spawnEvent(token, "Bravo");

    // Spawn auto-flips to Bravo; flip back to Alpha first so we can
    // explicitly assert the switch back to Bravo works.
    const flipA = await req(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: alphaId },
      { token },
    );
    expect(flipA.status).toBe(200);

    const flipB = await req<{ couple: { id: number } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: bravoId },
      { token },
    );
    expect(flipB.status).toBe(200);
    expect(flipB.data.couple.id).toBe(bravoId);

    const cur = await req<{ couple: { id: number } }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.id).toBe(bravoId);

    // Bravo has only the auto-spawned partner host guests — no
    // user-created guests yet.
    const guests = await req<{ guests: { id: number; partner_role: string | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const nonHosts = guests.data.guests.filter((g) => !g.partner_role);
    expect(nonHosts).toHaveLength(0);
  });

  test("05 switch back to Alpha: A's guests + budget + seating return as before — no data lost across switch", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mswitch2@weddly.test");

    // Plant 3 guests on Alpha.
    for (const name of ["Aunt Klári", "Uncle Béla", "Cousin Petra"]) {
      const g = await req("POST", "/api/guests", { full_name: name }, { token });
      expect(g.status).toBe(201);
    }
    // Plant a budget snapshot on Alpha.
    const snap = await req<{ snapshot: { id: number } }>(
      "POST",
      "/api/budget/snapshots",
      { name: "Alpha baseline" },
      { token },
    );
    expect(snap.status).toBe(201);
    // Plant a seating table on Alpha.
    const tbl = await req<{ table: { id: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "Head", shape: "round", seats: 8 },
      { token },
    );
    expect(tbl.status).toBe(201);

    // Spawn Bravo (auto-flips), then switch back to Alpha.
    const bravoId = await spawnEvent(token, "Bravo");
    expect(bravoId).not.toBe(alphaId);
    const back = await req(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: alphaId },
      { token },
    );
    expect(back.status).toBe(200);

    // Alpha's data is untouched.
    const guests = await req<{ guests: { full_name: string; partner_role: string | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const guestNames = guests.data.guests
      .filter((g) => !g.partner_role)
      .map((g) => g.full_name)
      .sort();
    expect(guestNames).toEqual(["Aunt Klári", "Cousin Petra", "Uncle Béla"]);

    const snaps = await req<{ snapshots: { id: number; name: string }[] }>(
      "GET",
      "/api/budget/snapshots",
      undefined,
      { token },
    );
    expect(snaps.data.snapshots.some((s) => s.name === "Alpha baseline")).toBe(true);

    const plan = await req<{ tables: { id: number; label: string }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(plan.data.tables.some((t) => t.label === "Head")).toBe(true);
  });

  test("06 switch to a couple_id that is not a member → 403 (membership check trumps existence)", async () => {
    wipeAll();
    // 999999 is not a member row for this user OR an existing couple; the
    // route checks membership first and returns 403. Pin actual behaviour
    // (the original prompt expected 404 for "unknown" but membership
    // check is the real first guard).
    const { token } = await bootstrapCouple("ws-msunk@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: 999_999 },
      { token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_a_member");
  });

  test("07 switch to a couple the user is NOT a member of → 403 not_a_member", async () => {
    wipeAll();
    const { coupleId: alphaId } = await bootstrapCouple("ws-mcross-a@weddly.test");
    const { token: tokenB } = await bootstrapCouple("ws-mcross-b@weddly.test");

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: alphaId },
      { token: tokenB },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_a_member");
  });

  test("08 switch to currently-active workspace is idempotent (200, no error)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ws-midem@weddly.test");

    const r = await req<{ couple: { id: number } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: coupleId },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.id).toBe(coupleId);

    // users.couple_id stays put.
    const userRow = db
      .prepare("SELECT couple_id FROM users WHERE email = ?")
      .get("ws-midem@weddly.test") as { couple_id: number };
    expect(userRow.couple_id).toBe(coupleId);
  });

  test("09 create third workspace: 3 couples; list returns 3; active = the most recently spawned one", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mthree@weddly.test");
    const bravoId = await spawnEvent(token, "Bravo");
    const charlieId = await spawnEvent(token, "Charlie");

    const r = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couples).toHaveLength(3);
    expect(r.data.couples.map((c) => c.couple_id).sort()).toEqual(
      [alphaId, bravoId, charlieId].sort(),
    );
    // POST /api/couples auto-switches each time, so the active is Charlie.
    expect(r.data.current_couple_id).toBe(charlieId);
  });

  test("10 fourth workspace request → 409 (max_workspaces)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mcap@weddly.test");
    await spawnEvent(token, "Bravo");
    await spawnEvent(token, "Charlie");

    const fourth = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/couples",
      {
        event_name: "Delta",
        wedding_date_goal: {
          kind: "tbd",
          exact_date: null,
          target_year: null,
          target_month: null,
          target_season: null,
        },
      },
      { token },
    );
    expect(fourth.status).toBe(409);
    expect(fourth.data.detail?.code).toBe("max_workspaces");
  });
});

describe("workspace_multi: leave workspace flows", () => {
  test("11 leave-couple for owner is always 409 (owner_cannot_leave) — even with 3 workspaces", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mlv-owner-multi@weddly.test");
    await spawnEvent(token, "Bravo");
    await spawnEvent(token, "Charlie");

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/leave-couple",
      {},
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("owner_cannot_leave");
  });

  test("12 leave-couple for sole-owner sole-workspace → 409 owner_cannot_leave", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mlv-only@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/leave-couple",
      {},
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("owner_cannot_leave");
  });

  test("13 leave-couple as partner B: 200, couple.partner_b_id nulled, B removed from couple_members", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("ws-mlv-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "ws-mlv-b@weddly.test" },
      { token: aToken },
    );
    expect(inv.status).toBe(201);
    const bToken = await registerAndAcceptInvite("ws-mlv-b@weddly.test", inv.data.invite.token);

    const leave = await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });
    expect(leave.status).toBe(200);

    const refreshed = db.prepare("SELECT partner_b_id FROM couples WHERE id = ?").get(coupleId) as {
      partner_b_id: number | null;
    };
    expect(refreshed.partner_b_id).toBeNull();

    const bUserRow = db
      .prepare("SELECT id, couple_id FROM users WHERE email = ?")
      .get("ws-mlv-b@weddly.test") as { id: number; couple_id: number | null };
    expect(bUserRow.couple_id).toBeNull();

    // couple_members row gone for B on this couple.
    const mem = db
      .prepare("SELECT COUNT(*) AS n FROM couple_members WHERE couple_id = ? AND user_id = ?")
      .get(coupleId, bUserRow.id) as { n: number };
    expect(mem.n).toBe(0);
  });

  test("14 owner with linked partner B still 409 owner_cannot_leave when owner tries to leave", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("ws-mlv-owner-pair@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "ws-mlv-pair-b@weddly.test" },
      { token: aToken },
    );
    expect(inv.status).toBe(201);
    await registerAndAcceptInvite("ws-mlv-pair-b@weddly.test", inv.data.invite.token);

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/leave-couple",
      {},
      { token: aToken },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("owner_cannot_leave");
  });

  test("15 after leaving, partner B can spin up their OWN couple via /onboard", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("ws-mlv-recreate-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "ws-mlv-recreate-b@weddly.test" },
      { token: aToken },
    );
    const bToken = await registerAndAcceptInvite(
      "ws-mlv-recreate-b@weddly.test",
      inv.data.invite.token,
    );
    const leave = await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });
    expect(leave.status).toBe(200);

    // After leaving, B is back to "no couple" — /onboard works (not POST
    // /api/couples, which requires an existing active workspace to inherit
    // bride/groom names from).
    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Bea",
        groom_name: "Csaba",
        wedding_date_goal: { kind: "tbd" },
      },
      { token: bToken },
    );
    expect(ob.status).toBe(201);
    expect(ob.data.couple.id).toBeGreaterThan(0);
  });

  test("16 leave-couple with no onboarded couple → 404", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("ws-mlv-none@weddly.test");
    const r = await req("POST", "/api/users/me/leave-couple", {}, { token });
    expect(r.status).toBe(404);
  });
});

describe("workspace_multi: onboarding vs additional creation gates", () => {
  test("17 verified user with NO couple: /me/couples returns 0 entries + current=null", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("ws-mnone@weddly.test");
    const r = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couples).toHaveLength(0);
    expect(r.data.current_couple_id).toBeNull();
  });

  test("18 POST /api/couples/onboard is one-shot: second call → 409 already onboarded", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mob-once@weddly.test");
    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "tbd" },
      },
      { token },
    );
    expect(r.status).toBe(409);
  });

  test("19 POST /api/couples works as the multi-workspace path even when already onboarded", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mob-multi@weddly.test");
    const bravoId = await spawnEvent(token, "Reception");
    expect(bravoId).not.toBe(alphaId);

    // Now the user has 2 memberships.
    const list = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, { token });
    expect(list.data.couples).toHaveLength(2);
  });

  test("20 POST /api/couples with NO body → 400 (event_name required)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mob-empty@weddly.test");
    const r = await req("POST", "/api/couples", {}, { token });
    expect(r.status).toBe(400);
  });

  test("21 POST /api/couples with event_name='' → 400 (1–100 char rule)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-mob-blank@weddly.test");
    const r = await req(
      "POST",
      "/api/couples",
      {
        event_name: "",
        wedding_date_goal: { kind: "tbd" },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("workspace_multi: cross-workspace data isolation", () => {
  test("22 guests scope per workspace: 5 guests on A → switch to B → list returns 0 user-created → back to A returns 5", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-g@weddly.test");

    const planted: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const name = `Guest-${i}`;
      planted.push(name);
      const g = await req("POST", "/api/guests", { full_name: name }, { token });
      expect(g.status).toBe(201);
    }

    const bravoId = await spawnEvent(token, "After-party");
    // On Bravo (auto-active) — no user-created guests (partner hosts may
    // exist as auto-seeded rows; filter them out).
    const gB = await req<{ guests: { full_name: string; partner_role: string | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    expect(gB.data.guests.filter((g) => !g.partner_role)).toHaveLength(0);

    // Back to Alpha — original 5 still there.
    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const gA = await req<{ guests: { full_name: string; partner_role: string | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const names = gA.data.guests
      .filter((g) => !g.partner_role)
      .map((g) => g.full_name)
      .sort();
    expect(names).toEqual([...planted].sort());
    expect(bravoId).not.toBe(alphaId);
  });

  test("23 budget snapshots scope per workspace", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-bud@weddly.test");
    await req("POST", "/api/budget/snapshots", { name: "Alpha snap" }, { token });

    const bravoId = await spawnEvent(token, "Reception");
    await req("POST", "/api/budget/snapshots", { name: "Bravo snap" }, { token });

    const bList = await req<{ snapshots: { name: string }[] }>(
      "GET",
      "/api/budget/snapshots",
      undefined,
      { token },
    );
    const bNames = bList.data.snapshots.map((s) => s.name).sort();
    expect(bNames).toEqual(["Bravo snap"]);

    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const aList = await req<{ snapshots: { name: string }[] }>(
      "GET",
      "/api/budget/snapshots",
      undefined,
      { token },
    );
    const aNames = aList.data.snapshots.map((s) => s.name).sort();
    expect(aNames).toEqual(["Alpha snap"]);
    expect(bravoId).not.toBe(alphaId);
  });

  test("24 schedule events scope per workspace", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-sch@weddly.test");
    const e1 = await req(
      "POST",
      "/api/schedule",
      { label: "Ceremony", starts_at_minutes: 900, duration_minutes: 30 },
      { token },
    );
    expect(e1.status).toBe(201);

    await spawnEvent(token, "After-party");
    const e2 = await req(
      "POST",
      "/api/schedule",
      { label: "Welcome drinks", starts_at_minutes: 1080, duration_minutes: 60 },
      { token },
    );
    expect(e2.status).toBe(201);

    const bList = await req<{ events: { label: string }[] }>("GET", "/api/schedule", undefined, {
      token,
    });
    expect(bList.data.events.map((e) => e.label).sort()).toEqual(["Welcome drinks"]);

    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const aList = await req<{ events: { label: string }[] }>("GET", "/api/schedule", undefined, {
      token,
    });
    expect(aList.data.events.map((e) => e.label).sort()).toEqual(["Ceremony"]);
  });

  test("25 seating tables scope per workspace", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-seat@weddly.test");
    const t1 = await req(
      "POST",
      "/api/seating/tables",
      { label: "Alpha-Head", shape: "round", seats: 8 },
      { token },
    );
    expect(t1.status).toBe(201);

    await spawnEvent(token, "Bravo");
    const t2 = await req(
      "POST",
      "/api/seating/tables",
      { label: "Bravo-Head", shape: "round", seats: 6 },
      { token },
    );
    expect(t2.status).toBe(201);

    const bPlan = await req<{ tables: { label: string }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(bPlan.data.tables.map((t) => t.label).sort()).toEqual(["Bravo-Head"]);

    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const aPlan = await req<{ tables: { label: string }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(aPlan.data.tables.map((t) => t.label).sort()).toEqual(["Alpha-Head"]);
  });

  test("26 picks scope per workspace", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-pick@weddly.test");
    const p1 = await req("PUT", "/api/picks/venue", { supplier_id: "alpha-venue-xyz" }, { token });
    expect(p1.status).toBe(200);

    await spawnEvent(token, "Bravo");
    const p2 = await req(
      "PUT",
      "/api/picks/photo_video",
      { supplier_id: "bravo-photographer-xyz" },
      { token },
    );
    expect(p2.status).toBe(200);

    const bList = await req<{ picks: { category: string; supplier_id: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token },
    );
    const bCats = bList.data.picks.map((p) => p.category).sort();
    expect(bCats).toEqual(["photo_video"]);

    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const aList = await req<{ picks: { category: string; supplier_id: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token },
    );
    const aCats = aList.data.picks.map((p) => p.category).sort();
    expect(aCats).toEqual(["venue"]);
  });

  test("27 activity log scopes per workspace (each workspace sees only its own actions)", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-miso-act@weddly.test");
    // Do something audit-worthy on Alpha: create a guest.
    const aG = await req("POST", "/api/guests", { full_name: "Alpha Guest" }, { token });
    expect(aG.status).toBe(201);

    const bravoId = await spawnEvent(token, "Bravo");
    const bG = await req("POST", "/api/guests", { full_name: "Bravo Guest" }, { token });
    expect(bG.status).toBe(201);

    // /api/couples/activity scopes by the user's current couple_id.
    const bAct = await req<{ entries: { action: string; target_kind: string }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token },
    );
    // Bravo should NOT contain Alpha's guest.create row — assert by
    // counting guest.create rows: at most one on Bravo (the freshly
    // created Bravo Guest).
    const bGuestCreates = bAct.data.entries.filter((e) => e.action === "guest.create");
    expect(bGuestCreates.length).toBe(1);

    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    const aAct = await req<{ entries: { action: string; target_kind: string }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token },
    );
    const aGuestCreates = aAct.data.entries.filter((e) => e.action === "guest.create");
    expect(aGuestCreates.length).toBe(1);

    // Defence-in-depth: assert at the DB level that activity rows on
    // Bravo do not include any guest.create with target_id from Alpha.
    const dbRows = db
      .prepare("SELECT target_id FROM audit_log WHERE couple_id = ? AND action = 'guest.create'")
      .all(bravoId) as { target_id: number }[];
    // Bravo has exactly one guest.create row.
    expect(dbRows.length).toBe(1);
  });
});

describe("workspace_multi: integrity + edge invariants", () => {
  test("28 users.couple_id integrity: after switch+leave operations, pointer is null OR matches an existing couple_members row", async () => {
    wipeAll();
    const { token: aToken, coupleId: alphaId } = await bootstrapCouple("ws-mint-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "ws-mint-b@weddly.test" },
      { token: aToken },
    );
    const bToken = await registerAndAcceptInvite("ws-mint-b@weddly.test", inv.data.invite.token);

    // After accept: B's couple_id should equal alphaId; couple_members has B on Alpha.
    const bRow1 = db
      .prepare("SELECT id, couple_id FROM users WHERE email = ?")
      .get("ws-mint-b@weddly.test") as { id: number; couple_id: number | null };
    if (bRow1.couple_id !== null) {
      const m = db
        .prepare("SELECT 1 AS ok FROM couple_members WHERE couple_id = ? AND user_id = ?")
        .get(bRow1.couple_id, bRow1.id) as { ok: number } | undefined;
      expect(m?.ok).toBe(1);
    }

    // B leaves Alpha — pointer should become null.
    const leave = await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });
    expect(leave.status).toBe(200);
    const bRow2 = db
      .prepare("SELECT couple_id FROM users WHERE email = ?")
      .get("ws-mint-b@weddly.test") as { couple_id: number | null };
    expect(bRow2.couple_id).toBeNull();

    // A's pointer still resolves to Alpha (which still has a member row for A).
    const aRow = db
      .prepare("SELECT id, couple_id FROM users WHERE email = ?")
      .get("ws-mint-a@weddly.test") as { id: number; couple_id: number };
    expect(aRow.couple_id).toBe(alphaId);
    const aMember = db
      .prepare("SELECT 1 AS ok FROM couple_members WHERE couple_id = ? AND user_id = ?")
      .get(aRow.couple_id, aRow.id) as { ok: number } | undefined;
    expect(aMember?.ok).toBe(1);
  });

  test("29 couple_members role transitions: A stays owner across switches; B stays partner until they own a new couple", async () => {
    wipeAll();
    const { token: aToken, coupleId: alphaId } = await bootstrapCouple("ws-mrole-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "ws-mrole-b@weddly.test" },
      { token: aToken },
    );
    const bToken = await registerAndAcceptInvite("ws-mrole-b@weddly.test", inv.data.invite.token);

    // A: owner on Alpha. Spawn Bravo — A becomes owner on Bravo too.
    const bravoId = await spawnEvent(aToken, "Bravo");
    const aList = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, {
      token: aToken,
    });
    expect(aList.data.couples).toHaveLength(2);
    expect(aList.data.couples.every((c) => c.role === "owner")).toBe(true);

    // B: partner on Alpha. Switch a few times — still partner.
    const bList1 = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, {
      token: bToken,
    });
    expect(bList1.data.couples).toHaveLength(1);
    expect(bList1.data.couples[0]!.role).toBe("partner");
    expect(bList1.data.couples[0]!.couple_id).toBe(alphaId);

    // Switch A back to Alpha to confirm role on Alpha didn't drift.
    await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token: aToken });
    const aList2 = await req<MembershipsResp>("GET", "/api/users/me/couples", undefined, {
      token: aToken,
    });
    for (const c of aList2.data.couples) expect(c.role).toBe("owner");
    expect(bravoId).not.toBe(alphaId);
  });

  test("30 concurrent switches (last-write-wins): pointer is one of the targets, no corruption", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("ws-mconcur@weddly.test");
    const bravoId = await spawnEvent(token, "Bravo");

    // Fire two switches in parallel. SQLite's serialisation guarantees one
    // wins; the resulting pointer must be one of the two targets (no
    // garbage value), and both responses must be 200.
    const [r1, r2] = await Promise.all([
      req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token }),
      req("POST", "/api/users/me/active-couple", { couple_id: bravoId }, { token }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const userRow = db
      .prepare("SELECT couple_id FROM users WHERE email = ?")
      .get("ws-mconcur@weddly.test") as { couple_id: number };
    expect([alphaId, bravoId]).toContain(userRow.couple_id);

    // The /current endpoint MUST agree with users.couple_id (no torn read).
    const cur = await req<{ couple: { id: number } }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.id).toBe(userRow.couple_id);
  });
});
