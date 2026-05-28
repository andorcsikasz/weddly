// Component tests for the 100-questions-before-marriage tool.
//
// Pure client state: no fetch mocks needed. The page reaches into
// localStorage for progress persistence, so each test clears the store
// before render to keep them order-independent.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
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
    const text = screen.getByTestId("couple-card-question").textContent ?? "";
    expect(rootsDeck?.questionsHu).toContain(text);
  });

  it("swap then CTA opens the newly-selected deck", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Mély víz/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();
    const deepDeck = COUPLE_CARD_DECKS.find((d) => d.id === "deepwater");
    const text = screen.getByTestId("couple-card-question").textContent ?? "";
    expect(deepDeck?.questionsHu).toContain(text);
  });

  it("advances to card 2/25 when 'next' is pressed and changes the question", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    const firstQuestion = screen.getByTestId("couple-card-question").textContent;
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));

    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();
    const secondQuestion = screen.getByTestId("couple-card-question").textContent;
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

  it("clicking the card face advances to the next card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();

    // The big card face is a <button aria-label="Húzzatok új kérdést">;
    // the small secondary affordance below it is aria-label="Következő
    // kártya". Distinct accessible names so each query is unambiguous.
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok új kérdést/i }));
    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();
  });

  it("bag-shuffle: wraps to 1/25 after 25 'next' clicks, with a fresh card up top", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    const firstCardOfRound1 = screen.getByTestId("couple-card-question").textContent;

    // Click "next" 25 times: 1→2→...→25→1. After the wrap, the page
    // sits at "1 / 25" again, and the question is the first card of a
    // freshly-reshuffled bag. The shuffler guarantees the new bag's top
    // card isn't the same as the just-seen 25th card.
    for (let i = 0; i < DECK_SIZE; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    }
    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();
    // The card text exists and is one of the deck's HU questions (we
    // don't pin a specific identity because the bag-shuffle is random).
    const rootsDeck = COUPLE_CARD_DECKS.find((d) => d.id === "roots");
    const newTop = screen.getByTestId("couple-card-question").textContent ?? "";
    expect(rootsDeck?.questionsHu).toContain(newTop);
    expect(newTop.length).toBeGreaterThan(0);
    expect(firstCardOfRound1?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("CoupleCardsPage: localStorage persistence", () => {
  it("persists the per-deck shuffled order + index across remounts", () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Hétköznapok/i }));
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    const stoppedAt = screen.getByTestId("couple-card-question").textContent;
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
    expect(screen.getByTestId("couple-card-question").textContent).toBe(stoppedAt);
  });
});

describe("CoupleCardsPage: focus mode", () => {
  it("hides the lock toggle on the showcase and surfaces it once a deck is open", () => {
    renderPage();
    // Showcase: no lock button.
    expect(
      screen.queryByRole("button", { name: /Fókusz mód bekapcsolása/i }),
    ).not.toBeInTheDocument();
    // Open a deck → the toggle appears (in its "lock" affordance because
    // the page is still scrollable until the user opts in).
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    expect(
      screen.getAllByRole("button", { name: /Fókusz mód bekapcsolása/i })[0]!,
    ).toBeInTheDocument();
  });

  it("manual lock toggle flips body overflow and swaps the aria-label", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));

    expect(document.body.style.overflow).not.toBe("hidden");
    fireEvent.click(screen.getAllByRole("button", { name: /Fókusz mód bekapcsolása/i })[0]!);

    expect(document.body.style.overflow).toBe("hidden");
    // After locking, the same button advertises the unlock action.
    expect(
      screen.getAllByRole("button", { name: /Fókusz mód kikapcsolása/i })[0]!,
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Fókusz mód kikapcsolása/i })[0]!);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("auto-locks after the visitor has surfaced four cards", () => {
    renderPage();
    // Open the deck (1st card) + three "next" presses (cards 2..4).
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    expect(document.body.style.overflow).not.toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));

    // Threshold hit: body overflow gets locked and the unlock affordance
    // is shown.
    expect(document.body.style.overflow).toBe("hidden");
    expect(
      screen.getAllByRole("button", { name: /Fókusz mód kikapcsolása/i })[0]!,
    ).toBeInTheDocument();
  });

  it("shuffle button in the floating chrome advances to a new card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    expect(screen.getByText(`1 / ${DECK_SIZE}`)).toBeInTheDocument();

    // Shuffle pill in the top-right cluster shares the nextCard handler,
    // so it advances the bag-shuffle by one card just like clicking the
    // card face does.
    fireEvent.click(screen.getAllByRole("button", { name: /Új random kártya/i })[0]!);
    expect(screen.getByText(`2 / ${DECK_SIZE}`)).toBeInTheDocument();
  });

  it("manual unlock disarms the auto-lock for the rest of the session", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Húzzatok egy kártyát/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    // Auto-locked.
    fireEvent.click(screen.getAllByRole("button", { name: /Fókusz mód kikapcsolása/i })[0]!);
    // Now click "next" some more — auto-lock should NOT fire again.
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    fireEvent.click(screen.getByRole("button", { name: /Következő kártya/i }));
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
