// The "csak a választottak" chip in the supplier directory wears a count, and
// tapping it applies `?picked=1`, which keeps only the cards whose id is one of
// the couple's picks. Those two numbers are the same promise made twice, so
// they are not allowed to disagree: a chip reading "(1)" over an empty grid
// gives the couple nothing to clear and nothing to blame, and the empty state
// underneath it then blames the country scope for something the country scope
// did not do.
//
// The way they used to disagree was the sentinels. "Magam szervezem" and
// "nincs rá szükségem" ride the same one-pick-per-category storage as a real
// supplier id, and both match no card by construction, so counting either one
// guarantees the gap. The not-needed half was already excluded; the
// self-organised half was counted on the grounds that it is a genuine decision,
// which it is. It is just not a vendor, and this chip counts vendors.

import { describe, expect, test } from "bun:test";
import {
  NOT_NEEDED_PICK,
  SELF_ORGANIZED_PICK,
  countRealPicks,
  isSentinelPick,
} from "../../shared/picks";

/** What `?picked=1` actually does to the grid: keep the cards whose id is a
 *  pick. Written out rather than imported because the page holds it inline:
 *  if that ever moves into a helper, point this at the helper instead. */
function cardsUnderPickedFilter(
  selection: Readonly<Record<string, string | undefined>>,
  cards: readonly { id: string }[],
): { id: string }[] {
  const pickedIds = new Set(Object.values(selection));
  return cards.filter((c) => pickedIds.has(c.id));
}

describe("the picked chip counts what the picked filter can show", () => {
  const catalogue = [{ id: "aranybastya" }, { id: "kondella-misi" }, { id: "c9" }];

  test("a self-organised planner is a decision, not a card, and is not counted", () => {
    const selection = { wedding_planner: SELF_ORGANIZED_PICK };
    expect(countRealPicks(selection)).toBe(0);
    expect(cardsUnderPickedFilter(selection, catalogue)).toHaveLength(0);
  });

  test("a not-needed category is not counted either", () => {
    expect(countRealPicks({ transport: NOT_NEEDED_PICK })).toBe(0);
  });

  test("real picks are counted, and every one of them is a card", () => {
    const selection = { venue: "aranybastya", photography: "kondella-misi" };
    expect(countRealPicks(selection)).toBe(2);
    expect(cardsUnderPickedFilter(selection, catalogue)).toHaveLength(2);
  });

  test("sentinels mixed in with real picks change the count by nothing", () => {
    const selection = {
      venue: "aranybastya",
      wedding_planner: SELF_ORGANIZED_PICK,
      transport: NOT_NEEDED_PICK,
    };
    expect(countRealPicks(selection)).toBe(1);
    expect(cardsUnderPickedFilter(selection, catalogue)).toHaveLength(1);
  });

  test("the count never exceeds what the filter yields from a full catalogue", () => {
    // The general shape of the invariant: whatever the selection, if every
    // picked id is present in the catalogue then the chip's number IS the
    // number of cards. Anything the chip counts that the filter cannot match
    // is the bug this file exists for.
    const selection = {
      venue: "aranybastya",
      photography: "kondella-misi",
      catering: "c9",
      wedding_planner: SELF_ORGANIZED_PICK,
      lighting: NOT_NEEDED_PICK,
    };
    expect(cardsUnderPickedFilter(selection, catalogue)).toHaveLength(countRealPicks(selection));
  });

  test("an empty selection, and an undefined value, both count nothing", () => {
    expect(countRealPicks({})).toBe(0);
    expect(countRealPicks({ venue: undefined })).toBe(0);
  });

  test("both sentinels are still sentinels (the count leans on this)", () => {
    expect(isSentinelPick(SELF_ORGANIZED_PICK)).toBe(true);
    expect(isSentinelPick(NOT_NEEDED_PICK)).toBe(true);
    expect(isSentinelPick("aranybastya")).toBe(false);
  });
});
