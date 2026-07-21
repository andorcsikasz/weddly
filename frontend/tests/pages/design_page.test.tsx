// Smoke coverage for /app/design/website. Mounts the page end to end under
// happy-dom with the API mocked and asserts the redesigned shape: the committed
// look sits in the Look Bar, the fine-tune list carries its seven rows, and the
// preview still falls back to labelled sample content.
//
// This test used to assert "all three chapters" and every catalog control being
// on screen at once. That is exactly the page the redesign removed: fifteen
// sibling control groups of equal weight. What it asserts now is the opposite
// property, that most of those controls are NOT on screen until asked for.

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_DESIGN } from "@shared/design";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import { ConfirmDialogProvider, ToastProvider } from "@/components/ui";
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

function mountPage(path = "/app/design/website") {
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/couples/current")) return Promise.resolve(jsonResponse({ couple }));
    if (url.includes("/api/schedule")) return Promise.resolve(jsonResponse({ events: [] }));
    if (url.includes("/api/wishlist")) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;

  return render(
    <I18nProvider>
      <ToastProvider>
        <ConfirmDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <DesignPage />
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("<DesignPage> smoke (/app/design/website)", () => {
  it("opens on the committed look and the seven fine-tune rows", async () => {
    mountPage();

    // Couple loaded. This couple is still on the untouched default, so they
    // have never made the one decision this page is about: the Sample Table
    // opens for them, and "Garden" appears twice (the Look Bar's committed
    // name, plus its tile on the table).
    await waitFor(() => {
      expect(screen.getAllByText("Garden").length).toBe(2);
    });
    expect(screen.getByText("Válassz stílust")).toBeInTheDocument();
    // All four looks are on the table, each a full card, not a swatch.
    for (const look of ["Editorial", "Blush", "Noir"]) {
      expect(screen.getByText(look)).toBeInTheDocument();
    }

    // The fine-tune list: every row present and labelled, nothing expanded.
    expect(screen.getByText("Finomhangolás")).toBeInTheDocument();
    for (const row of ["Színek", "Betűk", "Dátum", "Monogram", "Kártyák", "Szakaszok"]) {
      expect(screen.getByText(row)).toBeInTheDocument();
    }
    // Photos are promoted out of the accordion into their own block.
    expect(screen.getByText("Fotók")).toBeInTheDocument();
    expect(screen.getByText("1. kép")).toBeInTheDocument();

    // Sample-content chip (no real schedule/wishlist in the mocks) and the
    // preview rendering the sample schedule beat.
    expect(screen.getByText("Mintatartalom")).toBeInTheDocument();
    expect(screen.getByText("Szertartás")).toBeInTheDocument();
  });

  it("keeps the catalog closed until a row is opened", async () => {
    mountPage();
    await waitFor(() => {
      expect(screen.getByText("Színek")).toBeInTheDocument();
    });

    // The point of the redesign: a legacy palette deep in the catalog is NOT
    // on screen at rest. It used to be, alongside fourteen other grids.
    expect(screen.queryByRole("button", { name: "Pezsgő" })).toBeNull();

    fireEvent.click(screen.getByText("Színek"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pezsgő" })).toBeInTheDocument();
    });
    // Opening a swap shows the before/now comparison.
    expect(screen.getByText("Előtte")).toBeInTheDocument();
    expect(screen.getByText("Most")).toBeInTheDocument();
  });

  it("shows only one row's body at a time", async () => {
    mountPage();
    await waitFor(() => expect(screen.getByText("Színek")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Színek"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pezsgő" })).toBeInTheDocument());

    fireEvent.click(screen.getByText("Dátum"));
    await waitFor(() => {
      // The colour rail is gone; opening Date closed Colours.
      expect(screen.queryByRole("button", { name: "Pezsgő" })).toBeNull();
    });
  });

  it("puts the monogram in the row readout and in the live preview", async () => {
    mountPage();
    await waitFor(() => expect(screen.getByText("Monogram")).toBeInTheDocument());
    // The Monogram row renders the couple's real monogram as its value, and the
    // hero eyebrow inside the preview renders it too (enabled by default).
    expect(screen.getAllByText("M & L").length).toBeGreaterThanOrEqual(2);
  });
});

describe("<DesignPage> smoke (/app/design/print)", () => {
  it("shows one shelf of real cards and shares the committed look", async () => {
    mountPage("/app/design/print");

    // The shelf: every printable, named. These used to exist twice, as a grid
    // of text chips up top and a grid of description cards further down.
    await waitFor(() => {
      expect(screen.getByText("Kártyák", { selector: "p" })).toBeInTheDocument();
    });
    for (const card of ["Ültetőkártya", "Asztalszám", "Menü"]) {
      expect(screen.getAllByText(card).length).toBeGreaterThanOrEqual(1);
    }

    // The identity is shared across both surfaces, so the same Look Bar and
    // the same Sample Table serve the print tab. The old read-only "inherited
    // identity" recap card, which repeated the look in a third way, is gone.
    expect(screen.getAllByText("Garden").length).toBe(2);
    expect(screen.queryByText("Közös arculat")).toBeNull();

    // The QR toggle is gone: no PDF renderer ever emitted a QR code.
    expect(screen.queryByText("QR-kód")).toBeNull();

    // Print-side fine tune uses the same row vocabulary as the guest tab.
    expect(screen.getByText("Keret")).toBeInTheDocument();
  });
});
