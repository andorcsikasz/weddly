// Data-shape contract for the couple-cards deck definitions. The whole
// feature ships static, so the cheapest insurance against a copy-paste
// regression is to pin "every deck has exactly 25 HU + 25 EN questions,
// the deck count is 4, deck ids are distinct".

import { describe, expect, it } from "bun:test";
import { COUPLE_CARD_DECKS, DECK_SIZE } from "@/lib/couple_cards";

// Decks that ship without questions yet — they render a "coming soon"
// label and are not openable until cards land. Keep this list in sync
// with the empty arrays in couple_cards.ts.
const COMING_SOON_DECK_IDS = new Set(["greenflag"]);

describe("couple_cards data shape", () => {
  it("ships exactly 6 decks (4 red + greenflag + lemonade easter eggs)", () => {
    expect(COUPLE_CARD_DECKS.length).toBe(6);
  });

  it("every playable deck has DECK_SIZE questions in both locales", () => {
    expect(DECK_SIZE).toBe(25);
    for (const deck of COUPLE_CARD_DECKS) {
      if (COMING_SOON_DECK_IDS.has(deck.id)) {
        // Coming-soon decks ship with empty arrays until their cards land.
        expect(deck.questionsHu.length).toBe(0);
        expect(deck.questionsEn.length).toBe(0);
        continue;
      }
      expect(deck.questionsHu.length).toBe(DECK_SIZE);
      expect(deck.questionsEn.length).toBe(DECK_SIZE);
    }
  });

  it("deck ids are unique", () => {
    const ids = COUPLE_CARD_DECKS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every question is a non-empty string in both locales", () => {
    for (const deck of COUPLE_CARD_DECKS) {
      for (const q of deck.questionsHu) {
        expect(typeof q).toBe("string");
        expect(q.trim().length).toBeGreaterThan(0);
      }
      for (const q of deck.questionsEn) {
        expect(typeof q).toBe("string");
        expect(q.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("contains no em-dash characters (banned project-wide)", () => {
    // Em-dash slips into AI-generated copy by default. We strip them at
    // ingest because the user has flagged it as an AI tell — keep this
    // assertion in case someone regenerates the deck via an LLM later.
    for (const deck of COUPLE_CARD_DECKS) {
      for (const q of [...deck.questionsHu, ...deck.questionsEn]) {
        expect(q).not.toContain("—");
      }
    }
  });
});
