// What the HUD and the game-over card print.
//
// The whole point of this file's thin wrapper is that there is NO second money
// formatter in the runner, so the tests here are as much about the WRITER as the
// rendered string: a score has to go through the app's own `formatMoney`, has to
// carry the couple's currency, and has to not be reimplemented as a local
// `locale === "hu" ? … : …` chain — which is the exact shape that has silently
// handed every locale added after Hungarian somebody else's number format in
// this codebase before.

import { describe, expect, it } from "bun:test";
import { UI_LOCALES } from "@shared/locales";
import { CURRENCIES, type Currency } from "@shared/types";
import { formatMoney, intlLocale } from "@/lib/format";
import {
  expenseFor,
  pickupLabel,
  runDistance,
  runMoney,
  runSymbol,
  tierValues,
} from "@/pages/games/runner/utils/format";

describe("runMoney", () => {
  it("is the app's own formatter, byte for byte, for every currency and locale", () => {
    // If this ever diverges the runner has grown a second money path, which is the
    // failure this file exists to prevent — so compare against `formatMoney`
    // rather than against a hand-written expectation of what Intl will do.
    for (const currency of CURRENCIES) {
      for (const locale of UI_LOCALES) {
        expect(runMoney(123_456, currency, locale)).toBe(formatMoney(123_456, currency, locale));
      }
    }
  });

  it("renders the amount the economy actually uses", () => {
    // A HUF coin is 10 000 and a EUR coin is 10, which is the whole reason the
    // score cannot be a stored euro figure converted at the edge.
    expect(runMoney(10_000, "HUF", "hu")).toBe(formatMoney(10_000, "HUF", "hu"));
    expect(runMoney(10, "EUR", "de")).toBe(formatMoney(10, "EUR", "de"));
  });

  it("groups a forint score rather than printing ten digits in a row", () => {
    // The reason the runner has a money formatter at all: the raw value is
    // unreadable, and a bare `String(amount)` is what the reader would see.
    //
    // Hungarian groups with a SPACE and writes the glyph last — `1 500 000 Ft`.
    // Deliberately matched with a whitespace class rather than a literal space,
    // because ICU has used both a plain space and a narrow no-break space here
    // across versions and neither is a thing the runner should care about. It is
    // pinned so that the grouping itself is the assertion: a run that printed
    // "1500000" would pass a naive substring check.
    expect(runMoney(1_500_000, "HUF", "hu")).toMatch(/^1[\s  ]500[\s  ]000\s*Ft$/);
    // And the en-US reader gets the comma grouping with the same narrow glyph.
    expect(runMoney(1_500_000, "HUF", "en")).toMatch(/^Ft\s*1,500,000$/);
  });

  it("never throws on any currency/locale pair", () => {
    for (const currency of CURRENCIES) {
      for (const locale of UI_LOCALES) {
        expect(() => runMoney(0, currency, locale)).not.toThrow();
      }
    }
  });
});

describe("runSymbol", () => {
  it("reads forint as Ft in EVERY locale, which is the app's rule", () => {
    // Worth pinning because it looks like a bug and is not: `currencySymbol` is
    // asked for the NARROW symbol, and forint's narrow symbol is `Ft` in all five
    // shipped locales. An en-US reader being shown `Ft` rather than `HUF` is the
    // same answer every other HUF figure in the app gives, which is exactly the
    // consistency this game is built on. Changing it here alone would make the
    // runner disagree with the couple's own budget page.
    for (const locale of UI_LOCALES) {
      expect(runSymbol("HUF", locale)).toBe("Ft");
    }
  });

  it("distinguishes currencies", () => {
    const glyphs = new Set(CURRENCIES.map((c) => runSymbol(c, "en")));
    // Not a bijection requirement — but a runner that printed the same glyph for
    // the euro and the forint would be misread as a pricing bug, so at least the
    // two that carry the game's biggest numbers have to differ.
    expect(glyphs.size).toBeGreaterThan(1);
    expect(runSymbol("EUR", "en")).not.toBe(runSymbol("HUF", "en"));
  });

  it("travels with the number rather than inside a translated label", () => {
    // Every runner label is one string per locale, so none of them can carry the
    // symbol — the figure and its glyph are separate on purpose.
    expect(runSymbol("EUR", "en")).toBeTruthy();
  });
});

describe("expenseFor", () => {
  it("is the economy's own per-hit figure, not a value passed down from the engine", () => {
    // The two printed props bake this number into a canvas texture, which is why
    // it has to be derivable without a frame, a scene or a running engine.
    expect(typeof expenseFor("HUF")).toBe("number");
    expect(expenseFor("EUR")).toBeGreaterThan(0);
    expect(expenseFor("HUF")).not.toBe(expenseFor("EUR"));
  });
});

describe("pickupLabel", () => {
  it("prices a bag through the bag figure, not the envelope's", () => {
    for (const currency of CURRENCIES) {
      expect(pickupLabel("bag", currency, "en")).not.toBe(pickupLabel("envelope", currency, "en"));
    }
  });

  it("goes through the same money path as the HUD", () => {
    expect(pickupLabel("coin", "HUF", "hu")).toBe(runMoney(10_000, "HUF", "hu"));
  });
});

describe("tierValues", () => {
  it("is ascending in every currency", () => {
    for (const currency of CURRENCIES) {
      const { coin, bundle, envelope } = tierValues(currency);
      expect(bundle).toBeGreaterThan(coin);
      expect(envelope).toBeGreaterThan(bundle);
    }
  });

  it("has a row for every cash tier, and nothing invented", () => {
    for (const currency of CURRENCIES) {
      expect(Object.keys(tierValues(currency)).sort()).toEqual(["bundle", "coin", "envelope"]);
    }
  });
});

describe("runDistance", () => {
  it("groups through intlLocale, so every locale gets its own format", () => {
    for (const locale of UI_LOCALES) {
      expect(runDistance(123_456, locale)).toBe(
        new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(123_456),
      );
    }
  });

  it("gives later locales their own separators rather than inheriting the first", () => {
    // de-DE groups with a dot and en-US with a comma. A hardcoded `hu ? … : …`
    // handed every locale added after Hungarian the en-US answer; this is the
    // regression guard for that.
    expect(runDistance(1234, "de")).not.toBe(runDistance(1234, "en"));
  });

  it("rounds to whole metres and refuses a negative score", () => {
    expect(runDistance(10.4, "en")).toBe(runDistance(10, "en"));
    expect(runDistance(-5, "en")).toBe(runDistance(0, "en"));
  });
});

describe("currency coverage", () => {
  it("exercises every currency the runner can be handed", () => {
    // A gap here is invisible until a couple opens the game in that currency and
    // sees `NaN` — no error is raised anywhere along the way.
    expect(CURRENCIES.length).toBeGreaterThan(1);
    for (const currency of CURRENCIES as readonly Currency[]) {
      expect(runMoney(1000, currency, "en")).not.toContain("NaN");
      expect(pickupLabel("bag", currency, "en")).not.toContain("NaN");
    }
  });
});
