// Registered vendors' own listings (source='claimed', self-serve id `v{N}`)
// must surface in the public `/api/suppliers` directory alongside curated +
// community entries, carrying the "verified vendor" signal (source='claimed',
// vendor_account_id set). Suspended owners + demo accounts stay hidden, and the
// admin detail path resolves the standalone claimed id.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { createVendorListing } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { getUserByEmail } from "../../src/domain/users";
import { convertUserToVendor } from "../../src/domain/vendor_conversion";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

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
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
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
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
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
    const { listingId } = await seedRegisteredVendor(
      "vote-vendor2@weddly.test",
      "Down Studio",
      "dj",
    );
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

// Regression: a vendor who CLAIMS a curated listing gets vendor_account_id set
// on the existing curated row, but its stored `source` stays 'curated' (the
// claim UPDATE doesn't touch it, and resolveSupplierBase hands back the static
// curated entry). The directory badge + "Verified only" filter key off
// source==='claimed', so the claim was invisible until the read paths derived
// `source` from ownership.
describe("a claimed CURATED listing surfaces as verified", () => {
  test("directory + detail report source='claimed' once a vendor owns the curated slug", async () => {
    wipeAll();
    const curatedId = DIRECTORY[0]?.id;
    if (!curatedId) throw new Error("DIRECTORY is empty — no curated listing to claim");

    const reg = await registerAndVerify({
      email: "curated-claim@weddly.test",
      password: "supersafe123",
      full_name: "Owner",
    });
    db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(
      reg.data.user.id,
    );
    const account = createVendorAccount({
      ownerUserId: reg.data.user.id,
      displayName: "Claimed Curated Co",
      contactEmail: "curated-claim@weddly.test",
      onboardingDone: false,
    });
    // Exactly what vendor_claim's UPDATE does: attach the owner, leave source.
    db.prepare("UPDATE listings SET vendor_account_id = ? WHERE id = ?").run(account.id, curatedId);
    const viewer = await bootstrapCouple("curated-claim-viewer@weddly.test");

    try {
      const list = await req<{ suppliers: DirectoryItem[] }>(
        "GET",
        "/api/suppliers?country=all",
        undefined,
        { token: viewer.token },
      );
      const card = list.data.suppliers.find((s) => s.id === curatedId);
      expect(card).toBeDefined();
      expect(card?.vendor_account_id).toBe(account.id);
      expect(card?.source).toBe("claimed");

      const detail = await req<{ source: string; vendor_account_id: number | null }>(
        "GET",
        `/api/suppliers/${encodeURIComponent(curatedId)}`,
        undefined,
        { token: viewer.token },
      );
      expect(detail.status).toBe(200);
      expect(detail.data.vendor_account_id).toBe(account.id);
      expect(detail.data.source).toBe("claimed");
    } finally {
      // Curated listings survive wipeAll, so detach to avoid leaking the claim
      // into a later test in this file.
      db.prepare("UPDATE listings SET vendor_account_id = NULL WHERE id = ?").run(curatedId);
    }
  });
});
