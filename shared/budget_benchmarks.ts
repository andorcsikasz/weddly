// Illustrative HU wedding budget ranges (2026). Sources: rough averages
// from publicly-visible HU vendor pricing (tradergroup.hu, eskuvo.com).
// Treat as conversational scaffolding, NOT advice. Update before any
// public/marketing surfacing — the numbers below are educated guesses
// and should be reviewed against industry data before being relied on.

export interface BudgetBenchmark {
  /** Budget tier per guest in HUF — DIY-heavy, family venue, minimal vendors. */
  min_per_guest_huf: number;
  /** Mid-tier per guest in HUF — standard venue + catering, typical vendor mix. */
  mid_per_guest_huf: number;
  /** Premium tier per guest in HUF — Budapest venue, full service. */
  max_per_guest_huf: number;
}

/** Per-guest budget tiers, scaled by guest count. Per-guest rates fall
 *  slightly as headcount grows (volume discounts on bigger weddings). */
export function getBudgetBenchmark(guestCount: number): BudgetBenchmark {
  if (guestCount <= 30) {
    return { min_per_guest_huf: 60_000, mid_per_guest_huf: 90_000, max_per_guest_huf: 150_000 };
  }
  if (guestCount <= 80) {
    return { min_per_guest_huf: 45_000, mid_per_guest_huf: 75_000, max_per_guest_huf: 130_000 };
  }
  if (guestCount <= 150) {
    return { min_per_guest_huf: 35_000, mid_per_guest_huf: 65_000, max_per_guest_huf: 110_000 };
  }
  return { min_per_guest_huf: 30_000, mid_per_guest_huf: 55_000, max_per_guest_huf: 95_000 };
}

/** Total HUF range for the whole wedding at this guest count. */
export function getBudgetRange(guestCount: number): {
  min_huf: number;
  mid_huf: number;
  max_huf: number;
} {
  const t = getBudgetBenchmark(guestCount);
  return {
    min_huf: t.min_per_guest_huf * guestCount,
    mid_huf: t.mid_per_guest_huf * guestCount,
    max_huf: t.max_per_guest_huf * guestCount,
  };
}
