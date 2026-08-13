import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, registerAndVerify, bootstrapCouple } from "../helpers";
import { issueSession } from "../../src/auth/session";
import { db, now } from "../../src/db";

// ────────────────────────────────────────────────────────────────────────────
//   Focused state-graph coverage for the partner-invite lifecycle: create,
//   accept (plain), accept-merge (with solo-workspace purge), cancel, lookup,
//   incoming list, active-couple switch, and leave-couple. Each test wipeAll()s
//   first so couple_id / user_id sequences reset cleanly and tests stay order-
//   independent.
//
//   Notes pinned by hand-walking handlers in backend/src/routes/couples.ts
//   and backend/src/routes/user_couple.ts:
//     * INVITE_TTL is 7 days (shared/types.ts INVITE_TTL_MS), not 14.
//     * Accept-merge requires the literal string "MERGE" (case-sensitive).
//     * Cancel is idempotent — already-consumed invite returns 200/cancelled:false
//       rather than 409.
//     * Public lookup of a consumed token returns 410 "already used".
//     * Switching to the workspace you're already on returns 200 (idempotent).
//     * Owner leave returns 409 with code "owner_cannot_leave".
//     * /leave-couple when the user has no couple returns 404 "No couple to leave".
// ────────────────────────────────────────────────────────────────────────────

/** Register + verify a fresh user, return their bearer + user id, no couple. */
async function freshUserNoCouple(email: string): Promise<{ token: string; userId: number }> {
  const r = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Tamás Kovács",
  });
  expect(r.status).toBe(201);
  return { token: r.data.token, userId: r.data.user.id };
}

/** An UNVERIFIED user holding a session, written straight to the DB.
 *  Register no longer mints a `users` row (it parks a pending signup and the
 *  verify click creates the account), so a session for an unverified address
 *  can only be built here. Keeps the "accept doesn't check verified_email"
 *  assertion below honest. */
function freshUserUnverified(email: string): { token: string; userId: number } {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, 1, ?, ?)`,
    )
    .run(email.trim().toLowerCase(), "x", "Unverified User", ts, ts);
  const userId = Number(info.lastInsertRowid);
  return { token: issueSession(userId, "activation"), userId };
}

/** Convenience: create a partner invite from the owner-A workspace. */
async function createInvite(aToken: string, invitedEmail: string): Promise<string> {
  const inv = await req<{ invite: { token: string } }>(
    "POST",
    "/api/couples/invites",
    { invited_email: invitedEmail },
    { token: aToken },
  );
  expect(inv.status).toBe(201);
  return inv.data.invite.token;
}

// ════════════════════════════════════════════════════════════════════════════
//   1. Happy path + verification-bypass + state transitions
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: happy path + email-verify bypass", () => {
  test("1. happy path: A invites, B registers, B accepts → both share couple", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("happy-a@weddly.test");
    const aRow = db.prepare("SELECT id FROM users WHERE email = ?").get("happy-a@weddly.test") as {
      id: number;
    };
    const inviteToken = await createInvite(aToken, "happy-b@weddly.test");

    const { token: bToken, userId: bId } = await freshUserNoCouple("happy-b@weddly.test");
    const accept = await req<{ couple: { id: number; partner_b_id: number } }>(
      "POST",
      `/api/invites/${inviteToken}/accept`,
      {},
      { token: bToken },
    );
    expect(accept.status).toBe(200);
    expect(accept.data.couple.id).toBe(coupleId);

    const couple = db
      .prepare("SELECT partner_a_id, partner_b_id FROM couples WHERE id = ?")
      .get(coupleId) as {
      partner_a_id: number;
      partner_b_id: number;
    };
    expect(couple.partner_a_id).toBe(aRow.id);
    expect(couple.partner_b_id).toBe(bId);

    const bUser = db.prepare("SELECT couple_id, role FROM users WHERE id = ?").get(bId) as {
      couple_id: number;
      role: string;
    };
    expect(bUser.couple_id).toBe(coupleId);
    expect(bUser.role).toBe("partner");

    const member = db
      .prepare("SELECT role FROM couple_members WHERE couple_id = ? AND user_id = ?")
      .get(coupleId, bId) as { role: string } | undefined;
    expect(member?.role).toBe("partner");
  });

  test("2. partner B can accept WITHOUT verifying email first", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("noverify-a@weddly.test");
    const inviteToken = await createInvite(aToken, "noverify-b@weddly.test");

    // An account that exists but never verified its address. The invite link
    // itself is the proof of address ownership for partner B, so accept must
    // not gate on verified_email.
    const { token: bToken } = freshUserUnverified("noverify-b@weddly.test");
    const accept = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    expect(accept.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   2. Expiry + already-consumed paths
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: expiry + double-spend", () => {
  test("3a. expired invite → accept returns 410", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("exp-acc-a@weddly.test");
    const inviteToken = await createInvite(aToken, "exp-acc-b@weddly.test");
    // Force-expire (handler uses expires_at < now to flag).
    db.prepare("UPDATE couple_invites SET expires_at = 1 WHERE token = ?").run(inviteToken);

    const { token: bToken } = await freshUserNoCouple("exp-acc-b@weddly.test");
    const r = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    expect(r.status).toBe(410);
  });

  test("3b. expired invite → public lookup also returns 410", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("exp-lookup-a@weddly.test");
    const inviteToken = await createInvite(aToken, "exp-lookup-b@weddly.test");
    db.prepare("UPDATE couple_invites SET expires_at = 1 WHERE token = ?").run(inviteToken);

    const r = await req(`GET`, `/api/invites/${inviteToken}`);
    expect(r.status).toBe(410);
  });

  test("4. already-consumed invite → second accept returns 410 already-used", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("dup-a@weddly.test");
    const inviteToken = await createInvite(aToken, "dup-b@weddly.test");

    const { token: bToken } = await freshUserNoCouple("dup-b@weddly.test");
    const first = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    expect(first.status).toBe(200);

    // Re-try with a fresh user; the consumed_at check fires before any couple
    // membership logic.
    const { token: cToken } = await freshUserNoCouple("dup-c@weddly.test");
    const second = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: cToken });
    // Pinned actual: handler returns 410 "Invite already used" once consumed_at
    // is set — NOT 409. (See handleAcceptInvite consumed_at branch.)
    expect(second.status).toBe(410);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   3. Cancel paths + re-create after cancel
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: cancel + re-create", () => {
  test("5. cancel after acceptance → idempotent 200 cancelled:false (not 409)", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("can-post-a@weddly.test");
    const inviteToken = await createInvite(aToken, "can-post-b@weddly.test");
    const { token: bToken } = await freshUserNoCouple("can-post-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });

    const cancel = await req<{ ok: boolean; cancelled: boolean }>(
      "POST",
      "/api/couples/invites/cancel",
      {},
      { token: aToken },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.data.cancelled).toBe(false);
  });

  test("6a. cancel before acceptance → 200 cancelled:true, token dead", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("can-pre-a@weddly.test");
    const inviteToken = await createInvite(aToken, "can-pre-b@weddly.test");

    const cancel = await req<{ cancelled: boolean }>(
      "POST",
      "/api/couples/invites/cancel",
      {},
      { token: aToken },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.data.cancelled).toBe(true);
  });

  test("6b. accepting a cancelled token → 410 (cancel sets consumed_at)", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("can-pre-acc-a@weddly.test");
    const inviteToken = await createInvite(aToken, "can-pre-acc-b@weddly.test");
    await req("POST", "/api/couples/invites/cancel", {}, { token: aToken });

    const { token: bToken } = await freshUserNoCouple("can-pre-acc-b@weddly.test");
    const r = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    // Pinned actual: cancel stamps consumed_at, so the consumed_at branch
    // fires before expiry → 410 "Invite already used".
    expect(r.status).toBe(410);
  });

  test("7. re-create after cancel → 201 with a fresh token", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("recreate-a@weddly.test");
    const first = await createInvite(aToken, "recreate-b@weddly.test");
    await req("POST", "/api/couples/invites/cancel", {}, { token: aToken });
    const second = await createInvite(aToken, "recreate-b2@weddly.test");
    expect(second).not.toBe(first);

    // The new token resolves on public lookup; the old one is dead.
    const oldLookup = await req("GET", `/api/invites/${first}`);
    expect(oldLookup.status).toBe(410);
    const newLookup = await req("GET", `/api/invites/${second}`);
    expect(newLookup.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   4. Validation gates: two opens, own email, already linked
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: validation gates", () => {
  test("8. second open invite while one is pending → 409 invite_already_pending", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("two-open-a@weddly.test");
    await createInvite(aToken, "two-open-b@weddly.test");

    const second = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "two-open-c@weddly.test" },
      { token: aToken },
    );
    // Pinned actual: handler refuses the second open invite (does NOT silently
    // overwrite). Code is "invite_already_pending".
    expect(second.status).toBe(409);
    expect(second.data.detail?.code).toBe("invite_already_pending");
  });

  test("9. inviter invites their OWN email → 400 invite_own_email", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("self-invite-a@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "Self-Invite-A@weddly.test" }, // case-insensitive comparison
      { token: aToken },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invite_own_email");
  });

  test("10. partner B already linked → 409 on create", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("full-a@weddly.test");
    const inviteToken = await createInvite(aToken, "full-b@weddly.test");
    const { token: bToken } = await freshUserNoCouple("full-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });

    const r = await req(
      "POST",
      "/api/couples/invites",
      { invited_email: "full-c@weddly.test" },
      { token: aToken },
    );
    // Pinned actual: throws 409 "Partner B already linked" (no `code` set,
    // bare HttpError) before the pending-invite check or the email check.
    expect(r.status).toBe(409);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   5. Public lookup behaviour
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: public lookup", () => {
  test("11. lookup is PUBLIC (no auth) and returns couple_display_name + invited_email", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("look-pub-a@weddly.test");
    const inviteToken = await createInvite(aToken, "look-pub-b@weddly.test");

    const r = await req<{
      invite: { invited_email: string | null };
      couple_display_name: string;
    }>("GET", `/api/invites/${inviteToken}`);
    expect(r.status).toBe(200);
    expect(r.data.couple_display_name).toBe("Mia & Lucas");
    expect(r.data.invite.invited_email).toBe("look-pub-b@weddly.test");
  });

  test("12. unknown token → 404", async () => {
    wipeAll();
    const r = await req("GET", "/api/invites/totally-bogus-token-value");
    expect(r.status).toBe(404);
  });

  test("13. lookup of CONSUMED token → 410 already-used (pinned actual)", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("look-consumed-a@weddly.test");
    const inviteToken = await createInvite(aToken, "look-consumed-b@weddly.test");
    const { token: bToken } = await freshUserNoCouple("look-consumed-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });

    const r = await req("GET", `/api/invites/${inviteToken}`);
    expect(r.status).toBe(410);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   6. Accept paths: signed-in-no-couple vs accept-merge
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: accept variants", () => {
  test("14. signed-in user with NO couple → plain /accept links them as partner B", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("acc-nocouple-a@weddly.test");
    const inviteToken = await createInvite(aToken, "acc-nocouple-b@weddly.test");
    const { token: bToken, userId: bId } = await freshUserNoCouple("acc-nocouple-b@weddly.test");

    const r = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    expect(r.status).toBe(200);

    const bUser = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(bId) as {
      couple_id: number;
    };
    expect(bUser.couple_id).toBe(coupleId);

    const member = db
      .prepare("SELECT 1 FROM couple_members WHERE couple_id = ? AND user_id = ?")
      .get(coupleId, bId) as { 1: number } | undefined;
    expect(member).toBeDefined();
  });

  test("15. /accept-merge purges B's solo workspace + links into A", async () => {
    wipeAll();
    const { token: aToken, coupleId: aCoupleId } = await bootstrapCouple("merge-a@weddly.test");
    const inviteToken = await createInvite(aToken, "merge-b@weddly.test");

    // B onboards their own solo workspace and adds some data so we can prove
    // the purge happened. bootstrapCouple seeds budget lines from the 5M HUF
    // ceiling so we don't need to add anything manually for the budget assert.
    const { token: bToken, coupleId: bCoupleId } = await bootstrapCouple("merge-b@weddly.test");
    await req("POST", "/api/guests", { full_name: "Cousin Z" }, { token: bToken });

    // Sanity: B has guests + budget lines in their solo workspace pre-merge.
    const preGuests = db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE couple_id = ?")
      .get(bCoupleId) as { n: number };
    expect(preGuests.n).toBeGreaterThan(0);

    const r = await req<{ couple: { id: number } }>(
      "POST",
      `/api/invites/${inviteToken}/accept-merge`,
      { confirm: "MERGE" },
      { token: bToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.id).toBe(aCoupleId);

    // B's old workspace was purged: guests are gone, budget lines are gone.
    const postGuests = db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE couple_id = ?")
      .get(bCoupleId) as { n: number };
    expect(postGuests.n).toBe(0);
    const postBudget = db
      .prepare("SELECT COUNT(*) AS n FROM budget_lines WHERE couple_id = ?")
      .get(bCoupleId) as { n: number };
    expect(postBudget.n).toBe(0);

    // The couples row itself stays (audit retention) but is tombstoned with
    // status='deleting' and a "Purged workspace" display name.
    const oldCouple = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(bCoupleId) as { status: string; display_name: string };
    expect(oldCouple.status).toBe("deleting");
    expect(oldCouple.display_name).toBe("Purged workspace");

    // B now points at A's workspace.
    const bRow = db
      .prepare("SELECT couple_id FROM users WHERE email = ?")
      .get("merge-b@weddly.test") as { couple_id: number } | undefined;
    expect(bRow?.couple_id).toBe(aCoupleId);
  });

  test("16. /accept-merge missing confirm payload → 400", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("merge-noconf-a@weddly.test");
    const inviteToken = await createInvite(aToken, "merge-noconf-b@weddly.test");
    const { token: bToken } = await bootstrapCouple("merge-noconf-b@weddly.test");

    const r = await req("POST", `/api/invites/${inviteToken}/accept-merge`, {}, { token: bToken });
    expect(r.status).toBe(400);
  });

  test("17. /accept-merge with wrong confirm string → 400", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("merge-wrongconf-a@weddly.test");
    const inviteToken = await createInvite(aToken, "merge-wrongconf-b@weddly.test");
    const { token: bToken } = await bootstrapCouple("merge-wrongconf-b@weddly.test");

    const r = await req(
      "POST",
      `/api/invites/${inviteToken}/accept-merge`,
      { confirm: "merge" }, // lowercase — handler expects literal "MERGE"
      { token: bToken },
    );
    expect(r.status).toBe(400);
  });

  test("18. /accept-merge when SOURCE workspace has partner B → 409 source_has_partner_b", async () => {
    wipeAll();
    // A invites X.
    const { token: aToken } = await bootstrapCouple("merge-srcfull-a@weddly.test");
    const inviteToA = await createInvite(aToken, "merge-srcfull-x@weddly.test");

    // B has their own workspace AND has already added a partner B to it
    // (so it's a fully-paired source workspace).
    const { token: bToken } = await bootstrapCouple("merge-srcfull-b@weddly.test");
    const inviteToBPartner = await createInvite(bToken, "merge-srcfull-bpartner@weddly.test");
    const { token: bPartnerToken } = await freshUserNoCouple("merge-srcfull-bpartner@weddly.test");
    await req("POST", `/api/invites/${inviteToBPartner}/accept`, {}, { token: bPartnerToken });

    // Now B (owner of source) tries to /accept-merge into A's workspace. The
    // source has partner B linked → refuse rather than wipe their partner's
    // data.
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/invites/${inviteToA}/accept-merge`,
      { confirm: "MERGE" },
      { token: bToken },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("source_has_partner_b");
  });

  test("19. /accept-merge with empty source workspace succeeds (no purge surprises)", async () => {
    wipeAll();
    const { token: aToken, coupleId: aCoupleId } = await bootstrapCouple(
      "merge-empty-a@weddly.test",
    );
    const inviteToken = await createInvite(aToken, "merge-empty-b@weddly.test");

    // B onboards but doesn't add any guests/budget on top of the defaults
    // bootstrap already seeds — the merge should still succeed.
    const { token: bToken, coupleId: bCoupleId } = await bootstrapCouple(
      "merge-empty-b@weddly.test",
    );

    const r = await req<{ couple: { id: number } }>(
      "POST",
      `/api/invites/${inviteToken}/accept-merge`,
      { confirm: "MERGE" },
      { token: bToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.id).toBe(aCoupleId);

    // Source workspace is tombstoned.
    const src = db.prepare("SELECT status FROM couples WHERE id = ?").get(bCoupleId) as {
      status: string;
    };
    expect(src.status).toBe("deleting");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   7. Incoming-invite list
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: incoming invites", () => {
  test("20. B sees BOTH pending invites from couple-A and couple-C", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("incoming-a@weddly.test");
    await createInvite(aToken, "incoming-target@weddly.test");

    const { token: cToken } = await bootstrapCouple("incoming-c@weddly.test");
    await createInvite(cToken, "incoming-target@weddly.test");

    const { token: bToken } = await freshUserNoCouple("incoming-target@weddly.test");
    const incoming = await req<{
      invites: { couple_display_name: string; inviter_email: string }[];
    }>("GET", "/api/invites/incoming", undefined, { token: bToken });
    expect(incoming.status).toBe(200);
    expect(incoming.data.invites.length).toBe(2);
    const inviters = incoming.data.invites.map((i) => i.inviter_email).sort();
    expect(inviters).toEqual(["incoming-a@weddly.test", "incoming-c@weddly.test"]);
  });

  test("21. incoming list filters out expired AND consumed invites", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("incoming-filter-a@weddly.test");

    // Build three invites to the same email: one expired, one consumed,
    // one still pending. Only the pending one should show.
    const goodToken = await createInvite(aToken, "incoming-filter-b@weddly.test");
    await req("POST", "/api/couples/invites/cancel", {}, { token: aToken }); // consumes #1

    const expiredToken = await createInvite(aToken, "incoming-filter-b@weddly.test");
    db.prepare("UPDATE couple_invites SET expires_at = 1 WHERE token = ?").run(expiredToken);

    const liveToken = await createInvite(aToken, "incoming-filter-b@weddly.test");

    const { token: bToken } = await freshUserNoCouple("incoming-filter-b@weddly.test");
    const incoming = await req<{ invites: { token: string }[] }>(
      "GET",
      "/api/invites/incoming",
      undefined,
      { token: bToken },
    );
    expect(incoming.status).toBe(200);
    expect(incoming.data.invites.length).toBe(1);
    expect(incoming.data.invites[0]?.token).toBe(liveToken);
    // Pin: cancelled token does NOT leak through.
    expect(incoming.data.invites.find((i) => i.token === goodToken)).toBeUndefined();
    expect(incoming.data.invites.find((i) => i.token === expiredToken)).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   8. Active-couple switcher
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: switch active couple", () => {
  test("22. B in 2 couples → POST /active-couple flips the pointer + /current reflects it", async () => {
    wipeAll();
    // B onboards their own workspace (couple #1).
    const { token: bToken, coupleId: bOwnCoupleId } = await bootstrapCouple("switch-b@weddly.test");

    // A invites B; B accept-merges? No — accept-merge purges. We need B to be
    // a member of TWO live workspaces. Use the multi-workspace API: B creates
    // an additional workspace via POST /api/couples.
    const additional = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Civil ceremony" },
      { token: bToken },
    );
    expect(additional.status).toBe(201);
    const bravoId = additional.data.couple.id;

    // After creating additional, user.couple_id auto-switched to bravoId.
    const cur1 = await req<{ couple: { id: number } }>("GET", "/api/couples/current", undefined, {
      token: bToken,
    });
    expect(cur1.data.couple.id).toBe(bravoId);

    // Flip back to the original (Alpha) workspace.
    const switchBack = await req(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: bOwnCoupleId },
      { token: bToken },
    );
    expect(switchBack.status).toBe(200);

    const cur2 = await req<{ couple: { id: number } }>("GET", "/api/couples/current", undefined, {
      token: bToken,
    });
    expect(cur2.data.couple.id).toBe(bOwnCoupleId);
  });

  test("23. switch to a workspace I'm NOT a member of → 403 not_a_member", async () => {
    wipeAll();
    const { coupleId: otherId } = await bootstrapCouple("switch-other@weddly.test");
    const { token: bToken } = await bootstrapCouple("switch-non-member@weddly.test");

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: otherId },
      { token: bToken },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_a_member");
  });

  test("24. switch to MY own current couple → 200 idempotent", async () => {
    wipeAll();
    const { token: bToken, coupleId } = await bootstrapCouple("switch-idem@weddly.test");

    const r = await req(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: coupleId },
      { token: bToken },
    );
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   9. Leave-couple
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: leave couple", () => {
  test("25. partner B leaves → couple_members row gone, couple.partner_b_id nulled", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("leave-a@weddly.test");
    const inviteToken = await createInvite(aToken, "leave-b@weddly.test");
    const { token: bToken, userId: bId } = await freshUserNoCouple("leave-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });

    const leave = await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });
    expect(leave.status).toBe(200);

    const member = db
      .prepare("SELECT 1 FROM couple_members WHERE couple_id = ? AND user_id = ?")
      .get(coupleId, bId) as { 1: number } | null;
    // bun:sqlite returns null for "no row" rather than undefined.
    expect(member).toBeNull();

    const couple = db.prepare("SELECT partner_b_id FROM couples WHERE id = ?").get(coupleId) as {
      partner_b_id: number | null;
    };
    expect(couple.partner_b_id).toBeNull();

    const bUser = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(bId) as {
      couple_id: number | null;
    };
    expect(bUser.couple_id).toBeNull();
  });

  test("26. owner (partner A) cannot leave → 409 owner_cannot_leave", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("leave-owner@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/leave-couple",
      {},
      { token: aToken },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("owner_cannot_leave");
  });

  test("27. leave when user is in NO couple → 404", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("leave-nocouple@weddly.test");
    const r = await req("POST", "/api/users/me/leave-couple", {}, { token });
    expect(r.status).toBe(404);
  });

  test("28. after leaving, B can accept a fresh invite from a different couple", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("leave-rejoin-a@weddly.test");
    const invA = await createInvite(aToken, "leave-rejoin-b@weddly.test");
    const { token: bToken } = await freshUserNoCouple("leave-rejoin-b@weddly.test");
    await req("POST", `/api/invites/${invA}/accept`, {}, { token: bToken });
    await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });

    // Now couple C invites B; B accepts.
    const { token: cToken, coupleId: cCoupleId } = await bootstrapCouple(
      "leave-rejoin-c@weddly.test",
    );
    const invC = await createInvite(cToken, "leave-rejoin-b@weddly.test");
    const accept = await req<{ couple: { id: number } }>(
      "POST",
      `/api/invites/${invC}/accept`,
      {},
      { token: bToken },
    );
    expect(accept.status).toBe(200);
    expect(accept.data.couple.id).toBe(cCoupleId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   10. Partner-view status walks + audit trail
// ════════════════════════════════════════════════════════════════════════════

describe("invite_lifecycle: partner view + audit trail", () => {
  test("29. partner view transitions: invited → active (logged in) → joined (no sessions) → active", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("pv-walk-a@weddly.test");
    const inviteToken = await createInvite(aToken, "pv-walk-b@weddly.test");

    // After create: partner is "invited", email surfaces.
    const invited = await req<{ partner: { status: string; email: string | null } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(invited.data.partner.status).toBe("invited");
    expect(invited.data.partner.email).toBe("pv-walk-b@weddly.test");

    // B accepts → has an active session → "active".
    const { token: bToken } = await freshUserNoCouple("pv-walk-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    const active1 = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(active1.data.partner.status).toBe("active");

    // Drop B's sessions → "joined" (account exists, no live token).
    db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(
      "pv-walk-b@weddly.test",
    );
    const joined = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(joined.data.partner.status).toBe("joined");

    // B logs back in → "active" again.
    const login = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "pv-walk-b@weddly.test",
      password: "supersafe123",
    });
    expect(login.status).toBe(200);
    const active2 = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(active2.data.partner.status).toBe("active");
  });

  test("30. audit log records invite.create, invite.accept, invite.cancel, user.leave_couple", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("audit-a@weddly.test");
    const aUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("audit-a@weddly.test") as {
        id: number;
      }
    ).id;

    // 1. Create + cancel cycle (so we can assert both create AND cancel rows).
    await createInvite(aToken, "audit-throwaway@weddly.test");
    await req("POST", "/api/couples/invites/cancel", {}, { token: aToken });

    // 2. Create + accept (so we get an invite.accept row).
    const liveToken = await createInvite(aToken, "audit-b@weddly.test");
    const { token: bToken } = await freshUserNoCouple("audit-b@weddly.test");
    await req("POST", `/api/invites/${liveToken}/accept`, {}, { token: bToken });
    const bUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("audit-b@weddly.test") as {
        id: number;
      }
    ).id;

    // 3. B leaves so we get a user.leave_couple row.
    await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });

    const rows = db
      .prepare(
        "SELECT action, actor_user_id, couple_id FROM audit_log WHERE couple_id = ? ORDER BY id ASC",
      )
      .all(coupleId) as { action: string; actor_user_id: number | null; couple_id: number }[];

    const actions = rows.map((r) => r.action);
    expect(actions).toContain("invite.create");
    expect(actions).toContain("invite.cancel");
    expect(actions).toContain("invite.accept");
    expect(actions).toContain("user.leave_couple");

    // Spot-check actor + couple stamping on each.
    const created = rows.find((r) => r.action === "invite.create");
    expect(created?.actor_user_id).toBe(aUserId);
    expect(created?.couple_id).toBe(coupleId);

    const cancelled = rows.find((r) => r.action === "invite.cancel");
    expect(cancelled?.actor_user_id).toBe(aUserId);
    expect(cancelled?.couple_id).toBe(coupleId);

    const accepted = rows.find((r) => r.action === "invite.accept");
    expect(accepted?.actor_user_id).toBe(bUserId);
    expect(accepted?.couple_id).toBe(coupleId);

    const left = rows.find((r) => r.action === "user.leave_couple");
    expect(left?.actor_user_id).toBe(bUserId);
    expect(left?.couple_id).toBe(coupleId);
  });
});

// silence "unused import" warning — `now` is imported per the task contract.
void now;
