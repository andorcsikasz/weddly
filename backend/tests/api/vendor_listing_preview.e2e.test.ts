// `GET /api/vendor/listing/me/preview`: the detail couples get for a vendor's
// own page, built from the vendor's session. It exists so the vendor can see
// their page as couples do even while it is paused, pending or a demo, none of
// which resolve on the public paths. What must hold is that it is the OWNER's
// and only the owner's, and that it never widens the public paths.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { addListingPackage, createVendorListing } from "../../src/domain/listings";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";

beforeEach(() => {
  wipeAll();
});

async function seedVendor(email: string, name: string) {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: name,
    contactEmail: email,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category: "photography",
    name,
    city: "Szeged",
    contactEmail: email,
    address: "Kárász u. 1",
    contactPhone: "+36 30 123 4567",
    website: "https://preview-test.example",
  });
  initVendorBilling(account.id, "HUF");
  const id = `v${account.id}`;
  addListingPackage(id, {
    name: `${name} full day`,
    price_text: null,
    price_min: 450000,
    price_max: null,
    price_mode: "total",
    description: "Ten hours",
  });
  return { id, token: reg.data.token };
}

type Detail = {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  packages: { name: string }[];
};

describe("GET /api/vendor/listing/me/preview", () => {
  test("gives the vendor the full couple-facing detail of their own page", async () => {
    const { id, token } = await seedVendor("preview-own@weddly.test", "Great Tide");
    const r = await req<Detail>("GET", "/api/vendor/listing/me/preview", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(id);
    expect(r.data.packages.map((p) => p.name)).toEqual(["Great Tide full day"]);
    // The couple-facing detail, not the anonymous allowlist: the phone is there.
    expect(r.data.contact_phone).toBe("+36 30 123 4567");
    // And still no mailbox, for the vendor's own eyes too: that rule has no
    // exception for the owner, or the preview would not show what couples see.
    expect(r.data.contact_email).toBeNull();
  });

  test("still works while the page is paused or pending, when every public path 404s", async () => {
    const { id, token } = await seedVendor("preview-paused@weddly.test", "Great Tide");
    db.prepare("UPDATE listings SET status = 'hidden' WHERE id = ?").run(id);

    const pub = await req("GET", `/api/public/vendors/${id}`);
    expect(pub.status).toBe(404);
    const asCouple = await bootstrapCouple("preview-paused-couple@test.test");
    const detail = await req("GET", `/api/suppliers/${id}`, undefined, { token: asCouple.token });
    expect(detail.status).toBe(404);

    const r = await req<Detail>("GET", "/api/vendor/listing/me/preview", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(id);
  });

  test("is the caller's own listing, whichever other vendors exist", async () => {
    await seedVendor("preview-a@weddly.test", "Alpha Studio");
    const b = await seedVendor("preview-b@weddly.test", "Beta Studio");
    const r = await req<Detail>("GET", "/api/vendor/listing/me/preview", undefined, {
      token: b.token,
    });
    expect(r.data.id).toBe(b.id);
    expect(r.data.name).toBe("Beta Studio");
    expect(JSON.stringify(r.data)).not.toContain("Alpha Studio");
  });

  test("is not there for an anonymous visitor or for a couple", async () => {
    const anon = await req("GET", "/api/vendor/listing/me/preview");
    expect(anon.status).toBe(401);
    const { token } = await bootstrapCouple("preview-couple@test.test");
    const couple = await req("GET", "/api/vendor/listing/me/preview", undefined, { token });
    expect(couple.status).toBeGreaterThanOrEqual(400);
    expect(couple.status).toBeLessThan(500);
  });

  test("does not open the public paths: a hidden page stays hidden to everyone else", async () => {
    const { id } = await seedVendor("preview-closed@weddly.test", "Great Tide");
    db.prepare("UPDATE listings SET status = 'hidden' WHERE id = ?").run(id);
    expect((await req("GET", `/api/public/vendors/${id}`)).status).toBe(404);
  });
});
