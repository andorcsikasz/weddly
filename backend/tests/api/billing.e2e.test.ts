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
import { type BillingStatusResponse, MONTHLY_PRICE, PAID_LAUNCH_DATE } from "@shared/billing";
import type { Couple } from "@shared/types";
import { db } from "../../src/db";
import {
  activatePartnerFreeWindow,
  claimStripeEvent,
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
    expect(r.data.price).toBe(MONTHLY_PRICE.HUF);
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

    // The couple is notified by email that they were comped.
    const mail = db
      .prepare(
        "SELECT kind, to_email FROM email_log WHERE couple_id = ? AND kind = 'free_access_granted' ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { kind: string; to_email: string } | undefined;
    expect(mail?.kind).toBe("free_access_granted");
    expect(mail?.to_email).toBe("comp@weddly.test");

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

  test("stripe webhook events are claimed once (replay is a no-op)", () => {
    wipeAll();
    // First delivery of an event id is claimed (process it); every replay of the
    // same id is rejected (skip it) so a redelivered subscription event can't
    // re-apply stale state. The handler calls this right after verifying the
    // Stripe signature.
    expect(claimStripeEvent("evt_replay_1", "customer.subscription.updated")).toBe(true);
    expect(claimStripeEvent("evt_replay_1", "customer.subscription.updated")).toBe(false);
    expect(claimStripeEvent("evt_replay_1", "customer.subscription.deleted")).toBe(false);
    // A different event id is independent.
    expect(claimStripeEvent("evt_replay_2", "customer.subscription.updated")).toBe(true);
  });

  test("checkout + webhook degrade gracefully while Stripe is unconfigured", async () => {
    const { token } = await bootstrapCouple("nostripe@weddly.test");
    const checkout = await req("POST", "/api/billing/checkout", {}, { token });
    expect(checkout.status).toBe(503);
    const webhook = await req("POST", "/api/billing/webhook", {});
    expect(webhook.status).toBe(503);
  });
});

// ── Multi-workspace billing inheritance ─────────────────────────────────────
// An additional event-workspace rides the billing VERDICT of the owner's FIRST
// workspace — "the same rules apply to every workspace under one account as to
// the first". This both stops a second event minting its own fresh trial to
// dodge a lapsed primary AND lets a free (founding/trial) primary keep the
// owner's other events editable.

/** Spin up an additional (Bravo) workspace for `token` and return its id. The
 *  create flow also switches the user's ACTIVE pointer to it, so a subsequent
 *  GET /api/couples/current reads the new workspace. */
async function spawnEvent(token: string, label: string): Promise<number> {
  const r = await req<{ couple: { id: number } }>(
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

describe("multi-workspace billing inheritance", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a second event rides a founding primary: entitled even with its OWN trial expired, but not itself a founding member", async () => {
    const { token, coupleId: primaryId } = await bootstrapCouple("multi-a@weddly.test");
    // Put the primary (the owner's first workspace) on the founding free plan.
    const until = Date.now() + 1000 * 60 * 60 * 24 * 365;
    db.prepare(
      "UPDATE couples SET subscription_status = 'founding', is_founding_member = 1, founding_until = ? WHERE id = ?",
    ).run(until, primaryId);

    const secondaryId = await spawnEvent(token, "Civil ceremony");
    // Expire the secondary's OWN trial so only inheritance can keep it alive,
    // and turn the paywall on so a non-inherited secondary WOULD go read-only.
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(secondaryId);
    setBillingEnforcement(true, 1);

    // The active workspace is now the secondary; it reads the primary's plan.
    const cur = await getCouple(token);
    expect(cur.data.couple.id).toBe(secondaryId);
    expect(cur.data.couple.billing.entitled).toBe(true);
    expect(cur.data.couple.billing.subscription_status).toBe("founding");
    // ...but it does NOT itself count as a founding member (no slot consumed).
    expect(cur.data.couple.billing.is_founding_member).toBe(false);

    // And it is actually editable (not blocked by the read-only gate).
    const edit = await req("POST", "/api/households", { label: "Smith family" }, { token });
    expect(edit.status).not.toBe(402);
  });

  test("a lapsed primary makes new events read-only too — a second workspace can't mint a fresh trial to dodge the paywall", async () => {
    const { token, coupleId: primaryId } = await bootstrapCouple("multi-b@weddly.test");
    const secondaryId = await spawnEvent(token, "After-party");

    // Lapse the PRIMARY (expired trial, never subscribed) and turn the paywall on.
    db.prepare(
      "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = 1 WHERE id = ?",
    ).run(primaryId);
    setBillingEnforcement(true, 1);

    // The secondary still has its own fresh, unexpired trial — but inheritance
    // from the lapsed primary wins, so it is read-only.
    const cur = await getCouple(token);
    expect(cur.data.couple.id).toBe(secondaryId);
    expect(cur.data.couple.billing.entitled).toBe(false);

    const edit = await req("POST", "/api/households", { label: "x" }, { token });
    expect(edit.status).toBe(402);
  });

  test("admin overview stamps owner_user_id so all of one owner's workspaces group together", async () => {
    const { token } = await bootstrapCouple("multi-c@weddly.test");
    const secondaryId = await spawnEvent(token, "Rehearsal dinner");
    const adminToken = await addAdmin();

    const list = await req<{ couples: AdminCoupleView[] }>(
      "GET",
      "/api/admin/couples",
      undefined,
      { token: adminToken },
    );
    expect(list.status).toBe(200);
    const owner = list.data.couples.find((c) => c.id === secondaryId)?.owner_user_id ?? null;
    expect(owner).not.toBeNull();
    // Every workspace this owner created shares the same owner_user_id, so the
    // admin UI can collapse them under one card with an "×N" pill.
    const owned = list.data.couples.filter((c) => c.owner_user_id === owner);
    expect(owned.length).toBe(2);
  });
});
