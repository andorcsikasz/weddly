// A vendor who CLAIMED a curated (imported) listing keeps the curated id, and
// everything they edit lives in their own `listings` row. Vendor feedback
// 2026-11-03 found three ways that row never reached couples:
//
//   1. the detail page and the directory served the static import, not the row
//      (the description, address, map pin and website a vendor typed were only
//      visible in their own preview);
//   2. the boot-time curated sync rewrote the row from suppliers_data.ts on any
//      batch change, wiping the vendor's description back to the import;
//   3. a new address never moved the map pin.
//
// Plus the gallery "replace a photo in place" request from the same round.

import "../setup";

import { afterAll, describe, expect, test } from "bun:test";
import type { VendorListingView } from "@shared/listings";
import { db } from "../../src/db";
import { backfillListings } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const entry = [...DIRECTORY]
  .reverse()
  .find((s) => s.country === "HU" && s.city.startsWith("Budapest") && s.website);
if (!entry) throw new Error("no Budapest curated entry with a website");
const curatedId = entry.id;

function restoreCurated(): void {
  db.prepare(
    "UPDATE listings SET vendor_account_id = NULL, status = 'active', content_hash = NULL WHERE id = ?",
  ).run(curatedId);
  db.prepare("DELETE FROM listing_photos WHERE listing_id = ?").run(curatedId);
  backfillListings();
}

afterAll(restoreCurated);

/** A vendor account that owns the curated entry, the way a completed claim
 *  leaves it: the curated id, `vendor_account_id` set, no `v{N}` row. */
async function claimCurated(tag: string): Promise<string> {
  restoreCurated();
  const email = `claimer-${tag}@weddly.test`;
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: entry!.name,
    contactEmail: email,
    onboardingDone: true,
  });
  initVendorBilling(account.id, "HUF");
  db.prepare("UPDATE listings SET vendor_account_id = ? WHERE id = ?").run(account.id, curatedId);
  return reg.data.token;
}

interface DetailBody {
  blurb_hu: string;
  website: string;
  source: string;
}

describe("a claimed curated listing shows the vendor's own edits", () => {
  test("detail page and directory serve the vendor's description and address", async () => {
    wipeAll();
    const vendorToken = await claimCurated("detail");
    const patch = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      {
        blurb_hu: "Saját bemutatkozás, amit a szolgáltató írt.",
        website: "https://sajat-oldal.example",
      },
      { token: vendorToken },
    );
    expect(patch.status).toBe(200);

    const couple = await bootstrapCouple("detail-couple@weddly.test");
    const detail = await req<DetailBody>(
      "GET",
      `/api/suppliers/${encodeURIComponent(curatedId)}`,
      undefined,
      { token: couple.token },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.blurb_hu).toBe("Saját bemutatkozás, amit a szolgáltató írt.");
    expect(detail.data.website).toBe("https://sajat-oldal.example/");
    expect(detail.data.source).toBe("claimed");

    const list = await req<{ suppliers: Array<{ id: string; blurb_hu: string }> }>(
      "GET",
      "/api/suppliers",
      undefined,
      { token: couple.token },
    );
    const card = list.data.suppliers.filter((s) => s.id === curatedId);
    expect(card.length).toBe(1);
    expect(card[0]!.blurb_hu).toBe("Saját bemutatkozás, amit a szolgáltató írt.");
  });

  test("the boot-time curated sync no longer overwrites a vendor's edits", async () => {
    wipeAll();
    const vendorToken = await claimCurated("sync");
    await req(
      "PATCH",
      "/api/vendor/listing/me",
      { blurb_hu: "Ezt a szolgáltató írta." },
      { token: vendorToken },
    );
    // A batch rebuild changes the curated hash; simulate it.
    db.prepare("UPDATE listings SET content_hash = 'stale' WHERE id = ?").run(curatedId);
    backfillListings();
    const row = db.prepare("SELECT blurb_hu FROM listings WHERE id = ?").get(curatedId) as {
      blurb_hu: string;
    };
    expect(row.blurb_hu).toBe("Ezt a szolgáltató írta.");
  });

  test("an unclaimed curated row is still re-synced", () => {
    restoreCurated();
    db.prepare("UPDATE listings SET blurb_hu = 'drift', content_hash = 'stale' WHERE id = ?").run(
      curatedId,
    );
    backfillListings();
    const row = db.prepare("SELECT blurb_hu FROM listings WHERE id = ?").get(curatedId) as {
      blurb_hu: string;
    };
    expect(row.blurb_hu).toBe(entry!.blurb_hu);
  });

  test("a new address moves the map pin", async () => {
    wipeAll();
    const vendorToken = await claimCurated("geo");
    db.prepare("UPDATE listings SET lat = 1, lng = 1 WHERE id = ?").run(curatedId);
    // The fake geocoder answers Andrássy út 60 first, inside Budapest.
    const r = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { address: "Andrássy út 60" },
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    const row = db.prepare("SELECT lat, lng FROM listings WHERE id = ?").get(curatedId) as {
      lat: number;
      lng: number;
    };
    expect(row.lat).toBeCloseTo(47.5063, 3);
    expect(row.lng).toBeCloseTo(19.0653, 3);
  });

  test("an address the geocoder cannot place falls back to the town, never the old pin", async () => {
    wipeAll();
    const vendorToken = await claimCurated("geo-miss");
    db.prepare("UPDATE listings SET lat = 1, lng = 1 WHERE id = ?").run(curatedId);
    await req(
      "PATCH",
      "/api/vendor/listing/me",
      { address: "nomatch utca 1" },
      { token: vendorToken },
    );
    const row = db.prepare("SELECT lat FROM listings WHERE id = ?").get(curatedId) as {
      lat: number | null;
    };
    expect(row.lat).not.toBe(1);
  });
});

describe("replacing a gallery photo", () => {
  const png = () =>
    new File(
      [
        Uint8Array.from(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        ),
      ],
      "p.png",
      { type: "image/png" },
    );

  async function upload(path: string, token: string): Promise<Response> {
    const form = new FormData();
    form.append("file", png());
    const base = `http://localhost:${process.env.PORT}`;
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  }

  test("keeps the photo's id and place, swaps the file, resets the framing", async () => {
    wipeAll();
    const token = await claimCurated("photo");
    const first = await upload("/api/vendor/listing/me/photos", token);
    expect(first.status).toBe(201);
    const second = await upload("/api/vendor/listing/me/photos", token);
    await second.arrayBuffer();
    const view = (await first.json()) as VendorListingView;
    const target = view.photos![0]!;
    db.prepare("UPDATE listing_photos SET position_y = 20 WHERE id = ?").run(target.id);

    const r = await upload(`/api/vendor/listing/me/photos/${target.id}/replace`, token);
    expect(r.status).toBe(200);
    const after = (await r.json()) as VendorListingView;
    expect(after.photos!.length).toBe(2);
    expect(after.photos![0]!.id).toBe(target.id);
    expect(after.photos![0]!.url).not.toBe(target.url);
    expect(after.photos![0]!.position_y).toBe(50);
  });

  test("another listing's photo id is a 404", async () => {
    wipeAll();
    const token = await claimCurated("photo-404");
    const r = await upload("/api/vendor/listing/me/photos/999999/replace", token);
    expect(r.status).toBe(404);
    await r.arrayBuffer();
  });
});
