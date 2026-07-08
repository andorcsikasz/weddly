// The admin "Approve & open account" gate for a /planners applicant. Two paths:
//   - no account yet  -> provision a dormant planner (takes the email), seed the
//     profile from the application, email an activation link that opens the
//     account and lands the planner in a PRE-FILLED onboarding wizard;
//   - existing non-planner account (the mis-route) -> convert + seed it,
//     preserving the couple data, email a sign-in link.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { PlannerActivationView, PlannerProfile } from "@shared/types";
import { db, now } from "../../src/db";
import {
  bootstrapCouple,
  plaintextForStoredToken,
  req,
  verifyUserEmail,
  wipeAll,
} from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Seed a rich accepted planner_waitlist row and return its id. */
function seedRichWaitlist(email: string, fullName = "Evelin Applicant"): number {
  const ts = Math.floor(Date.now() / 1000);
  const info = db
    .prepare(
      `INSERT INTO planner_waitlist
         (full_name, email, phone, company_name, city, website, km_radius,
          weddings_per_year, wedding_style_1, wedding_style_2, wedding_style_3,
          other_style, selected_plan, message, status, created_at)
       VALUES (?, ?, '+3670', 'Evelin Events', 'Budapest', 'evelin.example', 100,
               30, 'romantic', 'modern', 'boho', 'eco', 'pro', 'Meselos bio',
               'accepted', ?)`,
    )
    .run(fullName, email, ts);
  return Number(info.lastInsertRowid);
}

/** Resolve the plaintext activation token for a provisioned user. */
function activationToken(userId: number): string {
  const row = db
    .prepare(
      "SELECT token FROM planner_activation_tokens WHERE user_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
    )
    .get(userId) as { token: string } | undefined;
  if (!row) throw new Error("no pending activation token");
  return plaintextForStoredToken(row.token);
}

describe("planner waitlist approval", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("approve -> provision -> activate -> pre-filled planner account", async () => {
    const adminToken = await bootstrapAdmin();
    const waitlistId = seedRichWaitlist("evelin@weddly.test");

    // Approve: provisions the dormant planner + seeds the profile.
    const approve = await req<{ ok: true; provisioned?: boolean; has_account: boolean }>(
      "POST",
      `/api/admin/planners/pending/${waitlistId}/send-invite`,
      {},
      { token: adminToken },
    );
    expect(approve.status).toBe(200);
    expect(approve.data.provisioned).toBe(true);

    const user = db
      .prepare(
        "SELECT id, user_type, verified_email, password_set, business_name, planner_city, planner_plan, planner_max_clients, planner_styles FROM users WHERE email = ?",
      )
      .get("evelin@weddly.test") as {
      id: number;
      user_type: string;
      verified_email: number;
      password_set: number;
      business_name: string | null;
      planner_city: string | null;
      planner_plan: string | null;
      planner_max_clients: number | null;
      planner_styles: string | null;
    };
    expect(user.user_type).toBe("planner");
    expect(user.verified_email).toBe(0);
    expect(user.password_set).toBe(0);
    // Seeded from the application.
    expect(user.business_name).toBe("Evelin Events");
    expect(user.planner_city).toBe("Budapest");
    expect(user.planner_plan).toBe("pro"); // selected_plan 'pro' -> planner 'pro'
    expect(user.planner_max_clients).toBe(7);
    expect(JSON.parse(user.planner_styles ?? "[]")).toContain("romantic");

    // Real founding-or-trial billing (a genuine early applicant), not the comp:
    // in a fresh DB the first applicant lands on a real founding slot.
    const sub = db
      .prepare(
        "SELECT subscription_status, is_founding_member FROM planner_subscriptions WHERE user_id = ?",
      )
      .get(user.id) as { subscription_status: string; is_founding_member: number };
    expect(sub.subscription_status).toBe("founding");
    expect(sub.is_founding_member).toBe(1);

    // The activation email (not the /signup CTA) went out.
    const mail = db
      .prepare("SELECT kind FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .get("evelin@weddly.test") as { kind: string };
    expect(mail.kind).toBe("planner_onboarding_invite");

    // Activation view: valid, business name + a real free window.
    const token = activationToken(user.id);
    const view = await req<PlannerActivationView>(
      "GET",
      `/api/planner/activation/${encodeURIComponent(token)}`,
    );
    expect(view.status).toBe(200);
    expect(view.data.business_name).toBe("Evelin Events");
    expect(view.data.free_until).toBeGreaterThan(now());

    // Complete: sets password, issues a live planner session.
    const done = await req<{ token: string; user: { user_type: string } }>(
      "POST",
      "/api/planner/activation/complete",
      {
        token,
        password: "plannerpass123",
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        locale: "hu",
      },
    );
    expect(done.status).toBe(200);
    expect(done.data.user.user_type).toBe("planner");

    // The onboarding wizard arrives pre-filled: seeded columns + waitlist prefill.
    const profile = await req<PlannerProfile>("GET", "/api/planner/profile", undefined, {
      token: done.data.token,
    });
    expect(profile.status).toBe(200);
    expect(profile.data.business_name).toBe("Evelin Events");
    expect(profile.data.planner_city).toBe("Budapest");
    expect(profile.data.planner_plan).toBe("pro");
    expect(profile.data.waitlist_prefill).not.toBeNull();
    expect(profile.data.waitlist_prefill?.mapped_plan).toBe("pro");
  });

  test("approve on an existing couple account (mis-route) converts + seeds, keeps couple data", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("mis@weddly.test");
    const before = db.prepare("SELECT id FROM users WHERE email = ?").get("mis@weddly.test") as {
      id: number;
    };
    // Case-insensitive email match, as in production.
    const waitlistId = seedRichWaitlist("Mis@weddly.test", "Mis Route");

    const approve = await req<{ ok: true; converted?: boolean; has_account: boolean }>(
      "POST",
      `/api/admin/planners/pending/${waitlistId}/send-invite`,
      {},
      { token: adminToken },
    );
    expect(approve.status).toBe(200);
    expect(approve.data.converted).toBe(true);
    expect(approve.data.has_account).toBe(true);

    const user = db
      .prepare(
        "SELECT user_type, couple_id, business_name, planner_city, planner_plan FROM users WHERE id = ?",
      )
      .get(before.id) as {
      user_type: string;
      couple_id: number | null;
      business_name: string | null;
      planner_city: string | null;
      planner_plan: string | null;
    };
    expect(user.user_type).toBe("planner");
    expect(user.couple_id).toBe(coupleId); // couple data preserved (non-destructive)
    expect(user.business_name).toBe("Evelin Events");
    expect(user.planner_city).toBe("Budapest");
    expect(user.planner_plan).toBe("pro");

    // No activation token minted for an existing account (they sign in).
    const tok = db
      .prepare("SELECT 1 FROM planner_activation_tokens WHERE user_id = ?")
      .get(before.id);
    expect(tok).toBeNull();

    // The sign-in email (not the activation one) went out.
    const mail = db
      .prepare("SELECT kind FROM email_log WHERE kind = 'planner_access_invite' AND to_email = ?")
      .all("mis@weddly.test") as { kind: string }[];
    expect(mail.length).toBe(1);
  });
});
