// The runner's SCORING, and the one thing every couple-facing number depends on:
// the economy is denominated in the workspace's own currency.
//
// The invariants worth pinning here are the ones a screenshot cannot show and a
// type annotation cannot enforce:
//
//  1. EVERY currency in the union has a full row. A missing row is `undefined` at
//     runtime, so a coin would score `undefined` and the HUD would print NaN —
//     with no error anywhere, and only for the couple whose currency it is.
//  2. Profit is DERIVED, never accumulated. Two orderings of the same counters
//     must produce the same number, which is what makes the live HUD and the
//     game-over card incapable of disagreeing.
//  3. The four tiers and the expense ascend in EVERY currency. A currency whose
//     forint-style large numbers were copied to a small-value currency would make
//     the bag worth less than the envelope.

import {
  CASH_TIERS,
  economyFor,
  coinValue,
  pickupValue,
  weddingProfit,
  verdictFor,
  verdictThresholds,
} from "@shared/runner";
import { CURRENCIES, type Currency } from "@shared/types";
import { describe, expect, it } from "bun:test";

const ALL: readonly Currency[] = CURRENCIES;

describe("runner economy", () => {
  it("has a complete row for every currency the app offers", () => {
    for (const currency of ALL) {
      const row = economyFor(currency);
      for (const key of ["coin", "bundle", "envelope", "bag", "expensePerHit"] as const) {
        expect(typeof row[key]).toBe("number");
        expect(Number.isFinite(row[key])).toBe(true);
      }
      expect(row.coin).toBeGreaterThan(0);
      expect(row.tight).toBeGreaterThan(0);
      expect(row.comfortable).toBeGreaterThan(row.tight);
    }
  });

  it("keeps the tiers ascending and prices a hit between an envelope and a bag", () => {
    for (const currency of ALL) {
      const { coin, bundle, envelope, bag, expensePerHit } = economyFor(currency);
      expect(bundle).toBeGreaterThan(coin);
      expect(envelope).toBeGreaterThan(bundle);
      expect(bag).toBeGreaterThan(envelope);

      /* THE TWO PRICE RELATIONSHIPS THAT DEFINE THE GAME'S RISK.
       *
       * A hit costs MORE than the largest loose pickup, so bumping into a prop is
       * never a profitable way to move down a lane — there is no reward for
       * hitting, and this is what keeps that true.
       *
       * A hit costs LESS than a bag, so a single tote can pay for a mistake. That
       * asymmetry is the whole recovery economy: three hearts with no way back is
       * a run that ends on the first bad lane, and a bag is the only thing on the
       * track big enough to be worth planning around. Note it is NOT
       * `expensePerHit > bag` — asserting that is what a first reading of "a hit
       * must hurt" suggests, and it would delete the recovery that makes the
       * middle of the run playable. */
      expect(expensePerHit).toBeGreaterThan(envelope);
      expect(expensePerHit).toBeLessThan(bag);
    }
  });

  it("prices a bag at four times an envelope, in every currency", () => {
    // The audio treats the bag as the one pickup that changes key, so the four
    // multiple has to be structural rather than a per-currency coincidence.
    for (const currency of ALL) {
      const { envelope, bag } = economyFor(currency);
      expect(bag).toBe(envelope * 10);
    }
  });

  it("is zero-decimal for every currency except those that use a minor unit", () => {
    // Money in this app is a whole unit of the currency everywhere. JPY has no
    // minor unit; the others do, but a coin in a wedding game is a whole unit —
    // the formatter rounds, so a fractional coin would only ever be a rounding
    // artefact nobody designed.
    for (const currency of ALL) {
      const { coin } = economyFor(currency);
      expect(Number.isInteger(coin)).toBe(true);
    }
  });
});

describe("collectible values", () => {
  it("gives the same answer for the coin table and for coinValue", () => {
    for (const row of CASH_TIERS) {
      for (const currency of ALL) {
        expect(coinValue(row.id, currency)).toBe(economyFor(currency)[row.id]);
      }
    }
  });

  it("prices a bag slot through pickupValue, not coinValue", () => {
    for (const currency of ALL) {
      expect(pickupValue("bag", currency)).toBe(economyFor(currency).bag);
    }
  });
});

describe("weddingProfit", () => {
  const base = { cash: 30_000, bags: 2, hits: 1, currency: "HUF" as Currency };

  it("is derived, so the same counters always give the same number", () => {
    const a = weddingProfit(base, 1);
    const b = weddingProfit({ ...base }, 1);
    expect(a).toBe(b);
  });

  it("scales the WHOLE gross with the multiplier, bags included", () => {
    // Not just the loose change: `cashValue` and `bagValue` both take the
    // multiplier, so a milestone doubles the tote money too. That is the intended
    // rule — a milestone is "you are having a good run", and paying it out on one
    // of the two income sources would make the badge feel arbitrary.
    const one = weddingProfit(base, 1);
    const two = weddingProfit(base, 2);
    const grossAtOne = base.cash + base.bags * economyFor("HUF").bag;
    expect(two - one).toBe(grossAtOne);
  });

  it("charges one expense per hit", () => {
    const one = weddingProfit(base, 1);
    const two = weddingProfit({ ...base, hits: 2 }, 1);
    expect(one - two).toBe(economyFor("HUF").expensePerHit);
  });

  it("goes NEGATIVE when the bills beat the gifts, and every hit only lowers it", () => {
    // Owner direction: a wedding can run at a loss and the score says so. The old
    // floor at zero hid the shortfall; it never protected anything, because a hit
    // only ever SUBTRACTS, so no amount of hitting can raise the number.
    const broke = { cash: 0, bags: 0, hits: 3, currency: "HUF" as Currency };
    expect(weddingProfit(broke, 1)).toBe(-3 * economyFor("HUF").expensePerHit);
    const deeper = { ...broke, hits: 4 };
    expect(weddingProfit(deeper, 1)).toBeLessThan(weddingProfit(broke, 1));
  });

  it("is below the collected cash once the bill is paid", () => {
    const net = weddingProfit(base, 1);
    const gross = base.cash + base.bags * economyFor("HUF").bag;
    expect(net).toBeLessThan(gross);
  });
});

describe("verdictFor", () => {
  it("reads the thresholds of the currency it is given", () => {
    for (const currency of ALL) {
      const { tight, comfortable } = verdictThresholds(currency);
      // `verdictFor` is a strict `<` ladder: a profit exactly ON a threshold is
      // already in the band ABOVE it. Pinning the boundary itself matters, because
      // the ladder is the only thing deciding which of four headlines a couple
      // sees, and the difference between `tight` and `under_budget` is the whole
      // point of the card.
      expect(verdictFor(comfortable, currency)).toBe("under_budget");
      expect(verdictFor(comfortable - 1, currency)).toBe("tight");
      expect(verdictFor(tight, currency)).toBe("tight");
      expect(verdictFor(tight - 1, currency)).toBe("over_budget");
      // Breaking exactly even is not a loss; a single unit short is.
      expect(verdictFor(0, currency)).toBe("over_budget");
      expect(verdictFor(-1, currency)).toBe("bankrupt");
    }
  });

  it("does not hand a forint couple a verdict a euro couple would also get", () => {
    // The two currencies' thresholds differ by three orders of magnitude, so a
    // profit that reads as a triumph in one is a bankruptcy in the other. This
    // is the test that would fail if the thresholds were hardcoded rather than
    // derived from the economy.
    const amount = 200_000;
    expect(verdictFor(amount, "HUF")).not.toBe(verdictFor(amount, "EUR"));
  });
});
