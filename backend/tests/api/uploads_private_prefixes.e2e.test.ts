// `/uploads/*` is a PUBLIC static handler, and the list of private prefixes it
// refuses is a DENYLIST — so every private upload category is world-readable
// until someone remembers to add its prefix. This suite is the reminder.
//
// The case that prompted it: a vendor waitlist applicant's price list, which is
// a business's confidential commercial terms, handed over on the strength of a
// signup form and only ever rendered on /app/admin/vendor-waitlist. Its storage
// key is built from a SEQUENTIAL row id (`vendor_waitlist/<id>/price_list.pdf`),
// so before the prefix was added, every applicant's pricing could be walked one
// integer at a time by a stranger with no account at all.
//
// Pairs with server.ts (tryServeStatic's private-prefix guard),
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
    // These three were already guarded; they are asserted here so the whole
    // denylist has one home and a future edit that drops a line fails loudly.
    for (const key of [
      "couples/1/budget-docs/1.pdf",
      "couples/1/budget-payments/1.pdf",
      "couples/1/booking-messages/1.pdf",
    ]) {
      const res = await fetch(`${BASE}/uploads/${key}`);
      expect(res.status).not.toBe(200);
      await res.arrayBuffer();
    }
  });
});
