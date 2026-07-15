// Registered vendors' own listings (source='claimed', self-serve id `v{N}`)
// must surface in the public `/api/suppliers` directory alongside curated +
// community entries, carrying the "verified vendor" signal (source='claimed',
// vendor_account_id set). Suspended owners + demo accounts stay hidden, and the
// admin detail path resolves the standalone claimed id.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { createVendorListing } from "../../src/domain/listings";
import { getUserByEmail } from "../../src/domain/users";
import { convertUserToVendor } from "../../src/domain/vendor_conversion";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

interface DirectoryItem {
  id: string;
  name: string;
  source: string;
  submitter_type: string | null;
  vendor_account_id: number | null;
}

/** Register a user, flip to role='vendor', and give them a vendor account +
 *  active 'claimed' listing (the self-serve/registered shape). Returns ids. */
async function seedRegisteredVendor(
  email: string,
  businessName: string,
  category: string,
): Promise<{ userId: number; accountId: number; listingId: string }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  await verifyUserEmail(email);
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: businessName,
    contactEmail: email,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category,
    name: businessName,
    city: "Budapest",
    contactEmail: email,
  });
  initVendorBilling(account.id, "HUF");
  return { userId, accountId: account.id, listingId: `v${account.id}` };
}

async function bootstrapAdminToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

describe("registered vendors in the public directory", () => {
  test("an active registered vendor appears with the verified 'claimed' signal", async () => {
    wipeAll();
    const { accountId, listingId } = await seedRegisteredVendor(
      "studio@weddly.test",
      "Fenyő Fotó",
      "photography",
    );

    const res = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    expect(res.status).toBe(200);
    const card = res.data.suppliers.find((s) => s.id === listingId);
    expect(card).toBeDefined();
    expect(card?.name).toBe("Fenyő Fotó");
    expect(card?.source).toBe("claimed");
    expect(card?.submitter_type).toBe("self");
    expect(card?.vendor_account_id).toBe(accountId);
  });

  test("category filter keeps the registered vendor when it matches", async () => {
    wipeAll();
    const { listingId } = await seedRegisteredVendor("dj@weddly.test", "DJ Nova", "dj");

    const match = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers?category=dj");
    expect(match.data.suppliers.some((s) => s.id === listingId)).toBe(true);

    const other = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?category=catering",
    );
    expect(other.data.suppliers.some((s) => s.id === listingId)).toBe(false);
  });

  test("a suspended vendor's listing is hidden from the directory", async () => {
    wipeAll();
    const { userId, listingId } = await seedRegisteredVendor(
      "gone@weddly.test",
      "Ghost Cakes",
      "cake_dessert",
    );
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(userId);

    const res = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    expect(res.data.suppliers.some((s) => s.id === listingId)).toBe(false);
  });

  test("the admin detail path resolves a standalone claimed listing", async () => {
    wipeAll();
    const adminToken = await bootstrapAdminToken();
    const { accountId, listingId } = await seedRegisteredVendor(
      "detail@weddly.test",
      "Detail Studio",
      "wedding_decor",
    );

    const res = await req<{ id: string; vendor_account_id: number | null; source: string }>(
      "GET",
      `/api/suppliers/${listingId}`,
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(listingId);
    expect(res.data.vendor_account_id).toBe(accountId);
    expect(res.data.source).toBe("claimed");
  });

  test("admin convert-to-vendor produces a directory-visible verified card", async () => {
    wipeAll();
    await bootstrapCouple("realsupplier@weddly.test");
    const user = getUserByEmail("realsupplier@weddly.test");
    const { vendorAccountId } = convertUserToVendor(user!, { category: "bridal_boutique" });

    const res = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    const card = res.data.suppliers.find((s) => s.id === `v${vendorAccountId}`);
    expect(card).toBeDefined();
    expect(card?.source).toBe("claimed");
    expect(card?.vendor_account_id).toBe(vendorAccountId);
  });
});

// Regression: PUT /api/suppliers/:id/vote rejected any id that wasn't a curated
// slug or a "c{N}" community id, so voting on a registered vendor's "v{N}"
// listing 404'd and the frontend rolled the optimistic tally back to 0.
describe("voting on a registered vendor's listing", () => {
  interface VoteCard {
    id: string;
    votes_score: number;
    user_vote: -1 | 0 | 1;
  }

  test("a couple can upvote a v{N} vendor listing and it persists", async () => {
    wipeAll();
    const { listingId } = await seedRegisteredVendor(
      "vote-vendor@weddly.test",
      "Gulyás Gabriella",
      "invitation_graphics",
    );
    const couple = await bootstrapCouple("vote-vendor-couple@weddly.test");

    const up = await req<{ votes_score: number; user_vote: number }>(
      "PUT",
      `/api/suppliers/${listingId}/vote`,
      { value: 1 },
      { token: couple.token },
    );
    expect(up.status).toBe(200);
    expect(up.data.user_vote).toBe(1);
    expect(up.data.votes_score).toBe(1);

    // The vote persists: the directory list echoes it back to the couple.
    const list = await req<{ suppliers: VoteCard[] }>(
      "GET",
      "/api/suppliers?country=all",
      undefined,
      { token: couple.token },
    );
    const card = list.data.suppliers.find((s) => s.id === listingId);
    expect(card).toBeDefined();
    expect(card!.votes_score).toBe(1);
    expect(card!.user_vote).toBe(1);
  });

  test("downvote then clear updates the tally on a vendor listing", async () => {
    wipeAll();
    const { listingId } = await seedRegisteredVendor("vote-vendor2@weddly.test", "Down Studio", "dj");
    const couple = await bootstrapCouple("vote-vendor-couple2@weddly.test");

    const down = await req<{ votes_score: number; user_vote: number }>(
      "PUT",
      `/api/suppliers/${listingId}/vote`,
      { value: -1 },
      { token: couple.token },
    );
    expect(down.status).toBe(200);
    expect(down.data.user_vote).toBe(-1);
    expect(down.data.votes_score).toBe(-1);

    const clear = await req<{ votes_score: number; user_vote: number }>(
      "PUT",
      `/api/suppliers/${listingId}/vote`,
      { value: 0 },
      { token: couple.token },
    );
    expect(clear.status).toBe(200);
    expect(clear.data.user_vote).toBe(0);
    expect(clear.data.votes_score).toBe(0);
  });

  test("the owning vendor's own couple can't self-vote their listing", async () => {
    wipeAll();
    // A vendor who also runs a couple workspace tries to pad their own listing.
    const owner = await bootstrapCouple("selfvote-vendor@weddly.test");
    const ownerUser = getUserByEmail("selfvote-vendor@weddly.test");
    const account = createVendorAccount({
      ownerUserId: ownerUser!.id,
      displayName: "Self Studio",
      contactEmail: "selfvote-vendor@weddly.test",
      onboardingDone: false,
    });
    createVendorListing({
      vendorAccountId: account.id,
      category: "invitation_graphics",
      name: "Self Studio",
      city: "Budapest",
      contactEmail: "selfvote-vendor@weddly.test",
    });
    initVendorBilling(account.id, "HUF");

    const r = await req<{ detail?: { code?: string } }>(
      "PUT",
      `/api/suppliers/v${account.id}/vote`,
      { value: 1 },
      { token: owner.token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("self_vote");
  });
});
