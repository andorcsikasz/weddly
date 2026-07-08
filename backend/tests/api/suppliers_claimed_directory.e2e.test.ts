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
      "photo_video",
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
    const { listingId } = await seedRegisteredVendor("dj@weddly.test", "DJ Nova", "music_dj");

    const match = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?category=music_dj",
    );
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
      "decor_floral",
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
    const { vendorAccountId } = convertUserToVendor(user!, { category: "attire" });

    const res = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    const card = res.data.suppliers.find((s) => s.id === `v${vendorAccountId}`);
    expect(card).toBeDefined();
    expect(card?.source).toBe("claimed");
    expect(card?.vendor_account_id).toBe(vendorAccountId);
  });
});
