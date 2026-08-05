// Data-shape contract for the couple-cards deck definitions. The whole
// feature ships static, so the cheapest insurance against a copy-paste
// regression is to pin "every deck has exactly 25 questions in every UI
// locale, the deck count is 6, deck ids are distinct".

import { describe, expect, it } from "bun:test";
import { UI_LOCALES } from "@shared/locales";
import {
  CARD_LOCALES,
  COUPLE_CARD_DECKS,
  DECK_SIZE,
  deckHasCards,
  deckQuestions,
} from "@/lib/couple_cards";

// Decks that ship without questions yet — they render a "coming soon"
// label and are not openable until cards land. Keep this list in sync
// with the empty arrays in couple_cards.ts. All six decks are now fully
// populated, so this is empty.
const COMING_SOON_DECK_IDS = new Set<string>();

describe("couple_cards data shape", () => {
  it("ships exactly 6 decks (4 red + firstdate + lemonade easter eggs)", () => {
    expect(COUPLE_CARD_DECKS.length).toBe(6);
  });

  it("carries a card list for every UI locale, single-sourced from UI_LOCALES", () => {
    expect(CARD_LOCALES).toEqual(UI_LOCALES);
  });

  it("every playable deck has DECK_SIZE questions in every locale", () => {
    expect(DECK_SIZE).toBe(25);
    for (const deck of COUPLE_CARD_DECKS) {
      for (const locale of CARD_LOCALES) {
        const expected = COMING_SOON_DECK_IDS.has(deck.id) ? 0 : DECK_SIZE;
        expect(deck.questions[locale].length).toBe(expected);
      }
    }
  });

  it("deck ids are unique", () => {
    const ids = COUPLE_CARD_DECKS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every question is a non-empty string in every locale", () => {
    for (const deck of COUPLE_CARD_DECKS) {
      for (const locale of CARD_LOCALES) {
        for (const q of deck.questions[locale]) {
          expect(typeof q).toBe("string");
          expect(q.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("no deck repeats a question inside one locale", () => {
    for (const deck of COUPLE_CARD_DECKS) {
      for (const locale of CARD_LOCALES) {
        const list = deck.questions[locale];
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it("contains no em-dash or en-dash characters (banned project-wide)", () => {
    // Em-dash slips into AI-generated copy by default. We strip them at
    // ingest because the user has flagged it as an AI tell — keep this
    // assertion in case someone regenerates the deck via an LLM later.
    // The en-dash rides along because the Hungarian lines arrived using it
    // for exactly the same parenthetical construction.
    for (const deck of COUPLE_CARD_DECKS) {
      for (const locale of CARD_LOCALES) {
        for (const q of deck.questions[locale]) {
          expect(q).not.toContain("—");
          expect(q).not.toContain("–");
        }
      }
    }
  });

  it("deckQuestions returns the asked-for locale and deckHasCards agrees", () => {
    const roots = COUPLE_CARD_DECKS.find((d) => d.id === "roots");
    if (!roots) throw new Error("roots deck missing");
    expect(deckHasCards(roots)).toBe(true);
    for (const locale of CARD_LOCALES) {
      expect(deckQuestions(roots, locale)).toBe(roots.questions[locale]);
    }
  });

  it("deckQuestions falls back to EN when a locale ships no cards", () => {
    // A half-translated deck must read as English, never as blanks: same
    // per-key degradation `t()` applies to UI copy.
    const stub = {
      id: "roots" as const,
      titleKey: "x",
      blurbKey: "y",
      questions: { en: ["only english"], hu: [], es: [], hr: [], de: [] },
    };
    expect(deckQuestions(stub, "de")).toEqual(["only english"]);
    expect(deckHasCards(stub)).toBe(true);
  });
});
