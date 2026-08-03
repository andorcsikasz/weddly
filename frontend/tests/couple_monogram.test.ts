// Unit coverage for the couple monogram's initials rule. Pure, no rendering:
// the component is a chip around this function, and every interesting case is
// in the function.

import { describe, expect, test } from "bun:test";
import { coupleInitials } from "../src/components/CoupleMonogram";

describe("coupleInitials", () => {
  test("takes one letter per partner from the app's own display name", () => {
    expect(coupleInitials("Allie & Noah")).toBe("AN");
  });

  test("survives a missing space around the separator", () => {
    expect(coupleInitials("Allie&Noah")).toBe("AN");
  });

  test("reads the separators couples actually type", () => {
    expect(coupleInitials("Anna + Béla")).toBe("AB");
    expect(coupleInitials("Anna és Béla")).toBe("AB");
    expect(coupleInitials("Anna and Ben")).toBe("AB");
    expect(coupleInitials("Ana y Pedro")).toBe("AP");
  });

  test("takes the FIRST name of each side, not the surname", () => {
    expect(coupleInitials("Kovács Anna & Nagy Béla")).toBe("KN");
  });

  test("one person falls back to their first two words", () => {
    expect(coupleInitials("Nagy Réka")).toBe("NR");
  });

  test("a single word gives a single letter", () => {
    expect(coupleInitials("Réka")).toBe("R");
  });

  test("non-Latin names keep their own letters rather than emptying out", () => {
    expect(coupleInitials("王芳 & Ольга")).toBe("王О");
    expect(coupleInitials("محمد")).toBe("م");
  });

  test("accents are preserved, not folded away", () => {
    expect(coupleInitials("Ágnes & Örs")).toBe("ÁÖ");
  });

  test("leading punctuation is skipped to find the first real letter", () => {
    expect(coupleInitials('"Bori" & (Tomi)')).toBe("BT");
  });

  test("never returns more than two letters", () => {
    expect(coupleInitials("Anna & Béla & Cili").length).toBe(2);
    expect(coupleInitials("One Two Three Four").length).toBe(2);
  });

  test("a name with no letters at all draws nothing", () => {
    expect(coupleInitials("   ")).toBe("");
    expect(coupleInitials("123 & 456")).toBe("");
  });

  test("the Hungarian locale uppercases its own way", () => {
    // Not a digraph trap, just proof the locale is threaded through rather
    // than defaulting to the host's.
    expect(coupleInitials("anna & béla", "hu")).toBe("AB");
  });
});
