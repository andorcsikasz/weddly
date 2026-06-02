// Live FX rates (EUR base) from the ECB via Frankfurter — free, no API key,
// CORS-enabled. Used by the admin financial planner: the rate strip and the
// HU tax estimates (which convert the Ft-denominated minimum wage / KATA fee
// into the planner's EUR). Fails soft (returns null) so the planner still
// renders with its static fallback rate when the API is unreachable.

export interface FxRates {
  base: "EUR";
  /** Units of each currency per 1 EUR. */
  rates: { HUF: number; USD: number; CNY: number };
  /** ECB reference date (YYYY-MM-DD). */
  asOf: string;
}

const FX_URL = "https://api.frankfurter.app/latest?from=EUR&to=HUF,USD,CNY";

export async function fetchFxRates(signal?: AbortSignal): Promise<FxRates | null> {
  try {
    const res = await fetch(FX_URL, { signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const r = j.rates;
    if (!r || typeof r.HUF !== "number" || typeof r.USD !== "number" || typeof r.CNY !== "number") {
      return null;
    }
    return { base: "EUR", rates: { HUF: r.HUF, USD: r.USD, CNY: r.CNY }, asOf: j.date ?? "" };
  } catch {
    return null;
  }
}
