// "My location" on the /app/suppliers map (POST /api/geo/map-locate) and its
// admin rollup (GET /api/admin/analytics/map-locate). The promise the couple is
// shown before the browser asks is "only your town and district are recorded",
// so the load-bearing assertion is that no coordinate reaches the table.
// Reverse geocoding runs on the ADDRESS_SUGGEST_FAKE fixtures in
// domain/map_locate.ts (47-48°N = Budapest VII. kerület, else Szeged).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { AdminMapLocateAnalytics } from "@shared/admin_analytics";
import { db } from "../../src/db";
import { MAP_LOCATE_DEDUPE_MS } from "../../src/domain/map_locate";
import { bootstrapCouple, req, wipeAll } from "../helpers";

let adminToken = "";
let coupleToken = "";

beforeEach(async () => {
  wipeAll();
  db.exec("DELETE FROM map_locate_events");
  adminToken = (await bootstrapCouple("admin@test.test")).token;
  coupleToken = (await bootstrapCouple("locate@weddly.test")).token;
});

const BUDAPEST = { lat: 47.4979, lng: 19.0702 };
const SZEGED = { lat: 46.253, lng: 20.1414 };

describe("POST /api/geo/map-locate", () => {
  test("stores town + district and never the coordinate", async () => {
    const r = await req<{ city: string; district: string; country: string; recorded: boolean }>(
      "POST",
      "/api/geo/map-locate",
      BUDAPEST,
      { token: coupleToken },
    );
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      country: "HU",
      city: "Budapest",
      district: "VII. kerület",
      recorded: true,
    });

    const cols = (db.prepare("PRAGMA table_info(map_locate_events)").all() as { name: string }[])
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual(["city", "country", "created_at", "district", "id", "user_id"]);
    const row = db.prepare("SELECT * FROM map_locate_events").get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain("47.49");
    expect(JSON.stringify(row)).not.toContain("19.07");
  });

  test("a district equal to the town is dropped", async () => {
    const r = await req<{ city: string; district: string | null }>(
      "POST",
      "/api/geo/map-locate",
      SZEGED,
      { token: coupleToken },
    );
    expect(r.data.city).toBe("Szeged");
    expect(r.data.district).toBeNull();
  });

  test("a repeat tap in the same place is one use; after the window it is another", async () => {
    await req("POST", "/api/geo/map-locate", BUDAPEST, { token: coupleToken });
    const again = await req<{ recorded: boolean }>("POST", "/api/geo/map-locate", BUDAPEST, {
      token: coupleToken,
    });
    expect(again.data.recorded).toBe(false);
    // A different place inside the window still counts.
    const moved = await req<{ recorded: boolean }>("POST", "/api/geo/map-locate", SZEGED, {
      token: coupleToken,
    });
    expect(moved.data.recorded).toBe(true);

    db.prepare("UPDATE map_locate_events SET created_at = created_at - ?").run(
      MAP_LOCATE_DEDUPE_MS + 1000,
    );
    const later = await req<{ recorded: boolean }>("POST", "/api/geo/map-locate", BUDAPEST, {
      token: coupleToken,
    });
    expect(later.data.recorded).toBe(true);
  });

  test("anonymous → 401, junk coordinates → 400", async () => {
    expect((await req("POST", "/api/geo/map-locate", BUDAPEST)).status).toBe(401);
    const bad = await req(
      "POST",
      "/api/geo/map-locate",
      { lat: 123, lng: 19 },
      {
        token: coupleToken,
      },
    );
    expect(bad.status).toBe(400);
    const str = await req(
      "POST",
      "/api/geo/map-locate",
      { lat: "47", lng: "19" },
      {
        token: coupleToken,
      },
    );
    expect(str.status).toBe(400);
  });
});

describe("GET /api/admin/analytics/map-locate", () => {
  test("counts people and taps by town and district", async () => {
    const other = (await bootstrapCouple("second@weddly.test")).token;
    await req("POST", "/api/geo/map-locate", BUDAPEST, { token: coupleToken });
    await req("POST", "/api/geo/map-locate", SZEGED, { token: coupleToken });
    await req("POST", "/api/geo/map-locate", BUDAPEST, { token: other });

    const r = await req<AdminMapLocateAnalytics>(
      "GET",
      "/api/admin/analytics/map-locate",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.total_uses).toBe(3);
    expect(r.data.unique_users).toBe(2);
    expect(r.data.uses_30d).toBe(3);
    expect(r.data.users_30d).toBe(2);
    expect(r.data.unresolved).toBe(0);
    expect(r.data.top_cities[0]).toEqual({ country: "HU", city: "Budapest", count: 2, users: 2 });
    expect(r.data.top_cities[1]).toEqual({ country: "HU", city: "Szeged", count: 1, users: 1 });
    expect(r.data.top_districts).toEqual([
      { city: "Budapest", district: "VII. kerület", count: 2, users: 2 },
    ]);
  });

  test("admin's own taps are excluded by default", async () => {
    await req("POST", "/api/geo/map-locate", BUDAPEST, { token: adminToken });
    const r = await req<AdminMapLocateAnalytics>(
      "GET",
      "/api/admin/analytics/map-locate",
      undefined,
      { token: adminToken },
    );
    expect(r.data.total_uses).toBe(0);
    const all = await req<AdminMapLocateAnalytics>(
      "GET",
      "/api/admin/analytics/map-locate?include_admins=1",
      undefined,
      { token: adminToken },
    );
    expect(all.data.total_uses).toBe(1);
  });

  test("non-admin → 403", async () => {
    const r = await req("GET", "/api/admin/analytics/map-locate", undefined, {
      token: coupleToken,
    });
    expect(r.status).toBe(403);
  });
});
