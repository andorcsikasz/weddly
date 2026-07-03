// Admin-provisioned planner accounts: the provision endpoint (dormant account
// + 2-year comp + activation email), the public activation landing (view +
// complete with clickwrap consent), the resend path, and the guarantees around
// the founding cohort (a comp never consumes one of the 25 founding slots).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { PLANNER_FOUNDING_DURATION_MS } from "@shared/planner_billing";
import type { AdminPlannerView, PlannerActivationView } from "@shared/types";
import { db, now } from "../../src/db";
import { plannerFoundingSlotsUsed } from "../../src/domain/planner_billing";
import { plaintextForStoredToken, req, verifyUserEmail, wipeAll } from "../helpers";

async function addAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
    privacy_version: PRIVACY_VERSION,
    terms_version: TERMS_VERSION,
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

const PROVISION_BODY = {
  email: "anna@weddings.test",
  full_name: "Anna Kovács",
  business_name: "Anna Weddings",
  category: "esküvőszervező",
};

async function provision(adminToken: string) {
  return req<{ ok: true; user_id: number }>(
    "POST",
    "/api/admin/planners/provision",
    PROVISION_BODY,
    { token: adminToken },
  );
}

/** The plaintext activation token for a provisioned user, resolved through the
 *  test-only capture map (only the hash is at rest). */
function activationToken(userId: number): string {
  const row = db
    .prepare(
      "SELECT token FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
    )
    .get(userId) as { token: string } | undefined;
  if (!row) throw new Error("no pending activation token");
  return plaintextForStoredToken(row.token);
}

const completeBody = (token: string, overrides: Record<string, unknown> = {}) => ({
  token,
  password: "plannerpass123",
  privacy_version: PRIVACY_VERSION,
  terms_version: TERMS_VERSION,
  locale: "hu",
  ...overrides,
});

describe("admin planner provisioning", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("provision creates a dormant planner with a 2-year comp and no founding slot spent", async () => {
    const adminToken = await addAdmin();
    const res = await provision(adminToken);
    expect(res.status).toBe(201);

    const user = db
      .prepare(
        "SELECT user_type, verified_email, password_set, business_name, planner_category FROM users WHERE id = ?",
      )
      .get(res.data.user_id) as {
      user_type: string;
      verified_email: number;
      password_set: number;
      business_name: string;
      planner_category: string;
    };
    expect(user.user_type).toBe("planner");
    expect(user.verified_email).toBe(0);
    expect(user.password_set).toBe(0);
    expect(user.business_name).toBe("Anna Weddings");
    expect(user.planner_category).toBe("esküvőszervező");

    const sub = db
      .prepare(
        "SELECT subscription_status, is_founding_member, founding_until FROM planner_subscriptions WHERE user_id = ?",
      )
      .get(res.data.user_id) as {
      subscription_status: string;
      is_founding_member: number;
      founding_until: number;
    };
    expect(sub.subscription_status).toBe("founding");
    expect(sub.is_founding_member).toBe(0); // comp, not a founding-cohort slot
    expect(sub.founding_until).toBeGreaterThan(now() + PLANNER_FOUNDING_DURATION_MS - 60_000);
    expect(plannerFoundingSlotsUsed()).toBe(0);

    // The activation email went out (logged even without a provider).
    const mail = db
      .prepare("SELECT kind FROM email_log WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(res.data.user_id) as { kind: string };
    expect(mail.kind).toBe("planner_provisioned");

    // Dormant: password login is refused before activation.
    const login = await req("POST", "/api/auth/login", {
      email: PROVISION_BODY.email,
      password: "plannerpass123",
    });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });

  test("provision requires admin, all four fields, and a free email", async () => {
    const adminToken = await addAdmin();

    const user = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "civilian@weddly.test",
      password: "supersafe123",
      full_name: "Civilian",
      privacy_version: PRIVACY_VERSION,
      terms_version: TERMS_VERSION,
    });
    await verifyUserEmail("civilian@weddly.test");
    const denied = await req("POST", "/api/admin/planners/provision", PROVISION_BODY, {
      token: user.data.token,
    });
    expect(denied.status).toBe(403);

    const missing = await req(
      "POST",
      "/api/admin/planners/provision",
      { ...PROVISION_BODY, category: "" },
      { token: adminToken },
    );
    expect(missing.status).toBe(400);

    expect((await provision(adminToken)).status).toBe(201);
    expect((await provision(adminToken)).status).toBe(409); // email now taken
  });

  test("admin list surfaces the pending activation state + provisioned fields", async () => {
    const adminToken = await addAdmin();
    const res = await provision(adminToken);

    const list = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    const row = list.data.planners.find((p) => p.user_id === res.data.user_id);
    expect(row).toBeDefined();
    expect(row?.pending_activation).toBe(true);
    expect(row?.business_name).toBe("Anna Weddings");
    expect(row?.planner_category).toBe("esküvőszervező");
    expect(row?.founding_until).toBeGreaterThan(now());
  });

  test("activation view + complete: consent-gated, single-use, issues a live planner session", async () => {
    const adminToken = await addAdmin();
    const res = await provision(adminToken);
    const token = activationToken(res.data.user_id);

    const view = await req<PlannerActivationView>(
      "GET",
      `/api/planner/activation/${encodeURIComponent(token)}`,
    );
    expect(view.status).toBe(200);
    expect(view.data.email).toBe(PROVISION_BODY.email);
    expect(view.data.business_name).toBe("Anna Weddings");
    expect(view.data.free_until).toBeGreaterThan(now());

    // Stale policy versions are refused (clickwrap ledger honesty).
    const stale = await req(
      "POST",
      "/api/planner/activation/complete",
      completeBody(token, { terms_version: "1900-01-01" }),
    );
    expect(stale.status).toBe(400);

    const done = await req<{ token: string; user: { user_type: string; id: number } }>(
      "POST",
      "/api/planner/activation/complete",
      completeBody(token),
    );
    expect(done.status).toBe(200);
    expect(done.data.user.user_type).toBe("planner");

    // The session is live and the account is verified + password-backed now.
    const me = await req<{ user: { verified_email: boolean; password_set: boolean } }>(
      "GET",
      "/api/auth/me",
      undefined,
      { token: done.data.token },
    );
    expect(me.status).toBe(200);
    expect(me.data.user.verified_email).toBe(true);
    expect(me.data.user.password_set).toBe(true);

    // Both consents were recorded on the ledger.
    const consents = db
      .prepare(
        "SELECT document, version FROM user_consents WHERE subject_user_id = ? ORDER BY document",
      )
      .all(res.data.user_id) as { document: string; version: string }[];
    expect(consents.map((c) => c.document)).toEqual(["privacy", "terms"]);

    // Password login works from here on.
    const login = await req("POST", "/api/auth/login", {
      email: PROVISION_BODY.email,
      password: "plannerpass123",
    });
    expect(login.status).toBe(200);

    // Single-use: both the view and a replayed complete are gone (410).
    const replayView = await req("GET", `/api/planner/activation/${encodeURIComponent(token)}`);
    expect(replayView.status).toBe(410);
    const replay = await req("POST", "/api/planner/activation/complete", completeBody(token));
    expect(replay.status).toBe(410);

    // The admin list no longer shows the row as pending.
    const list = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(list.data.planners.find((p) => p.user_id === res.data.user_id)?.pending_activation).toBe(
      false,
    );
  });

  test("expired token is refused with 410 and unknown tokens 404", async () => {
    const adminToken = await addAdmin();
    const res = await provision(adminToken);
    const token = activationToken(res.data.user_id);
    db.prepare("UPDATE planner_activation_tokens SET expires_at = 1 WHERE user_id = ?").run(
      res.data.user_id,
    );

    const view = await req("GET", `/api/planner/activation/${encodeURIComponent(token)}`);
    expect(view.status).toBe(410);
    const unknown = await req("GET", `/api/planner/activation/${"a".repeat(64)}`);
    expect(unknown.status).toBe(404);
  });

  test("resend invalidates the old link, works only while pending, and is admin-only", async () => {
    const adminToken = await addAdmin();
    const res = await provision(adminToken);
    const oldToken = activationToken(res.data.user_id);

    const resend = await req(
      "POST",
      `/api/admin/planners/${res.data.user_id}/resend-activation`,
      {},
      { token: adminToken },
    );
    expect(resend.status).toBe(200);

    // Old link is dead, the fresh one completes.
    const oldView = await req("GET", `/api/planner/activation/${encodeURIComponent(oldToken)}`);
    expect(oldView.status).toBe(404);
    const fresh = activationToken(res.data.user_id);
    const done = await req("POST", "/api/planner/activation/complete", completeBody(fresh));
    expect(done.status).toBe(200);

    // Already activated: no more resends.
    const after = await req(
      "POST",
      `/api/admin/planners/${res.data.user_id}/resend-activation`,
      {},
      { token: adminToken },
    );
    expect(after.status).toBe(409);
  });
});
