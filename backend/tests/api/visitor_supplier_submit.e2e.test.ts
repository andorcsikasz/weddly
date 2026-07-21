// A verified visitor (no Weddly account) suggests a supplier. The submission
// reuses the community_suppliers pipeline: the row anchors its NOT-NULL author
// FK to the reserved system user and records the real submitter in
// submitter_visitor_id. Price is optional (omitted → sentinel 0 → null listing).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { VisitorSession } from "@shared/verified_visitors";
import { __testPlaintextForHash } from "../../src/auth/tokens";
import { db, getVisitorSystemUserId } from "../../src/db";
import { req } from "../helpers";

interface VisitorRow {
  id: number;
  verify_token_hash: string | null;
}

async function verifiedVisitor(email: string): Promise<{ id: number; deviceToken: string }> {
  await req("POST", "/api/visitors/verify/request", { email });
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
    const listing = db
      .prepare("SELECT price_band FROM listings WHERE id = ?")
      .get(`c${row?.id}`) as { price_band: number | null } | undefined;
    expect(listing?.price_band).toBeNull();
  });

  test("an unverified visitor (no token) is refused", async () => {
    const res = await req(
      "POST",
      "/api/suppliers/community",
      { category: "photography", name: "VVSup Nope", address: "x", contact_email: "n@vv.example.com" },
    );
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
      { category: "photography", name: "VVSup Existing", address: "x", city: "budapest" },
      { headers: { "X-Visitor-Token": deviceToken } },
    );
    expect(byNameCity.status).toBe(409);
    expect(byNameCity.data.detail?.code).toBe("already_listed");

    db.prepare("DELETE FROM listings WHERE id = 'vvexisting1'").run();
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
