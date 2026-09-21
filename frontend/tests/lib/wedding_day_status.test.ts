// The one verdict a vendor page gives about the couple's own wedding date.
//
// The cases that matter are the refusals: an unclaimed listing, a vendor whose
// calendar is not entitled or not public, and a date in the past all answer
// null, because "free" printed over an empty payload would be a promise about a
// diary Weddly knows nothing about.

import type { SupplierAvailability } from "@shared/suppliers";
import { describe, expect, it } from "bun:test";
import { weddingDayStatus } from "@/lib/wedding_day_status";

const TODAY = new Date(2026, 8, 21); // 21 Sep 2026, local

function availability(over: Partial<SupplierAvailability> = {}): SupplierAvailability {
  return {
    unavailable_dates: [],
    partial_dates: [],
    next_available: null,
    bookable: true,
    calendar_public: true,
    available_weekdays: null,
    ...over,
  };
}

describe("weddingDayStatus", () => {
  it("is free on an ordinary open day", () => {
    expect(weddingDayStatus(availability(), "2027-06-12", TODAY)).toBe("free");
  });

  it("is busy on a blocked date and partial on a partly blocked one", () => {
    const a = availability({
      unavailable_dates: ["2027-06-12"],
      partial_dates: ["2027-06-19"],
    });
    expect(weddingDayStatus(a, "2027-06-12", TODAY)).toBe("busy");
    expect(weddingDayStatus(a, "2027-06-19", TODAY)).toBe("partial");
    expect(weddingDayStatus(a, "2027-06-26", TODAY)).toBe("free");
  });

  it("is busy on a weekday the vendor does not work", () => {
    // 2027-06-12 is a Saturday (ISO 6); a Monday-to-Friday vendor is not there.
    const weekdaysOnly = availability({ available_weekdays: [1, 2, 3, 4, 5] });
    expect(weddingDayStatus(weekdaysOnly, "2027-06-12", TODAY)).toBe("busy");
    expect(weddingDayStatus(weekdaysOnly, "2027-06-11", TODAY)).toBe("free");
  });

  it("a blocked date outranks everything else", () => {
    const a = availability({
      unavailable_dates: ["2027-06-12"],
      partial_dates: ["2027-06-12"],
    });
    expect(weddingDayStatus(a, "2027-06-12", TODAY)).toBe("busy");
  });

  it("answers null when Weddly cannot vouch for the calendar", () => {
    // Unclaimed / unentitled: the payload is empty because nobody knows.
    expect(weddingDayStatus(availability({ bookable: false }), "2027-06-12", TODAY)).toBeNull();
    // The vendor publishes no calendar at all.
    expect(
      weddingDayStatus(availability({ calendar_public: false }), "2027-06-12", TODAY),
    ).toBeNull();
    // Nothing loaded yet.
    expect(weddingDayStatus(null, "2027-06-12", TODAY)).toBeNull();
  });

  it("answers null without a wedding date, with a junk one, or with one in the past", () => {
    expect(weddingDayStatus(availability(), null, TODAY)).toBeNull();
    expect(weddingDayStatus(availability(), "soon", TODAY)).toBeNull();
    expect(weddingDayStatus(availability(), "2026-09-20", TODAY)).toBeNull();
    // Today itself is still bookable.
    expect(weddingDayStatus(availability(), "2026-09-21", TODAY)).toBe("free");
  });

  it("accepts a full ISO timestamp by reading its date part", () => {
    expect(weddingDayStatus(availability(), "2027-06-12T00:00:00.000Z", TODAY)).toBe("free");
  });
});
