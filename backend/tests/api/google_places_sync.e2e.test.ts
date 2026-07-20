// Google Places rating backfill — the operator-run job behind the browse
// teaser's ranking. Runs against the deterministic stub (GOOGLE_PLACES_FAKE=1,
// pinned in tests/setup.ts), so nothing here touches the billed API.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { syncPlaceRatings } from "../../src/domain/google_places_sync";
import { wipeAll } from "../helpers";

function insertListing(id: string, name: string, opts: { status?: string } = {}): void {
  db.prepare(
    `INSERT INTO listings
       (id, source, category, name, city, status, hero_image_url, content_hash, created_at, updated_at)
     VALUES (?, 'curated', 'venue', ?, 'Budapest', ?, 'https://img.example/x.jpg', '', ?, ?)`,
  ).run(id, name, opts.status ?? "active", now(), now());
}

function ratingRow(id: string): { google_rating: number | null; google_synced_at: number | null } {
  return db
    .prepare("SELECT google_rating, google_synced_at FROM listings WHERE id = ?")
    .get(id) as {
    google_rating: number | null;
    google_synced_at: number | null;
  };
}

beforeEach(() => {
  wipeAll();
  db.exec("DELETE FROM listings");
});

describe("google places sync", () => {
  test("writes a rating and a sync stamp onto unsynced listings", async () => {
    insertListing("a", "Alpha Venue");
    insertListing("b", "Beta Venue");

    const r = await syncPlaceRatings(50);
    expect(r.skipped).toBe(false);
    expect(r.attempted).toBe(2);
    expect(r.updated).toBe(2);

    const a = ratingRow("a");
    expect(a.google_rating).toBeGreaterThanOrEqual(3);
    expect(a.google_rating).toBeLessThanOrEqual(5);
    expect(a.google_synced_at).not.toBeNull();
  });

  test("skips listings synced recently, so a re-run costs nothing", async () => {
    insertListing("a", "Alpha Venue");
    await syncPlaceRatings(50);

    const second = await syncPlaceRatings(50);
    expect(second.attempted).toBe(0);
    expect(second.updated).toBe(0);
  });

  test("re-resolves a rating older than the refresh window", async () => {
    insertListing("a", "Alpha Venue");
    await syncPlaceRatings(50);
    // Backdate past the 30-day window.
    db.prepare("UPDATE listings SET google_synced_at = ? WHERE id = 'a'").run(
      now() - 40 * 24 * 60 * 60 * 1000,
    );

    const again = await syncPlaceRatings(50);
    expect(again.attempted).toBe(1);
    expect(again.updated).toBe(1);
  });

  test("honours the limit and leaves inactive listings alone", async () => {
    insertListing("a", "Alpha Venue");
    insertListing("b", "Beta Venue");
    insertListing("hidden", "Hidden Venue", { status: "hidden" });

    const r = await syncPlaceRatings(1);
    expect(r.attempted).toBe(1);
    expect(ratingRow("hidden").google_synced_at).toBeNull();
  });
});
