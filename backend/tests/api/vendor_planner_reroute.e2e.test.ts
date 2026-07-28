// Wedding planners must never end up holding a VENDOR account, and when one
// already does, an admin can move them across.
//
// The motivating case was real: a curated `wedding_planner` directory entry was
// claimed through /vendor/claim, which minted `users.role='vendor'` for someone
// whose whole product is the planner workspace. Vendor SIGNUP had blocked the
// category since 8e506f4a; the claim funnel and the cold claim-invite campaign
// that hands out claim links had not.
//
// Covers (major-change rule: new endpoint + new state machine + auth change):
//   - claim start refuses a planner listing before the mail goes out
//   - claim verify on an already-minted token reports `blocked: "planner"`
//     instead of dead-ending, and complete still refuses
//   - a normal listing is unaffected by the guard
//   - claim-invite targeting skips planner listings
//   - POST /api/admin/vendors/:id/convert-to-planner moves the account:
//     planner user_type, planner subscription, listing released back to
//     unclaimed, vendor_accounts row gone, couple inquiries preserved

import "../setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { createClaim } from "../../src/domain/listing_claims";
import { listTargets } from "../../src/domain/vendor_campaign";
import { getCampaignRow } from "../../src/domain/vendor_campaign";
import type { AuthSession } from "@shared/types";
import type { ClaimVerifyView } from "@shared/vendor_claim";
import type { VendorCampaign, VendorCampaignTarget } from "@shared/vendor_campaign";
import { bootstrapCouple, registerAndVerify, req, verifyUserEmail, wipeAll } from "../helpers";

let adminToken = "";

/** Curated listing straight into `listings` — every surface under test reads
 *  that table, so walking the community submit + moderation flow per fixture
 *  would add noise without adding coverage. */
function seedListing(patch: {
  id: string;
  category: string;
  contact_email: string | null;
  vendor_account_id?: number | null;
}): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, contact_email, status, created_at, updated_at)
     VALUES (?, 'curated', ?, ?, ?, 'Budapest', ?, 'active', ?, ?)`,
  ).run(
    patch.id,
    patch.vendor_account_id ?? null,
    patch.category,
    `Fixture ${patch.id}`,
    patch.contact_email,
    ts,
    ts,
  );
}

beforeAll(async () => {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  adminToken = reg.data.token;
});

// The fixtures here are CURATED listings and a live claim campaign, both of
// which later suites count globally (listings_p2a asserts the curated row count
// equals DIRECTORY.length; campaign_schedules refuses to prepare a round while
// one of the family is still in flight). Leaving them behind fails those files,
// not this one, so clean up on the way out.
afterAll(() => {
  db.prepare("DELETE FROM listings WHERE id LIKE 'reroute-%'").run();
  db.prepare(
    "DELETE FROM vendor_claim_campaign_sends WHERE campaign_id IN (SELECT id FROM vendor_claim_campaigns WHERE slug = 'reroute-targeting')",
  ).run();
  db.prepare("DELETE FROM vendor_claim_campaigns WHERE slug = 'reroute-targeting'").run();
});

describe("planner listings are closed to the vendor funnel", () => {
  test("claim start refuses a wedding_planner listing", async () => {
    seedListing({
      id: "reroute-planner-1",
      category: "wedding_planner",
      contact_email: "planner1@example.com",
    });

    const r = await req<{ code?: string }>("POST", "/api/vendor/claim/start", {
      listing_id: "reroute-planner-1",
      claimant_email: "planner1@example.com",
    });
    expect(r.status).toBe(409);
    // Nothing was minted and nothing was mailed: the guard sits before both.
    const claims = db
      .prepare("SELECT COUNT(*) AS n FROM listing_claims WHERE listing_id = ?")
      .get("reroute-planner-1") as { n: number };
    expect(claims.n).toBe(0);
  });

  test("a normal listing still starts a claim", async () => {
    seedListing({
      id: "reroute-photo-1",
      category: "photography",
      contact_email: "photo1@example.com",
    });

    const r = await req("POST", "/api/vendor/claim/start", {
      listing_id: "reroute-photo-1",
      claimant_email: "photo1@example.com",
    });
    expect(r.status).toBe(200);
  });

  // The invite campaign pre-minted claim rows before this guard existed, so
  // those links are live in real inboxes. They must land somewhere useful.
  test("verify reports blocked, complete refuses, on a pre-existing claim", async () => {
    seedListing({
      id: "reroute-planner-2",
      category: "wedding_planner",
      contact_email: "planner2@example.com",
    });
    const claim = createClaim("reroute-planner-2", "planner2@example.com", "planner2@example.com");

    const v = await req<{ claim: ClaimVerifyView }>(
      "POST",
      `/api/vendor/claim/verify/${claim.token}`,
      {},
    );
    expect(v.status).toBe(200);
    expect(v.data.claim.blocked).toBe("planner");
    expect(v.data.claim.listing_name).toBe("Fixture reroute-planner-2");

    const c = await req("POST", "/api/vendor/claim/complete", {
      token: claim.token,
      password: "supersafe123",
      full_name: "Planner Two",
    });
    expect(c.status).toBe(409);
    // No account, no flipped listing.
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get("planner2@example.com");
    expect(user).toBeFalsy();
    const listing = db
      .prepare("SELECT vendor_account_id FROM listings WHERE id = ?")
      .get("reroute-planner-2") as { vendor_account_id: number | null };
    expect(listing.vendor_account_id).toBeNull();
  });

  test("claim-invite targeting skips planner listings", async () => {
    seedListing({
      id: "reroute-planner-3",
      category: "wedding_planner",
      contact_email: "planner3@example.com",
    });
    seedListing({
      id: "reroute-photo-3",
      category: "photography",
      contact_email: "photo3@example.com",
    });

    const created = await req<{ campaign: VendorCampaign }>(
      "POST",
      "/api/admin/vendor-campaigns",
      { slug: "reroute-targeting" },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    const row = getCampaignRow(created.data.campaign.id);
    if (!row) throw new Error("campaign vanished");

    const targets: VendorCampaignTarget[] = listTargets(row, 500);
    const emails = targets.map((t) => t.email);
    expect(emails).toContain("photo3@example.com");
    expect(emails).not.toContain("planner3@example.com");
  });
});

describe("admin: move a mis-routed vendor to the planner side", () => {
  test("converts the account, releases the listing, keeps the inquiry", async () => {
    // A live vendor, made the ordinary way, then re-categorised to reproduce
    // production: the planner sitting on a vendor account. (Registering with
    // the category directly is refused, which is the point of the guard above.)
    const reg = await req<AuthSession>("POST", "/api/vendor/register", {
      email: "tobemoved@example.com",
      password: "supersafe123",
      full_name: "Moved Planner",
      business_name: "Eventfixture",
      category: "photography",
      locale: "en",
    });
    expect(reg.status).toBe(201);
    const userId = reg.data.user.id;
    // Vendor signup leaves the account unverified; verify it so the "their login
    // still works after the move" assertion below is testing the move rather
    // than the login gate.
    await verifyUserEmail("tobemoved@example.com");

    const account = db
      .prepare("SELECT id FROM vendor_accounts WHERE owner_user_id = ?")
      .get(userId) as { id: number };
    expect(account.id).toBeGreaterThan(0);
    const listing = db
      .prepare("SELECT id FROM listings WHERE vendor_account_id = ?")
      .get(account.id) as { id: string };
    db.prepare("UPDATE listings SET category = 'wedding_planner' WHERE id = ?").run(listing.id);

    // A couple inquiry on the books — it must survive the move (SET NULL), or
    // the couple loses a supplier record because of our repair.
    const { coupleId } = await bootstrapCouple("reroute-couple@weddly.test");
    const ts = now();
    db.prepare(
      `INSERT INTO supplier_bookings
         (couple_id, supplier_id, vendor_account_id, event_date, status, created_at, updated_at)
       VALUES (?, ?, ?, '2027-06-05', 'requested', ?, ?)`,
    ).run(coupleId, listing.id, account.id, ts, ts);

    const res = await req<{
      ok: true;
      user_id: number;
      listings_released: number;
      bookings_unlinked: number;
    }>("POST", `/api/admin/vendors/${account.id}/convert-to-planner`, {}, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.data.user_id).toBe(userId);
    expect(res.data.listings_released).toBe(1);
    expect(res.data.bookings_unlinked).toBe(1);

    // The person: same row, now a planner, still able to sign in.
    const user = db
      .prepare("SELECT role, user_type, business_name, verified_email FROM users WHERE id = ?")
      .get(userId) as {
      role: string;
      user_type: string;
      business_name: string | null;
      verified_email: number;
    };
    expect(user.user_type).toBe("planner");
    expect(user.role).not.toBe("vendor");
    expect(user.verified_email).toBe(1);
    expect(user.business_name).toBe("Eventfixture");

    const login = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "tobemoved@example.com",
      password: "supersafe123",
    });
    expect(login.status).toBe(200);

    // Planner billing exists, so they aren't locked out on arrival.
    const sub = db
      .prepare("SELECT subscription_status FROM planner_subscriptions WHERE user_id = ?")
      .get(userId) as { subscription_status: string } | undefined;
    expect(sub?.subscription_status).toBeTruthy();

    // The vendor side is gone, the directory card is back to unclaimed.
    const gone = db.prepare("SELECT id FROM vendor_accounts WHERE id = ?").get(account.id);
    expect(gone).toBeFalsy();
    const released = db
      .prepare("SELECT vendor_account_id, status FROM listings WHERE id = ?")
      .get(listing.id) as { vendor_account_id: number | null; status: string };
    expect(released.vendor_account_id).toBeNull();
    expect(released.status).toBe("active");

    // The couple's inquiry survived, just unlinked.
    const booking = db
      .prepare("SELECT vendor_account_id FROM supplier_bookings WHERE supplier_id = ?")
      .get(listing.id) as { vendor_account_id: number | null } | undefined;
    expect(booking).toBeTruthy();
    expect(booking?.vendor_account_id).toBeNull();
  });

  test("is admin-only and 404s on an unknown account", async () => {
    const anon = await req("POST", "/api/admin/vendors/999999/convert-to-planner", {});
    expect(anon.status).toBe(401);

    const missing = await req(
      "POST",
      "/api/admin/vendors/999999/convert-to-planner",
      {},
      { token: adminToken },
    );
    expect(missing.status).toBe(404);
  });
});
