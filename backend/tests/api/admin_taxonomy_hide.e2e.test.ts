// Admin can soft-hide a supplier group or category instead of hard-deleting
// it. Couples no longer see hidden rows on the public dropdowns + directory
// surfaces; the admin keeps seeing them on /app/admin/categories with a
// "Hidden" badge + unhide button.
//
// Schema: `supplier_groups.hidden` + `supplier_categories.hidden` (INTEGER
// 0/1, default 0) — additive in db.ts. Behaviour: PATCH accepts `hidden`,
// the public taxonomy endpoint filters hidden rows out, the dedicated
// admin GET endpoint surfaces all rows so the editor can flip them back.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { SupplierTaxonomy } from "@shared/supplier_taxonomy";
import { db } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

/** Sample group + category ids straight from the seed so we can flip
 *  visibility on a known row. The seed runs on every test setup; the
 *  groups are deterministic by slug. */
function seededGroupId(slug: string): number {
  const row = db.prepare("SELECT id FROM supplier_groups WHERE slug = ?").get(slug) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Seed group missing: ${slug}`);
  return row.id;
}

function seededCategoryId(slug: string): number {
  const row = db.prepare("SELECT id FROM supplier_categories WHERE slug = ?").get(slug) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Seed category missing: ${slug}`);
  return row.id;
}

describe("PATCH /api/admin/supplier-categories/:id — hidden flag", () => {
  test("category hide → public taxonomy filters it out, admin endpoint still surfaces it", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const catId = seededCategoryId("nails");

    // Public view before — category is visible.
    const before = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    expect(before.status).toBe(200);
    const beforeHasNails = before.data.groups
      .flatMap((g) => g.categories)
      .some((c) => c.slug === "nails");
    expect(beforeHasNails).toBe(true);

    // Hide.
    const patch = await req(
      "PATCH",
      `/api/admin/supplier-categories/${catId}`,
      { hidden: true },
      { token: adminToken },
    );
    expect(patch.status).toBe(200);

    // Public view after — category is filtered out.
    const after = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    expect(after.status).toBe(200);
    const afterHasNails = after.data.groups
      .flatMap((c) => c.categories)
      .some((c) => c.slug === "nails");
    expect(afterHasNails).toBe(false);

    // Admin view — category still present, hidden = true.
    const admin = await req<SupplierTaxonomy>("GET", "/api/admin/supplier-taxonomy", undefined, {
      token: adminToken,
    });
    expect(admin.status).toBe(200);
    const nails = admin.data.groups.flatMap((g) => g.categories).find((c) => c.slug === "nails");
    expect(nails).toBeDefined();
    expect(nails?.hidden).toBe(true);
  });

  test("category unhide brings it back to the public taxonomy", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const catId = seededCategoryId("transport");

    await req(
      "PATCH",
      `/api/admin/supplier-categories/${catId}`,
      { hidden: true },
      { token: adminToken },
    );
    let publicView = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    expect(
      publicView.data.groups.flatMap((g) => g.categories).some((c) => c.slug === "transport"),
    ).toBe(false);

    await req(
      "PATCH",
      `/api/admin/supplier-categories/${catId}`,
      { hidden: false },
      { token: adminToken },
    );
    publicView = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    expect(
      publicView.data.groups.flatMap((g) => g.categories).some((c) => c.slug === "transport"),
    ).toBe(true);
  });

  test("hidden = non-boolean → 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const catId = seededCategoryId("nails");
    const r = await req(
      "PATCH",
      `/api/admin/supplier-categories/${catId}`,
      { hidden: "yes" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("hide a category whose slug is still referenced by community suppliers — soft hide works", async () => {
    // The whole point of hide vs delete: hide bypasses the FK-style guard
    // that gates DELETE on supplier references being zero. Soft-deprecate
    // a category that's still in use without orphaning anyone.
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const { token: ownerToken } = await bootstrapCouple("hide-owner@weddly.test");

    // Submit a community supplier in the "venue" category — this would
    // block a DELETE on `venue`.
    const submit = await req<{ supplier: { id: string } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        submitter_type: "self",
        name: "Hide-Test Venue",
        city: "Budapest",
        address: null,
        website: "https://hide-test-venue.example",
        contact_email: "hello@hide-test-venue.example",
        contact_phone: null,
        blurb: "Soft-hide path doesn't care about FK references.",
        price_band: 2,
      },
      { token: ownerToken },
    );
    expect(submit.status).toBe(201);

    const catId = seededCategoryId("venue");
    const hide = await req(
      "PATCH",
      `/api/admin/supplier-categories/${catId}`,
      { hidden: true },
      { token: adminToken },
    );
    expect(hide.status).toBe(200);

    // Sanity: DELETE on the same category would 409.
    const del = await req("DELETE", `/api/admin/supplier-categories/${catId}`, undefined, {
      token: adminToken,
    });
    expect(del.status).toBe(409);
  });
});

describe("PATCH /api/admin/supplier-groups/:id — hidden flag", () => {
  test("group hide masks every category underneath in the public taxonomy", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const groupId = seededGroupId("fashion_beauty");

    const before = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    expect(before.data.groups.some((g) => g.slug === "fashion_beauty")).toBe(true);

    await req(
      "PATCH",
      `/api/admin/supplier-groups/${groupId}`,
      { hidden: true },
      { token: adminToken },
    );

    const after = await req<SupplierTaxonomy>("GET", "/api/supplier-categories");
    // Group itself disappears, AND so do its children.
    expect(after.data.groups.some((g) => g.slug === "fashion_beauty")).toBe(false);
    expect(
      after.data.groups.flatMap((g) => g.categories).some((c) => c.slug === "bridal_boutique"),
    ).toBe(false);

    // Admin view: group reappears with hidden=true; categories still
    // unhidden individually so an admin who only hid the parent can
    // unhide it without re-flipping each child.
    const admin = await req<SupplierTaxonomy>("GET", "/api/admin/supplier-taxonomy", undefined, {
      token: adminToken,
    });
    const style = admin.data.groups.find((g) => g.slug === "fashion_beauty");
    expect(style?.hidden).toBe(true);
    expect(style?.categories.find((c) => c.slug === "bridal_boutique")?.hidden).toBe(false);
  });
});

describe("GET /api/admin/supplier-taxonomy — auth", () => {
  test("anon → 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/admin/supplier-taxonomy");
    expect(r.status).toBe(401);
  });

  test("non-admin (couple-role) → 403", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("not-admin-tax@weddly.test");
    const r = await req("GET", "/api/admin/supplier-taxonomy", undefined, { token });
    expect(r.status).toBe(403);
  });
});
