// Subscription billing state machine + read-only gate.
//
// Stripe stays DISABLED in tests (STRIPE_ENABLED=false), so this exercises the
// parts that don't need a live Stripe: trial init at onboarding, the founding
// transition when partner B joins, entitlement computation, the 402 edit gate
// once a trial lapses, and that checkout/portal/webhook degrade gracefully.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { BillingStatusResponse } from "@shared/billing";
import type { Couple } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

async function freshUserNoCouple(email: string): Promise<{ token: string }> {
  const r = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner",
  });
  expect(r.status).toBe(201);
  await verifyUserEmail(email);
  return { token: r.data.token };
}

async function createInvite(ownerToken: string): Promise<string> {
  const inv = await req<{ invite: { token: string } }>(
    "POST",
    "/api/couples/invites",
    {},
    { token: ownerToken },
  );
  expect(inv.status).toBe(201);
  return inv.data.invite.token;
}

describe("billing state machine", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("onboarding starts a 14-day trial and the couple is entitled", async () => {
    const { token } = await bootstrapCouple("trial-start@weddly.test");
    const r = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couple.billing.subscription_status).toBe("trialing");
    expect(r.data.couple.billing.entitled).toBe(true);
    expect(r.data.couple.billing.reason).toBe("trialing");
    expect(typeof r.data.couple.billing.trial_ends_at).toBe("number");
    expect(r.data.couple.billing.is_founding_member).toBe(false);
  });

  test("GET /api/billing/status reports disabled Stripe + 200 founding spots", async () => {
    const { token } = await bootstrapCouple("status@weddly.test");
    const r = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.enabled).toBe(false);
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.currency).toBe("HUF");
    expect(r.data.price).toBe(1990);
    // A solo trialing couple holds no founding membership yet → all 200 free.
    expect(r.data.founding_spots_left).toBe(200);
  });

  test("partner B joining the first-200 couple activates the 18-month founding plan", async () => {
    const { token: aToken, coupleId } = await bootstrapCouple("founding-a@weddly.test");
    const inviteToken = await createInvite(aToken);
    const { token: bToken } = await freshUserNoCouple("founding-b@weddly.test");
    const accept = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });
    expect(accept.status).toBe(200);

    const r = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, {
      token: aToken,
    });
    expect(r.data.couple.billing.subscription_status).toBe("founding");
    expect(r.data.couple.billing.is_founding_member).toBe(true);
    expect(r.data.couple.billing.entitled).toBe(true);
    expect(r.data.couple.billing.reason).toBe("founding");
    expect(r.data.couple.billing.founding_until).toBeGreaterThan(Date.now());

    const status = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, {
      token: aToken,
    });
    expect(status.data.founding_spots_left).toBe(199);

    // Sanity: the couple row really flipped, including the partner link.
    const row = db
      .prepare("SELECT partner_b_id, is_founding_member FROM couples WHERE id = ?")
      .get(coupleId) as { partner_b_id: number | null; is_founding_member: number };
    expect(row.partner_b_id).not.toBeNull();
    expect(row.is_founding_member).toBe(1);
  });

  test("a couple past the 200 cap keeps the trial (no founding) when the partner joins", async () => {
    // Push this couple's creation rank past the cap by pretending 200 earlier
    // real couples already exist (set its id-rank via a high created_at isn't
    // enough — rank is by id; instead seed 200 placeholder rows).
    const { token: aToken } = await bootstrapCouple("overcap-a@weddly.test");
    // Seed 200 earlier non-demo couples (negative ids, all < our couple's id)
    // so foundingRank() lands at >= 200 and the cap is exceeded.
    const insert = db.prepare(
      `INSERT INTO couples (id, partner_a_id, display_name, bride_name, groom_name,
         style_tags_json, frozen_categories_json, status, created_at, updated_at, is_demo)
       VALUES (?, 1, 'x', '', '', '[]', '[]', 'active', 1, 1, 0)`,
    );
    db.transaction(() => {
      for (let i = 1; i <= 200; i++) insert.run(-i);
    })();

    const inviteToken = await createInvite(aToken);
    const { token: bToken } = await freshUserNoCouple("overcap-b@weddly.test");
    await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: bToken });

    const r = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, {
      token: aToken,
    });
    // Rank counts couples with id < coupleId; our placeholders have negative
    // ids (all < coupleId) so the couple is past the cap → stays trialing.
    expect(r.data.couple.billing.subscription_status).toBe("trialing");
    expect(r.data.couple.billing.is_founding_member).toBe(false);
  });

  test("an expired trial flips the workspace to read-only (402 on edits, GET still works)", async () => {
    const { token, coupleId } = await bootstrapCouple("lapse@weddly.test");
    // Force the trial into the past.
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId);

    // Reads still work.
    const get = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });
    expect(get.status).toBe(200);
    expect(get.data.couple.billing.entitled).toBe(false);
    expect(get.data.couple.billing.reason).toBe("trial_expired");

    // Edits are blocked with 402 + the subscription_required code.
    const edit = await req<{ error: string; detail?: { code?: string; reason?: string } }>(
      "POST",
      "/api/households",
      { label: "Smith family" },
      { token },
    );
    expect(edit.status).toBe(402);
    expect(edit.data.detail?.code).toBe("subscription_required");
    expect(edit.data.detail?.reason).toBe("trial_expired");
  });

  test("checkout + webhook degrade gracefully while Stripe is unconfigured", async () => {
    const { token } = await bootstrapCouple("nostripe@weddly.test");
    const checkout = await req("POST", "/api/billing/checkout", {}, { token });
    expect(checkout.status).toBe(503);

    // No signature, billing disabled → 503 (never silently 200).
    const webhook = await req("POST", "/api/billing/webhook", {});
    expect(webhook.status).toBe(503);
  });
});
