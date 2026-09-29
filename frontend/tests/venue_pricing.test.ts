import { describe, expect, test } from "bun:test";
import {
  dayKindsFor,
  emptyVenueProfile,
  estimateVenueCost,
  matchVenuePricing,
  publicHolidays,
  ruleCoversDate,
  type VenuePriceItem,
  type VenuePricingRule,
} from "@shared/venue";

function item(p: Partial<VenuePriceItem> & Pick<VenuePriceItem, "key" | "mode">): VenuePriceItem {
  return { label: null, amount: null, quantity: null, optional: false, ...p };
}

function rule(p: Partial<VenuePricingRule>): VenuePricingRule {
  return {
    id: 1,
    name: "Rule",
    start_month: 1,
    end_month: 12,
    days: ["weekday", "friday", "saturday", "sunday"],
    min_guests: null,
    max_guests: null,
    min_spend: null,
    available: true,
    items: [],
    position: 0,
    updated_at: 0,
    ...p,
  };
}

const peakSaturday = rule({
  id: 1,
  name: "Peak season",
  start_month: 5,
  end_month: 9,
  days: ["saturday"],
  min_guests: 100,
  items: [
    item({ key: "venue_rental", mode: "fixed", amount: 650_000 }),
    item({ key: "catering", mode: "per_guest", amount: 30_990 }),
    item({ key: "drinks", mode: "included" }),
    item({ key: "ceremony_location", mode: "free" }),
    item({ key: "extra_hour", mode: "per_hour", amount: 50_000, optional: true }),
  ],
});

function detail(rules: VenuePricingRule[], country: string | null = "HU") {
  return { pricing_rules: rules, country, profile: emptyVenueProfile() };
}

describe("venue calendar", () => {
  test("day kinds split Mon-Thu from the weekend and flag public holidays", () => {
    expect(dayKindsFor("2026-06-10", "HU")).toEqual(["weekday"]); // Wednesday
    expect(dayKindsFor("2026-06-12", "HU")).toEqual(["friday"]);
    expect(dayKindsFor("2026-06-13", "HU")).toEqual(["saturday"]);
    // 20 August 2026 is a Thursday and a Hungarian national holiday.
    expect(dayKindsFor("2026-08-20", "HU")).toEqual(["weekday", "holiday"]);
    // Same date is an ordinary Thursday in Germany.
    expect(dayKindsFor("2026-08-20", "DE")).toEqual(["weekday"]);
  });

  test("movable feasts follow Easter", () => {
    // Easter Sunday 2026 is 5 April.
    const hu = publicHolidays("HU", 2026);
    expect(hu.has("2026-04-03")).toBe(true); // Good Friday
    expect(hu.has("2026-04-06")).toBe(true); // Easter Monday
    expect(hu.has("2026-05-25")).toBe(true); // Whit Monday
    expect(publicHolidays("XX", 2026).size).toBe(0);
  });

  test("a season can wrap the year", () => {
    const winter = rule({ start_month: 11, end_month: 2, days: ["saturday"] });
    expect(ruleCoversDate(winter, "2026-12-12", "HU")).toBe(true);
    expect(ruleCoversDate(winter, "2027-01-16", "HU")).toBe(true);
    expect(ruleCoversDate(winter, "2026-06-13", "HU")).toBe(false);
  });
});

describe("venue estimate", () => {
  test("sums charged lines; free, included and optional lines are listed but not summed", () => {
    const est = estimateVenueCost(peakSaturday, 120);
    expect(est.total).toBe(650_000 + 120 * 30_990);
    expect(est.is_from).toBe(false);
    const statuses = est.lines.map((l) => l.status);
    expect(statuses).toEqual(["charged", "charged", "included", "free", "optional"]);
  });

  test("an unpriceable mandatory line makes the total a floor instead of a guess", () => {
    const r = rule({
      items: [
        item({ key: "venue_rental", mode: "fixed", amount: 100 }),
        item({ key: "accommodation", mode: "per_room", amount: 50 }), // no room count
        item({ key: "technical", mode: "on_request" }),
      ],
    });
    const est = estimateVenueCost(r, 80);
    expect(est.total).toBe(100);
    expect(est.is_from).toBe(true);
    expect(est.lines[1]?.status).toBe("needs_quantity");
  });

  test("per-guest with no guest count is not imputed", () => {
    const est = estimateVenueCost(peakSaturday, null);
    expect(est.total).toBe(650_000);
    expect(est.is_from).toBe(true);
  });

  test("a security deposit is refundable and never summed; minimum spend is a floor", () => {
    const r = rule({
      min_spend: 1_000,
      items: [
        item({ key: "venue_rental", mode: "fixed", amount: 400 }),
        item({ key: "security_deposit", mode: "fixed", amount: 5_000 }),
      ],
    });
    const est = estimateVenueCost(r, 50);
    expect(est.subtotal).toBe(400);
    expect(est.total).toBe(1_000);
    expect(est.min_spend_applied).toBe(true);
    expect(est.lines[1]?.status).toBe("refundable");
  });
});

describe("matching a couple's date and guest count", () => {
  test("79 guests on a Saturday whose rule wants 100: the rule is shown WITH the misfit", () => {
    const m = matchVenuePricing(detail([peakSaturday]), { date: "2026-06-13", guests: 79 });
    expect(m.kind).toBe("priced");
    if (m.kind !== "priced") return;
    expect(m.rule.name).toBe("Peak season");
    expect(m.fit).toBe("below_min");
  });

  test("a rule whose guest band fits is preferred over one that does not", () => {
    const small = rule({
      id: 2,
      name: "Small Saturday",
      start_month: 5,
      end_month: 9,
      days: ["saturday"],
      max_guests: 99,
      position: 1,
    });
    const m = matchVenuePricing(detail([peakSaturday, small]), { date: "2026-06-13", guests: 79 });
    expect(m.kind === "priced" && m.rule.name).toBe("Small Saturday");
  });

  test("the most specific rule wins, so a blackout month beats the season", () => {
    const august = rule({
      id: 3,
      name: "August closed",
      start_month: 8,
      end_month: 8,
      days: ["saturday"],
      available: false,
      position: 5,
    });
    const m = matchVenuePricing(detail([peakSaturday, august]), {
      date: "2026-08-15",
      guests: 120,
    });
    expect(m.kind).toBe("unavailable");
    const june = matchVenuePricing(detail([peakSaturday, august]), {
      date: "2026-06-13",
      guests: 120,
    });
    expect(june.kind).toBe("priced");
  });

  test("no date, no rules and an uncovered date are three different answers", () => {
    expect(matchVenuePricing(detail([]), { date: "2026-06-13", guests: 50 }).kind).toBe("no_rules");
    expect(matchVenuePricing(detail([peakSaturday]), { date: null, guests: 50 }).kind).toBe(
      "no_date",
    );
    expect(matchVenuePricing(detail([peakSaturday]), { date: "2026-06-10", guests: 50 }).kind).toBe(
      "no_match",
    );
  });

  test("a holiday rule prices a holiday that falls on a weekday", () => {
    const holiday = rule({ id: 4, name: "Holiday", days: ["holiday"] });
    const m = matchVenuePricing(detail([holiday]), { date: "2026-08-20", guests: 50 });
    expect(m.kind === "priced" && m.rule.name).toBe("Holiday");
  });
});
