// A verified visitor (no Weddly account) suggests a supplier. The submission
// reuses the community_suppliers pipeline: the row anchors its NOT-NULL author
// FK to the reserved system user and records the real submitter in
// submitter_visitor_id. Price is optional (omitted → sentinel 0 → null listing).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { VisitorSession } from "@shared/verified_visitors";
import { __testPlaintextForHash } from "../../src/auth/tokens";
import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import { db, VISITOR_SYSTEM_USER_EMAIL, getVisitorSystemUserId } from "../../src/db";
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

interface VisitorRow {
  id: number;
  verify_token_hash: string | null;
}

async function verifiedVisitor(
  email: string,
  fullName?: string,
): Promise<{ id: number; deviceToken: string }> {
  await req("POST", "/api/visitors/verify/request", { email, full_name: fullName });
  const row = db.prepare("SELECT * FROM verified_visitors WHERE email = ?").get(email) as
    | VisitorRow
    | undefined;
  const plain = __testPlaintextForHash(row?.verify_token_hash ?? "");
  if (!plain) throw new Error(`no captured token for ${email}`);
  const consumed = await req<VisitorSession>("POST", `/api/visitors/verify/${plain}`);
  return { id: consumed.data.visitor.id, deviceToken: consumed.data.token };
}

interface SupplierRow {
  id: number;
  submitter_user_id: number;
  submitter_visitor_id: number | null;
  price_band: number;
  status: string;
}

function supplierByName(name: string): SupplierRow | null {
  return (
    (db.prepare("SELECT * FROM community_suppliers WHERE name = ?").get(name) as
      | SupplierRow
      | undefined) ?? null
  );
}

beforeEach(() => {
  db.prepare("DELETE FROM verified_visitors").run();
  db.prepare("DELETE FROM community_suppliers WHERE name LIKE 'VVSup%'").run();
});

describe("verified visitor suggests a supplier", () => {
  test("submits with the device token; row anchored to visitor + system user", async () => {
    const { id: visitorId, deviceToken } = await verifiedVisitor("vsub1@example.com");

    const res = await req<{ pending: boolean }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "photography",
        name: "VVSup Studio",
        address: "Budapest, Fő utca 1",
        contact_email: "hello@vvsup.example.com",
        // price_band intentionally omitted — it's optional now.
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(res.status).toBe(201);
    expect(res.data.pending).toBe(true);

    const row = supplierByName("VVSup Studio");
    expect(row?.status).toBe("pending");
    expect(row?.submitter_visitor_id).toBe(visitorId);
    expect(row?.submitter_user_id).toBe(getVisitorSystemUserId());
    expect(row?.price_band).toBe(0); // sentinel for "unpriced"

    // The mirrored listing shows the price as null (not a misleading "$").
    const listing = db.prepare("SELECT price_band FROM listings WHERE id = ?").get(`c${row?.id}`) as
      | { price_band: number | null }
      | undefined;
    expect(listing?.price_band).toBeNull();
  });

  test("an unverified visitor (no token) is refused", async () => {
    const res = await req("POST", "/api/suppliers/community", {
      category: "photography",
      name: "VVSup Nope",
      address: "x",
      contact_email: "n@vv.example.com",
    });
    expect(res.status).toBe(401);
    expect((res.data as { detail?: { code?: string } }).detail?.code).toBe("visitor_unverified");
  });

  test("a suggestion that's already live points the submitter to it", async () => {
    const { deviceToken } = await verifiedVisitor("vsub3@example.com");
    // A live directory listing (as if curated/claimed) the visitor duplicates.
    const ts = Date.now();
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, website, blurb_hu, blurb_en, status, content_hash, created_at, updated_at)
       VALUES ('vvexisting1', 'curated', 'photography', 'VVSup Existing', 'Budapest',
               'https://vvsup-existing.example.com', '', '', 'active', 'h', ?, ?)`,
    ).run(ts, ts);

    // Same website hostname → flagged as already listed, with a link target.
    const byWebsite = await req<{ detail?: { code?: string; existing?: { id: string } } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "photography",
        name: "Totally Different Name",
        address: "Budapest",
        contact_email: "dup@vvsup.example.com",
        website: "https://www.vvsup-existing.example.com/contact",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(byWebsite.status).toBe(409);
    expect(byWebsite.data.detail?.code).toBe("already_listed");
    expect(byWebsite.data.detail?.existing?.id).toBe("vvexisting1");

    // Same name + city (no website) → also flagged.
    const byNameCity = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "photography",
        name: "VVSup Existing",
        address: "x",
        city: "budapest",
        contact_email: "dup2@vvsup.example.com",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(byNameCity.status).toBe(409);
    expect(byNameCity.data.detail?.code).toBe("already_listed");

    db.prepare("DELETE FROM listings WHERE id = 'vvexisting1'").run();
  });

  test("a typo'd/variant name in the same city+category still points to the existing listing", async () => {
    const { deviceToken } = await verifiedVisitor("vsub5@example.com");
    const ts = Date.now();
    // Mirrors the real bug (community supplier #15, 2026-08-19): a curated
    // listing named "X–Y-kastély Faluváros" already live, and a self-submitter
    // typed "X Y Kastely" (no dash, no diacritics, no town suffix) as new.
    // Fictitious name/city so it can't collide with the real seeded directory.
    db.prepare(
      `INSERT INTO listings
         (id, source, category, name, city, website, blurb_hu, blurb_en, status, content_hash, created_at, updated_at)
       VALUES ('vvexisting2', 'curated', 'venue', 'VVSup–Teszt-kastély Faluváros', 'Faluváros',
               '', '', '', 'active', 'h', ?, ?)`,
    ).run(ts, ts);

    const dup = await req<{ detail?: { code?: string; existing?: { id: string } } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        name: "VVSup Teszt Kastely",
        address: "Kossuth Lajos utca 2",
        city: "Faluváros",
        contact_email: "dup5@vvsup.example.com",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(dup.status).toBe(409);
    expect(dup.data.detail?.code).toBe("already_listed");
    expect(dup.data.detail?.existing?.id).toBe("vvexisting2");

    // A same-name venue in a DIFFERENT town must not be blocked — the loose
    // match is gated on city so two unrelated "X Kastély" venues never collide.
    const notDup = await req<{ pending: boolean }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        name: "VVSup Teszt Kastely",
        address: "Fő utca 1",
        city: "Sárvár",
        contact_email: "notdup5@vvsup.example.com",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(notDup.status).toBe(201);
    expect(notDup.data.pending).toBe(true);

    db.prepare("DELETE FROM listings WHERE id = 'vvexisting2'").run();
    db.prepare(
      "DELETE FROM listings WHERE source = 'community' AND name = 'VVSup Teszt Kastely'",
    ).run();
    db.prepare("DELETE FROM community_suppliers WHERE name = 'VVSup Teszt Kastely'").run();
  });

  test("the vendor's own email is required of a visitor", async () => {
    const { deviceToken } = await verifiedVisitor("vsub4@example.com");
    const res = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/suppliers/community",
      { category: "photography", name: "VVSup Nameless", address: "Budapest" },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(res.status).toBe(400);
    expect(res.data.detail?.code).toBe("contact_email_required");
    expect(supplierByName("VVSup Nameless")).toBeNull();
  });

  test("a logged-in couple may still submit without one", async () => {
    // The gate is about who is answerable for the row: a couple has an account
    // we can go back to, a visitor is an address and nothing else.
    const couple = await registerAndVerify({
      email: "vvcouple@example.com",
      password: "supersafe123",
      full_name: "Kata Kis",
    });
    const res = await req(
      "POST",
      "/api/suppliers/community",
      { category: "photography", name: "VVSup Couple Sub", city: "Budapest" },
      { token: couple.data.token },
    );
    expect(res.status).toBe(201);
    expect(supplierByName("VVSup Couple Sub")).not.toBeNull();
  });

  test("a provided price band (1..5) is kept", async () => {
    const { deviceToken } = await verifiedVisitor("vsub2@example.com");
    const res = await req(
      "POST",
      "/api/suppliers/community",
      {
        category: "photography",
        name: "VVSup Priced",
        address: "Budapest",
        contact_email: "priced@vvsup.example.com",
        price_band: 4,
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(res.status).toBe(201);
    expect(supplierByName("VVSup Priced")?.price_band).toBe(4);
  });
});

describe("admin sees who suggested a visitor listing", () => {
  // The row's author FK points at the reserved system user, so an admin card
  // that reads `submitter_email` answers "who suggested this?" with a sentinel
  // address. The visitor's own address is carried alongside it.
  test("the queue and every action response name the visitor, not the sentinel", async () => {
    const { deviceToken } = await verifiedVisitor("vadmin1@example.com", "Zsuzsi Kovács");
    const token = await adminToken();

    await req(
      "POST",
      "/api/suppliers/community",
      {
        category: "mc_celebrant",
        name: "VVSup Ceremony",
        city: "Budapest",
        contact_email: "hello@vvceremony.example.com",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    const id = supplierByName("VVSup Ceremony")?.id;
    expect(id).toBeDefined();

    const list = await req<{ suppliers: CommunitySupplierAdminView[] }>(
      "GET",
      "/api/admin/suppliers",
      undefined,
      { token },
    );
    const card = list.data.suppliers.find((s) => s.id === id);
    expect(card?.submitter_visitor_email).toBe("vadmin1@example.com");
    expect(card?.submitter_visitor_name).toBe("Zsuzsi Kovács");
    // The sentinel is still reported — it is what the row actually stores —
    // but it is no longer the only thing the admin can read.
    expect(card?.submitter_email).toBe(VISITOR_SYSTEM_USER_EMAIL);

    // Single-row reads go through their own query; a moderator touching the
    // card must not blank the identity the list just showed them.
    const patched = await req<{ supplier: CommunitySupplierAdminView }>(
      "PATCH",
      `/api/admin/suppliers/${id}/notes`,
      { notes: "called them" },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.supplier.submitter_visitor_email).toBe("vadmin1@example.com");
  });

  test("purge-submitter is refused: there is no account behind the row", async () => {
    // submitter_user_id is the SHARED system user, so purging "the submitter"
    // would scrub it and take every other visitor's listing with it.
    const { deviceToken } = await verifiedVisitor("vadmin2@example.com");
    const token = await adminToken();
    await req(
      "POST",
      "/api/suppliers/community",
      {
        category: "photography",
        name: "VVSup Purgeable",
        city: "Budapest",
        contact_email: "hello@vvpurge.example.com",
      },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    const id = supplierByName("VVSup Purgeable")?.id;

    const res = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/admin/suppliers/${id}/purge-submitter`,
      {},
      { token },
    );
    expect(res.status).toBe(409);
    expect(res.data.detail?.code).toBe("visitor_submitter");
    expect(supplierByName("VVSup Purgeable")).not.toBeNull();
    // A purge scrubs the users row in place, so the sentinel address surviving
    // is the proof the system user was never touched.
    const systemUser = db
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(getVisitorSystemUserId()) as { email: string } | undefined;
    expect(systemUser?.email).toBe(VISITOR_SYSTEM_USER_EMAIL);
  });
});

describe("resolve-maps-url is open to a verified visitor", () => {
  // The register modal's smart-fill helper must work for a no-account visitor.
  // We assert the AUTH branch only (a verified visitor gets past the gate),
  // using inputs that fail validation before any external Nominatim/Google
  // call, so the test never hits the network.
  test("a verified visitor clears auth and is validated (400, not 401)", async () => {
    const { deviceToken } = await verifiedVisitor("vmap1@example.com");
    const res = await req(
      "POST",
      "/api/suppliers/resolve-maps-url",
      { url: "https://example.com/not-a-map" },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(res.status).toBe(400);
  });

  test("no token and no session is refused (401)", async () => {
    const res = await req("POST", "/api/suppliers/resolve-maps-url", {
      url: "https://example.com/not-a-map",
    });
    expect(res.status).toBe(401);
  });
});
