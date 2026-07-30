// Imported profiles are a teaser until the business claims them.
//
// Some directory entries were built from what a business publishes on its own
// website. Others were IMPORTED from the profile that business had built on a
// different platform — their bio, their photos, their price, their phone,
// written for somebody else's directory. Republishing all of that here before
// they have accepted anything is not ours to do, so while such a listing is
// unclaimed every public surface shows one photo and the plain facts, and
// nothing else. Claiming is the acceptance, and it puts everything back.
//
// What's asserted: the redaction holds on the in-app card list, the in-app
// detail payload, the anonymous public profile and the SSR share card; it does
// NOT touch an ordinary curated entry; and it lifts the moment the listing has
// a vendor_account_id.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { DirectorySupplier, SupplierDetail } from "@shared/suppliers";
import { db } from "../../src/db";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { lookupVendorPageMeta } from "../../src/lib/seo_ssr";
import { bootstrapCouple, req, wipeAll } from "../helpers";

/** A real imported entry from the wedigo cohort: bio, gallery and phone. */
const IMPORTED_ID = "eskuvoi-video-film-hu";
/** Built by us from the business's own site — must be unaffected. */
const OWN_RESEARCH_ID = "24frames";

function listingRow(id: string): {
  profile_imported: number;
  contact_phone: string | null;
  blurb_hu: string | null;
  price_band: number | null;
} {
  return db
    .prepare(
      "SELECT profile_imported, contact_phone, blurb_hu, price_band FROM listings WHERE id = ?",
    )
    .get(id) as {
    profile_imported: number;
    contact_phone: string | null;
    blurb_hu: string | null;
    price_band: number | null;
  };
}

async function cardFor(id: string, token: string): Promise<DirectorySupplier | undefined> {
  const r = await req<{ suppliers: DirectorySupplier[] }>(
    "GET",
    "/api/suppliers?country=all",
    undefined,
    { token },
  );
  expect(r.status).toBe(200);
  return r.data.suppliers.find((s) => s.id === id);
}

describe("imported profiles are redacted until claimed", () => {
  test("the seed itself still carries the bio, the phone and a full gallery", () => {
    // The point of the feature is that we HOLD data we don't publish. If the
    // row were empty the rest of this suite would pass for the wrong reason.
    const row = listingRow(IMPORTED_ID);
    expect(row.profile_imported).toBe(1);
    expect(row.blurb_hu).toBeTruthy();
    expect(row.contact_phone).toBeTruthy();
    // Photo count is checked on the SEED, not on `listing_photos`: re-hosting
    // is a boot sweep that reaches out to the open internet, so it does nothing
    // in the test environment.
    const seed = DIRECTORY.find((d) => d.id === IMPORTED_ID);
    expect(seed?.gallery_urls?.length ?? 0).toBeGreaterThan(1);
  });

  test("the in-app card shows no bio, no price and no phone", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("teaser-card@weddly.test");
    const card = await cardFor(IMPORTED_ID, token);
    expect(card).toBeTruthy();
    expect(card?.blurb_hu).toBe("");
    expect(card?.blurb_en).toBe("");
    expect(card?.contact_phone).toBeNull();
    expect(card?.price_band).toBeNull();
    // The facts a couple needs to recognise the business survive.
    expect(card?.name).toBeTruthy();
    expect(card?.city).toBeTruthy();
    expect(card?.website).toBeTruthy();
  });

  test("the in-app detail shows exactly one photo and no packages", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("teaser-detail@weddly.test");
    const r = await req<SupplierDetail>("GET", `/api/suppliers/${IMPORTED_ID}`, undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.gallery_urls?.length ?? 0).toBeLessThanOrEqual(1);
    expect(r.data.blurb_hu).toBe("");
    expect(r.data.contact_phone).toBeNull();
    expect(r.data.price_band).toBeNull();
    expect(r.data.packages).toEqual([]);
  });

  test("the anonymous public profile is redacted too", async () => {
    const r = await req<{ detail: SupplierDetail }>("GET", `/api/public/vendors/${IMPORTED_ID}`);
    expect(r.status).toBe(200);
    const d = r.data.detail;
    expect(d.blurb_hu).toBe("");
    expect(d.blurb_en).toBe("");
    expect(d.contact_phone).toBeNull();
    expect(d.price_band).toBeNull();
    expect(d.gallery_urls?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test("the SSR share card carries no bio", () => {
    // Redacting the API and then baking the bio into the page source would
    // publish it anyway, and to crawlers first.
    const meta = lookupVendorPageMeta(`/vendors/${IMPORTED_ID}`);
    expect(meta).toBeTruthy();
    expect(meta?.blurbHu).toBe("");
    expect(meta?.blurbEn).toBe("");
    // The one photo the teaser is allowed still rides along.
    expect(meta?.name).toBeTruthy();
  });

  test("an entry we researched ourselves is untouched", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("teaser-control@weddly.test");
    expect(listingRow(OWN_RESEARCH_ID).profile_imported).toBe(0);
    const card = await cardFor(OWN_RESEARCH_ID, token);
    expect(card).toBeTruthy();
    expect(card?.blurb_hu).toBeTruthy();
    // The catalogue carries no contact VALUES for anyone any more (see
    // supplier_contact_privacy.e2e.test.ts), so "the phone survived the teaser
    // gate" is now asked of the flag the card kept.
    expect(card?.has_contact_phone).toBe(true);
    expect(card?.price_band).not.toBeNull();
  });

  test("claiming the listing puts everything back", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("teaser-claimed@weddly.test");

    // Stand in a vendor account on the listing — that is what "accepted their
    // account" means at the data layer.
    const ts = Date.now();
    db.prepare(
      `INSERT INTO users (email, password_hash, full_name, role, status, verified_email, created_at, updated_at)
       VALUES ('imported-owner@weddly.test', 'x', 'Owner', 'vendor', 'active', 1, ?, ?)`,
    ).run(ts, ts);
    const userId = Number(
      (
        db.prepare("SELECT id FROM users WHERE email = ?").get("imported-owner@weddly.test") as {
          id: number;
        }
      ).id,
    );
    db.prepare(
      `INSERT INTO vendor_accounts (owner_user_id, display_name, created_at, updated_at)
       VALUES (?, 'Imported Owner', ?, ?)`,
    ).run(userId, ts, ts);
    const accountId = Number(
      (
        db.prepare("SELECT id FROM vendor_accounts WHERE owner_user_id = ?").get(userId) as {
          id: number;
        }
      ).id,
    );
    db.prepare("UPDATE listings SET vendor_account_id = ? WHERE id = ?").run(
      accountId,
      IMPORTED_ID,
    );

    const card = await cardFor(IMPORTED_ID, token);
    expect(card).toBeTruthy();
    expect(card?.blurb_hu).toBeTruthy();
    expect(card?.has_contact_phone).toBe(true);

    const detail = await req<SupplierDetail>("GET", `/api/suppliers/${IMPORTED_ID}`, undefined, {
      token,
    });
    expect(detail.data.blurb_hu).toBeTruthy();
    expect(detail.data.contact_phone).toBeTruthy();
    expect(detail.data.price_band).toBe(
      listingRow(IMPORTED_ID).price_band as SupplierDetail["price_band"],
    );

    // Leave the row as the suite found it — this file doesn't wipeAll() the
    // listings table, and a stuck claim would silently un-redact the cases above.
    db.prepare("UPDATE listings SET vendor_account_id = NULL WHERE id = ?").run(IMPORTED_ID);
  });
});
