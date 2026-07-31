import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// End-to-end coverage for the founding grant fired by the REAL partner-accept
// HTTP flow (the billing suite only exercises `activatePartnerFreeWindow`
// directly). The regression this guards: a couple with several event-
// workspaces must still earn exactly ONE founding badge, on the owner's anchor
// (oldest workspace), even when the partner invite was created from — and
// accepted into — a secondary event. See domain/billing.activatePartnerFreeWindow
// + domain/couples.propagatePartnerToOwnerWorkspaces.

function billingRow(id: number) {
  return db
    .prepare(
      "SELECT id, subscription_status, is_founding_member, partner_b_id FROM couples WHERE id = ?",
    )
    .get(id) as {
    id: number;
    subscription_status: string;
    is_founding_member: number;
    partner_b_id: number | null;
  };
}

async function invite(ownerToken: string, email: string): Promise<string> {
  const r = await req<{ invite: { token: string } }>(
    "POST",
    "/api/couples/invites",
    { invited_email: email },
    { token: ownerToken },
  );
  expect(r.status).toBe(201);
  return r.data.invite.token;
}

async function joinPartner(email: string, inviteToken: string): Promise<void> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Bea Nagy",
  });
  expect(reg.status).toBe(201);
  const acc = await req(
    "POST",
    `/api/invites/${inviteToken}/accept`,
    {},
    { token: reg.data.token },
  );
  expect(acc.status).toBe(200);
}

describe("founding grant via the partner-accept HTTP flow", () => {
  beforeEach(() => wipeAll());

  test("single-workspace couple: accepting the invite grants founding", async () => {
    const { token, coupleId } = await bootstrapCouple("solo-owner@weddly.test");
    const inviteToken = await invite(token, "solo-partner@weddly.test");
    await joinPartner("solo-partner@weddly.test", inviteToken);

    const anchor = billingRow(coupleId);
    expect(anchor.subscription_status).toBe("founding");
    expect(anchor.is_founding_member).toBe(1);
  });

  test("multi-event couple: invite from a secondary still grants founding on the anchor only", async () => {
    const { token, coupleId: anchorId } = await bootstrapCouple("multi-owner@weddly.test");

    // Each additional event moves users.couple_id to the new workspace, so the
    // owner's ACTIVE workspace (and thus the invite target) ends up on the last
    // secondary — the exact shape of the real 3-event report.
    const e2 = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Civil ceremony" },
      { token },
    );
    expect(e2.status).toBe(201);
    const e3 = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Family dinner" },
      { token },
    );
    expect(e3.status).toBe(201);

    const inviteToken = await invite(token, "multi-partner@weddly.test");
    await joinPartner("multi-partner@weddly.test", inviteToken);

    // The single founding badge lands on the anchor (oldest workspace)...
    const anchor = billingRow(anchorId);
    expect(anchor.subscription_status).toBe("founding");
    expect(anchor.is_founding_member).toBe(1);
    // ...and never on a secondary (that would burn a FOUNDING_CAP slot per event).
    expect(billingRow(e2.data.couple.id).is_founding_member).toBe(0);
    expect(billingRow(e3.data.couple.id).is_founding_member).toBe(0);
  });
});

// ── Repair: the verdict has to sit where it can be spent ────────────────────
// `toCoupleBilling` reads the ANCHOR, so a founding badge on a secondary is
// worth nothing to the couple while still costing the cohort a seat. Two ways
// that happened: the pre-anchor grant (before 2026-07-06) landed on whatever
// workspace the invite targeted, and pausing the first workspace promotes the
// next one to anchor without the badge following. `reconcileFoundingOnAnchor`
// (and its boot backfill) is the repair; it is slot-neutral by construction.

describe("founding anchor reconciliation", () => {
  beforeEach(() => wipeAll());

  test("a badge stranded on a secondary moves to the anchor, spending no extra slot", async () => {
    const { token, coupleId: anchorId } = await bootstrapCouple("stranded-owner@weddly.test");
    const e2 = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Civil ceremony" },
      { token },
    );
    expect(e2.status).toBe(201);
    const secondaryId = e2.data.couple.id;
    const inviteToken = await invite(token, "stranded-partner@weddly.test");
    await joinPartner("stranded-partner@weddly.test", inviteToken);
    // Rewind to the pre-anchor world: badge on the secondary, anchor on trial.
    db.prepare(
      `UPDATE couples SET subscription_status='trialing', is_founding_member=0,
                          founding_until=NULL WHERE id = ?`,
    ).run(anchorId);
    db.prepare(
      `UPDATE couples SET subscription_status='founding', is_founding_member=1,
                          founding_until=? WHERE id = ?`,
    ).run(Date.now() + 86_400_000, secondaryId);
    const before = foundingBadges();

    const { backfillFoundingAnchor } = await import("../../src/domain/billing");
    expect(backfillFoundingAnchor().moved).toBe(1);

    const anchor = billingRow(anchorId);
    expect(anchor.subscription_status).toBe("founding");
    expect(anchor.is_founding_member).toBe(1);
    // The secondary gives its badge up — one owner, one seat.
    expect(billingRow(secondaryId).is_founding_member).toBe(0);
    expect(foundingBadges()).toBe(before);
  });

  test("an anchor holding both partners but no verdict is granted", async () => {
    const { token, coupleId } = await bootstrapCouple("noverdict-owner@weddly.test");
    const inviteToken = await invite(token, "noverdict-partner@weddly.test");
    await joinPartner("noverdict-partner@weddly.test", inviteToken);
    // Wipe the verdict but keep partner_b_id — the shape left behind when a
    // partner arrives by propagation, which is deliberately billing-neutral.
    db.prepare(
      `UPDATE couples SET subscription_status='trialing', is_founding_member=0,
                          founding_until=NULL WHERE id = ?`,
    ).run(coupleId);

    const { backfillFoundingAnchor } = await import("../../src/domain/billing");
    expect(backfillFoundingAnchor().granted).toBe(1);
    expect(billingRow(coupleId).is_founding_member).toBe(1);
  });

  test("a still-solo owner is left on trial, and the pass is idempotent", async () => {
    const { coupleId } = await bootstrapCouple("solo-noop@weddly.test");
    const { backfillFoundingAnchor } = await import("../../src/domain/billing");
    expect(backfillFoundingAnchor()).toEqual({ moved: 0, granted: 0 });
    expect(billingRow(coupleId).subscription_status).toBe("trialing");
    // A healthy founder is a no-op too, however many times it runs.
    const { token } = await bootstrapCouple("idem-owner@weddly.test");
    const inviteToken = await invite(token, "idem-partner@weddly.test");
    await joinPartner("idem-partner@weddly.test", inviteToken);
    const before = foundingBadges();
    backfillFoundingAnchor();
    backfillFoundingAnchor();
    expect(foundingBadges()).toBe(before);
  });
});

/** Live founding badges across every non-demo couple — the number FOUNDING_CAP
 *  is counted against, so every assertion about "spends no extra slot" reads
 *  this rather than a per-couple flag. */
function foundingBadges(): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 0 AND is_founding_member = 1")
    .get() as { n: number };
  return r.n;
}
