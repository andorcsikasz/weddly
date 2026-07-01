// Smoke coverage for /app/design/website (the studio-chapters editor):
// mounts the page end to end under happy-dom with the API mocked, and asserts
// the three chapters + every newly-exposed catalog control render, the preview
// falls back to labelled sample content, and the monogram reaches the hero.

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_DESIGN } from "@shared/design";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui";
import DesignPage from "@/pages/DesignPage";

beforeAll(async () => {
  await _preloadHuForTests();
  localStorage.setItem("weddly.locale", "hu");
});

afterEach(cleanup);

const couple = {
  id: 1,
  slug: "MIALUCAS",
  display_name: "Mia & Lucas",
  bride_name: "Mia",
  groom_name: "Lucas",
  wedding_date: "2026-09-12",
  ceremony_kind: "both",
  venue_name: "Sári Udvar",
  venue_city: "Dunakiliti",
  cover_image_url: null,
  guest_page_intro: null,
  useful_info: null,
  location_radius_km: 5,
  is_public: false,
  design: DEFAULT_DESIGN,
  billing: { entitled: true, reason: "trialing" },
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("<DesignPage> smoke (/app/design/website)", () => {
  it("mounts, loads the couple, and renders all three chapters + new controls", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/couples/current")) return Promise.resolve(jsonResponse({ couple }));
      if (url.includes("/api/schedule")) return Promise.resolve(jsonResponse({ events: [] }));
      if (url.includes("/api/wishlist")) return Promise.resolve(jsonResponse({ items: [] }));
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    render(
      <I18nProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={["/app/design/website"]}>
            <DesignPage />
          </MemoryRouter>
        </ToastProvider>
      </I18nProvider>,
    );

    // Couple loaded → the editor grid replaces the loading line.
    await waitFor(() => {
      expect(screen.getByText("Esküvői stílus")).toBeInTheDocument();
    });

    // The three studio chapters.
    expect(screen.getByText("Stílus")).toBeInTheDocument();
    expect(screen.getByText("Tipográfia")).toBeInTheDocument();
    expect(screen.getByText("Részletek")).toBeInTheDocument();

    // New controls: palette picker (a legacy palette by name), monogram block,
    // rounding + shadow + sections labels, demoted custom colors, finish card.
    expect(screen.getByText("Pezsgő")).toBeInTheDocument();
    expect(screen.getByText("Monogram megjelenítése")).toBeInTheDocument();
    expect(screen.getByText("Kártya lekerekítés")).toBeInTheDocument();
    expect(screen.getByText("Kártya árnyék")).toBeInTheDocument();
    expect(screen.getByText("Látható szakaszok")).toBeInTheDocument();
    expect(screen.getByText("Haladó: egyedi színek")).toBeInTheDocument();
    expect(screen.getByText("Tetszik az összkép?")).toBeInTheDocument();

    // Sample-content chip (no real schedule/wishlist in the mocks) + the
    // guest-page preview rendering the sample schedule beat.
    expect(screen.getByText("Mintatartalom")).toBeInTheDocument();
    expect(screen.getByText("Szertartás")).toBeInTheDocument();

    // The monogram renders twice: the separator chip specimen in chapter 03
    // AND the hero eyebrow inside the live preview (enabled by default).
    expect(screen.getAllByText("M & L").length).toBeGreaterThanOrEqual(2);
  });
});
