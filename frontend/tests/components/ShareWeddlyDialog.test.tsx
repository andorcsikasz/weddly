// The share-Weddly modal's localisation + icon-action contract. The spec is
// strict about two things this pins: the whole experience speaks ONE language
// (English only for the EN interface, Hungarian otherwise) and the two actions
// are icon-only but never icon-only to a screen reader (real aria-labels).

import { beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    cleanup();
    try {
      localStorage.clear();
      localStorage.setItem("weddly.locale", "en");
    } catch {
      /* storage blocked */
    }
  });

  it("renders the English headline and all three English message cards", () => {
    renderModal();
    expect(screen.getByText("You build your marriage. We build Weddly.")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(3);
    // The first card is selected by default.
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]?.getAttribute("aria-checked")).toBe("false");
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
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[2] as HTMLElement);
    expect(radios[2]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[0]?.getAttribute("aria-checked")).toBe("false");
  });
});

describe("ShareWeddlyDialog — Hungarian interface", () => {
  beforeEach(async () => {
    cleanup();
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
      expect(screen.getByText("Ti a közös jövőtöket építitek. Mi a Weddlyt.")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Megosztás" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Másolás" })).toBeTruthy();
    // No English leaks into the Hungarian experience.
    expect(screen.queryByText(/You build your marriage/)).toBeNull();
  });
});
