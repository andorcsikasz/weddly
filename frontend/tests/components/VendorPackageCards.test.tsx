import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ListingPackage } from "@shared/listing_packages";
import { VendorPackageGrid, VendorPackageList } from "@/components/VendorPackageCards";

const messages: Record<string, string> = {
  "suppliers.detail.packages.priceFrom": "From {price}",
  "suppliers.detail.packages.priceUpTo": "Up to {price}",
  "suppliers.detail.packages.priceTotal": "{price} total",
  "suppliers.detail.packages.pricePerPerson": "{price} / person",
  "suppliers.detail.packages.estimatedEquivalent": "Est. {price}",
  "suppliers.detail.packages.detailsOnRequest": "Details available on request",
  "suppliers.detail.packages.requestCta": "Request a quote",
  "suppliers.detail.packages.forGuests": "For your {n} guests: est. {price}",
  "suppliers.detail.packages.seeFullDetails": "See full details",
  "suppliers.detail.packages.showLess": "Show less",
};

const t = (key: string, vars?: Record<string, string | number>) => {
  let out = messages[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) {
    out = out.replace(`{${name}}`, String(value));
  }
  return out;
};

function pkg(over: Partial<ListingPackage> & Pick<ListingPackage, "id" | "name">): ListingPackage {
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

describe("VendorPackageGrid structured pricing", () => {
  it("renders the structured price and its capacity-normalised equivalent", () => {
    render(
      <VendorPackageGrid
        packages={[
          pkg({
            id: 1,
            name: "Venue hire",
            price_min: 3_000,
            price_max: 6_000,
            price_mode: "total",
          }),
        ]}
        currency="EUR"
        capacityMin={50}
        capacityMax={150}
        locale="en"
        t={t}
      />,
    );

    expect(screen.getByText(/€3,000.*€6,000 total/)).toBeTruthy();
    expect(screen.getByText(/Est\..*€20.*€120.*person/)).toBeTruthy();
  });

  it("keeps rendering legacy free-text rows without inventing a mode", () => {
    render(
      <VendorPackageGrid
        packages={[pkg({ id: 2, name: "Legacy", price_text: "from €950 / day" })]}
        currency="EUR"
        capacityMin={null}
        capacityMax={null}
        locale="en"
        t={t}
      />,
    );

    expect(screen.getByText("from €950 / day")).toBeTruthy();
  });
});

describe("VendorPackageList", () => {
  const list = (
    packages: ListingPackage[],
    over: Partial<Parameters<typeof VendorPackageList>[0]> = {},
  ) =>
    render(
      <VendorPackageList
        packages={packages}
        currency="EUR"
        capacityMin={50}
        capacityMax={150}
        locale="en"
        t={t}
        {...over}
      />,
    );

  it("is a menu of rows: name, headline facts and the guide price", () => {
    list([
      pkg({
        id: 1,
        name: "Full day",
        price_min: 1_500,
        price_max: 2_500,
        price_mode: "total",
        description: "Duration: 8 hours\nPhotographers: 2",
      }),
    ]);

    expect(screen.getByText("Full day")).toBeTruthy();
    expect(screen.getByText("Duration: 8 hours · Photographers: 2")).toBeTruthy();
    expect(screen.getByText(/€1,500.*€2,500 total/)).toBeTruthy();
    // Two facts fit in the headline, so there is nothing to expand.
    expect(screen.queryByText("See full details")).toBeNull();
  });

  it("hides the quote button unless the page wires it, and hands the package back when it does", () => {
    const one = pkg({ id: 7, name: "Ceremony only", price_min: 400, price_mode: "total" });

    const { unmount } = list([one]);
    expect(screen.queryByTestId("package-request")).toBeNull();
    unmount();

    const asked: ListingPackage[] = [];
    list([one], { onRequest: (p) => asked.push(p) });
    fireEvent.click(screen.getByText("Request a quote"));
    expect(asked.map((p) => p.id)).toEqual([7]);
  });

  it("puts everything past the headline behind the row's own toggle", () => {
    list([
      pkg({
        id: 2,
        name: "Premium",
        price_min: 3_000,
        price_mode: "total",
        description: "Duration: 10 hours\nPhotographers: 2\nAlbum: 30 pages\nDelivery: 6 weeks",
      }),
    ]);

    // Only the first two facts are visible until it is opened.
    expect(screen.queryByText("30 pages")).toBeNull();
    fireEvent.click(screen.getByText("See full details"));
    expect(screen.getByText("30 pages")).toBeTruthy();
    expect(screen.getByText("6 weeks")).toBeTruthy();
    fireEvent.click(screen.getByText("Show less"));
    expect(screen.queryByText("30 pages")).toBeNull();
  });

  it("scales a per-guest rate to the couple's own headcount, and only when they stated one", () => {
    const perHead = pkg({
      id: 3,
      name: "Menu",
      price_min: 40,
      price_max: 60,
      price_mode: "per_person",
    });

    const { unmount } = list([perHead], { couplesGuests: 80 });
    expect(screen.getByText(/For your 80 guests: est\..*€3,200.*€4,800 total/)).toBeTruthy();
    unmount();

    // No stated headcount: it falls back to the listing-capacity conversion
    // (50 to 150 guests), never to an invented number.
    list([perHead], { couplesGuests: null });
    expect(screen.queryByText(/For your/)).toBeNull();
    expect(screen.getByText(/Est\..*€2,000.*€9,000.*total/)).toBeTruthy();
  });

  it("keeps the legacy free-text price for a row with no structured one", () => {
    list([pkg({ id: 4, name: "Old offer", price_text: "250 000 Ft-tól" })]);
    expect(screen.getByText("250 000 Ft-tól")).toBeTruthy();
  });

  it("says details are on request for a row with nothing on it", () => {
    list([pkg({ id: 5, name: "Bespoke" })]);
    expect(screen.getByText("Details available on request")).toBeTruthy();
  });
});
