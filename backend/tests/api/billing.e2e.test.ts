// Subscription billing state machine + read-only gate.
//
// Stripe stays DISABLED in tests (STRIPE_ENABLED=false), so this exercises the
// parts that don't need a live Stripe: the trial granted at onboarding, the
// founding (free) plan granted at partner-join while slots remain (the
// first-200 cohort is counted by "both partners joined"), entitlement, the 402
// edit gate once a trial lapses, the admin free-badge grant/revoke, and
// graceful degradation.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminFinancialPlannerOverview } from "@shared/admin_financial_planner";
import type { AdminCoupleView } from "@shared/types";
import { type BillingStatusResponse, PAID_LAUNCH_DATE } from "@shared/billing";
import type { Couple } from "@shared/types";
import { db } from "../../src/db";
import {
  activatePartnerFreeWindow,
  foundingSlotsUsed,
  setBillingEnforcement,
} from "../../src/domain/billing";
import { FOUNDING_CAP } from "@shared/billing";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

/** Seed N placeholder founding-cohort couples (`is_founding_member = 1`) so N
 *  of the FOUNDING_CAP founding slots are consumed — the cap is now counted by
 *  granted badges, not couple-creation order. Negative ids keep them clear of
 *  real rows; a far-future `founding_until` keeps them entitled. They also
 *  count as real (non-demo) couples for the enforcement-readiness threshold. */
function seedCouples(n: number): void {
  const until = Date.now() + 1000 * 60 * 60 * 24 * 365;
  const insert = db.prepare(
    `INSERT INTO couples (id, partner_a_id, display_name, bride_name, groom_name,
       style_tags_json, frozen_categories_json, status, subscription_status,
       is_founding_member, founding_until, created_at, updated_at, is_demo)
     VALUES (?, 1, 'x', '', '', '[]', '[]', 'active', 'founding', 1, ?, 1, 1, 0)`,
  );
  db.transaction(() => {
    for (let i = 1; i <= n; i++) insert.run(-i, until);
  })();
}

async function addAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

const getCouple = (token: string) =>
  req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });

describe("billing state machine", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("onboarding starts a fresh (solo) couple on the trial, not founding", async () => {
    // A new couple has only partner A, so it can't yet count toward the
    // both-partners founding cohort — it onboards on the trial.
    const { token } = await bootstrapCouple("founding-onboard@weddly.test");
    const r = await getCouple(token);
    expect(r.status).toBe(200);
    expect(r.data.couple.billing.subscription_status).toBe("trialing");
    expect(r.data.couple.billing.is_founding_member).toBe(false);
    expect(r.data.couple.billing.entitled).toBe(true);
  });

  test("GET /api/billing/status reports disabled Stripe + an untouched founding cohort for a solo couple", async () => {
    const { token } = await bootstrapCouple("status@weddly.test");
    const r = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.enabled).toBe(false);
    expect(r.data.currency).toBe("HUF");
    expect(r.data.price).toBe(1990);
    // Solo couple hasn't consumed a founding slot (that happens at partner-join).
    expect(r.data.founding_spots_left).toBe(200);
  });

  test("a fresh couple trials even when the founding cohort is already full", async () => {
    seedCouples(200); // all 200 founding slots consumed
    const { token } = await bootstrapCouple("overcap@weddly.test");
    const r = await getCouple(token);
    expect(r.data.couple.billing.subscription_status).toBe("trialing");
    expect(r.data.couple.billing.is_founding_member).toBe(false);
    expect(r.data.couple.billing.entitled).toBe(true);
    // Pre-launch, the trial never ends before the paid-launch date.
    expect(r.data.couple.billing.trial_ends_at).toBeGreaterThanOrEqual(PAID_LAUNCH_DATE);
  });

  test("billing status reports has_partner=false for a solo workspace", async () => {
    const { token } = await bootstrapCouple("solo@weddly.test");
    const r = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, { token });
    expect(r.data.has_partner).toBe(false);
  });

  test("inviting a partner grants founding (free until the wedding day) while slots remain", async () => {
    const { token, coupleId } = await bootstrapCouple("partner-free@weddly.test");
    // Set a concrete wedding date and simulate partner B joining.
    const weddingMs = Date.parse("2027-06-15");
    const partnerA = (
      db.prepare("SELECT partner_a_id FROM couples WHERE id = ?").get(coupleId) as {
        partner_a_id: number;
      }
    ).partner_a_id;
    db.prepare("UPDATE couples SET wedding_date = '2027-06-15', partner_b_id = ? WHERE id = ?").run(
      partnerA,
      coupleId,
    );

    const granted = activatePartnerFreeWindow(coupleId);
    expect(granted).toBe(true);

    const r = await getCouple(token);
    expect(r.data.couple.billing.subscription_status).toBe("founding");
    expect(r.data.couple.billing.entitled).toBe(true);
    // Within the cap → this couple takes a founding slot (badge), free until the
    // wedding day.
    expect(r.data.couple.billing.is_founding_member).toBe(true);
    expect(r.data.couple.billing.founding_until).toBe(weddingMs);
  });

  test("inviting a partner does NOT grant founding once the cohort is full", async () => {
    seedCouples(200); // all 200 founding slots consumed
    const { token, coupleId } = await bootstrapCouple("partner-full@weddly.test");
    const partnerA = (
      db.prepare("SELECT partner_a_id FROM couples WHERE id = ?").get(coupleId) as {
        partner_a_id: number;
      }
    ).partner_a_id;
    db.prepare("UPDATE couples SET wedding_date = '2027-06-15', partner_b_id = ? WHERE id = ?").run(
      partnerA,
      coupleId,
    );

    // Cohort is full → partner-join is a no-op and the couple stays on its trial.
    const granted = activatePartnerFreeWindow(coupleId);
    expect(granted).toBe(false);

    const r = await getCouple(token);
    expect(r.data.couple.billing.subscription_status).toBe("trialing");
    expect(r.data.couple.billing.is_founding_member).toBe(false);
  });

  test("founding cohort never overshoots FOUNDING_CAP at the boundary (atomic grant)", async () => {
    // Fill all but ONE slot, then make TWO couples eligible and grant both.
    // Exactly one may take the last slot; the cohort must land on exactly
    // FOUNDING_CAP, never CAP+1. The grant path wraps its slots-remaining check
    // and the UPDATE in a single transaction so the count can't be read stale.
    seedCouples(FOUNDING_CAP - 1);
    expect(foundingSlotsUsed()).toBe(FOUNDING_CAP - 1);

    const a = await bootstrapCouple("cap-a@weddly.test");
    const b = await bootstrapCouple("cap-b@weddly.test");
    for (const c of [a, b]) {
      const partnerA = (
        db.prepare("SELECT partner_a_id FROM couples WHERE id = ?").get(c.coupleId) as {
          partner_a_id: number;
        }
      ).partner_a_id;
      db.prepare(
        "UPDATE couples SET wedding_date = '2027-06-15', partner_b_id = ? WHERE id = ?",
      ).run(partnerA, c.coupleId);
    }

    const grantedA = activatePartnerFreeWindow(a.coupleId);
    const grantedB = activatePartnerFreeWindow(b.coupleId);

    // Exactly one grant succeeded; the cohort is exactly full, never over.
    expect([grantedA, grantedB].filter(Boolean).length).toBe(1);
    expect(foundingSlotsUsed()).toBe(FOUNDING_CAP);
  }, 30_000);

  test("moving the wedding date re-pins the founding free window", async () => {
    const { token, coupleId } = await bootstrapCouple("repin@weddly.test");
    const partnerA = (
      db.prepare("SELECT partner_a_id FROM couples WHERE id = ?").get(coupleId) as {
        partner_a_id: number;
      }
    ).partner_a_id;
    db.prepare("UPDATE couples SET wedding_date = '2027-06-15', partner_b_id = ? WHERE id = ?").run(
      partnerA,
      coupleId,
    );
    activatePartnerFreeWindow(coupleId);

    // The couple moves the wedding earlier via PATCH → founding_until follows.
    const patched = await req<{ couple: Couple }>(
      "PATCH",
      "/api/couples/current",
      { wedding_date: "2027-03-01" },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.couple.billing.founding_until).toBe(Date.parse("2027-03-01"));
  });

  test("an expired trial flips the workspace to read-only (402 on edits, GET still works)", async () => {
    seedCouples(200);
    const { token, coupleId } = await bootstrapCouple("lapse@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId);
    setBillingEnforcement(true, 1); // paywall live, otherwise the freeze is deferred

    const get = await getCouple(token);
    expect(get.status).toBe(200);
    expect(get.data.couple.billing.entitled).toBe(false);
    expect(get.data.couple.billing.reason).toBe("trial_expired");

    const edit = await req<{ detail?: { code?: string; reason?: string } }>(
      "POST",
      "/api/households",
      { label: "Smith family" },
      { token },
    );
    expect(edit.status).toBe(402);
    expect(edit.data.detail?.code).toBe("subscription_required");
    expect(edit.data.detail?.reason).toBe("trial_expired");
  });

  test("admin can grant a free badge (read-only couple becomes founding) and revoke it", async () => {
    seedCouples(200);
    const { token, coupleId } = await bootstrapCouple("comp@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId); // lapsed
    setBillingEnforcement(true, 1); // paywall live so revoke -> read-only is observable
    const adminToken = await addAdmin();

    const granted = await req<{ couple: AdminCoupleView }>(
      "POST",
      `/api/admin/couples/${coupleId}/grant-free`,
      {},
      { token: adminToken },
    );
    expect(granted.status).toBe(200);
    expect(granted.data.couple.billing.subscription_status).toBe("founding");
    expect(granted.data.couple.billing.entitled).toBe(true);

    // The couple can edit again.
    const edit = await req("POST", "/api/households", { label: "Comped" }, { token });
    expect(edit.status).toBe(201);

    // Revoke → read-only again.
    const revoked = await req<{ couple: AdminCoupleView }>(
      "POST",
      `/api/admin/couples/${coupleId}/revoke-free`,
      {},
      { token: adminToken },
    );
    expect(revoked.data.couple.billing.subscription_status).toBe("none");
    expect(revoked.data.couple.billing.entitled).toBe(false);
    const blocked = await req("POST", "/api/households", { label: "Nope" }, { token });
    expect(blocked.status).toBe(402);
  });

  test("deferred freeze: while enforcement is OFF a lapsed couple still edits (no 402)", async () => {
    seedCouples(200);
    const { token, coupleId } = await bootstrapCouple("deferred@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId); // would lapse
    // Leave enforcement OFF (the default) — nobody should be paywalled yet.

    const get = await getCouple(token);
    expect(get.data.couple.billing.entitled).toBe(true);

    const edit = await req("POST", "/api/households", { label: "Still editable" }, { token });
    expect(edit.status).toBe(201);
  });

  test("an admin-owned couple is never payment-obligated, even with enforcement ON", async () => {
    seedCouples(200);
    // admin@test.test is the pinned ADMIN_EMAILS value in setup.ts.
    const { token, coupleId } = await bootstrapCouple("admin@test.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId); // expired trial
    setBillingEnforcement(true, 1); // paywall live for everyone else

    const get = await getCouple(token);
    expect(get.data.couple.billing.entitled).toBe(true);

    const edit = await req("POST", "/api/households", { label: "Admin edits" }, { token });
    expect(edit.status).toBe(201);
  });

  test("admin enforcement toggle: requires admin, refuses ON below 200, then sets/clears", async () => {
    const { token: userToken } = await bootstrapCouple("toggle-user@weddly.test");
    const adminToken = await addAdmin();
    const setEnforce = (on: boolean, tok: string) =>
      req<AdminFinancialPlannerOverview>(
        "POST",
        "/api/admin/financial-planner/enforcement",
        { on },
        { token: tok },
      );

    // Non-admin is rejected.
    const forbidden = await setEnforce(true, userToken);
    expect(forbidden.status).toBe(403);

    // Admin, but fewer than 200 couples → refused.
    const tooEarly = await setEnforce(true, adminToken);
    expect(tooEarly.status).toBe(400);

    // Fill the cohort, then go live.
    seedCouples(200);
    const on = await setEnforce(true, adminToken);
    expect(on.status).toBe(200);
    expect(on.data.billing_enforcement_on).toBe(true);
    expect(on.data.enforcement_ready).toBe(true);

    // And turn it back off.
    const off = await setEnforce(false, adminToken);
    expect(off.status).toBe(200);
    expect(off.data.billing_enforcement_on).toBe(false);
  });

  test("checkout + webhook degrade gracefully while Stripe is unconfigured", async () => {
    const { token } = await bootstrapCouple("nostripe@weddly.test");
    const checkout = await req("POST", "/api/billing/checkout", {}, { token });
    expect(checkout.status).toBe(503);
    const webhook = await req("POST", "/api/billing/webhook", {});
    expect(webhook.status).toBe(503);
  });
});
