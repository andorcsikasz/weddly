// P2.B + P2.C — growth instrumentation + vendor listing-claim flow.
// Verifies:
//   - Server-side hooks fire (rsvp.page.view, rsvp.submitted, guest.portal.view)
//   - POST /api/growth/event allowlist (rsvp.share_link.copied OK; other kinds 400)
//   - Vendor claim flow: start → verify → complete creates user+vendor_account
//     and flips listings.vendor_account_id atomically
//   - Negative paths: listing with no contact_email refuses; already-claimed
//     listing refuses; existing email on complete refuses
//
// See [[feedback_multi_agent_debate]] (paths D + E synthesis) for context.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";

interface GrowthRow {
  kind: string;
  couple_id: number | null;
  household_id: number | null;
  user_id: number | null;
  referrer: string | null;
  user_agent_hash: string | null;
  payload_json: string | null;
}

function listGrowth(kind?: string): GrowthRow[] {
  if (kind) {
    return db
      .prepare(
        "SELECT kind, couple_id, household_id, user_id, referrer, user_agent_hash, payload_json FROM growth_events WHERE kind = ? ORDER BY id DESC",
      )
      .all(kind) as GrowthRow[];
  }
  return db
    .prepare(
      "SELECT kind, couple_id, household_id, user_id, referrer, user_agent_hash, payload_json FROM growth_events ORDER BY id DESC",
    )
    .all() as GrowthRow[];
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

/** Spin up a community supplier with a contact email, walk it through email-
 *  verify + admin approve, and return its public id (`c{N}`) + contact email
 *  + numeric community id. Used as the substrate for claim tests. */
async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<{ listingId: string; numericId: number; contactEmail: string }> {
  const { token } = await bootstrapCouple(ownerEmail);

  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photo_video",
      submitter_type: "self",
      name,
      city: "Budapest",
      address: null,
      website: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${name} for claim flow E2E`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;
  const numericId = Number(publicId.slice(1));

  // Verify email so the listing flips to awaiting_review
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as { token: string } | undefined;
  expect(vtok).toBeTruthy();
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  // Admin approves → status='active', and listings dual-write keeps in sync
  const adminToken = await registerAdminAndGetToken();
  const ap = await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: adminToken });
  expect(ap.status).toBe(200);

  return { listingId: publicId, numericId, contactEmail };
}

// ── P2.B growth instrumentation ───────────────────────────────────────────

describe("P2.B growth events: server-side hooks", () => {
  test("rsvp.page.view fires on /api/rsvp/lookup", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("growth-rsvp-view@weddly.test");

    // Create a guest so a household is materialised (bootstrapCouple doesn't
    // do that on its own — the household table is empty after onboard).
    const g = await req<{ guest: { household_id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Pageview Guest", new_household_label: "Pageview HH" },
      { token },
    );
    expect(g.status).toBe(201);

    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    const hhRow = db
      .prepare("SELECT id, code FROM households WHERE id = ?")
      .get(g.data.guest.household_id) as { id: number; code: string } | undefined;
    expect(hhRow).toBeTruthy();

    const r = await req(
      "GET",
      `/api/rsvp/lookup?couple=${encodeURIComponent(slugRow!.slug)}&code=${encodeURIComponent(hhRow!.code)}`,
    );
    expect(r.status).toBe(200);

    const events = listGrowth("rsvp.page.view");
    expect(events.length).toBe(1);
    expect(events[0]?.couple_id).toBe(coupleId);
    expect(events[0]?.household_id).toBe(hhRow!.id);
  });

  test("rsvp.submitted fires on /api/rsvp/checkin with counts payload", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("growth-rsvp-submit@weddly.test");

    // Create a guest (and household) via the API so a household_code exists.
    const g = await req<{ guest: { id: number; household_id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Test Guest", new_household_label: "Test HH" },
      { token },
    );
    expect(g.status).toBe(201);

    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    const hhRow = db
      .prepare("SELECT id, code FROM households WHERE id = ?")
      .get(g.data.guest.household_id) as { id: number; code: string } | undefined;
    expect(hhRow).toBeTruthy();

    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slugRow?.slug,
      household_code: hhRow!.code,
      members: [
        {
          guest_id: g.data.guest.id,
          rsvp_status: "yes",
          meal_choice: "meat",
          dietary: null,
          accommodation_needed: false,
          song_request: null,
        },
      ],
    });
    expect(r.status).toBe(200);

    const events = listGrowth("rsvp.submitted");
    expect(events.length).toBe(1);
    expect(events[0]?.couple_id).toBe(coupleId);
    expect(events[0]?.household_id).toBe(hhRow!.id);
    const payload = JSON.parse(events[0]?.payload_json ?? "{}") as {
      counts?: { yes: number; no: number };
    };
    expect(payload.counts?.yes).toBe(1);
  });

  test("guest.portal.view fires after at least one yes RSVP", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("growth-portal@weddly.test");
    const g = await req<{ guest: { id: number; household_id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Portal Guest", new_household_label: "Portal HH" },
      { token },
    );
    expect(g.status).toBe(201);

    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    const hhRow = db
      .prepare("SELECT id, code FROM households WHERE id = ?")
      .get(g.data.guest.household_id) as { id: number; code: string } | undefined;

    // Submit yes RSVP first so the portal gate opens.
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slugRow?.slug,
      household_code: hhRow!.code,
      members: [
        {
          guest_id: g.data.guest.id,
          rsvp_status: "yes",
          meal_choice: null,
          dietary: null,
          accommodation_needed: false,
          song_request: null,
        },
      ],
    });

    const r = await req(
      "GET",
      `/api/guest/portal?couple=${encodeURIComponent(slugRow!.slug)}&code=${encodeURIComponent(hhRow!.code)}`,
    );
    expect(r.status).toBe(200);

    const events = listGrowth("guest.portal.view");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.couple_id).toBe(coupleId);
  });
});

describe("P2.B frontend ping endpoint", () => {
  test("accepts an allowlisted kind", async () => {
    wipeAll();
    const r = await req("POST", "/api/growth/event", { kind: "rsvp.share_link.copied" });
    expect(r.status).toBe(200);
    const events = listGrowth("rsvp.share_link.copied");
    expect(events.length).toBe(1);
  });

  test("rejects a non-allowlisted kind", async () => {
    wipeAll();
    const r = await req("POST", "/api/growth/event", { kind: "rsvp.page.view" });
    expect(r.status).toBe(400);
    expect(listGrowth("rsvp.page.view").length).toBe(0);
  });
});

// ── P2.C vendor claim flow ────────────────────────────────────────────────

interface ClaimVerifyRow {
  id: number;
  status: string;
  email_sent_to: string;
  token: string;
  listing_id: string;
}

describe("P2.C vendor claim — happy path", () => {
  test("start → verify → complete creates user, vendor_account, flips listings.vendor_account_id", async () => {
    wipeAll();
    const { listingId, contactEmail } = await makeApprovedListing(
      "claim-owner@weddly.test",
      "studio@claim.example",
      "Claim Photo Studio",
    );

    // 1. Start the claim
    const start = await req<{ ok: true; sent_to_masked: string }>(
      "POST",
      "/api/vendor/claim/start",
      { listing_id: listingId },
    );
    expect(start.status).toBe(200);
    expect(start.data.sent_to_masked).toMatch(/\*+@claim\.example/);

    // 2. Pull token directly from the DB (simulates clicking the email link)
    const claimRow = db
      .prepare("SELECT id, status, email_sent_to, token, listing_id FROM listing_claims WHERE listing_id = ? ORDER BY id DESC LIMIT 1")
      .get(listingId) as ClaimVerifyRow | undefined;
    expect(claimRow).toBeTruthy();
    expect(claimRow?.status).toBe("pending");
    expect(claimRow?.email_sent_to).toBe(contactEmail);

    // 3. Verify endpoint returns the view without consuming
    const verify = await req<{ claim: { listing_id: string; listing_name: string; email: string; status: string } }>(
      "POST",
      `/api/vendor/claim/verify/${claimRow!.token}`,
      {},
    );
    expect(verify.status).toBe(200);
    expect(verify.data.claim.listing_id).toBe(listingId);
    expect(verify.data.claim.listing_name).toBe("Claim Photo Studio");
    expect(verify.data.claim.email).toBe(contactEmail);
    expect(verify.data.claim.status).toBe("pending");

    // 4. Complete: creates user, vendor_account, flips listing
    const complete = await req<{ token: string; user: { id: number; role: string; email: string } }>(
      "POST",
      "/api/vendor/claim/complete",
      {
        token: claimRow!.token,
        password: "vendorpass123",
        full_name: "Vendor Owner",
      },
    );
    expect(complete.status).toBe(201);
    expect(complete.data.user.role).toBe("vendor");
    expect(complete.data.user.email).toBe(contactEmail);
    expect(complete.data.token).toBeTruthy();

    // Verify the DB state after completion
    const listing = db.prepare("SELECT vendor_account_id FROM listings WHERE id = ?").get(listingId) as
      | { vendor_account_id: number | null }
      | undefined;
    expect(listing?.vendor_account_id).not.toBeNull();

    const account = db
      .prepare("SELECT owner_user_id, display_name FROM vendor_accounts WHERE id = ?")
      .get(listing!.vendor_account_id) as { owner_user_id: number; display_name: string } | undefined;
    expect(account?.display_name).toBe("Claim Photo Studio");
    expect(account?.owner_user_id).toBe(complete.data.user.id);

    const finalClaim = db
      .prepare("SELECT status, verified_at, vendor_account_id FROM listing_claims WHERE id = ?")
      .get(claimRow!.id) as { status: string; verified_at: number | null; vendor_account_id: number | null } | undefined;
    expect(finalClaim?.status).toBe("verified");
    expect(finalClaim?.verified_at).not.toBeNull();
    expect(finalClaim?.vendor_account_id).toBe(listing!.vendor_account_id);
  });
});

describe("P2.C vendor claim — error paths", () => {
  test("start refuses when listing has no contact_email", async () => {
    wipeAll();
    // Use a curated listing — those land in the DB with contact_email = null.
    const curatedRow = db
      .prepare("SELECT id, contact_email FROM listings WHERE source = 'curated' AND contact_email IS NULL LIMIT 1")
      .get() as { id: string; contact_email: string | null } | undefined;
    expect(curatedRow).toBeTruthy();

    const r = await req("POST", "/api/vendor/claim/start", { listing_id: curatedRow!.id });
    expect(r.status).toBe(409);
  });

  test("start refuses when listing is already claimed", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "claim-twice-owner@weddly.test",
      "twice@claim.example",
      "Twice Claimed",
    );

    // First claim wins.
    const s1 = await req("POST", "/api/vendor/claim/start", { listing_id: listingId });
    expect(s1.status).toBe(200);
    const c1 = db
      .prepare("SELECT token FROM listing_claims WHERE listing_id = ? ORDER BY id DESC LIMIT 1")
      .get(listingId) as { token: string } | undefined;
    const done1 = await req("POST", "/api/vendor/claim/complete", {
      token: c1!.token,
      password: "vendorpass123",
      full_name: "First Claimant",
    });
    expect(done1.status).toBe(201);

    // Second start refuses with already_claimed.
    const s2 = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/claim/start",
      { listing_id: listingId },
    );
    expect(s2.status).toBe(409);
  });

  test("complete refuses when the email is already taken by a user", async () => {
    wipeAll();
    const conflictingEmail = "conflict@claim.example";
    // Register an existing user with that email first.
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: conflictingEmail,
      password: "supersafe123",
      full_name: "Existing User",
    });
    expect(reg.status).toBe(201);

    const { listingId } = await makeApprovedListing(
      "conflict-owner@weddly.test",
      conflictingEmail,
      "Conflict Studio",
    );

    const s = await req("POST", "/api/vendor/claim/start", { listing_id: listingId });
    expect(s.status).toBe(200);
    const c = db
      .prepare("SELECT token FROM listing_claims WHERE listing_id = ? ORDER BY id DESC LIMIT 1")
      .get(listingId) as { token: string } | undefined;

    const complete = await req(
      "POST",
      "/api/vendor/claim/complete",
      { token: c!.token, password: "newpass123", full_name: "New Vendor" },
    );
    expect(complete.status).toBe(409);
  });
});
