// Venue profile, spaces and seasonal pricing rules (shared/venue.ts,
// routes/vendor_venue.ts). What must hold:
//   - only the owner of a VENUE listing writes, and only to their own listing;
//   - the profile PATCH is partial and refuses contradictions (in-house
//     catering required + outside catering allowed);
//   - a price item's amount agrees with its mode, and an unavailable rule
//     carries no items;
//   - a space can only borrow photos from its own listing's gallery;
//   - couples see it on the detail payload, anonymous visitors never do.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { SupplierDetail } from "@shared/suppliers";
import type { VenueDetail } from "@shared/venue";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { addListingPhoto, createVendorListing } from "../../src/domain/listings";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";

beforeEach(() => {
  wipeAll();
});

async function seedVendor(email: string, category: "venue" | "photography" = "venue") {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Venue Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: "Rose Manor",
    contactEmail: email,
    onboardingDone: true,
  });
  db.prepare("UPDATE vendor_accounts SET country = 'HU' WHERE id = ?").run(account.id);
  createVendorListing({
    vendorAccountId: account.id,
    category,
    name: "Rose Manor",
    city: "Eger",
    contactEmail: email,
    address: "Fő u. 1",
    contactPhone: null,
    website: null,
  });
  initVendorBilling(account.id, "HUF");
  return { id: `v${account.id}`, token: reg.data.token };
}

const PEAK = {
  name: "Peak season",
  start_month: 5,
  end_month: 9,
  days: ["saturday"],
  min_guests: 100,
  items: [
    { key: "venue_rental", mode: "fixed", amount: 650000 },
    { key: "catering", mode: "per_guest", amount: 30990 },
    { key: "drinks", mode: "included" },
    { key: "ceremony_location", mode: "free" },
    { key: "extra_hour", mode: "per_hour", amount: 50000, optional: true },
  ],
};

describe("venue profile", () => {
  test("starts empty, PATCH is partial, and the profile reads back", async () => {
    const { token } = await seedVendor("venue-profile@weddly.test");
    const empty = await req<VenueDetail>("GET", "/api/vendor/listing/me/venue", undefined, {
      token,
    });
    expect(empty.status).toBe(200);
    expect(empty.data.profile.venue_types).toEqual([]);
    expect(empty.data.currency).toBe("HUF");
    expect(empty.data.country).toBe("HU");

    const a = await req<VenueDetail>(
      "PATCH",
      "/api/vendor/listing/me/venue/profile",
      {
        venue_types: ["castle_manor", "vineyard"],
        styles: ["romantic"],
        max_seated: 180,
        instagram: "https://www.instagram.com/rose.manor/",
        facilities: ["parking"],
        accommodation_capacity: 40,
      },
      { token },
    );
    expect(a.status).toBe(200);
    expect(a.data.profile.instagram).toBe("rose.manor");
    // Capacity without the accommodation facility is dropped.
    expect(a.data.profile.accommodation_capacity).toBeNull();

    const b = await req<VenueDetail>(
      "PATCH",
      "/api/vendor/listing/me/venue/profile",
      { catering: ["in_house_required"] },
      { token },
    );
    expect(b.data.profile.venue_types).toEqual(["castle_manor", "vineyard"]);
    expect(b.data.profile.max_seated).toBe(180);
    expect(b.data.profile.catering).toEqual(["in_house_required"]);
  });

  test("refuses unknown keys, contradictions and impossible guest ranges", async () => {
    const { token } = await seedVendor("venue-bad@weddly.test");
    const unknown = await req(
      "PATCH",
      "/api/vendor/listing/me/venue/profile",
      {
        venue_types: ["spaceship"],
      },
      { token },
    );
    expect(unknown.status).toBe(400);

    const conflict = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/vendor/listing/me/venue/profile",
      { catering: ["in_house_required", "external_allowed"] },
      { token },
    );
    expect(conflict.status).toBe(400);
    expect(conflict.data.detail?.code).toBe("catering_conflict");

    await req("PATCH", "/api/vendor/listing/me/venue/profile", { max_seated: 80 }, { token });
    const range = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/vendor/listing/me/venue/profile",
      { min_guests: 120 },
      { token },
    );
    expect(range.status).toBe(400);
    expect(range.data.detail?.code).toBe("bad_guest_range");
  });

  test("only venue listings, only vendors", async () => {
    const photo = await seedVendor("venue-photographer@weddly.test", "photography");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/listing/me/venue",
      undefined,
      {
        token: photo.token,
      },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("not_a_venue");

    const couple = await bootstrapCouple("venue-couple@test.test");
    const c = await req("GET", "/api/vendor/listing/me/venue", undefined, { token: couple.token });
    expect(c.status).toBe(403);
    const anon = await req("GET", "/api/vendor/listing/me/venue");
    expect(anon.status).toBe(401);
  });
});

describe("venue spaces", () => {
  test("add, edit and delete; photos come from the listing's own gallery only", async () => {
    const { id, token } = await seedVendor("venue-spaces@weddly.test");
    const other = await seedVendor("venue-spaces-other@weddly.test");
    const mine = addListingPhoto(id, "/uploads/listings/x/a.webp");
    const theirs = addListingPhoto(other.id, "/uploads/listings/y/b.webp");

    const added = await req<VenueDetail>(
      "POST",
      "/api/vendor/listing/me/venue/spaces",
      {
        name: "Rose Garden",
        uses: ["ceremony"],
        setting: "outdoor",
        capacity: 150,
        fee: "included",
        weather_backup: true,
        photo_ids: [mine.id],
      },
      { token },
    );
    expect(added.status).toBe(201);
    const space = added.data.spaces[0];
    expect(space?.name).toBe("Rose Garden");
    expect(space?.photo_urls).toEqual(["/uploads/listings/x/a.webp"]);

    const stolen = await req(
      "PUT",
      `/api/vendor/listing/me/venue/spaces/${space?.id}`,
      { name: "Rose Garden", photo_ids: [theirs.id] },
      { token },
    );
    expect(stolen.status).toBe(400);

    const feeless = await req(
      "PUT",
      `/api/vendor/listing/me/venue/spaces/${space?.id}`,
      { name: "Rose Garden", fee: "included", fee_amount: 1000 },
      { token },
    );
    expect(feeless.status).toBe(400);

    // Another vendor cannot touch it.
    const foreign = await req(
      "DELETE",
      `/api/vendor/listing/me/venue/spaces/${space?.id}`,
      undefined,
      {
        token: other.token,
      },
    );
    expect(foreign.status).toBe(404);

    const del = await req<VenueDetail>(
      "DELETE",
      `/api/vendor/listing/me/venue/spaces/${space?.id}`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.spaces).toEqual([]);
  });
});

describe("venue pricing rules", () => {
  test("add, duplicate, edit and delete a rule", async () => {
    const { token } = await seedVendor("venue-rules@weddly.test");
    const added = await req<VenueDetail>(
      "POST",
      "/api/vendor/listing/me/venue/pricing-rules",
      PEAK,
      { token },
    );
    expect(added.status).toBe(201);
    const rule = added.data.pricing_rules[0];
    expect(rule?.items).toHaveLength(5);
    expect(rule?.items[4]?.optional).toBe(true);

    const dup = await req<VenueDetail>(
      "POST",
      `/api/vendor/listing/me/venue/pricing-rules/${rule?.id}/duplicate`,
      undefined,
      { token },
    );
    expect(dup.status).toBe(201);
    expect(dup.data.pricing_rules.map((r) => r.name)).toEqual(["Peak season", "Peak season (2)"]);
    const copy = dup.data.pricing_rules[1];

    // Turning a rule off drops its items.
    const off = await req<VenueDetail>(
      "PUT",
      `/api/vendor/listing/me/venue/pricing-rules/${copy?.id}`,
      { ...PEAK, name: "August closed", start_month: 8, end_month: 8, available: false },
      { token },
    );
    expect(off.status).toBe(200);
    const closed = off.data.pricing_rules.find((r) => r.id === copy?.id);
    expect(closed?.available).toBe(false);
    expect(closed?.items).toEqual([]);

    const del = await req<VenueDetail>(
      "DELETE",
      `/api/vendor/listing/me/venue/pricing-rules/${copy?.id}`,
      undefined,
      { token },
    );
    expect(del.data.pricing_rules).toHaveLength(1);
  });

  test("an amount has to agree with its mode", async () => {
    const { token } = await seedVendor("venue-rules-bad@weddly.test");
    const post = (items: unknown[], extra: Record<string, unknown> = {}) =>
      req<{ detail?: { code?: string } }>(
        "POST",
        "/api/vendor/listing/me/venue/pricing-rules",
        { ...PEAK, items, ...extra },
        { token },
      );
    expect((await post([{ key: "drinks", mode: "included", amount: 100 }])).data.detail?.code).toBe(
      "item_amount_unexpected",
    );
    expect((await post([{ key: "venue_rental", mode: "fixed" }])).data.detail?.code).toBe(
      "item_amount_missing",
    );
    expect((await post([{ key: "custom", mode: "free" }])).data.detail?.code).toBe(
      "item_label_missing",
    );
    expect((await post([], { days: [] })).data.detail?.code).toBe("days_missing");
    expect((await post([], { min_guests: 200, max_guests: 100 })).data.detail?.code).toBe(
      "bad_guest_range",
    );
    expect((await post([], { start_month: 13 })).status).toBe(400);
  });
});

describe("couple-facing exposure", () => {
  test("a signed-in couple gets the venue block; the anonymous page does not", async () => {
    const { id, token } = await seedVendor("venue-exposed@weddly.test");
    const couple = await bootstrapCouple("venue-exposed-couple@test.test");

    const before = await req<SupplierDetail>("GET", `/api/suppliers/${id}`, undefined, {
      token: couple.token,
    });
    expect(before.status).toBe(200);
    // Nothing filled in yet: no empty venue sections.
    expect(before.data.venue).toBeNull();

    await req("PATCH", "/api/vendor/listing/me/venue/profile", { styles: ["rustic"] }, { token });
    await req("POST", "/api/vendor/listing/me/venue/pricing-rules", PEAK, { token });

    const after = await req<SupplierDetail>("GET", `/api/suppliers/${id}`, undefined, {
      token: couple.token,
    });
    expect(after.data.venue?.profile.styles).toEqual(["rustic"]);
    expect(after.data.venue?.pricing_rules[0]?.name).toBe("Peak season");
    expect(after.data.venue?.currency).toBe("HUF");

    const pub = await req<Record<string, unknown>>("GET", `/api/public/vendors/${id}`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.data)).not.toContain("Peak season");
    expect(Object.keys(pub.data)).not.toContain("venue");
  });
});
