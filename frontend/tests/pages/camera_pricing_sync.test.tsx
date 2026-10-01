// /camera quotes film prices; the checkout charges them. Both read
// shared/film_pricing.ts, and this pins that the page renders that ladder.

import { beforeEach, describe, expect, it } from "bun:test";
import { FILM_PRICE_TIERS, filmTierPriceCents, formatEurCents } from "@shared/film_pricing";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import CameraPage from "@/pages/CameraPage";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("weddly.locale", "en");
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/camera"]}>
      <I18nProvider>
        <AuthProvider>
          <CameraPage />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("/camera pricing stays in sync with the checkout", () => {
  it("quotes every tier at the couple and the stand-alone price the checkout charges", () => {
    renderPage();
    for (const tier of FILM_PRICE_TIERS) {
      fireEvent.click(screen.getByRole("radio", { name: `Up to ${tier.cap} guests` }));
      const couple = formatEurCents(filmTierPriceCents(tier, "couple"));
      const standalone = formatEurCents(filmTierPriceCents(tier, "standalone"));
      expect(screen.getAllByText(couple).length).toBeGreaterThan(0);
      expect(screen.getAllByText(standalone).length).toBeGreaterThan(0);
    }
  });

  it("names the stand-alone card so it can lead into creating the event", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Non-Weddly users" })).toBeInTheDocument();
  });
});
