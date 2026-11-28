// The pure split of a vendor offer into budget lines (shared/offer_budget.ts).
// The invariant everything else leans on: the split NEVER loses or invents money.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  classifyOfferItem,
  isServiceCharge,
  offerBudgetBreakdown,
  offerPrimaryCategory,
  storedPlannedAmount,
} from "@shared/offer_budget";
import { OFFER_SCHEMA, type VendorOfferPayload, offerTotalAt } from "@shared/vendor_offers";

function offer(over: Partial<VendorOfferPayload> = {}): VendorOfferPayload {
  return {
    schema: OFFER_SCHEMA,
    vendor_name: "Teleki-Wattay Kastély",
    category: "venue",
    currency: "HUF",
    quoted_at: "2026-11-28",
    valid_until: null,
    event_date: null,
    guest_count: 91,
    stated_total: null,
    line_items: [
      { label: "Exclusive hire", amount: 700000, kind: "base", optional: false },
      { label: "Catering, Standard menu", amount: 17550, kind: "per_person", optional: false },
      {
        label: "10% service charge on food and drinks",
        amount: 159705,
        kind: "fee",
        optional: false,
      },
      { label: "Soft unlimited drinks, 6 h", amount: 6800, kind: "per_person", optional: true },
    ],
    deposit_amount: null,
    payment_terms: null,
    inclusions: [],
    exclusions: [],
    cancellation: null,
    notes: null,
    ...over,
  };
}

describe("classification", () => {
  test("words decide the bucket, the offer's own category is the fallback", () => {
    expect(classifyOfferItem("Soft unlimited drinks, 6 h", "venue")).toBe("drinks");
    expect(classifyOfferItem("Welcome drink with canapés", "venue")).toBe("drinks");
    expect(classifyOfferItem("Standard menu", "venue")).toBe("catering");
    expect(classifyOfferItem("Italok csomag", "venue")).toBe("drinks");
    expect(classifyOfferItem("Wedding cake", "catering")).toBe("cake_dessert");
    expect(classifyOfferItem("Exclusive hire", "venue")).toBe("venue");
  });

  test("short stems do not match inside unrelated words", () => {
    expect(classifyOfferItem("Italian garden terrace", "venue")).toBe("venue");
    expect(classifyOfferItem("Radar room", "venue")).toBe("venue");
    expect(classifyOfferItem("Essential package", "venue")).toBe("venue");
  });

  test("a service charge is a fee about service, not cleaning", () => {
    expect(isServiceCharge("10% service charge on food and drinks")).toBe(true);
    expect(isServiceCharge("Szervízdíj 10%")).toBe(true);
    expect(isServiceCharge("Cleaning service")).toBe(false);
  });

  test("supplier categories map to budget buckets", () => {
    expect(offerPrimaryCategory("venue")).toBe("venue");
    expect(offerPrimaryCategory("bar_drinks")).toBe("drinks");
    expect(offerPrimaryCategory("photography")).toBe("photo_video");
    expect(offerPrimaryCategory("no-such-thing")).toBe("other");
  });
});

describe("breakdown", () => {
  test("splits venue hire, catering and the service charge by what they buy", () => {
    const b = offerBudgetBreakdown(offer(), { guests: 91 });
    expect(b.by_category.venue).toBe(700000);
    // The charge follows the food (the only food/drink row here), so it lands on
    // catering rather than on the venue hire.
    expect(b.by_category.catering).toBe(17550 * 91 + 159705);
    expect(b.by_category.drinks).toBeUndefined();
  });

  test("the split sums to the offer total, optional extras excluded", () => {
    const p = offer();
    const b = offerBudgetBreakdown(p, { guests: 91 });
    expect(b.total).toBe(offerTotalAt(p, 91));
  });

  test("a chosen optional extra is added and a service charge spreads over food and drink", () => {
    const p = offer();
    const b = offerBudgetBreakdown(p, { guests: 91, includeOptional: [3] });
    expect(b.total).toBe(offerTotalAt(p, 91) + 6800 * 91);
    const cat = (b.by_category.catering ?? 0) - 17550 * 91;
    const drk = (b.by_category.drinks ?? 0) - 6800 * 91;
    // Both received a share of the charge, in proportion to what they cost.
    expect(cat).toBeGreaterThan(0);
    expect(drk).toBeGreaterThan(0);
    expect(cat + drk).toBe(159705);
    expect(cat / drk).toBeCloseTo((17550 * 91) / (6800 * 91), 1);
  });

  test("per-guest rows rescale with the headcount, flat ones do not", () => {
    const p = offer();
    const at91 = offerBudgetBreakdown(p, { guests: 91 });
    const at100 = offerBudgetBreakdown(p, { guests: 100 });
    expect(at100.by_category.venue).toBe(at91.by_category.venue ?? 0);
    expect(at100.total).toBe(offerTotalAt(p, 100));
  });

  test("a discount comes off its own category, never below zero", () => {
    const p = offer({
      line_items: [
        { label: "Hire", amount: 1000, kind: "base", optional: false },
        { label: "Menu", amount: 50, kind: "per_person", optional: false },
        { label: "Early bird food discount", amount: 5000, kind: "discount", optional: false },
      ],
      guest_count: 10,
    });
    const b = offerBudgetBreakdown(p, { guests: 10 });
    // 500 of menu is eaten by the discount first, then the remainder from the hire.
    expect(b.by_category.catering).toBeUndefined();
    expect(b.total).toBe(offerTotalAt(p, 10));
    for (const r of b.rows) expect(r.amount).toBeGreaterThan(0);
  });

  test("an override moves a row and the total does not change", () => {
    const p = offer();
    const base = offerBudgetBreakdown(p, { guests: 91 });
    const moved = offerBudgetBreakdown(p, { guests: 91, overrides: { 0: "decor_floral" } });
    expect(moved.by_category.decor_floral).toBe(700000);
    expect(moved.by_category.venue).toBeUndefined();
    expect(moved.total).toBe(base.total);
  });

  test("a printed total with no lines becomes one row in the offer's own category", () => {
    const p = offer({ line_items: [], stated_total: 450000, guest_count: null });
    const b = offerBudgetBreakdown(p, { guests: null });
    expect(b.rows).toHaveLength(1);
    expect(b.by_category.venue).toBe(450000);
  });
});

describe("stored amount", () => {
  test("per-guest categories are stored at the baseline headcount", () => {
    // Priced at 91 guests, budget baseline 80: stored so the slider at 91 shows 91's price.
    const stored = storedPlannedAmount({ amount: 1597050, category: "catering" }, 91, 80);
    expect(Math.round((stored * 91) / 80)).toBe(1597050);
  });

  test("flat categories and frozen categories store the amount as is", () => {
    expect(storedPlannedAmount({ amount: 700000, category: "venue" }, 91, 80)).toBe(700000);
    expect(
      storedPlannedAmount({ amount: 1000, category: "catering" }, 91, 80, new Set(["catering"])),
    ).toBe(1000);
  });
});
