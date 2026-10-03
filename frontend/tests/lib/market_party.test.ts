import { describe, expect, test } from "bun:test";
import { MARKET_PACKS } from "@shared/market_packs";
import {
  bailoutRefund,
  isFlashQuestion,
  isMarketOpening,
  MARKET_FLASH_SECONDS,
  MARKET_PROMPT_MAX,
} from "@shared/markets";
import { formatCountdown } from "../../src/components/markets/party";

describe("WeddlyMarket question packs", () => {
  // The bulk endpoint validates every entry and rejects the WHOLE pack on one
  // bad question, so a pack that breaks a rule would fail for every couple.
  test("every pack question would pass the server's own validation", () => {
    for (const pack of MARKET_PACKS) {
      expect(pack.questions.length).toBeGreaterThan(0);
      for (const q of pack.questions) {
        for (const text of [q.en, q.hu]) {
          expect(text.trim().length).toBeGreaterThan(0);
          expect(text.length).toBeLessThanOrEqual(MARKET_PROMPT_MAX);
        }
        if (q.opening !== undefined) expect(isMarketOpening(q.opening)).toBe(true);
      }
    }
  });

  test("no pack repeats a question", () => {
    const all = MARKET_PACKS.flatMap((p) => p.questions.map((q) => q.en));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("WeddlyMarket party helpers", () => {
  test("countdown reads m:ss and never goes negative", () => {
    expect(formatCountdown(90_000)).toBe("1:30");
    expect(formatCountdown(5_001)).toBe("0:06");
    expect(formatCountdown(-3_000)).toBe("0:00");
  });

  test("every flash option is short enough to be shown as a flash", () => {
    for (const sec of MARKET_FLASH_SECONDS) {
      expect(isFlashQuestion({ createdAt: 0, closesAt: sec * 1000 })).toBe(true);
    }
    expect(isFlashQuestion({ createdAt: 0, closesAt: 60 * 60 * 1000 })).toBe(false);
  });

  test("a bail-out refunds 80%, rounded down, so it can never mint a point", () => {
    expect(bailoutRefund(100)).toBe(80);
    expect(bailoutRefund(5)).toBe(4);
    expect(bailoutRefund(7)).toBe(5);
  });
});
