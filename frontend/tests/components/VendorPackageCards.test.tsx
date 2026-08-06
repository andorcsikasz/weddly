import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ListingPackage } from "@shared/listing_packages";
import { VendorPackageGrid } from "@/components/VendorPackageCards";

const messages: Record<string, string> = {
  "suppliers.detail.packages.priceFrom": "From {price}",
  "suppliers.detail.packages.priceUpTo": "Up to {price}",
  "suppliers.detail.packages.priceTotal": "{price} total",
  "suppliers.detail.packages.pricePerPerson": "{price} / person",
  "suppliers.detail.packages.estimatedEquivalent": "Est. {price}",
  "suppliers.detail.packages.detailsOnRequest": "Details available on request",
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
