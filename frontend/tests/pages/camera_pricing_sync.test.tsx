// /camera promises Weddly couples a guest cap; the in-app film enforces one.
// Both read FILM_TIER_CAPS, and this pins that the page says so.

import { beforeEach, describe, expect, it } from "bun:test";
import { FILM_TIER_CAPS } from "@shared/types";
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

describe("/camera pricing stays in sync with the in-app film", () => {
  it("says the subscription includes the in-app guest cap", () => {
    renderPage();
    const line = `Up to ${FILM_TIER_CAPS.free} guests is included with a Weddly subscription.`;
    expect(screen.getAllByText(line).length).toBeGreaterThan(0);
  });

  it("prices each tier for a couple the way the app does", () => {
    renderPage();
    // Default tier is 50 guests: inside the included cap.
    expect(screen.getByText("Included")).toBeInTheDocument();
    // 100 guests: the one-time unlock to 200.
    fireEvent.click(screen.getByRole("button", { name: "Up to 100 guests" }));
    expect(screen.getByText("€7.90")).toBeInTheDocument();
    // 400 guests: past anything the app offers, so no couple price at all.
    fireEvent.click(screen.getByRole("button", { name: "Up to 400 guests" }));
    expect(screen.queryByText("Weddly couples")).toBeNull();
  });
});
