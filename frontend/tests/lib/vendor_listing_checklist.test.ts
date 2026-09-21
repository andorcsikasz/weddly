// The vendor's setup checklist is in the order of the page couples see and of
// the listing editor, so working down the checklist is working down the form
// (owner direction 2026-09-21). This pins the order; it never had one worth
// pinning before, and a reshuffle would silently un-parallel the two.

import { describe, expect, it } from "bun:test";
import { listingChecklistFor } from "@shared/vendor_clients";

const input = {
  category: "venue",
  hero_image_url: null,
  blurb_hu: null,
  blurb_en: null,
  city: null,
  contact_email: null,
  contact_phone: null,
  price_band: null,
  capacity_min: null,
  capacity_max: null,
  photo_count: 0,
  package_count: 0,
} as const;

describe("listingChecklistFor", () => {
  it("runs facts, photos, packages, about, contact for a category with a guest count", () => {
    expect(listingChecklistFor(input).map((s) => s.key)).toEqual([
      "pricing",
      "capacity",
      "cover",
      "gallery",
      "packages",
      "description",
      "contact",
    ]);
  });

  it("drops capacity, and only capacity, where a guest count means nothing", () => {
    expect(listingChecklistFor({ ...input, category: "florist" }).map((s) => s.key)).toEqual([
      "pricing",
      "cover",
      "gallery",
      "packages",
      "description",
      "contact",
    ]);
  });

  it("still scores each step off its own field", () => {
    const steps = listingChecklistFor({
      ...input,
      price_band: 3,
      hero_image_url: "/uploads/x.jpg",
      package_count: 1,
      city: "Szeged",
      contact_phone: "+36 30 1",
    });
    const done = Object.fromEntries(steps.map((s) => [s.key, s.done]));
    expect(done).toEqual({
      pricing: true,
      capacity: false,
      cover: true,
      gallery: false,
      packages: true,
      description: false,
      contact: true,
    });
  });
});
