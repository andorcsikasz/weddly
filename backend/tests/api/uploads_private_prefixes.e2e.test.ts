// `/uploads/*` exposes only an explicit, reviewed allowlist of public media
// namespaces. Every new storage category is private until deliberately added.
//
// The case that prompted it: a vendor waitlist applicant's price list, which is
// a business's confidential commercial terms, handed over on the strength of a
// signup form and only ever rendered on /app/admin/vendor-waitlist. Its storage
// key is built from a SEQUENTIAL row id (`vendor_waitlist/<id>/price_list.pdf`),
// so before the prefix was added, every applicant's pricing could be walked one
// integer at a time by a stranger with no account at all.
//
// Pairs with server.ts (tryServeStatic's public-key allowlist),
// routes/vendor_waitlist.ts (the admin-gated stream) and
// domain/vendor_waitlist.ts (priceListUrl).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { storage } from "../../src/lib/storage";
import { registerAndVerify, req, wipeAll } from "../helpers";

const ADMIN_EMAIL = "admin@test.test";
const ADMIN_PASSWORD = "supersafe123";
const BASE = `http://localhost:${process.env.PORT}`;

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

/** A waitlist row with a price list already on disk. Written straight to the
 *  storage driver + the table so the test doesn't depend on the multipart
 *  submit form, which is a separate concern. */
async function seedApplicantWithPriceList(name: string): Promise<number> {
  const ts = Date.now();
  const res = db
    .prepare(
      `INSERT INTO vendor_waitlist (business_name, email, category, location, status, created_at)
       VALUES (?, ?, ?, ?, 'new', ?)`,
    )
    .run(name, `${name.replace(/\W/g, "")}@vendor.test`, "photographer", "Budapest", ts);
  const id = Number(res.lastInsertRowid);
  const key = `vendor_waitlist/${id}/price_list.pdf`;
  await storage.write(key, new Blob([`%PDF-1.4 secret rates for ${name}`]));
  db.prepare("UPDATE vendor_waitlist SET price_list_path = ? WHERE id = ?").run(key, id);
  return id;
}

describe("private uploads are not reachable at a public /uploads/ URL", () => {
  test("a waitlist price list 404s publicly and streams only to an admin", async () => {
    wipeAll();
    const id = await seedApplicantWithPriceList("Great Tide Studio");

    // 1. The public static path is closed, signed out. This is the whole bug:
    //    the key is guessable from a sequential id, so this must not serve.
    const anon = await fetch(`${BASE}/uploads/vendor_waitlist/${id}/price_list.pdf`);
    expect(anon.status).not.toBe(200);
    await anon.arrayBuffer();

    // 2. Nor with an ordinary signed-in account. A session is not a key to the
    //    filing cabinet.
    const outsider = await registerAndVerify({
      email: "nosy@weddly.test",
      password: "supersafe123",
      full_name: "Nosy Parker",
    });
    const asUser = await fetch(`${BASE}/uploads/vendor_waitlist/${id}/price_list.pdf`, {
      headers: { Authorization: `Bearer ${outsider.data.token}` },
    });
    expect(asUser.status).not.toBe(200);
    await asUser.arrayBuffer();

    // 3. The admin route refuses that same ordinary account.
    const denied = await fetch(`${BASE}/api/admin/vendor-waitlist/${id}/price-list`, {
      headers: { Authorization: `Bearer ${outsider.data.token}` },
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    await denied.arrayBuffer();

    // 4. And it refuses an anonymous caller.
    const anonRoute = await fetch(`${BASE}/api/admin/vendor-waitlist/${id}/price-list`);
    expect(anonRoute.status).toBeGreaterThanOrEqual(400);
    await anonRoute.arrayBuffer();

    // 5. An admin still gets the bytes, which is the point of keeping it.
    const token = await adminToken();
    const ok = await fetch(`${BASE}/api/admin/vendor-waitlist/${id}/price-list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(await ok.text()).toContain("secret rates for Great Tide Studio");
  });

  test("the admin payload points at the gated route, never at /uploads/", async () => {
    wipeAll();
    const id = await seedApplicantWithPriceList("Northern Light Films");
    const token = await adminToken();

    const list = await req<{ entries: Array<{ id: number; price_list_url: string | null }> }>(
      "GET",
      "/api/admin/vendor-waitlist",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    const entry = list.data.entries.find((e) => e.id === id);
    expect(entry).toBeDefined();
    // The URL the admin UI renders is the credential-checked one. If this ever
    // reverts to an `/uploads/` path the bytes go public again, silently.
    expect(entry?.price_list_url).toBe(`/api/admin/vendor-waitlist/${id}/price-list`);
    expect(entry?.price_list_url).not.toContain("/uploads/");
  });

  test("the couple-side private prefixes are closed too", async () => {
    // These are asserted together so a future allowlist expansion fails loudly.
    for (const key of [
      "couples/1/budget-docs/1.pdf",
      "couples/1/budget-payments/1.pdf",
      "couples/1/booking-messages/1.pdf",
      "couples/1/moodboard/1.png",
    ]) {
      const res = await fetch(`${BASE}/uploads/${key}`);
      expect(res.status).not.toBe(200);
      await res.arrayBuffer();
    }
  });

  test("unknown future namespaces remain private by default", async () => {
    const key = "future-private-feature/1/sequential-secret.txt";
    await storage.write(key, new Blob(["must never be public by accident"]));
    const response = await fetch(`${BASE}/uploads/${key}`);
    expect(response.status).not.toBe(200);
    await response.arrayBuffer();
  });

  test("an unclaimed listing cannot publish unreferenced operator-imported media", async () => {
    wipeAll();
    const ts = Date.now();
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, status, created_at, updated_at)
       VALUES ('unclaimed-image-test', 'curated', 'photography', 'Unclaimed', 'Budapest', 'active', ?, ?)`,
    ).run(ts, ts);
    const key = "listings/unclaimed-image-test/hero.webp";
    await storage.write(key, new Blob(["unlicensed website image"]));
    const response = await fetch(`${BASE}/uploads/${key}`);
    expect(response.status).not.toBe(200);
    await response.arrayBuffer();
  });

  test("a researched curated listing can publish only its recorded local hero and gallery", async () => {
    wipeAll();
    const ts = Date.now();
    const listingId = "researched-image-test";
    const heroKey = `listings/${listingId}/hero.webp`;
    const galleryKey = `listings/${listingId}/gallery/official.webp`;
    const strayKey = `listings/${listingId}/gallery/unreferenced.webp`;
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, status, hero_image_url, profile_imported, created_at, updated_at)
       VALUES (?, 'curated', 'venue', 'Researched venue', 'Nagykovácsi', 'active', ?, 0, ?, ?)`,
    ).run(listingId, `/uploads/${heroKey}?v=${ts}`, ts, ts);
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      listingId,
      `/uploads/${galleryKey}`,
      ts,
    );
    await storage.write(heroKey, new Blob(["curated hero"]));
    await storage.write(galleryKey, new Blob(["curated gallery"]));
    await storage.write(strayKey, new Blob(["must stay private"]));

    const hero = await fetch(`${BASE}/uploads/${heroKey}?v=${ts}`);
    expect(hero.status).toBe(200);
    expect(await hero.text()).toBe("curated hero");
    const gallery = await fetch(`${BASE}/uploads/${galleryKey}`);
    expect(gallery.status).toBe(200);
    expect(await gallery.text()).toBe("curated gallery");

    const stray = await fetch(`${BASE}/uploads/${strayKey}`);
    expect(stray.status).not.toBe(200);
    await stray.arrayBuffer();
  });

  test("a community listing can publish its admin-attached hero and gallery too", async () => {
    // Regression: 6a8a4b5c (2026-08-24) rewrote this gate to widen curated
    // publishing and only checked `source === "curated"`, which silently
    // dropped every community (couple-submitted, admin-photographed) listing
    // back to private — their hero/gallery 404'd publicly with nothing in the
    // DB or the admin UI showing anything wrong.
    wipeAll();
    const ts = Date.now();
    const listingId = "c-community-image-test";
    const heroKey = `listings/${listingId}/hero.webp`;
    const galleryKey = `listings/${listingId}/gallery/admin-upload.webp`;
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, status, hero_image_url, profile_imported, created_at, updated_at)
       VALUES (?, 'community', 'venue', 'Community venue', 'Pusztazámor', 'active', ?, 0, ?, ?)`,
    ).run(listingId, `/uploads/${heroKey}?v=${ts}`, ts, ts);
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      listingId,
      `/uploads/${galleryKey}`,
      ts,
    );
    await storage.write(heroKey, new Blob(["community hero"]));
    await storage.write(galleryKey, new Blob(["community gallery"]));

    const hero = await fetch(`${BASE}/uploads/${heroKey}?v=${ts}`);
    expect(hero.status).toBe(200);
    expect(await hero.text()).toBe("community hero");
    const gallery = await fetch(`${BASE}/uploads/${galleryKey}`);
    expect(gallery.status).toBe(200);
    expect(await gallery.text()).toBe("community gallery");
  });

  test("an imported profile exposes its one recorded teaser hero but not its gallery", async () => {
    wipeAll();
    const ts = Date.now();
    const listingId = "imported-image-test";
    const heroKey = `listings/${listingId}/hero.webp`;
    const galleryKey = `listings/${listingId}/gallery/lifted.webp`;
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, status, hero_image_url, profile_imported, created_at, updated_at)
       VALUES (?, 'curated', 'photography', 'Imported teaser', 'Budapest', 'active', ?, 1, ?, ?)`,
    ).run(listingId, `/uploads/${heroKey}`, ts, ts);
    db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
      listingId,
      `/uploads/${galleryKey}`,
      ts,
    );
    await storage.write(heroKey, new Blob(["one public teaser"]));
    await storage.write(galleryKey, new Blob(["private until claimed"]));

    const hero = await fetch(`${BASE}/uploads/${heroKey}`);
    expect(hero.status).toBe(200);
    expect(await hero.text()).toBe("one public teaser");
    const gallery = await fetch(`${BASE}/uploads/${galleryKey}`);
    expect(gallery.status).not.toBe(200);
    await gallery.arrayBuffer();
  });
});
