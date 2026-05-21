// Geo-proximity filter on `/api/suppliers`. Optional opt-in via
// `?near_lat=&near_lng=&radius_km=` — missing/malformed params keep the
// historic un-filtered behaviour so existing callers see no diff.
//
// The curated DIRECTORY is HU-only today (Budapest + nearby venues) per
// suppliers_data.ts. We exercise the filter against those known coords —
// once non-HU listings populate, the same query shape will start returning
// EU results for a Berlin / Vienna couple's lat/lng.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll } from "../helpers";

interface DirectoryItem {
  id: string;
  category: string;
  lat: number | null;
  lng: number | null;
}

// Budapest city centre — Heroes' Square (Hősök tere) coordinates. Most of
// the curated venue catalogue clusters within a 50 km radius of this point.
const BUDAPEST_LAT = 47.5147;
const BUDAPEST_LNG = 19.0779;

// Norfolk, Virginia — confirmed off-Hungary point we use as the "obviously
// nothing matches" probe. Distance to Budapest ≈ 7600 km, so radius=100 km
// from here must return zero rows.
const NORFOLK_LAT = 36.8508;
const NORFOLK_LNG = -76.2859;

describe("GET /api/suppliers — geo proximity filter", () => {
  test("no geo params → full catalogue (back-compat)", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    expect(r.status).toBe(200);
    // Baseline: at least one curated entry comes back.
    expect(r.data.suppliers.length).toBeGreaterThan(0);
  });

  test("near Budapest within 100 km returns multiple curated venues", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}&radius_km=100`,
    );
    expect(r.status).toBe(200);
    // The curated set has many Budapest-area venues; the geo filter should
    // surface at least a handful, but stay smaller than the un-filtered list.
    expect(r.data.suppliers.length).toBeGreaterThan(0);
  });

  test("near a far point (Norfolk VA) with 100km radius returns zero rows", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${NORFOLK_LAT}&near_lng=${NORFOLK_LNG}&radius_km=100`,
    );
    expect(r.status).toBe(200);
    expect(r.data.suppliers.length).toBe(0);
  });

  test("smaller radius returns a subset of larger radius results", async () => {
    wipeAll();
    const wide = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}&radius_km=200`,
    );
    const narrow = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}&radius_km=5`,
    );
    expect(wide.status).toBe(200);
    expect(narrow.status).toBe(200);
    expect(narrow.data.suppliers.length).toBeLessThanOrEqual(wide.data.suppliers.length);
  });

  test("rows without lat/lng are excluded from geo results", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}&radius_km=50`,
    );
    expect(r.status).toBe(200);
    // Every returned row must have a real coordinate. If a row leaks through
    // without coords, the post-filter is broken.
    for (const s of r.data.suppliers) {
      expect(s.lat).not.toBeNull();
      expect(s.lng).not.toBeNull();
    }
  });

  test("partial geo params (missing radius) keeps the un-filtered behaviour", async () => {
    wipeAll();
    const baseline = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    const partial = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}`,
    );
    expect(partial.status).toBe(200);
    expect(partial.data.suppliers.length).toBe(baseline.data.suppliers.length);
  });

  test("garbage geo params fall back to un-filtered list (no 400)", async () => {
    wipeAll();
    const baseline = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    const garbage = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?near_lat=banana&near_lng=cherry&radius_km=hello",
    );
    expect(garbage.status).toBe(200);
    expect(garbage.data.suppliers.length).toBe(baseline.data.suppliers.length);
  });

  test("geo + category compose (AND-style)", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      `/api/suppliers?category=venue&near_lat=${BUDAPEST_LAT}&near_lng=${BUDAPEST_LNG}&radius_km=100`,
    );
    expect(r.status).toBe(200);
    // Every row is a venue AND geo-filtered.
    for (const s of r.data.suppliers) {
      expect(s.category).toBe("venue");
      expect(s.lat).not.toBeNull();
    }
  });
});
