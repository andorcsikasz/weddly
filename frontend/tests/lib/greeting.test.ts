// The vendor dashboard's opening line.
//
// Worth a test because every failure mode here is embarrassing rather than
// broken: "good afternoon" at midnight, a Christmas greeting on the 23rd, or an
// Easter that quietly drifts a year after it was hard-coded. Nothing renders an
// error, it just reads as though nobody is home.

import { describe, expect, it } from "bun:test";
import en from "@/locales/en";
import es from "@/locales/es";
import hu from "@/locales/hu";
import { type GreetingKey, greetingKeyFor } from "@/lib/greeting";

/** A local-time date, which is what the greeting reads. Constructing through
 *  the numeric ctor (not an ISO string) is the point: `new Date("2026-06-01")`
 *  is UTC midnight and lands on May 31st for anyone west of Greenwich. */
function at(year: number, month: number, day: number, hour = 9): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

describe("greetingKeyFor: time of day", () => {
  // An ordinary Monday in June, nowhere near a holiday, walked hour by hour so
  // a band can neither swallow its neighbour nor
  // leave a gap. Bands: 05-08 early, 08-11 morning, 11-14 midday, 14-17
  // afternoon, 17-19 early evening, 19-22 evening, 22-05 night.
  const cases: [number, GreetingKey][] = [
    [0, "night"],
    [4, "night"],
    [5, "early"],
    [6, "early"],
    [7, "early"],
    [8, "morning"],
    [9, "morning"],
    [10, "morning"],
    [11, "midday"],
    [12, "midday"],
    [13, "midday"],
    [14, "afternoon"],
    [15, "afternoon"],
    [16, "afternoon"],
    [17, "early_evening"],
    [18, "early_evening"],
    [19, "evening"],
    [20, "evening"],
    [21, "evening"],
    [22, "night"],
    [23, "night"],
  ];
  for (const [hour, expected] of cases) {
    it(`${String(hour).padStart(2, "0")}:00 is ${expected}`, () => {
      expect(greetingKeyFor(at(2026, 6, 1, hour))).toBe(expected);
    });
  }

  it("changes at the top of the hour, not somewhere inside it", () => {
    expect(greetingKeyFor(new Date(2026, 5, 1, 10, 59, 59))).toBe("morning");
    expect(greetingKeyFor(new Date(2026, 5, 1, 11, 0, 0))).toBe("midday");
    expect(greetingKeyFor(new Date(2026, 5, 1, 21, 59, 59))).toBe("evening");
    expect(greetingKeyFor(new Date(2026, 5, 1, 22, 0, 0))).toBe("night");
  });
});

describe("greetingKeyFor: holidays", () => {
  it("covers Christmas Eve through Boxing Day, and stops there", () => {
    expect(greetingKeyFor(at(2026, 12, 23))).toBe("morning");
    expect(greetingKeyFor(at(2026, 12, 24))).toBe("christmas");
    expect(greetingKeyFor(at(2026, 12, 25))).toBe("christmas");
    expect(greetingKeyFor(at(2026, 12, 26))).toBe("christmas");
    expect(greetingKeyFor(at(2026, 12, 27))).toBe("morning");
  });

  it("wishes the new year from the eve to the first working day", () => {
    expect(greetingKeyFor(at(2026, 12, 30))).toBe("morning");
    expect(greetingKeyFor(at(2026, 12, 31))).toBe("new_year");
    expect(greetingKeyFor(at(2027, 1, 1))).toBe("new_year");
    expect(greetingKeyFor(at(2027, 1, 2))).toBe("new_year");
    expect(greetingKeyFor(at(2027, 1, 3))).toBe("morning");
  });

  it("catches Valentine's, the one day a wedding supplier cares about most", () => {
    expect(greetingKeyFor(at(2027, 2, 14))).toBe("valentines");
    expect(greetingKeyFor(at(2027, 2, 15))).toBe("morning");
  });

  // Computed, not tabled: a hard-coded Easter is right for one year and wrong
  // forever after. Easter Sunday is 2026-04-05, 2027-03-28, 2028-04-16.
  it("tracks Easter across years, Good Friday to Easter Monday", () => {
    expect(greetingKeyFor(at(2026, 4, 2))).toBe("morning"); // Maundy Thursday
    expect(greetingKeyFor(at(2026, 4, 3))).toBe("easter"); // Good Friday
    expect(greetingKeyFor(at(2026, 4, 5))).toBe("easter"); // Easter Sunday
    expect(greetingKeyFor(at(2026, 4, 6))).toBe("easter"); // Easter Monday
    expect(greetingKeyFor(at(2026, 4, 7))).toBe("morning");

    expect(greetingKeyFor(at(2027, 3, 28))).toBe("easter");
    expect(greetingKeyFor(at(2028, 4, 16))).toBe("easter");
    // And the same calendar day is ordinary in a year Easter isn't on it.
    expect(greetingKeyFor(at(2027, 4, 5))).toBe("morning");
  });

  it("lets the holiday outrank the hour, rather than stacking both", () => {
    expect(greetingKeyFor(at(2026, 12, 25, 23))).toBe("christmas");
    expect(greetingKeyFor(at(2026, 12, 25, 6))).toBe("christmas");
  });
});

describe("greetingKeyFor: copy", () => {
  const KEYS: GreetingKey[] = [
    "early",
    "morning",
    "midday",
    "afternoon",
    "early_evening",
    "evening",
    "night",
    "christmas",
    "new_year",
    "valentines",
    "easter",
  ];

  // A missing line renders the raw key path at 36px across the top of the
  // dashboard, so the three locales have to agree on the whole set.
  for (const [name, tree] of [
    ["en", en],
    ["hu", hu],
    ["es", es],
  ] as const) {
    it(`${name} has every greeting, each addressed to {name}`, () => {
      const greeting = tree.vendor.dashboard.greeting as Record<string, string>;
      expect(Object.keys(greeting).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) {
        expect(greeting[key]).toContain("{name}");
      }
    });
  }
});
