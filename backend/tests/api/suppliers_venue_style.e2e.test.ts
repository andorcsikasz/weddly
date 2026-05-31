// `venue_style` on the curated directory — refines the always-"venue" category
// with the kind of place (castle, boat, restaurant…). Sourced from each
// listing's "jelleg" tag in suppliers_data.ts and mirrored into `listings`.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req } from "../helpers";
import { getListingById } from "../../src/domain/listings";

interface DirectoryItem {
  id: string;
  category: string;
  venue_style: string | null;
}

describe("GET /api/suppliers — venue_style", () => {
  test("classified venues expose their venue_style", async () => {
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers?category=venue");
    expect(r.status).toBe(200);
    const byId = new Map(r.data.suppliers.map((s) => [s.id, s] as const));

    // A handful of entries from the regional expansion, one per style shape.
    expect(byId.get("wedding-beach-tat")?.venue_style).toBe("waterfront");
    expect(byId.get("europa-hajo-budapest")?.venue_style).toBe("boat");
    expect(byId.get("teleki-tisza-kastely-nagykovacsi")?.venue_style).toBe("castle");
    expect(byId.get("le-til-kuria-biri")?.venue_style).toBe("manor");
    expect(byId.get("vadvirag-rendezvenyterem-cegled")?.venue_style).toBe("event_hall");
    expect(byId.get("vankos-es-eszcajg-ujhartyan")?.venue_style).toBe("venue_with_stay");
  });

  test("unclassified curated entries default venue_style to null", async () => {
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    expect(r.status).toBe(200);
    // A non-venue curated entry — never carries a venue style.
    const stationery = r.data.suppliers.find((s) => s.id === "vinczemill");
    expect(stationery?.venue_style ?? null).toBeNull();
  });

  test("venue_style is mirrored into the listings table on backfill", () => {
    const listing = getListingById("wedding-beach-tat");
    expect(listing).not.toBeNull();
    expect(listing?.venue_style).toBe("waterfront");
  });
});
