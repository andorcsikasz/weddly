// The share-Weddly modal's localisation + icon-action contract. The spec is
// strict about two things this pins: the whole experience speaks ONE language
// (English only for the EN interface, Hungarian otherwise) and the two actions
// are icon-only but never icon-only to a screen reader (real aria-labels).

import { beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareWeddlyDialog } from "@/components/ShareWeddlyDialog";
import { I18nProvider, _preloadHuForTests } from "@/lib/i18n";

function renderModal() {
  return render(
    <I18nProvider>
      <ShareWeddlyDialog open onClose={() => {}} source="profile_dropdown" />
    </I18nProvider>,
  );
}

describe("ShareWeddlyDialog — English interface", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
      localStorage.setItem("weddly.locale", "en");
    } catch {
      /* storage blocked */
    }
  });

  it("renders the English headline and all three English message cards", () => {
    renderModal();
    expect(screen.getByText("Share Weddly to reach more couples. 🕊️🤍")).toBeTruthy();
    const dots = screen.getAllByRole("button", { name: /Share message [123]/ });
    expect(dots.length).toBe(3);
    expect(dots[0]?.getAttribute("aria-current")).toBe("true");
    expect(dots[1]?.getAttribute("aria-current")).toBe("false");
    // No Hungarian leaks into the English experience.
    expect(screen.queryByText(/Ti a közös jövőtöket építitek/)).toBeNull();
  });

  it("labels both icon actions for assistive tech", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("moves selection when another card is clicked", () => {
    renderModal();
    const dots = screen.getAllByRole("button", { name: /Share message [123]/ });
    fireEvent.click(dots[2] as HTMLElement);
    expect(dots[2]?.getAttribute("aria-current")).toBe("true");
    expect(dots[0]?.getAttribute("aria-current")).toBe("false");
  });
});

describe("ShareWeddlyDialog — Hungarian interface", () => {
  beforeEach(async () => {
    try {
      localStorage.clear();
      localStorage.setItem("weddly.locale", "hu");
    } catch {
      /* storage blocked */
    }
    // HU is a dynamic import in production; preload it so the synchronous
    // queries below see Hungarian rather than the EN fallback.
    await _preloadHuForTests();
  });

  it("renders the Hungarian headline and Hungarian action labels", async () => {
    renderModal();
    await waitFor(() =>
      expect(
        screen.getByText("Osszátok meg a Weddly-t, hogy több párhoz eljussunk. 🕊️🤍"),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Megosztás" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Másolás" })).toBeTruthy();
    // No English leaks into the Hungarian experience.
    expect(screen.queryByText(/Share Weddly to reach/)).toBeNull();
  });
});
