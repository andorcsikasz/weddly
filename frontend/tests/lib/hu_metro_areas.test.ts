// Regression guards for the supplier-directory "nearby cities" + "~45 km" hint.
// Two coupling traps motivate these tests. First, the prefix-match fallback in
// `resolveQueryCoords` historically trusted `cities[0]` to be the anchor —
// re-sorting the metro arrays alphabetically (or any other reason) would silently
// pull random coords and produce 5000-km hints from the (0,0) gulf-of-guinea
// fallback. Second, proximity is now RADIAL: the old same-metro guard is gone, so
// a venue one group over but genuinely close must surface, while anything past
// NEARBY_RADIUS_KM must still be refused (a "~300 km" badge reads as a system
// error). Both are easy to break invisibly during a refactor; pin them here.

import { beforeAll, describe, expect, it } from "bun:test";
import {
  distanceContextForQuery,
  distanceKmForQuery,
  metroKeysForCity,
  metroKeysForQuery,
  NEARBY_RADIUS_KM,
  nearbyTownLabel,
  registerTown,
  registerTowns,
  searchTowns,
} from "@/lib/hu_metro_areas";

describe("metroKeysForCity", () => {
  it("returns the metro key for an anchor, a non-anchor town, and an upper-cased anchor", () => {
    expect(metroKeysForCity("Budapest")).toBe("budapest");
    expect(metroKeysForCity("BUDAPEST")).toBe("budapest");
    expect(metroKeysForCity("Érd")).toBe("budapest");
  });

  it("returns the empty string for nullish, empty, or unknown cities", () => {
    expect(metroKeysForCity(null)).toBe("");
    expect(metroKeysForCity(undefined)).toBe("");
    expect(metroKeysForCity("")).toBe("");
    expect(metroKeysForCity("Atlantis")).toBe("");
  });
});

describe("metroKeysForQuery", () => {
  it("matches an anchor query exactly", () => {
    expect(metroKeysForQuery("budapest")).toEqual(["budapest"]);
  });

  it("expands a non-anchor town to its metro key", () => {
    expect(metroKeysForQuery("zsambek")).toEqual(["budapest"]);
  });

  it("prefix-matches an anchor when the query is at least 4 chars", () => {
    expect(metroKeysForQuery("buda")).toEqual(["budapest"]);
  });

  it("does not prefix-match below the 4-char threshold", () => {
    expect(metroKeysForQuery("bud")).toEqual([]);
  });

  it("returns an empty array for an unknown query", () => {
    expect(metroKeysForQuery("xyzzy")).toEqual([]);
  });
});

describe("searchTowns — typeahead lookup", () => {
  it("prefix-matches and prefers the shorter name", () => {
    const out = searchTowns("vác", 7);
    // "Vác" should outrank "Vácrátót" (shortest prefix match wins).
    expect(out[0]).toBe("Vác");
    expect(out).toContain("Vácrátót");
  });

  it("is diacritic- and case-insensitive", () => {
    expect(searchTowns("BUDA", 7)).toContain("Budapest");
    expect(searchTowns("erd", 7)).toContain("Érd");
  });

  it("respects the limit and dedupes", () => {
    const out = searchTowns("a", 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns nothing for an empty or unknown fragment", () => {
    expect(searchTowns("", 7)).toEqual([]);
    expect(searchTowns("   ", 7)).toEqual([]);
    expect(searchTowns("zzzzqq", 7)).toEqual([]);
  });
});

describe("distanceContextForQuery — radial proximity (no metro-group gate)", () => {
  it("returns a distance for a NEAR pair that straddles two metro groups", () => {
    // The bug we fixed: Mór sits in the Székesfehérvár group, Csákvár in the
    // Budapest group, but they're only ~20 km apart. The old same-metro guard
    // hid this; radial proximity must now surface it.
    const ctx = distanceContextForQuery("mor", "Csákvár");
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.fromLabel).toBe("Mór");
    expect(ctx.km % 5).toBe(0);
    expect(ctx.km).toBeLessThanOrEqual(NEARBY_RADIUS_KM);
  });

  it("returns null when the two towns are further than NEARBY_RADIUS_KM apart", () => {
    // Pécs ↔ Vác is ~200 km — well past the radius. A hint that far isn't
    // useful and reads as a system error, so it's still refused (now by the
    // distance cap, not by group identity).
    expect(distanceContextForQuery("pecs", "Vác")).toBeNull();
  });
});

describe("distanceContextForQuery — < 5 km floor", () => {
  it("returns null when the supplier city equals the query town (rounds to 0)", () => {
    expect(distanceContextForQuery("budapest", "Budapest")).toBeNull();
  });

  it("returns a 5-km-bucketed distance for a near-neighbour pair", () => {
    // Budapest ↔ Érd is ~15 km Haversine, well clear of the 5 km floor.
    // Don't hardcode the exact bucket — assert the contract (≥ 5 and a 5-multiple)
    // so cosmetic coord nudges don't flap the test.
    const ctx = distanceContextForQuery("budapest", "Érd");
    expect(ctx).not.toBeNull();
    if (!ctx) return; // narrow for TS
    expect(ctx.fromLabel).toBe("Budapest");
    expect(ctx.km).toBeGreaterThanOrEqual(5);
    expect(ctx.km % 5).toBe(0);
  });
});

describe("distanceContextForQuery — supplier-coord fallback", () => {
  it("uses the supplier's own lat/lng when its city isn't in the dictionary", () => {
    // Unknown city string, but real coordinates near Budapest (≈ Érd). The
    // dictionary lookup misses on the city, so the fallback coords carry it.
    const ctx = distanceContextForQuery("budapest", "Nowhere-on-the-map", {
      lat: 47.39,
      lng: 18.92,
    });
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.km).toBeGreaterThanOrEqual(5);
    expect(ctx.km % 5).toBe(0);
  });

  it("returns null when neither the city nor coords resolve", () => {
    expect(distanceContextForQuery("budapest", "Nowhere", { lat: null, lng: null })).toBeNull();
  });
});

describe("distanceKmForQuery", () => {
  it("returns raw (un-bucketed) km with no radius cap so callers can bound it", () => {
    const far = distanceKmForQuery("pecs", "Vác");
    expect(far).not.toBeNull();
    if (far == null) return;
    // Cross-country pair — well past the nearby radius; the raw helper still
    // reports it (the cap lives in distanceContextForQuery / the filter).
    expect(far).toBeGreaterThan(NEARBY_RADIUS_KM);
  });

  it("returns null when the query isn't a known town", () => {
    expect(distanceKmForQuery("xyzzy", "Budapest")).toBeNull();
  });
});

describe("distanceContextForQuery — prefix-match path (cities[0] regression guard)", () => {
  it("returns the anchor as fromLabel, not some arbitrary first-array city", () => {
    // "buda" doesn't match any city directly; it falls through to the anchor
    // prefix-match path. If that path naïvely trusts `cities[0]` to be the
    // anchor and the array gets reordered, fromLabel breaks AND coords come
    // from the wrong city (cascading into a wild km value). Pin both.
    const ctx = distanceContextForQuery("buda", "Vác");
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.fromLabel).toBe("Budapest");
    expect(ctx.km % 5).toBe(0);
    // Budapest ↔ Vác is ~30 km Haversine. A wide plausibility band catches
    // the symptom of the cities[0] bug (e.g. 5000 km from a 0/0 fallback)
    // even if fromLabel happened to land right by coincidence.
    expect(ctx.km).toBeGreaterThanOrEqual(20);
    expect(ctx.km).toBeLessThanOrEqual(50);
  });
});

describe("nearbyTownLabel", () => {
  it("returns the canonical town label when the user typed an anchor exactly", () => {
    expect(nearbyTownLabel("budapest")).toBe("Budapest");
  });

  it("resolves an anchor prefix-match to the anchor label", () => {
    expect(nearbyTownLabel("buda")).toBe("Budapest");
  });

  it("returns the canonical name for a non-anchor town in the metro", () => {
    expect(nearbyTownLabel("zsambek")).toBe("Zsámbék");
  });

  it("returns null for a completely unknown query", () => {
    expect(nearbyTownLabel("xyzzy")).toBeNull();
  });
});

// The runtime overlay is what lets the search resolve ANY of the ~3,155 HU
// settlements (not just the ~200 curated metro towns) plus one-off geocoder
// hits. These register into shared module state, so this block runs last to
// avoid perturbing the curated-only assertions above.
describe("runtime town overlay — gazetteer + geocoder", () => {
  beforeAll(async () => {
    const { HU_GAZETTEER } = await import("@/lib/hu_gazetteer");
    registerTowns(HU_GAZETTEER);
  });

  it("resolves a gazetteer village outside the curated dictionary (Zebegény)", () => {
    // Zebegény is a real Danube-bend village with no curated metro entry; before
    // the gazetteer it resolved to nothing and proximity silently degraded to
    // text matching. Now it must place on the map.
    expect(nearbyTownLabel("zebegeny")).toBe("Zebegény");
    const km = distanceKmForQuery("zebegeny", "Vác");
    expect(km).not.toBeNull();
    if (km == null) return;
    // Zebegény ↔ Vác is ~15 km crow-flies — comfortably inside the nearby band.
    expect(km).toBeGreaterThan(0);
    expect(km).toBeLessThan(NEARBY_RADIUS_KM);
  });

  it("surfaces a gazetteer village in the typeahead", () => {
    expect(searchTowns("zebeg", 7)).toContain("Zebegény");
  });

  it("never lets a registered row shadow a curated coordinate", () => {
    // A bogus (0,0) Budapest must NOT override the hand-tuned metro coord — else
    // every Budapest distance would blow up from the gulf-of-guinea origin.
    registerTowns([["Budapest", 0, 0]]);
    const ctx = distanceContextForQuery("budapest", "Érd");
    expect(ctx?.fromLabel).toBe("Budapest");
    expect(ctx?.km).toBeLessThanOrEqual(NEARBY_RADIUS_KM);
  });

  it("registers a one-off geocoder hit, including the typed alias", () => {
    // Simulates a Nominatim fallback for a place the offline gazetteer lacks:
    // canonical label + the raw term the user typed both resolve to the coord.
    registerTown("Kleinmünchen", 48.26, 14.29, "kleinmunchen typed");
    expect(nearbyTownLabel("kleinmunchen")).toBe("Kleinmünchen");
    expect(nearbyTownLabel("kleinmunchen typed")).toBe("Kleinmünchen");
  });
});
