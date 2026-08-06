import { describe, expect, test } from "bun:test";
import {
  convertedPrice,
  currencyForCountry,
  hasStructuredPrice,
  listingCurrency,
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
