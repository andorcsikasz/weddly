// Live EUR-based FX rates for the admin financial planner. We pull the
// real-time market mid for EUR→HUF / USD / CNY from Yahoo Finance's public
// chart endpoint (no key) — fetched server-side so we're not bound by a
// once-a-day reference rate and so the browser dodges the cross-origin block.
//
// Narrow + best-effort, like lib/amadeus.ts: returns `null` on any failure,
// caches the success path for 10 minutes, serves the last good value if a
// later refresh fails, and never throws to the route. Set `FX_DISABLED=1`
// (tests) to skip the outbound call entirely.

import type { FxRates } from "@shared/admin_financial_planner";
import { log as logger } from "./logger";

const PAIRS = { HUF: "EURHUF=X", USD: "EURUSD=X", CNY: "EURCNY=X" } as const;
const TTL_MS = 10 * 60_000;

let cache: { value: FxRates; expiresAt: number } | null = null;

async function yahooPrice(symbol: string): Promise<{ price: number; time: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=1d&range=1d`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WeddlyBot/1.0)" },
    });
    if (!r.ok) {
      logger.warn("fx.yahoo_failed", { symbol, status: r.status });
      return null;
    }
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }>;
      };
    };
    const meta = j.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    const time =
      typeof meta?.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now();
    return { price, time };
  } catch (e) {
    logger.warn("fx.yahoo_error", { symbol, error: String(e) });
    return null;
  }
}

/** Live EUR→HUF/USD/CNY mid. Cached 10 min; falls back to the last good value
 *  (then null) when the upstream is unreachable. */
export async function getFxRates(): Promise<FxRates | null> {
  if (process.env.FX_DISABLED === "1") return null;
  const nowMs = Date.now();
  if (cache && cache.expiresAt > nowMs) return cache.value;

  const [huf, usd, cny] = await Promise.all([
    yahooPrice(PAIRS.HUF),
    yahooPrice(PAIRS.USD),
    yahooPrice(PAIRS.CNY),
  ]);
  if (!huf || !usd || !cny) {
    // Don't poison the cache on a partial failure — serve the last good value
    // if we have one, otherwise signal "no data" so the strip just hides.
    return cache?.value ?? null;
  }

  const value: FxRates = {
    base: "EUR",
    rates: { HUF: huf.price, USD: usd.price, CNY: cny.price },
    as_of: Math.max(huf.time, usd.time, cny.time),
    source: "yahoo",
  };
  cache = { value, expiresAt: nowMs + TTL_MS };
  return value;
}
