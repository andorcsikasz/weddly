// Regression guards for the supplier-directory "nearby cities" + "~45 km" hint.
// Two coupling traps motivate these tests. First, the prefix-match fallback in
// `distanceContextForQuery` historically trusted `cities[0]` to be the anchor —
// re-sorting the metro arrays alphabetically (or any other reason) would silently
// pull random coords and produce 5000-km hints from the (0,0) gulf-of-guinea
// fallback. Second, the same-metro guard exists specifically so a Pécs supplier
// surfacing under a Budapest query through some other path doesn't render a
// "~300 km" badge that reads as a system error. Both are easy to break invisibly
// during a refactor; pin them here.

import { describe, expect, it } from "bun:test";
import {
  distanceContextForQuery,
  metroKeysForCity,
  metroKeysForQuery,
  nearbyExpansionLabel,
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

describe("distanceContextForQuery — same-metro guard", () => {
  it("returns null when the query and supplier sit in different metros (no 300 km surprise)", () => {
    // "pecs" → Pécs group; "Vác" → Budapest group. The guard should refuse to
    // compute a cross-metro distance even though both cities are in the dictionary.
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

describe("nearbyExpansionLabel", () => {
  it("returns null when the user typed an anchor exactly (no banner needed)", () => {
    expect(nearbyExpansionLabel("budapest")).toBeNull();
  });

  it("returns null on an anchor prefix-match (still effectively the anchor)", () => {
    expect(nearbyExpansionLabel("buda")).toBeNull();
  });

  it("returns the anchor label for a non-anchor town in the metro", () => {
    expect(nearbyExpansionLabel("zsambek")).toBe("Budapest");
  });

  it("returns null for a completely unknown query", () => {
    expect(nearbyExpansionLabel("xyzzy")).toBeNull();
  });
});
