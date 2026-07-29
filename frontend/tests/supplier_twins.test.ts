// The "is this vendor already on Weddly?" matcher.
//
// This is the guard that stops a couple minting a private `couple_suppliers`
// copy of a business the directory already lists, so its two failure modes are
// opposite and both bad: too loose and it blocks the save on an unrelated
// vendor with a similar name, too tight and the duplicate it exists to prevent
// walks straight through. The thresholds below are the whole design, so they
// get pinned here rather than only in the modal that calls them.

import { describe, expect, test } from "bun:test";
import {
  findSupplierTwins,
  foldSupplierName,
  isSameSupplierName,
  type TwinCandidate,
} from "../../shared/suppliers";

function entry(id: string, name: string, category: TwinCandidate["category"]): TwinCandidate {
  return { id, name, category };
}

const DIRECTORY: TwinCandidate[] = [
  entry("hertelendy", "Hertelendy Kastély Kft.", "venue"),
  entry("etyeki", "Etyeki Kúria", "venue"),
  entry("kastely-etterem", "Kastély Étterem", "venue"),
  entry("bloom", "Bloom Studio", "photography"),
];

describe("foldSupplierName", () => {
  test("folds away the things two people would ignore", () => {
    // Diacritics, case, legal form and punctuation are all noise when the
    // question is "did they type the same business".
    expect(foldSupplierName("Hertelendy Kastély Kft.")).toBe("hertelendy kastely");
    expect(foldSupplierName("  HERTELENDY   KASTELY  ")).toBe("hertelendy kastely");
    expect(isSameSupplierName("Hertelendy Kastély Kft.", "hertelendy kastely")).toBe(true);
  });

  test("an empty or punctuation-only name is never 'the same' as anything", () => {
    // Otherwise two blank names fold to "" and match each other, which would
    // block the save on a form the couple has barely started filling in.
    expect(isSameSupplierName("", "")).toBe(false);
    expect(isSameSupplierName("...", "---")).toBe(false);
  });
});

describe("findSupplierTwins", () => {
  test("an exact name match is found and marked exact", () => {
    const hits = findSupplierTwins("hertelendy kastely", "venue", DIRECTORY);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.supplier.id).toBe("hertelendy");
    expect(hits[0]?.exact).toBe(true);
  });

  test("an exact match crosses categories, because that's a mis-file not a second business", () => {
    const hits = findSupplierTwins("Hertelendy Kastély", "catering", DIRECTORY);
    expect(hits.map((h) => h.supplier.id)).toEqual(["hertelendy"]);
    expect(hits[0]?.exact).toBe(true);
  });

  test("a guess never crosses categories", () => {
    // "kastely" is contained in a venue name, but the couple is filing a
    // photographer. Offering the venue there is noise, not help.
    expect(findSupplierTwins("kastely etterem budapest", "photography", DIRECTORY)).toEqual([]);
  });

  test("short queries match nothing", () => {
    // "Kúr" or "DJ" would hit a large slice of the directory.
    expect(findSupplierTwins("Kúr", "venue", DIRECTORY)).toEqual([]);
    // Long enough to be looked up, but a LOOSE hit needs 6+ characters, so
    // this 5-character prefix of "Etyeki Kúria" still doesn't fire.
    expect(findSupplierTwins("Etyek", "venue", DIRECTORY)).toEqual([]);
  });

  test("a long prefix is offered, but not as exact", () => {
    const hits = findSupplierTwins("Etyeki Kúr", "venue", DIRECTORY);
    expect(hits.map((h) => h.supplier.id)).toEqual(["etyeki"]);
    expect(hits[0]?.exact).toBe(false);
  });

  test("the exact hit is ranked above a loose one from the same query", () => {
    // "kastely" alone is a loose hit on both venues; adding the exact name of
    // one of them has to put that one first, or the notice steers the couple
    // to the wrong business.
    const withExact = [...DIRECTORY, entry("kastely", "Kastély", "venue")];
    const hits = findSupplierTwins("Kastély", "venue", withExact);
    expect(hits[0]?.supplier.id).toBe("kastely");
    expect(hits[0]?.exact).toBe(true);
  });

  test("the caller's limit is honoured", () => {
    const hits = findSupplierTwins("kastely", "venue", DIRECTORY, 1);
    expect(hits).toHaveLength(1);
  });

  test("an unrelated name finds nothing", () => {
    expect(findSupplierTwins("Napfény Rendezvényház", "venue", DIRECTORY)).toEqual([]);
  });

  test("a null category compares against the whole directory", () => {
    // The category select starts empty, so the check has to work before the
    // couple has picked one.
    const hits = findSupplierTwins("Bloom Studio", null, DIRECTORY);
    expect(hits.map((h) => h.supplier.id)).toEqual(["bloom"]);
  });
});
