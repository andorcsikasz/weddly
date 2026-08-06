// Vendor "Packages" (Árajánlatok) editor — collapse behaviour. Each package is
// a collapsible card: the header shows the name + price summary and the body
// (name/price/description/PDF/actions) only renders when expanded, so a vendor
// with three packages sees a compact list instead of a long scroll. Guards that
// bodies start collapsed, the header summarises the package, and clicking the
// header toggles the fields open/closed.

import type { ListingPackage } from "@shared/listing_packages";
import { beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { VendorListingPackages } from "@/components/VendorListingPackages";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

function pkg(over: Partial<ListingPackage> & { id: number; name: string }): ListingPackage {
  return {
    price_text: null,
    price_min: null,
    price_max: null,
    price_mode: null,
    description: null,
    pdf_url: null,
    pdf_name: null,
    ...over,
  };
}

const PACKAGES: ListingPackage[] = [
  pkg({ id: 1, name: "Tasting", price_text: "€120" }),
  pkg({ id: 2, name: "Wedding cake", price_text: "from €950" }),
  pkg({ id: 3, name: "Full dessert table", price_text: "from €1800" }),
];

beforeEach(() => {
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage — ignore */
  }
});

describe("VendorListingPackages — collapsible cards", () => {
  it("renders every package collapsed by default (no fields, summary shown)", () => {
    render(
      <Providers>
        <VendorListingPackages
          packages={PACKAGES}
          category="cake_dessert"
          currency="EUR"
          currencyOverride={null}
          capacityMin={20}
          capacityMax={80}
          onChange={() => {}}
        />
      </Providers>,
    );

    // No package body fields are mounted while collapsed.
    expect(screen.queryByLabelText("Package name")).toBeNull();
    expect(screen.queryByLabelText("Minimum price")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();

    // Each collapsed card is a toggle button summarising name + price.
    const headers = screen.getAllByRole("button", { expanded: false });
    expect(headers.length).toBe(3);
    expect(within(headers[0]!).getByText("Tasting")).toBeTruthy();
    expect(within(headers[0]!).getByText("€120")).toBeTruthy();
    expect(within(headers[1]!).getByText("Wedding cake")).toBeTruthy();
  });

  it("expands a package when its header is clicked, and collapses again", () => {
    render(
      <Providers>
        <VendorListingPackages
          packages={PACKAGES}
          category="cake_dessert"
          currency="EUR"
          currencyOverride={null}
          capacityMin={20}
          capacityMax={80}
          onChange={() => {}}
        />
      </Providers>,
    );

    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);

    // Body of the first package is now open — its fields are mounted. The
    // header's own button is GONE at this point: an open card turns its title
    // into the name input, so the title is never printed twice. The collapse
    // control is the chevron beside it.
    const nameInput = screen.getByLabelText("Package name") as HTMLInputElement;
    expect(nameInput.value).toBe("Tasting");
    expect(screen.getByLabelText("Minimum price")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();

    // Only THIS card opened — the other two stay collapsed.
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(2);

    // The chevron collapses it again.
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByLabelText("Package name")).toBeNull();
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(3);
  });

  it("summarises a structured range and shows the capacity conversion", () => {
    const structured = [
      pkg({
        id: 4,
        name: "Reception",
        price_min: 800,
        price_max: 1_600,
        price_mode: "total",
      }),
    ];
    render(
      <Providers>
        <VendorListingPackages
          packages={structured}
          category="venue"
          currency="EUR"
          currencyOverride="EUR"
          capacityMin={20}
          capacityMax={80}
          onChange={() => {}}
        />
      </Providers>,
    );

    expect(screen.getByText(/€800.*€1,600 total/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "Total price", pressed: true })).toBeTruthy();
    expect(screen.getByText(/Estimated equivalent:.*€10.*€80.*person/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use country default" })).toBeTruthy();
  });
});
