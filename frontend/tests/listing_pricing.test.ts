import { describe, expect, test } from "bun:test";
import {
  convertedPrice,
  currencyForCountry,
  hasStructuredPrice,
  listingCurrency,
  packagePriceSummary,
} from "@shared/listing_pricing";

describe("structured listing pricing", () => {
  test("country defaults cover home and non-euro neighbouring markets", () => {
    expect(currencyForCountry(null)).toBe("HUF");
    expect(currencyForCountry("hu")).toBe("HUF");
    expect(currencyForCountry("HR")).toBe("EUR");
    expect(currencyForCountry("PL")).toBe("PLN");
    expect(currencyForCountry("CZ")).toBe("CZK");
  });

  test("a valid override wins and an invalid stored value falls back safely", () => {
    expect(listingCurrency({ country: "HU", currency: "EUR" })).toBe("EUR");
    expect(listingCurrency({ country: "HU", currency: "bitcoin" })).toBe("HUF");
  });

  test("total ranges cross guest bounds when converted per person", () => {
    expect(
      convertedPrice(
        { price_min: 300_000, price_max: 600_000, price_mode: "total" },
        { min: 50, max: 150 },
      ),
    ).toEqual({ mode: "per_person", range: { min: 2_000, max: 12_000 } });
  });

  test("per-person ranges expand across the capacity envelope", () => {
    expect(
      convertedPrice(
        { price_min: 10_000, price_max: 20_000, price_mode: "per_person" },
        { min: 50, max: 150 },
      ),
    ).toEqual({ mode: "total", range: { min: 500_000, max: 3_000_000 } });
  });

  test("open-ended prices convert independently and missing capacity stays unknown", () => {
    const price = { price_min: 250_000, price_max: null, price_mode: "total" as const };
    expect(convertedPrice(price, { min: null, max: 100 })).toEqual({
      mode: "per_person",
      range: { min: 2_500, max: null },
    });
    expect(convertedPrice(price, { min: null, max: null })).toBeNull();
    expect(hasStructuredPrice({ ...price, price_mode: null })).toBe(false);
  });
});

describe("packagePriceSummary", () => {
  test("pools the min and max across every structured package", () => {
    expect(
      packagePriceSummary([
        { price_min: 450_000, price_max: 600_000, price_mode: "total" },
        { price_min: 200_000, price_max: 350_000, price_mode: "total" },
      ]),
    ).toEqual({ mode: "total", range: { min: 200_000, max: 600_000 } });
  });

  test("a legacy price_text-only package (no mode) is ignored, not zeroed", () => {
    expect(
      packagePriceSummary([{ price_min: null, price_max: null, price_mode: null }]),
    ).toBeNull();
  });

  test("no packages at all summarises to nothing", () => {
    expect(packagePriceSummary([])).toBeNull();
  });

  test("only pools packages matching the first structured package's mode", () => {
    // A total-priced day rate and a per-person rate cannot share one range —
    // pairing 800,000 total with 15,000/person would read as a discount.
    expect(
      packagePriceSummary([
        { price_min: 800_000, price_max: 800_000, price_mode: "total" },
        { price_min: 12_000, price_max: 18_000, price_mode: "per_person" },
      ]),
    ).toEqual({ mode: "total", range: { min: 800_000, max: 800_000 } });
  });

  test("an open-ended 'from' package still summarises", () => {
    expect(
      packagePriceSummary([{ price_min: 1_200_000, price_max: null, price_mode: "total" }]),
    ).toEqual({ mode: "total", range: { min: 1_200_000, max: null } });
  });
});
