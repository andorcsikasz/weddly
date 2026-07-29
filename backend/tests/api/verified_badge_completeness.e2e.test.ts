// The verified check is FILLED only when the profile behind it is finished.
//
// A registered vendor earns the badge the moment they have an account, but a
// listing with no cover photo and no price is not a finished profile, so the
// frontend draws that badge hollow. This suite pins the server side of that
// rule: `DirectorySupplier.listing_complete` on the in-app directory + detail,
// on the anonymous public profile and on the browse-teaser showcase, and its
// planner twin `PlannerDirectoryEntry.profile_complete`.
//
// The rule that matters most here is that completeness comes from the SAME
// checklist as the vendor's own progress ring (`listingChecklistFor`). If the
// two ever fork, a vendor reads "100%" on their dashboard while couples still
// see a hollow badge, and nothing on either screen explains why.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { PublicVendorShowcase, SupplierDetail } from "@shared/suppliers";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import { db } from "../../src/db";
import { addListingPackage, addListingPhoto, createVendorListing } from "../../src/domain/listings";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

interface DirectoryCard {
  id: string;
  source: string;
  listing_complete: boolean;
}

/** A registered vendor with a bare listing: name, city, category, contact
 *  email. That is a real, live, badge-earning directory card and nowhere near
 *  a finished profile — no cover, no gallery, no blurb, no price, no package. */
async function seedVendor(
  email: string,
  name: string,
  category: string,
): Promise<{ accountId: number; listingId: string }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(reg.data.user.id);
  const account = createVendorAccount({
    ownerUserId: reg.data.user.id,
    displayName: name,
    contactEmail: email,
    onboardingDone: true,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category,
    name,
    city: "Budapest",
    contactEmail: email,
  });
  initVendorBilling(account.id, "HUF");
  return { accountId: account.id, listingId: `v${account.id}` };
}

/** Tick every remaining checklist step. `photography` has no guest capacity, so
 *  its checklist is the 6-step form and this is genuinely 100%. */
function finishListing(listingId: string): void {
  db.prepare(
    `UPDATE listings
        SET hero_image_url = '/uploads/listings/hero.webp',
            blurb_hu = 'Csendes, dokumentarista esküvői fotó.',
            blurb_en = 'Quiet, documentary wedding photography.',
            price_band = 3
      WHERE id = ?`,
  ).run(listingId);
  addListingPhoto(listingId, "/uploads/listings/1.webp");
  addListingPackage(listingId, { name: "Teljes nap", price_text: "450 000 Ft", description: null });
}

function directory(token: string) {
  return req<{ suppliers: DirectoryCard[] }>("GET", "/api/suppliers", undefined, { token });
}

describe("verified badge — the fill comes from listing completeness", () => {
  test("a bare listing is incomplete on the directory card and on both detail views", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const { listingId } = await seedVendor("bare@weddly.test", "Fenyő Fotó", "photography");

    const list = await directory(token);
    expect(list.status).toBe(200);
    const card = list.data.suppliers.find((s) => s.id === listingId);
    // The card is there, and it IS the verified 'claimed' kind — the badge is
    // never withheld for an unfinished profile, only drawn hollow.
    expect(card?.source).toBe("claimed");
    expect(card?.listing_complete).toBe(false);

    const detail = await req<SupplierDetail>("GET", `/api/suppliers/${listingId}`, undefined, {
      token,
    });
    expect(detail.data.listing_complete).toBe(false);

    const pub = await req<{ detail: SupplierDetail }>("GET", `/api/public/vendors/${listingId}`);
    expect(pub.data.detail.listing_complete).toBe(false);
  });

  test("ticking every checklist step flips it on every surface at once", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const { listingId } = await seedVendor("done@weddly.test", "Fenyő Fotó", "photography");
    finishListing(listingId);

    const card = (await directory(token)).data.suppliers.find((s) => s.id === listingId);
    expect(card?.listing_complete).toBe(true);

    const detail = await req<SupplierDetail>("GET", `/api/suppliers/${listingId}`, undefined, {
      token,
    });
    expect(detail.data.listing_complete).toBe(true);

    const pub = await req<{ detail: SupplierDetail }>("GET", `/api/public/vendors/${listingId}`);
    expect(pub.data.detail.listing_complete).toBe(true);
  });

  test("one missing step is enough to keep the badge hollow", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const { listingId } = await seedVendor("nearly@weddly.test", "Fenyő Fotó", "photography");
    finishListing(listingId);
    // Pricing alone comes back off. 5 of 6 is not a finished profile, and a
    // badge that fills at "nearly" would mean nothing.
    db.prepare("UPDATE listings SET price_band = NULL WHERE id = ?").run(listingId);

    const card = (await directory(token)).data.suppliers.find((s) => s.id === listingId);
    expect(card?.listing_complete).toBe(false);
  });

  test("the public browse showcase carries the same flag per card", async () => {
    wipeAll();
    const bare = await seedVendor("teaser-bare@weddly.test", "Bare Studio", "photography");
    const full = await seedVendor("teaser-full@weddly.test", "Full Studio", "photography");
    // The showcase only samples listings that have a hero photo, so the
    // unfinished one needs its cover (and nothing else) to be comparable.
    db.prepare("UPDATE listings SET hero_image_url = '/uploads/listings/hero.webp' WHERE id = ?").run(
      bare.listingId,
    );
    finishListing(full.listingId);

    const res = await req<PublicVendorShowcase>("GET", "/api/public/vendor-showcase");
    expect(res.status).toBe(200);
    const cards = res.data.categories.flatMap((c) => c.vendors);
    expect(cards.find((v) => v.id === bare.listingId)?.listing_complete).toBe(false);
    expect(cards.find((v) => v.id === full.listingId)?.listing_complete).toBe(true);
  });

  test("an unclaimed curated entry is never 'complete' — it wears no badge", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const list = await directory(token);
    const curated = list.data.suppliers.find((s) => s.source === "curated");
    expect(curated).toBeDefined();
    expect(curated?.listing_complete).toBe(false);
  });
});

/** Register + verify + promote to planner. `full` fills every field the
 *  "complete your profile" nudge chases (business name, city, bio, styles);
 *  otherwise only the pair the directory requires to list at all. */
async function seedPlanner(email: string, full: boolean): Promise<number> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  const userId = reg.data.user.id;
  db.prepare(
    `UPDATE users
        SET user_type = 'planner', couple_id = NULL, planner_verified = 1,
            business_name = 'Nagy Weddings', planner_city = 'Budapest'
      WHERE id = ?`,
  ).run(userId);
  if (full) {
    db.prepare(
      "UPDATE users SET planner_bio = ?, planner_styles = ? WHERE id = ?",
    ).run("We plan calm, editorial weddings.", JSON.stringify(["editorial"]), userId);
  }
  return userId;
}

describe("verified badge — the planner twin", () => {
  test("a half-written planner card is verified but incomplete", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const plannerId = await seedPlanner("thin@planner.test", false);

    const list = await req<{ planners: PlannerDirectoryEntry[] }>(
      "GET",
      "/api/couples/planner-directory",
      undefined,
      { token },
    );
    const entry = list.data.planners.find((p) => p.planner_user_id === plannerId);
    expect(entry?.verified).toBe(true);
    expect(entry?.profile_complete).toBe(false);

    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${plannerId}`,
      undefined,
      { token },
    );
    expect(detail.data.profile_complete).toBe(false);
  });

  test("bio + styles finish the profile and fill the badge", async () => {
    wipeAll();
    const { token } = await bootstrapCouple();
    const plannerId = await seedPlanner("full@planner.test", true);

    const list = await req<{ planners: PlannerDirectoryEntry[] }>(
      "GET",
      "/api/couples/planner-directory",
      undefined,
      { token },
    );
    expect(
      list.data.planners.find((p) => p.planner_user_id === plannerId)?.profile_complete,
    ).toBe(true);

    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${plannerId}`,
      undefined,
      { token },
    );
    expect(detail.data.profile_complete).toBe(true);
  });
});
