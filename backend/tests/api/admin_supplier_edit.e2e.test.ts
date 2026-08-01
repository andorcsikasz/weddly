// Admin edits a community-submitted listing, and attaches pictures to it.
//
// Two gaps this closes. The couple-facing submission form collects nine fields
// and the auto-enricher can only find what a website publishes, so a listing
// for a business with no website arrived thin and had no path to ever stop
// being thin — an admin who researched it could only type the answers into the
// private admin note. And a listing with no coordinate is invisible on the map
// tab no matter how good the rest of the card is.
//
// The invariants under test:
//  - PATCH is PARTIAL: an absent key is left alone, `null` clears.
//  - Every write re-mirrors into `listings`, INCLUDING the researched columns.
//    That one needs the content hash to cover them, otherwise a coords-only
//    edit hashes identically and the upsert silently skips.
//  - Photos are OUR bytes under OUR key; a URL we can't download is a 422, not
//    a stored remote URL the CSP would refuse to render.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AdminListingPhotosResponse,
  CommunitySupplierAdminView,
} from "@shared/community_suppliers";
import { db } from "../../src/db";
import { addListingPhoto, setListingHeroImage } from "../../src/domain/listings";
import { registerAndVerify, req } from "../helpers";

const ADMIN_EMAIL = "admin@test.test";
const ADMIN_PASSWORD = "supersafe123";

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  return login.data.token;
}

/** A submitter + one thin community row, the shape a real submission lands in:
 *  name, category, town, nothing else. */
async function seedThinListing(name: string): Promise<{ id: number; token: string }> {
  const token = await adminToken();
  const submitter = await registerAndVerify({
    email: `sub-${name.replace(/\W+/g, "")}@example.com`,
    password: "supersafe123",
    full_name: "Kata Kis",
  });
  const res = await req<{ pending: boolean }>(
    "POST",
    "/api/suppliers/community",
    { category: "venue", name, city: "Siena" },
    { token: submitter.data.token },
  );
  expect(res.status).toBe(201);
  const row = db.prepare("SELECT id FROM community_suppliers WHERE name = ?").get(name) as
    | { id: number }
    | undefined;
  if (!row) throw new Error("seed row missing");
  return { id: row.id, token };
}

interface ListingRow {
  city: string;
  lat: number | null;
  lng: number | null;
  capacity_max: number | null;
  venue_style: string | null;
  spoken_languages: string | null;
  contact_phone: string | null;
  hero_image_url: string | null;
}

function listingFor(id: number): ListingRow | undefined {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(`c${id}`) as ListingRow | undefined;
}

beforeEach(() => {
  db.prepare("DELETE FROM community_suppliers WHERE name LIKE 'AdminEdit%'").run();
  db.prepare("DELETE FROM listings WHERE name LIKE 'AdminEdit%'").run();
});

describe("PATCH /api/admin/suppliers/:id", () => {
  test("writes the researched fields and mirrors every one into listings", async () => {
    const { id, token } = await seedThinListing("AdminEdit Podere");

    const res = await req<{ supplier: CommunitySupplierAdminView; fields_written: number }>(
      "PATCH",
      `/api/admin/suppliers/${id}`,
      {
        city: "Siena, IT",
        address: "Strada Provinciale 73 BIS, 153, 53100 Costalpino",
        contact_phone: "+39 347 373 4267",
        blurb: "An intimate farmhouse in the Tuscan countryside.",
        price_band: 2,
        lat: 43.28994,
        lng: 11.27664,
        capacity_max: 60,
        venue_style: "estate",
        spoken_languages: ["it", "en", "fr", "he"],
      },
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.fields_written).toBe(10);
    expect(res.data.supplier.lat).toBeCloseTo(43.28994, 5);
    expect(res.data.supplier.venue_style).toBe("estate");
    // Controlled order, not the order they were typed in.
    expect(res.data.supplier.spoken_languages).toEqual(["en", "fr", "it", "he"]);

    // The mirror is what the public card reads. Before the content hash covered
    // these columns, this is where a coords-only edit silently vanished.
    const listing = listingFor(id);
    expect(listing?.city).toBe("Siena, IT");
    expect(listing?.lat).toBeCloseTo(43.28994, 5);
    expect(listing?.capacity_max).toBe(60);
    expect(listing?.venue_style).toBe("estate");
    expect(listing?.spoken_languages).toBe("en,fr,it,he");
    expect(listing?.contact_phone).toBe("+39 347 373 4267");
  });

  test("an edit that only moves the coordinates still reaches the mirror", async () => {
    const { id, token } = await seedThinListing("AdminEdit Coords");

    await req("PATCH", `/api/admin/suppliers/${id}`, { lat: 43.1, lng: 11.1 }, { token });
    expect(listingFor(id)?.lat).toBeCloseTo(43.1, 5);

    // Nothing else about the row changes — a hash that ignored lat/lng would
    // produce the same digest here and skip the write.
    const second = await req("PATCH", `/api/admin/suppliers/${id}`, { lat: 44.2 }, { token });
    expect(second.status).toBe(200);
    expect(listingFor(id)?.lat).toBeCloseTo(44.2, 5);
  });

  test("is partial: an absent key is untouched, null clears", async () => {
    const { id, token } = await seedThinListing("AdminEdit Partial");

    await req(
      "PATCH",
      `/api/admin/suppliers/${id}`,
      { contact_phone: "+39 345 437 6886", venue_style: "estate", capacity_max: 40 },
      { token },
    );

    // A body about ONE field must not blank the other two.
    const res = await req<{ supplier: CommunitySupplierAdminView }>(
      "PATCH",
      `/api/admin/suppliers/${id}`,
      { capacity_max: null },
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.supplier.capacity_max).toBeNull();
    expect(res.data.supplier.contact_phone).toBe("+39 345 437 6886");
    expect(res.data.supplier.venue_style).toBe("estate");

    // An emptied language picker is an explicit "none", which has to survive
    // the COALESCE the listings mirror applies to that column.
    await req("PATCH", `/api/admin/suppliers/${id}`, { spoken_languages: ["it"] }, { token });
    expect(listingFor(id)?.spoken_languages).toBe("it");
    await req("PATCH", `/api/admin/suppliers/${id}`, { spoken_languages: [] }, { token });
    expect(listingFor(id)?.spoken_languages).toBe("");
  });

  test("a city with a country suffix moves the card out of Hungary", async () => {
    const { id, token } = await seedThinListing("AdminEdit Country");

    await req("PATCH", `/api/admin/suppliers/${id}`, { city: "Siena, IT" }, { token });
    await req("POST", `/api/admin/suppliers/${id}/approve`, {}, { token });

    const list = await req<{ suppliers: { id: string; country: string }[] }>(
      "GET",
      "/api/suppliers?country=all",
      undefined,
      { token },
    );
    const card = list.data.suppliers.find((s) => s.id === `c${id}`);
    expect(card?.country).toBe("IT");
  });

  test("rejects junk without touching the row", async () => {
    const { id, token } = await seedThinListing("AdminEdit Junk");

    for (const body of [
      { venue_style: "spaceship" },
      { spoken_languages: ["klingon"] },
      { lat: 200 },
      { website: "javascript:alert(1)" },
      { name: "   " },
      { price_band: 9 },
    ]) {
      const res = await req("PATCH", `/api/admin/suppliers/${id}`, body, { token });
      expect(res.status).toBe(400);
    }

    // capacity_min > capacity_max is checked against the MERGED row, so setting
    // one end has to validate against the end already stored.
    await req("PATCH", `/api/admin/suppliers/${id}`, { capacity_max: 50 }, { token });
    const backwards = await req(
      "PATCH",
      `/api/admin/suppliers/${id}`,
      { capacity_min: 200 },
      { token },
    );
    expect(backwards.status).toBe(400);
  });

  test("is admin-only", async () => {
    const { id } = await seedThinListing("AdminEdit Guard");
    const outsider = await registerAndVerify({
      email: "notadmin-edit@example.com",
      password: "supersafe123",
      full_name: "Réka Tóth",
    });
    const res = await req(
      "PATCH",
      `/api/admin/suppliers/${id}`,
      { name: "Hijacked" },
      { token: outsider.data.token },
    );
    expect(res.status).toBe(403);
    const row = db.prepare("SELECT name FROM community_suppliers WHERE id = ?").get(id) as {
      name: string;
    };
    expect(row.name).toBe("AdminEdit Guard");
  });
});

describe("admin listing photos", () => {
  test("lists the hero and the gallery as one ordered set", async () => {
    const { id, token } = await seedThinListing("AdminEdit Photos");
    setListingHeroImage(`c${id}`, "/uploads/listings/test/hero.jpg");
    const thumb = addListingPhoto(`c${id}`, "/uploads/listings/test/gallery/a.jpg");

    const res = await req<AdminListingPhotosResponse>(
      "GET",
      `/api/admin/suppliers/c${id}/photos`,
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.photos.map((p) => p.role)).toEqual(["hero", "gallery"]);
    expect(res.data.photos[0]?.id).toBeNull();
    expect(res.data.photos[1]?.id).toBe(thumb.id);
  });

  test("removes the hero by the literal 'hero' and a thumbnail by its id", async () => {
    const { id, token } = await seedThinListing("AdminEdit PhotoDelete");
    setListingHeroImage(`c${id}`, "/uploads/listings/test/hero.jpg");
    const thumb = addListingPhoto(`c${id}`, "/uploads/listings/test/gallery/a.jpg");

    const dropHero = await req<AdminListingPhotosResponse>(
      "DELETE",
      `/api/admin/suppliers/c${id}/photos/hero`,
      undefined,
      { token },
    );
    expect(dropHero.status).toBe(200);
    expect(dropHero.data.photos.some((p) => p.role === "hero")).toBe(false);
    expect(listingFor(id)?.hero_image_url).toBeNull();

    const dropThumb = await req<AdminListingPhotosResponse>(
      "DELETE",
      `/api/admin/suppliers/c${id}/photos/${thumb.id}`,
      undefined,
      { token },
    );
    expect(dropThumb.data.photos).toEqual([]);
  });

  test("a URL we cannot download is a 422, never a stored hotlink", async () => {
    const { id, token } = await seedThinListing("AdminEdit PhotoFail");
    // Loopback: the SSRF guard refuses it before any request goes out, so this
    // asserts the failure path without depending on the network.
    const res = await req(
      "POST",
      `/api/admin/suppliers/c${id}/photos`,
      { url: "http://127.0.0.1/photo.jpg" },
      { token },
    );
    expect(res.status).toBe(422);
    expect(listingFor(id)?.hero_image_url).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?").get(`c${id}`),
    ).toEqual({ n: 0 });
  });

  test("404s on a listing that does not exist", async () => {
    const token = await adminToken();
    const res = await req("GET", "/api/admin/suppliers/c99999999/photos", undefined, { token });
    expect(res.status).toBe(404);
  });
});
