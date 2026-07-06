import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

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
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner B",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const acc = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: reg.data.token });
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
