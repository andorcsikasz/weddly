import { describe, expect, it } from "bun:test";
import {
  combineProductForecast,
  expiryOffsets,
  projectRecurringProduct,
} from "@shared/admin_financial_planner";

const flat = { newPerMonth: 0, trialToPaidPct: 0, monthlyChurnPct: 0, foundingConvPct: 0 };

describe("projectRecurringProduct", () => {
  it("adds converted trials and prices them at the ARPU", () => {
    const out = projectRecurringProduct(
      { subscribers: 0, arpuEur: 10 },
      { ...flat, newPerMonth: 10, trialToPaidPct: 50 },
      3,
      [],
    );
    expect(out.map((p) => p.subscribers)).toEqual([5, 10, 15]);
    expect(out[2]?.mrr).toBe(150);
  });

  it("converts a free window the month it ends, and counts scheduled charges once", () => {
    const out = projectRecurringProduct(
      { subscribers: 0, arpuEur: 10, certainAdds: 2 },
      { ...flat, foundingConvPct: 50 },
      3,
      [0, 10, 0],
    );
    expect(out.map((p) => p.subscribers)).toEqual([2, 7, 7]);
  });

  it("churns the paying base", () => {
    const out = projectRecurringProduct(
      { subscribers: 100, arpuEur: 1 },
      { ...flat, monthlyChurnPct: 10 },
      2,
      [],
    );
    expect(out.map((p) => p.subscribers)).toEqual([90, 81]);
  });
});

describe("combineProductForecast", () => {
  it("totals every subscription line plus the one-off sales", () => {
    const line = (mrr: number) => [{ month: 1, subscribers: 1, mrr }];
    const [p] = combineProductForecast(
      { couples: line(5), vendors: line(10), planners: line(19) },
      { cameraPerMonthEur: 15.8, addonPerMonthEur: 2.15 },
      1,
    );
    expect(p?.camera_revenue).toBe(16);
    expect(p?.addon_revenue).toBe(2);
    expect(p?.total).toBe(5 + 10 + 19 + 16 + 2);
  });
});

describe("expiryOffsets", () => {
  it("maps YYYY-MM buckets onto month offsets and drops out-of-range ones", () => {
    const now = new Date(2026, 8, 15).getTime(); // September 2026
    const out = expiryOffsets(
      [
        { month: "2026-08", count: 9 },
        { month: "2026-09", count: 1 },
        { month: "2026-11", count: 3 },
        { month: "2028-01", count: 7 },
      ],
      now,
      3,
    );
    expect(out).toEqual([1, 0, 3]);
  });
});
