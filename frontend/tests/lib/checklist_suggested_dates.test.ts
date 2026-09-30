import type { WeddingDateGoal } from "@shared/types";
import { checklistSections, planningAnchorDate } from "@shared/wedding_checklist";
import { describe, expect, it } from "bun:test";

const TODAY = "2026-10-01";
const goal = (patch: Partial<WeddingDateGoal>): WeddingDateGoal => ({
  kind: "tbd",
  exact_date: null,
  target_year: null,
  target_month: null,
  target_season: null,
  target_quarter: null,
  ...patch,
});

describe("planningAnchorDate", () => {
  it("uses the real date when there is one", () => {
    expect(planningAnchorDate("2028-05-20", null, TODAY, "early_bird")).toBe("2028-05-20");
  });

  it("reads an approximate goal from onboarding", () => {
    expect(
      planningAnchorDate(
        null,
        goal({ kind: "month", target_year: 2027, target_month: 9 }),
        TODAY,
        "relaxed",
      ),
    ).toBe("2027-09-15");
    expect(
      planningAnchorDate(
        null,
        goal({ kind: "quarter", target_year: 2027, target_quarter: 2 }),
        TODAY,
        "relaxed",
      ),
    ).toBe("2027-05-15");
    expect(
      planningAnchorDate(null, goal({ kind: "year", target_year: 2028 }), TODAY, "relaxed"),
    ).toBe("2028-07-01");
  });

  it("falls back to the pace's horizon, never to nothing", () => {
    expect(planningAnchorDate(null, null, TODAY, "early_bird")).toBe("2028-04-01");
    expect(planningAnchorDate(null, goal({ kind: "tbd" }), TODAY, "last_minute")).toBe(
      "2027-02-01",
    );
    // A goal that has already gone by is no anchor.
    expect(
      planningAnchorDate(null, goal({ kind: "year", target_year: 2025 }), TODAY, "relaxed"),
    ).toBe("2027-08-01");
  });
});

describe("suggested deadlines", () => {
  const ranged = (wedding: string, pace: "early_bird" | "last_minute") =>
    checklistSections("en", wedding, TODAY, pace).slice(0, 5);

  it("spread across a ranged section instead of sharing one day", () => {
    for (const section of ranged("2029-06-16", "early_bird")) {
      const dates = section.items.map((item) => item.dueDate);
      expect(new Set(dates).size).toBeGreaterThan(dates.length / 2);
      expect([...dates].sort()).toEqual(dates);
    }
  });

  it("stay in order from one section to the next", () => {
    const all = ranged("2029-06-16", "early_bird").flatMap((s) => s.items.map((i) => i.dueDate));
    expect([...all].sort()).toEqual(all);
  });

  it("compress into a short runway without piling up on today", () => {
    const all = ranged("2027-03-01", "early_bird").flatMap((s) => s.items.map((i) => i.dueDate));
    expect(all.filter((d) => d === TODAY).length).toBeLessThanOrEqual(1);
    expect(all.every((d) => (d ?? "") >= TODAY && (d ?? "") < "2027-03-01")).toBe(true);
    expect([...all].sort()).toEqual(all);
  });
});
