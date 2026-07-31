// Which vendors count as results for the country a couple is browsing.
//
// The directory leaves CLAIMED (verified) listings out of the country scope on
// purpose, so a registered vendor stays reachable from anywhere. On the client
// that exemption used to mean "keep them in the list and sort them last", which
// holds only while there is something above them: a couple planning in Italy
// reported the vendor list "actually shows vendors in Hungary", and in any
// category Italy has nothing in, the verified Hungarian vendors WERE the list.
//
// So the rule is now: an out-of-country verified vendor is not a result. It
// leaves the grid, the counts and the map, and comes back under its own capped
// heading. That rule is one function, pinned here, because the four consumers
// drifting apart is exactly how the bug arrived.

import { describe, expect, test } from "bun:test";
import { isOutOfCountryScope, partitionByCountryScope } from "../../shared/suppliers";

const italianVenue = { id: "it-1", source: "curated", country: "IT" };
const hungarianVerified = { id: "hu-v1", source: "claimed", country: "HU" };
const hungarianCurated = { id: "hu-1", source: "curated", country: "HU" };
/** The couple's own DIY row: no country, never anyone else's business. */
const ownEntry = { id: "diy-1", source: "self" };

describe("isOutOfCountryScope", () => {
  test("a verified vendor from another country is out of scope", () => {
    expect(isOutOfCountryScope(hungarianVerified, "IT")).toBe(true);
  });

  test("a vendor in the browsed country is in scope, verified or not", () => {
    expect(isOutOfCountryScope(italianVenue, "IT")).toBe(false);
    expect(isOutOfCountryScope({ ...hungarianVerified, country: "IT" }, "IT")).toBe(false);
  });

  test("the couple's own entry is never out of scope", () => {
    // It carries no country and belongs to them, not to a catalogue.
    expect(isOutOfCountryScope(ownEntry, "IT")).toBe(false);
  });

  test("browsing all countries puts nothing out of scope", () => {
    expect(isOutOfCountryScope(hungarianVerified, null)).toBe(false);
    expect(isOutOfCountryScope(italianVenue, null)).toBe(false);
  });
});

describe("partitionByCountryScope", () => {
  test("verified vendors from elsewhere leave the result set", () => {
    const { inScope, outOfScope } = partitionByCountryScope(
      [italianVenue, hungarianVerified, ownEntry],
      "IT",
    );
    expect(inScope.map((s) => s.id)).toEqual(["it-1", "diy-1"]);
    expect(outOfScope.map((s) => s.id)).toEqual(["hu-v1"]);
  });

  test("a country with nothing of its own returns NO results, not a foreign list", () => {
    // The whole point: the page can now say "nothing in Italy yet" instead of
    // rendering Hungary under a heading the couple reads as their options.
    const { inScope, outOfScope } = partitionByCountryScope(
      [hungarianVerified, { id: "hu-v2", source: "claimed", country: "HU" }],
      "IT",
    );
    expect(inScope).toEqual([]);
    expect(outOfScope).toHaveLength(2);
  });

  test("an unscoped browse keeps everything as results", () => {
    const rows = [italianVenue, hungarianVerified, hungarianCurated];
    const { inScope, outOfScope } = partitionByCountryScope(rows, null);
    expect(inScope).toHaveLength(3);
    expect(outOfScope).toEqual([]);
  });

  test("order survives the split, so a caller's ranking is preserved", () => {
    const rows = [
      hungarianVerified,
      italianVenue,
      { id: "it-2", source: "claimed", country: "IT" },
    ];
    const { inScope } = partitionByCountryScope(rows, "IT");
    expect(inScope.map((s) => s.id)).toEqual(["it-1", "it-2"]);
  });
});
