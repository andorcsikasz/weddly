// Coordinate backfill for DB-backed listings (`domain/listing_geocode.ts`,
// driven by `scripts/geocode_listings.ts`). Community + vendor cards used to
// carry a full address and still never appear on the directory map, because
// nothing ever resolved it to lat/lng.
//
// Runs against the deterministic Photon fixtures (ADDRESS_SUGGEST_FAKE=1, pinned
// in tests/setup.ts), which answer with Budapest addresses — so a Budapest
// listing is the "placeable" case and any other town is the "refuse to guess"
// case.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { geocodeListings } from "../../src/domain/listing_geocode";

interface Row {
  lat: number | null;
  lng: number | null;
  geo_synced_at: number | null;
}

function insertListing(id: string, city: string, address: string | null): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings (id, source, category, name, city, address, status, created_at, updated_at)
     VALUES (?, 'community', 'florist', ?, ?, ?, 'active', ?, ?)`,
  ).run(id, `Test ${id}`, city, address, ts, ts);
}

function readListing(id: string): Row {
  return db.prepare("SELECT lat, lng, geo_synced_at FROM listings WHERE id = ?").get(id) as Row;
}

describe("geocodeListings", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM listings WHERE id LIKE 'geotest-%'").run();
  });

  test("places a listing whose address the geocoder can resolve", async () => {
    insertListing("geotest-1", "Budapest", "Andrássy út 60");

    const r = await geocodeListings(10);
    expect(r.placed).toBeGreaterThanOrEqual(1);

    const row = readListing("geotest-1");
    expect(typeof row.lat).toBe("number");
    expect(typeof row.lng).toBe("number");
    expect(row.geo_synced_at).not.toBeNull();
  });

  test("leaves a row alone when the hit is nowhere near the town it claims", async () => {
    // The fixtures only know Budapest, so a Szeged address can't be verified —
    // and a wrong pin is worse than no pin.
    insertListing("geotest-2", "Szeged", "Kárász utca 1");

    await geocodeListings(10);

    const row = readListing("geotest-2");
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    // Stamped anyway, so the next run doesn't re-ask about the same address.
    expect(row.geo_synced_at).not.toBeNull();
  });

  test("skips rows without an address and rows already placed", async () => {
    insertListing("geotest-3", "Budapest", null);
    insertListing("geotest-4", "Budapest", "Andrássy út 60");
    db.prepare("UPDATE listings SET lat = 1.5, lng = 2.5 WHERE id = 'geotest-4'").run();

    await geocodeListings(10);

    expect(readListing("geotest-3").geo_synced_at).toBeNull();
    const placed = readListing("geotest-4");
    expect(placed.lat).toBe(1.5);
    expect(placed.lng).toBe(2.5);
    expect(placed.geo_synced_at).toBeNull();
  });

  test("never touches curated rows (their coords ship in suppliers_data.ts)", async () => {
    const ts = now();
    db.prepare(
      `INSERT INTO listings (id, source, category, name, city, address, status, created_at, updated_at)
       VALUES ('geotest-5', 'curated', 'venue', 'Curated test', 'Budapest', 'Andrássy út 60', 'active', ?, ?)`,
    ).run(ts, ts);

    await geocodeListings(10);

    const row = readListing("geotest-5");
    expect(row.lat).toBeNull();
    expect(row.geo_synced_at).toBeNull();
  });
});
