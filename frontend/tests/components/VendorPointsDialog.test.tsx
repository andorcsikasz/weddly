// The "Hogyan gyűjthetsz pontot?" dialog. Two things it got wrong are worth a
// test, because both were invisible from the code and only showed up when a
// vendor opened the panel and told us:
//
//   1. it drew ONE badge, the tier you hold, so a Gold vendor saw a single gold
//      pill and the rung they started on (Blue) plus the two above it did not
//      exist anywhere in the app. There was no way to see the ladder, what a
//      rung cost, or how far along it you were;
//   2. Gold was reachable on points alone, so the panel could say "you are
//      Gold" about a page with one review on it. The gate is only half the fix
//      — if the dialog doesn't SAY what is missing, a too-easy tier just
//      becomes a mysterious one.

import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VENDOR_TIERS, type VendorPointsStatus } from "@shared/vendor_points";
import { VendorPointsRail } from "@/components/VendorPointsRail";
import { I18nProvider } from "@/lib/i18n";

/** The vendor from the report: 165 points, Gold on the old rules, one review. */
const REPORTED: VendorPointsStatus = {
  points: 165,
  facts: { points: 165, reviews: 1, profile_milestones: 4 },
  tier: "blue",
  perks: {
    search_boost: 0,
    extra_lead_credits: 0,
    subscription_discount_pct: 0,
    profile_badge: false,
  },
  next_tier: "gold",
  points_to_next: 0,
  progress: 0.2,
  recent: [],
  earned_by_event: {
    profile_completeness: 40,
    review_collected: 15,
    first_review: 50,
    fast_reply: 0,
    referral_activated: 0,
    booking_confirmed: 60,
    repeat_booking: 0,
    admin_adjustment: 0,
  },
  category_rank: null,
};

function open(points: VendorPointsStatus) {
  render(
    <MemoryRouter>
      <I18nProvider>
        <VendorPointsRail collapsed={false} points={points} />
      </I18nProvider>
    </MemoryRouter>,
  );
  // The rail block IS the button that opens the rulebook.
  const trigger = screen.getAllByRole("button")[0];
  if (trigger) fireEvent.click(trigger);
}

describe("the Weddly Points dialog", () => {
  it("shows the whole ladder, not just the rung you hold", () => {
    open(REPORTED);
    const ladder = screen.getByRole("list", { name: /tiers/i });
    const rungs = within(ladder).getAllByRole("listitem");
    expect(rungs).toHaveLength(VENDOR_TIERS.length);

    // Every tier is named, Blue included: that is the rung this vendor is on
    // and it was the one missing from the panel entirely.
    for (const label of ["Blue", "Gold", "Platinum", "Black"]) {
      expect(within(ladder).getByText(label)).toBeTruthy();
    }

    // And each rung says what it costs, read from VENDOR_TIERS rather than
    // spelled into the copy.
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    expect(gold).toBeTruthy();
    if (!gold) return;
    expect(
      within(ladder).getByText(
        new RegExp(`${gold.min_points}.*${gold.requires.min_reviews}`),
      ),
    ).toBeTruthy();
  });

  it("names what is actually missing, not a points gap that is already closed", () => {
    open(REPORTED);
    // 165 points is past Gold's floor, so a panel that only talked about points
    // would say "0 points to Gold" and leave the vendor with nothing to do.
    expect(screen.queryByText(/0 points to Gold/i)).toBeNull();

    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    // The binding requirement, in the status line and again in the gap list.
    // The sentence is rendered in the rail and in the dialog it opens, so both
    // surfaces name the same blocker rather than only the panel knowing.
    expect(
      screen.getAllByText(new RegExp(`${gold.requires.min_reviews - 1} more reviews`, "i")).length,
    ).toBeGreaterThan(1);
    expect(screen.getByText(/^Reviews$/)).toBeTruthy();
    expect(screen.getByText(`1 / ${gold.requires.min_reviews}`)).toBeTruthy();
  });

  it("drops the gap list once a rung is fully met", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    open({
      ...REPORTED,
      points: gold.min_points,
      facts: { points: gold.min_points, reviews: gold.requires.min_reviews, profile_milestones: 4 },
      tier: "gold",
      next_tier: "platinum",
    });
    // Gold is held, so the list now describes PLATINUM and must not still be
    // asking for Gold's five reviews.
    expect(screen.getByText(/To reach Platinum/i)).toBeTruthy();
    const platinum = VENDOR_TIERS.find((t) => t.key === "platinum");
    if (!platinum) return;
    expect(
      screen.getByText(`${gold.requires.min_reviews} / ${platinum.requires.min_reviews}`),
    ).toBeTruthy();
  });
});
