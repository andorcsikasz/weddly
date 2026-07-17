import "../setup";

import { describe, expect, test } from "bun:test";
import {
  CURRENCIES,
  CURRENCY_META,
  currencyMeta,
  isCurrency,
  minorUnitFactor,
  scaleFromEur,
  toBillingCurrency,
} from "@shared/currency";
import { MONTHLY_PRICE, monthlyPrice } from "@shared/billing";
import { PLANNER_TIER_PRICE, plannerPrice } from "@shared/planner_billing";
import { VENDOR_MONTHLY_PRICE, vendorPrice } from "@shared/vendor_billing";

// Pure invariants of the currency model. These are the rules the rest of the
// codebase assumes but can't state in the type system.

describe("currency model", () => {
  test("CURRENCIES mirrors CURRENCY_META with no duplicates", () => {
    expect(CURRENCIES).toEqual(CURRENCY_META.map((m) => m.code));
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
  });

  test("covers 10 European currencies + JPY + legacy USD", () => {
    // The product spec: the European continent plus the yen. USD predates the
    // expansion and is kept only so existing rows stay valid.
    expect(CURRENCIES).toContain("JPY");
    expect(CURRENCIES).toContain("USD");
    const european: string[] = CURRENCIES.filter((c) => c !== "JPY" && c !== "USD");
    expect(european.length).toBe(10);
    expect(european.sort()).toEqual(
      ["CHF", "CZK", "DKK", "EUR", "GBP", "HUF", "NOK", "PLN", "RON", "SEK"].sort(),
    );
  });

  test("isCurrency accepts every member and rejects lookalikes", () => {
    for (const c of CURRENCIES) expect(isCurrency(c)).toBe(true);
    // Real ISO codes we don't support, plus the shapes a bad caller sends.
    for (const bad of ["ZWL", "AUD", "huf", "", "  EUR", null, undefined, 7, {}]) {
      expect(isCurrency(bad)).toBe(false);
    }
  });

  test("every display currency bills in a currency Stripe is wired for", () => {
    for (const c of CURRENCIES) {
      const billing = toBillingCurrency(c);
      // The three price maps are exhaustive Records over BillingCurrency, so a
      // missing key here would be an undefined price on someone's invoice.
      expect(MONTHLY_PRICE[billing]).toBeGreaterThan(0);
      expect(VENDOR_MONTHLY_PRICE[billing]).toBeGreaterThan(0);
      for (const tier of ["starter", "pro", "premium"] as const) {
        expect(PLANNER_TIER_PRICE[tier][billing]).toBeGreaterThan(0);
      }
    }
  });

  test("HUF and USD bill as themselves; everything else settles in EUR", () => {
    expect(toBillingCurrency("HUF")).toBe("HUF");
    expect(toBillingCurrency("USD")).toBe("USD");
    for (const c of CURRENCIES) {
      if (c === "HUF" || c === "USD" || c === "EUR") continue;
      expect(toBillingCurrency(c)).toBe("EUR");
    }
  });

  test("price helpers never return undefined for a display currency", () => {
    for (const c of CURRENCIES) {
      expect(monthlyPrice(c)).toBeGreaterThan(0);
      expect(vendorPrice(c)).toBeGreaterThan(0);
      expect(plannerPrice("pro", c)).toBeGreaterThan(0);
    }
    // A złoty workspace pays the euro price, not an undefined one.
    expect(monthlyPrice("PLN")).toBe(MONTHLY_PRICE.EUR);
    expect(monthlyPrice("JPY")).toBe(MONTHLY_PRICE.EUR);
    expect(monthlyPrice("HUF")).toBe(MONTHLY_PRICE.HUF);
  });

  test("only the zero-decimal currencies store whole units", () => {
    // Getting this wrong inflates or shrinks a wishlist target 100x.
    expect(minorUnitFactor("HUF")).toBe(1);
    expect(minorUnitFactor("JPY")).toBe(1);
    for (const c of CURRENCIES) {
      if (c === "HUF" || c === "JPY") continue;
      expect(minorUnitFactor(c)).toBe(100);
    }
  });

  test("currencyMeta resolves every code and carries a usable scale", () => {
    for (const c of CURRENCIES) {
      const meta = currencyMeta(c);
      expect(meta.code).toBe(c);
      expect(meta.symbol.length).toBeGreaterThan(0);
      expect(meta.unitsPerEur).toBeGreaterThan(0);
    }
  });

  test("scaleFromEur produces round, correctly-scaled figures", () => {
    expect(scaleFromEur(10_000, "EUR")).toBe(10_000);
    // ~400 Ft/EUR → 4M, and rounded to 2 significant digits.
    expect(scaleFromEur(10_000, "HUF")).toBe(4_000_000);
    // Yen lands in the millions rather than the thousands — the whole point of
    // scaling rather than reusing the EUR bounds verbatim.
    expect(scaleFromEur(10_000, "JPY")).toBe(1_700_000);
    expect(scaleFromEur(0, "PLN")).toBe(0);
    for (const c of CURRENCIES) {
      expect(Number.isFinite(scaleFromEur(25_000, c))).toBe(true);
      expect(scaleFromEur(25_000, c)).toBeGreaterThan(0);
    }
  });
});
