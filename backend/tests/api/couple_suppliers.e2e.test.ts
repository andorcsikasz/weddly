// Location + contact on DIY couple-suppliers, and the guest-page venue-picker
// wiring built on top of them: a couple can capture a real VENUE (name +
// address + map coordinates + phone/email) as a reusable venue vendor, select
// it as "our venue", and have the couple row + map pin reflect it.
//
// Covers backend/src/routes/couple_suppliers.ts (the new place/contact fields),
// backend/src/routes/couples.ts (PATCH now persists location_lat/lng), and
// backend/src/routes/geo.ts (the reverse-geocode arg validation). The live
// Nominatim reverse call is not exercised — it hits an external host, so we
// assert only the argument validation, mirroring how places.ts is treated.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";

interface SupplierDTO {
  id: string;
  name: string;
  category: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  budget_line_id: number | null;
  paid: boolean;
  price_huf: number | null;
}

interface CoupleDTO {
  venue_name: string | null;
  venue_city: string | null;
  venue_address: string | null;
  venue_phone: string | null;
  location_lat: number | null;
  location_lng: number | null;
}

describe("couple-suppliers venue location + contact", () => {
  test("creates a venue with address, coordinates and contact, round-tripping", async () => {
    const { token } = await bootstrapCouple("cs-venue-create@weddly.test");
    const r = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Sári Udvar",
        category: "venue",
        city: "Dunakiliti",
        address: "Fő utca 1, Dunakiliti",
        lat: 47.9876,
        lng: 17.3456,
        contact_email: "info@sariudvar.hu",
        contact_phone: "+36 30 123 4567",
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.supplier.lat).toBeCloseTo(47.9876, 4);
    expect(r.data.supplier.lng).toBeCloseTo(17.3456, 4);
    expect(r.data.supplier.address).toBe("Fő utca 1, Dunakiliti");
    expect(r.data.supplier.city).toBe("Dunakiliti");
    expect(r.data.supplier.contact_email).toBe("info@sariudvar.hu");
    expect(r.data.supplier.contact_phone).toBe("+36 30 123 4567");

    const list = await req<{ suppliers: SupplierDTO[] }>(
      "GET",
      "/api/couple-suppliers",
      undefined,
      { token },
    );
    const found = list.data.suppliers.find((s) => s.id === r.data.supplier.id);
    expect(found?.lat).toBeCloseTo(47.9876, 4);
    expect(found?.contact_phone).toBe("+36 30 123 4567");
  });

  test("a partial update keeps coordinates when flipping an unrelated field", async () => {
    const { token } = await bootstrapCouple("cs-venue-partial@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      { name: "Villa", category: "venue", address: "Road 2", lat: 47.5, lng: 19.0 },
      { token },
    );
    const id = c.data.supplier.id;
    const u = await req<{ supplier: SupplierDTO }>(
      "PATCH",
      `/api/couple-suppliers/${id}`,
      { paid: true },
      { token },
    );
    expect(u.status).toBe(200);
    expect(u.data.supplier.paid).toBe(true);
    expect(u.data.supplier.lat).toBeCloseTo(47.5, 4);
    expect(u.data.supplier.lng).toBeCloseTo(19.0, 4);
    expect(u.data.supplier.address).toBe("Road 2");
  });

  test("clears coordinates when both are sent null", async () => {
    const { token } = await bootstrapCouple("cs-venue-clear@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      { name: "Barn", category: "venue", address: "Somewhere", lat: 47.1, lng: 18.2 },
      { token },
    );
    const u = await req<{ supplier: SupplierDTO }>(
      "PATCH",
      `/api/couple-suppliers/${c.data.supplier.id}`,
      { lat: null, lng: null },
      { token },
    );
    expect(u.status).toBe(200);
    expect(u.data.supplier.lat).toBeNull();
    expect(u.data.supplier.lng).toBeNull();
  });

  test("rejects an out-of-range latitude", async () => {
    const { token } = await bootstrapCouple("cs-venue-badlat@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "X", category: "venue", lat: 100, lng: 20 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects a lone latitude (coordinates must move as a pair)", async () => {
    const { token } = await bootstrapCouple("cs-venue-lonelat@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "X", category: "venue", lat: 47.5 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects an over-long address", async () => {
    const { token } = await bootstrapCouple("cs-venue-longaddr@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "X", category: "venue", address: "y".repeat(301) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects a malformed contact email", async () => {
    const { token } = await bootstrapCouple("cs-venue-bademail@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "X", category: "venue", contact_email: "not-an-email" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("a priced venue still mirrors a budget line", async () => {
    const { token } = await bootstrapCouple("cs-venue-priced@weddly.test");
    const r = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      { name: "Priced venue", category: "venue", price_huf: 500_000, lat: 47.5, lng: 19.0 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.supplier.budget_line_id).not.toBeNull();
  });
});

describe("venue selection wiring (picks + couple row)", () => {
  test("picking a venue vendor reflects everywhere, no manual couple PATCH needed", async () => {
    const { token } = await bootstrapCouple("cs-venue-select@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Kastély",
        category: "venue",
        city: "Gödöllő",
        address: "Grassalkovich-kastély",
        lat: 47.6,
        lng: 19.36,
        contact_phone: "+36 1 111 1111",
      },
      { token },
    );
    const id = c.data.supplier.id;

    const pick = await req("PUT", "/api/picks/venue", { supplier_id: id }, { token });
    expect(pick.status).toBe(200);

    // The pick itself is now what writes the couple row's copy (see
    // domain/venue_sync.ts) — a caller re-sending the same fields via PATCH
    // /api/couples/current would find them already in place and 400 on
    // "No fields to update", which is the sync working, not a regression.
    const picks = await req<{ picks: { category: string; supplier_id: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token },
    );
    expect(picks.data.picks.find((p) => p.category === "venue")?.supplier_id).toBe(id);

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_address).toBe("Grassalkovich-kastély");
    expect(cur.data.couple.location_lat).toBeCloseTo(47.6, 4);
    expect(cur.data.couple.location_lng).toBeCloseTo(19.36, 4);
  });

  test("PATCH couple rejects a lone location coordinate", async () => {
    const { token } = await bootstrapCouple("cs-venue-lonecoord@weddly.test");
    const r = await req("PATCH", "/api/couples/current", { location_lat: 47.6 }, { token });
    expect(r.status).toBe(400);
  });
});

// The couple's venue_* + location_lat/lng columns are a denormalized copy of
// the "venue" category pick (see backend/src/domain/venue_sync.ts). These
// exercise the sync happening as a SIDE EFFECT of the pick/DIY-supplier
// routes themselves — no manual PATCH /api/couples/current involved — which
// is what makes the copy correct no matter which surface in the app changed
// the pick (a browse-card bookmark toggle, a supplier detail page, deleting
// or editing the DIY entry that's picked), not just the guest-page editor.
describe("venue auto-sync (couple row follows the pick, no manual PATCH)", () => {
  test("PUT /api/picks/venue alone populates the couple row", async () => {
    const { token } = await bootstrapCouple("cs-venue-autosync-pick@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Tófeje Kúria",
        category: "venue",
        city: "Tófej",
        address: "Fő út 9",
        lat: 46.8,
        lng: 16.7,
        contact_phone: "+36 30 999 8888",
      },
      { token },
    );
    const id = c.data.supplier.id;

    const pick = await req("PUT", "/api/picks/venue", { supplier_id: id }, { token });
    expect(pick.status).toBe(200);

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_name).toBe("Tófeje Kúria");
    expect(cur.data.couple.venue_city).toBe("Tófej");
    expect(cur.data.couple.venue_address).toBe("Fő út 9");
    expect(cur.data.couple.venue_phone).toBe("+36 30 999 8888");
    expect(cur.data.couple.location_lat).toBeCloseTo(46.8, 4);
    expect(cur.data.couple.location_lng).toBeCloseTo(16.7, 4);
  });

  test("DELETE /api/picks/venue clears the couple row", async () => {
    const { token } = await bootstrapCouple("cs-venue-autosync-unpick@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Malom",
        category: "venue",
        city: "Eger",
        address: "Malom u. 1",
        lat: 47.9,
        lng: 20.4,
      },
      { token },
    );
    await req("PUT", "/api/picks/venue", { supplier_id: c.data.supplier.id }, { token });

    const remove = await req("DELETE", "/api/picks/venue", undefined, { token });
    expect(remove.status).toBe(200);

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_name).toBeNull();
    expect(cur.data.couple.venue_address).toBeNull();
    expect(cur.data.couple.location_lat).toBeNull();
    expect(cur.data.couple.location_lng).toBeNull();
  });

  test("deleting the picked DIY venue clears both the pick and the couple row", async () => {
    const { token } = await bootstrapCouple("cs-venue-autosync-delete@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Pajta",
        category: "venue",
        city: "Sopron",
        address: "Fő tér 2",
        lat: 47.68,
        lng: 16.6,
      },
      { token },
    );
    const id = c.data.supplier.id;
    await req("PUT", "/api/picks/venue", { supplier_id: id }, { token });

    const del = await req("DELETE", `/api/couple-suppliers/${id}`, undefined, { token });
    expect(del.status).toBe(200);

    const picks = await req<{ picks: { category: string; supplier_id: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token },
    );
    expect(picks.data.picks.find((p) => p.category === "venue")).toBeUndefined();

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_name).toBeNull();
    expect(cur.data.couple.venue_address).toBeNull();
    expect(cur.data.couple.location_lat).toBeNull();
  });

  test("editing the picked DIY venue's address updates the couple row", async () => {
    const { token } = await bootstrapCouple("cs-venue-autosync-edit@weddly.test");
    const c = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Csűr",
        category: "venue",
        city: "Vác",
        address: "Régi cím 1",
        lat: 47.77,
        lng: 19.13,
      },
      { token },
    );
    const id = c.data.supplier.id;
    await req("PUT", "/api/picks/venue", { supplier_id: id }, { token });

    const patch = await req<{ supplier: SupplierDTO }>(
      "PATCH",
      `/api/couple-suppliers/${id}`,
      { address: "Új cím 42", contact_phone: "+36 20 111 2233" },
      { token },
    );
    expect(patch.status).toBe(200);

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_address).toBe("Új cím 42");
    expect(cur.data.couple.venue_phone).toBe("+36 20 111 2233");
  });

  test("editing an unrelated (non-picked) DIY supplier never touches the couple's venue", async () => {
    const { token } = await bootstrapCouple("cs-venue-autosync-unrelated@weddly.test");
    const venue = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      {
        name: "Igazi Helyszín",
        category: "venue",
        city: "Pécs",
        address: "Cím 1",
        lat: 46.07,
        lng: 18.23,
      },
      { token },
    );
    await req("PUT", "/api/picks/venue", { supplier_id: venue.data.supplier.id }, { token });

    const other = await req<{ supplier: SupplierDTO }>(
      "POST",
      "/api/couple-suppliers",
      { name: "Virágos", category: "florist" },
      { token },
    );
    const patch = await req(
      "PATCH",
      `/api/couple-suppliers/${other.data.supplier.id}`,
      { notes: "hoz egy csokrot" },
      { token },
    );
    expect(patch.status).toBe(200);

    const cur = await req<{ couple: CoupleDTO }>("GET", "/api/couples/current", undefined, {
      token,
    });
    expect(cur.data.couple.venue_name).toBe("Igazi Helyszín");
    expect(cur.data.couple.venue_address).toBe("Cím 1");
  });
});

describe("geo reverse endpoint", () => {
  test("rejects out-of-range coordinates", async () => {
    const { token } = await bootstrapCouple("cs-geo-reverse@weddly.test");
    const r = await req("GET", "/api/geo/reverse?lat=200&lng=20", undefined, { token });
    expect(r.status).toBe(400);
  });
});
