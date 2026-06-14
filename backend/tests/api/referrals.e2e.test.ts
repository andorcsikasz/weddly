// Referral invite system: code generation, couple referral reward (1 month),
// vendor referral reward (2 months), double-grant prevention.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION as _PRIVACY_VERSION, VENDOR_BETA_NOTICE_VERSION as _VBN_VERSION } from "@shared/legal";
import type { ReferralStatusResponse } from "../../src/routes/referrals";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Submit the vendor waitlist using multipart form-data (the endpoint requires it). */
async function submitVendorWaitlist(
  fields: Record<string, string>,
): Promise<{ status: number; data: { entry: { id: number } } }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (!fields.privacy_version) form.append("privacy_version", _PRIVACY_VERSION);
  if (!fields.vendor_beta_notice_version) form.append("vendor_beta_notice_version", _VBN_VERSION);
  const res = await fetch(`${BASE}/api/vendors/waitlist`, { method: "POST", body: form });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  wipeAll();
  // Force billing enforcement on so we can see entitlement changes.
  db.exec(
    "UPDATE billing_control SET enforcement_on = 1 WHERE id = 1",
  );
});

describe("referral code", () => {
  test("GET /api/referral returns a code and urls", async () => {
    const { token } = await bootstrapCouple("ref_owner@weddly.test");
    const r = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.code).toHaveLength(8);
    expect(r.data.couple_url).toContain("ref_code=");
    expect(r.data.vendor_url).toContain("ref_code=");
    expect(r.data.stats.couple_refs).toBe(0);
    expect(r.data.stats.vendor_refs).toBe(0);
    expect(r.data.stats.bonus_months).toBe(0);
  });

  test("code is stable on repeated calls", async () => {
    const { token } = await bootstrapCouple("code_stable@weddly.test");
    const r1 = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, { token });
    const r2 = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, { token });
    expect(r1.data.code).toBe(r2.data.code);
  });
});

describe("couple referral reward", () => {
  test("referrer gets 1 month when referred couple has partner B join", async () => {
    // Set up the referrer couple.
    const { token: refToken, coupleId: refCoupleId } = await bootstrapCouple(
      "referrer@weddly.test",
    );
    const refInfo = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, {
      token: refToken,
    });
    const code = refInfo.data.code;

    // Record trial_ends_at before the referral.
    const before = db
      .prepare("SELECT trial_ends_at FROM couples WHERE id = ?")
      .get(refCoupleId) as { trial_ends_at: number | null };

    // Register + onboard referred couple using the referral code.
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "referred@weddly.test",
      password: "supersafe123",
      full_name: "Referred",
    });
    expect(reg.status).toBe(201);
    await verifyUserEmail("referred@weddly.test");
    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Ref & Pair",
        wedding_date: "2027-06-01",
        style_tags: [],
        ref_code: code,
      },
      { token: reg.data.token },
    );
    expect(ob.status).toBe(201);
    const referredCoupleId = ob.data.couple.id;

    // Reward should NOT be granted yet (only partner A joined).
    const midRow = db
      .prepare("SELECT COUNT(*) AS n FROM referral_grants WHERE referrer_couple_id = ?")
      .get(refCoupleId) as { n: number };
    expect(midRow.n).toBe(0);

    // Partner B joins via invite.
    const inviteR = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "partnerb@weddly.test" },
      { token: reg.data.token },
    );
    expect(inviteR.status).toBe(201);
    const inviteToken = inviteR.data.invite.token;

    const regB = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "partnerb@weddly.test",
      password: "supersafe123",
      full_name: "Partner B",
    });
    expect(regB.status).toBe(201);
    const acceptR = await req(
      "POST",
      `/api/invites/${inviteToken}/accept`,
      {},
      { token: regB.data.token },
    );
    expect(acceptR.status).toBe(200);

    // Now the reward should have been granted.
    const grantRow = db
      .prepare("SELECT bonus_ms FROM referral_grants WHERE referrer_couple_id = ? AND referral_type = 'couple'")
      .get(refCoupleId) as { bonus_ms: number } | undefined;
    expect(grantRow).toBeDefined();
    expect(grantRow!.bonus_ms).toBe(1000 * 60 * 60 * 24 * 30);

    // Referrer's trial_ends_at should have grown by ~30 days.
    const afterRow = db
      .prepare("SELECT trial_ends_at FROM couples WHERE id = ?")
      .get(refCoupleId) as { trial_ends_at: number | null };
    if (before.trial_ends_at && afterRow.trial_ends_at) {
      expect(afterRow.trial_ends_at).toBeGreaterThan(before.trial_ends_at);
    }

    // /api/referral stats should reflect 1 couple ref.
    const stats = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, {
      token: refToken,
    });
    expect(stats.data.stats.couple_refs).toBe(1);
    expect(stats.data.stats.bonus_months).toBe(1);

    // Redundant trigger is a no-op (idempotent).
    const { maybeGrantCoupleReferral } = await import("../../src/domain/referrals");
    maybeGrantCoupleReferral(referredCoupleId);
    const grantCount = db
      .prepare("SELECT COUNT(*) AS n FROM referral_grants WHERE referrer_couple_id = ?")
      .get(refCoupleId) as { n: number };
    expect(grantCount.n).toBe(1);
  });

  test("self-referral is ignored", async () => {
    const { token, coupleId } = await bootstrapCouple("selfrefer@weddly.test");
    const refInfo = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, { token });
    // Stamp the couple's own code onto itself — backend guards prevent this.
    db.prepare("UPDATE couples SET referred_by_couple_id = ? WHERE id = ?").run(coupleId, coupleId);
    const { maybeGrantCoupleReferral } = await import("../../src/domain/referrals");
    maybeGrantCoupleReferral(coupleId);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM referral_grants").get() as { n: number }).n;
    expect(n).toBe(0);
    // Stats still 0
    const stats = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, { token });
    expect(stats.data.stats.couple_refs).toBe(0);
    void refInfo; // suppress unused var
  });
});

describe("vendor referral reward", () => {
  test("referrer gets 2 months when vendor activates via waitlist referral", async () => {
    const { token: refToken, coupleId: refCoupleId } = await bootstrapCouple(
      "vendor_ref@weddly.test",
    );
    const refInfo = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, {
      token: refToken,
    });
    const code = refInfo.data.code;

    const before = db
      .prepare("SELECT trial_ends_at FROM couples WHERE id = ?")
      .get(refCoupleId) as { trial_ends_at: number | null };

    // Submit vendor waitlist with the referral code (multipart form required).
    const wlRes = await submitVendorWaitlist({
      business_name: "Test Venue",
      email: "vendor@test.test",
      category: "venue",
      ref_code: code,
    });
    expect(wlRes.status).toBe(201);
    const waitlistId = wlRes.data.entry.id;

    // Verify the referred_by_couple_id was stored on the waitlist row.
    const wlRow = db
      .prepare("SELECT referred_by_couple_id FROM vendor_waitlist WHERE id = ?")
      .get(waitlistId) as { referred_by_couple_id: number | null };
    expect(wlRow.referred_by_couple_id).toBe(refCoupleId);

    // No reward yet — vendor hasn't activated.
    const midGrants = db
      .prepare("SELECT COUNT(*) AS n FROM referral_grants WHERE referrer_couple_id = ?")
      .get(refCoupleId) as { n: number };
    expect(midGrants.n).toBe(0);

    // Admin accepts (creates onboarding token).
    const adminReg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Admin",
    });
    await verifyUserEmail("admin@test.test");

    const decideR = await req(
      "POST",
      `/api/admin/vendor-waitlist/${waitlistId}/decide`,
      {
        outcome: "accepted",
        subject: "You're in!",
        body: "Welcome aboard.",
      },
      { token: adminReg.data.token },
    );
    expect(decideR.status).toBe(200);

    // Get the onboarding token from the DB.
    const otRow = db
      .prepare("SELECT token FROM vendor_onboarding WHERE waitlist_id = ? ORDER BY id DESC LIMIT 1")
      .get(waitlistId) as { token: string } | undefined;
    expect(otRow).toBeDefined();
    const onboardToken = otRow!.token;

    // Vendor activates.
    const activateR = await req("POST", "/api/vendor/onboard/complete", {
      token: onboardToken,
      password: "supersafe123",
      full_name: "Venue Owner",
    });
    expect(activateR.status).toBe(201);

    // Reward should now be granted.
    const grantRow = db
      .prepare(
        "SELECT bonus_ms FROM referral_grants WHERE referrer_couple_id = ? AND referral_type = 'vendor'",
      )
      .get(refCoupleId) as { bonus_ms: number } | undefined;
    expect(grantRow).toBeDefined();
    expect(grantRow!.bonus_ms).toBe(1000 * 60 * 60 * 24 * 60);

    // Referrer's trial should have extended.
    const afterRow = db
      .prepare("SELECT trial_ends_at FROM couples WHERE id = ?")
      .get(refCoupleId) as { trial_ends_at: number | null };
    if (before.trial_ends_at && afterRow.trial_ends_at) {
      expect(afterRow.trial_ends_at).toBeGreaterThan(before.trial_ends_at);
    }

    const stats = await req<ReferralStatusResponse>("GET", "/api/referral", undefined, {
      token: refToken,
    });
    expect(stats.data.stats.vendor_refs).toBe(1);
    expect(stats.data.stats.bonus_months).toBe(2);
  });
});
