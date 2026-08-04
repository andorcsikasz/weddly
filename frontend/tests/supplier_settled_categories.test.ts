// What a couple sees in a category they have already settled.
//
// The directory's job ends the moment a trade is decided: once the venue is
// booked, the other 289 venues under it are noise. So a settled category
// collapses to the single card that settled it — a listing they picked, a
// vendor they added themselves, or a "csinálom magam" entry — and every other
// card in that category leaves the grid, the map and the counts.
//
// A category the couple has ruled out ("nincs rá szükségem" / "magam
// szervezem") collapses all the way to nothing, which is the one case that can
// leave the grid empty on purpose, so the page owes it a line of copy. The limit
// that keeps a REAL pick from blanking its category behind a filter is pinned
// here rather than left to the page.

import { describe, expect, test } from "bun:test";
import { NOT_NEEDED_PICK, SELF_ORGANIZED_PICK } from "../../shared/picks";
import {
  type SettledCandidate,
  collapseSettledCategories,
  pickIdentityOf,
} from "../../shared/suppliers";

const venueA: SettledCandidate = { id: "venue-a", source: "curated", category: "venue" };
const venueB: SettledCandidate = { id: "venue-b", source: "curated", category: "venue" };
const venueC: SettledCandidate = { id: "venue-c", source: "claimed", category: "venue" };
const photog: SettledCandidate = { id: "photo-a", source: "curated", category: "photography" };
/** A private row the couple typed in, bound to nothing. */
const ownCatering: SettledCandidate = {
  id: "diy-1",
  source: "self",
  category: "catering",
  listing_id: null,
};
/** A private row BOUND to a directory listing: its pick lives on the listing. */
const boundVenue: SettledCandidate = {
  id: "diy-2",
  source: "self",
  category: "venue",
  listing_id: "venue-b",
};

describe("pickIdentityOf", () => {
  test("a directory row answers to its own id", () => {
    expect(pickIdentityOf(venueA)).toBe("venue-a");
  });

  test("an unbound private row answers to its own id", () => {
    expect(pickIdentityOf(ownCatering)).toBe("diy-1");
  });

  test("a bound private row answers to the LISTING's id", () => {
    // The binding is the whole point: one business is one card, and the pick
    // has to survive the row being adopted into the directory.
    expect(pickIdentityOf(boundVenue)).toBe("venue-b");
  });
});

describe("collapseSettledCategories", () => {
  test("a picked category shows the pick and nothing else", () => {
    const out = collapseSettledCategories([venueA, venueB, venueC], { venue: "venue-b" });
    expect(out.map((s) => s.id)).toEqual(["venue-b"]);
  });

  test("categories the couple has not settled are untouched", () => {
    const out = collapseSettledCategories([venueA, venueB, photog], { venue: "venue-a" });
    expect(out.map((s) => s.id)).toEqual(["venue-a", "photo-a"]);
  });

  test("a vendor the couple added themselves collapses its category too", () => {
    const other: SettledCandidate = { id: "cat-a", source: "curated", category: "catering" };
    const out = collapseSettledCategories([other, ownCatering], { catering: "diy-1" });
    expect(out.map((s) => s.id)).toEqual(["diy-1"]);
  });

  test("a bound private row keeps its category collapsed under the listing id", () => {
    // The page draws the LISTING's card for a bound row, so the pick points at
    // the listing. Matching on the row id would leave the category uncollapsed.
    const out = collapseSettledCategories([venueA, venueB, boundVenue], { venue: "venue-b" });
    expect(out.map((s) => s.id)).toEqual(["venue-b", "diy-2"]);
  });

  test("nothing collapses with no picks at all", () => {
    const rows = [venueA, venueB, photog];
    expect(collapseSettledCategories(rows, {})).toEqual(rows);
  });

  test("a sentinel pick empties its category", () => {
    // "nem kell" / "magam szervezem" settle a category harder than a booking
    // does: there is no vendor to keep, and a couple who has ruled the trade
    // out has no use for any of it. The page owes the empty category a line of
    // copy, which is the page's job and not this function's.
    expect(collapseSettledCategories([venueA, venueB], { venue: NOT_NEEDED_PICK })).toEqual([]);
    expect(collapseSettledCategories([photog], { photography: SELF_ORGANIZED_PICK })).toHaveLength(
      0,
    );
  });

  test("a sentinel empties only its own category", () => {
    // The neighbouring trades are untouched: this is one category's decision,
    // and it must not read as an empty directory.
    const out = collapseSettledCategories([venueA, venueB, photog], { venue: NOT_NEEDED_PICK });
    expect(out.map((s) => s.id)).toEqual(["photo-a"]);
  });

  test("a sentinel empties its category even with the pick's card absent", () => {
    // The "did the chosen card survive the other filters" guard protects a REAL
    // pick from being blanked by a city chip. A sentinel names no card, so it
    // has nothing to survive and the guard must not apply to it.
    expect(collapseSettledCategories([venueC], { venue: NOT_NEEDED_PICK })).toEqual([]);
  });

  test("a pick filtered out by something else does NOT blank its category", () => {
    // The couple picked venue-b, then typed a city that venue-b is not in. If
    // this collapsed, the category would read as an empty directory rather than
    // as a filter with no match.
    const out = collapseSettledCategories([venueA, venueC], { venue: "venue-b" });
    expect(out.map((s) => s.id)).toEqual(["venue-a", "venue-c"]);
  });

  test("order survives, so a caller's ranking is preserved", () => {
    const out = collapseSettledCategories([photog, venueA, venueB], {
      venue: "venue-a",
      photography: "photo-a",
    });
    expect(out.map((s) => s.id)).toEqual(["photo-a", "venue-a"]);
  });
});
