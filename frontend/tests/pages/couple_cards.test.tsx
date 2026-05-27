// Component tests for the 100-questions-before-marriage tool.
//
// Pure client state: no fetch mocks needed. The page reaches into
// localStorage for progress persistence, so each test clears the store
// before render to keep them order-independent.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import CoupleCardsPage from "@/pages/CoupleCardsPage";
import { COUPLE_CARD_DECKS, DECK_SIZE } from "@/lib/couple_cards";

beforeAll(async () => {
  await _preloadHuForTests();
});

beforeEach(() => {
  window.localStorage.clear();
  // Force HU locale: happy-dom's navigator.language defaults to "en", which
  // pushes I18nProvider into EN. The page's HU labels are what we assert
  // against, so pin the locale before render.
  window.localStorage.setItem("weddly.locale", "hu");
});

afterEach(() => {
  window.localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CoupleCardsPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("CoupleCardsPage: deck showcase", () => {
  it("renders the page hero with the HU h1", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /100 kérdés a házasság előtt/i }),
    ).toBeInTheDocument();
  });

  it("renders all four deck titles as buttons (one centre + three minis)", () => {
    renderPage();
    // Names are unique across the showcase: exactly one button per deck,
    // either the centre card or one of the three mini tiles.
    expect(screen.getByRole("button", { name: /Gyökerek/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hétköznapok/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Közelség/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mély víz/i })).toBeInTheDocument();
  });

  it("clicking a mini deck swaps the centre but doesn't open the card view", () => {
    renderPage();
    // Mély víz starts in the mini row (Roots is the default centre).
    fireEvent.click(screen.getByRole("button", { name: /Mély víz/i }));
    // No card view yet — the "Draw a card" CTA still shows up.
    expect(screen.getByRole("button", { name: /Húzzatok egy kártyát/i })).toBeInTheDocument();
    // No article (card surface) rendered yet.
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("CoupleCardsPage: card view", () => {
  it("CTA opens the selected deck (default Roots) and shows card 1/25", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();

    const rootsDeck = COUPLE_CARD_DECKS.find((d) => d.id === "roots");
    expect(rootsDeck).toBeDefined();
    const rendered = screen.getByRole("article");
    const text = within(rendered).getByText(/.+/).textContent ?? "";
    expect(rootsDeck?.questionsHu).toContain(text);
  });

  it("swap then CTA opens the newly-selected deck", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Mély víz/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();
    const deepDeck = COUPLE_CARD_DECKS.find((d) => d.id === "deepwater");
    const text = within(screen.getByRole("article")).getByText(/.+/).textContent ?? "";
    expect(deepDeck?.questionsHu).toContain(text);
  });

  it("advances to card 2/25 when 'next' is pressed and changes the question", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    const firstQuestion = within(screen.getByRole("article")).getByText(/.+/).textContent;
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));

    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();
    const secondQuestion = within(screen.getByRole("article")).getByText(/.+/).textContent;
    expect(secondQuestion).not.toBe(firstQuestion);
  });

  it("returns to the showcase via the back link", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    // Card view: the "Draw a card" CTA has been swapped out for "Next card".
    expect(screen.queryByRole("button", { name: /Húzzatok egy kártyát/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Vissza a paklikhoz/i }));
    expect(screen.getByRole("button", { name: /Húzzatok egy kártyát/i })).toBeInTheDocument();
  });

  it("reshuffle resets the card pointer to 1/25", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Mély víz/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    expect(screen.getByText(`3 / ${DECK_SIZE}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Új keverés/i }));
    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();
  });
});

describe("CoupleCardsPage: localStorage persistence", () => {
  it("persists the per-deck shuffled order + index across remounts", () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Hétköznapok/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    const stoppedAt = within(screen.getByRole("article")).getByText(/.+/).textContent;
    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();

    // Unmount → remount. The page resets `selectedDeck` to Roots (showcase
    // state lives in component memory, not localStorage), so the test has
    // to swap back to Hétköznapok before opening. The persisted bit is the
    // per-deck SHUFFLE + INDEX, which lives in localStorage and should
    // resurface the same card on the second open.
    first.unmount();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Hétköznapok/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByText(/.+/).textContent).toBe(stoppedAt);
  });

  it("wraps from card 25 back to card 1 when 'next' fires past the deck end", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    // Click "next" 25 times: 1→2→...→25→1.
    for (let i = 0; i < DECK_SIZE; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    }
    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();
  });
});
