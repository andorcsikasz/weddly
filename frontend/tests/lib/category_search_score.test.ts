import { describe, expect, test } from "bun:test";
import { categorySearchScore, foldForSearch, searchScore } from "@shared/suppliers";

const score = (label: string, q: string) => categorySearchScore(label, foldForSearch(q));

describe("category search score", () => {
  test("a query that runs past the label still finds the category", () => {
    // "fotós" on the browse page offered three foreign studios and no Fotó row.
    expect(score("Fotó", "fotós")).toBeGreaterThan(0);
    expect(score("Videó", "videós")).toBeGreaterThan(0);
    expect(score("Esküvői helyszín", "helyszínek")).toBeGreaterThan(0);
  });

  test("forward matches keep their own score and outrank the loose one", () => {
    expect(score("Fotó", "fot")).toBe(searchScore("Fotó", "fot"));
    expect(score("Fotó", "foto")).toBeGreaterThan(score("Fotó", "fotós"));
  });

  test("a short label never swallows a longer word", () => {
    expect(score("DJ", "djembe")).toBe(0);
    expect(score("Fotó", "virág")).toBe(0);
  });
});
