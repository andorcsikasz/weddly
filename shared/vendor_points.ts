// Weddly Points: the vendor-side tier + reputation currency.
//
// ONE source of truth for what earns points, what a tier is worth, and how a
// point total maps to a tier. Both sides import from here, and the backend's
// points engine is the only thing allowed to write the ledger.
//
// Design rules that must survive later edits:
//
//   1. The LEDGER is the truth. `vendor_points_ledger` is append-only; the
//      total, the tier and every quest are DERIVED by replaying it. There is
//      deliberately no mutable `points` counter on `vendor_accounts`: a
//      counter drifts, and a drifted gamification total is unfixable without
//      an audit trail nobody kept.
//   2. NOTHING is awarded for a star VALUE. Collecting a review earns points;
//      whether it was 5 stars or 3 changes nothing. Paying for good ratings is
//      how a marketplace buys itself a fake reputation.
//   3. Tiers are config, not scattered ifs. A perk is a typed field here, read
//      through `perksForTier`, so "what does Gold actually give me" has exactly
//      one answer and every enforcement site reads it from this table.
//   4. Everything is CAPPED. Each earning rule states its own ceiling, because
//      the cheapest attack on a points system is doing the cheap thing a
//      thousand times.
//
// The tier table lives in code rather than a `tiers` row set on purpose: every
// perk below has to be ENFORCED by code that already knows the perk's name
// (search ranking, lead credits, billing), so a JSON blob in SQLite would be a
// second place to edit without being a second place that can act. Moving it
// into a table later is mechanical: the shape is already `{key, min_points,
// perks}` and everything reads it through the accessors at the bottom.

/** Every event the points engine understands. The string is persisted in the
 *  ledger, so renaming one is a data migration, not a refactor. */
export type VendorPointsEvent =
  /** A public-profile milestone crossed (cover photo, description, price band…). */
  | "profile_completeness"
  /** The vendor collected a review. Value-blind by rule 2. */
  | "review_collected"
  /** The FIRST review on the profile, once ever: the hardest one to get. */
  | "first_review"
  /** The vendor answered a new inquiry inside FAST_REPLY_HOURS. */
  | "fast_reply"
  /** A referred vendor activated (finished onboarding AND got a first booking). */
  | "referral_activated"
  /** A couple confirmed a booking with this vendor: an inquiry that became a
   *  wedding. The single most valuable thing a vendor can do here. */
  | "booking_confirmed"
  /** LEGACY, never awarded. A wedding is a once-in-a-lifetime purchase, so "the
   *  same couple books you again" fired for practically nobody and sat in the
   *  rulebook advertising an unreachable 40 points. Superseded by
   *  `booking_confirmed`. The member stays because the string is persisted in
   *  the ledger and a handful of rows may exist; dropping it would orphan them
   *  out of `earned_by_event` and make the breakdown stop summing to the total. */
  | "repeat_booking"
  /** Manual admin correction. Can be negative; never emitted by the engine. */
  | "admin_adjustment";

/** Points per event. Deliberately coarse round numbers: this is a progress bar,
 *  not an accounting system, and fine-grained values invite fine-grained
 *  arguments about fairness. */
export const POINTS_BY_EVENT: Record<VendorPointsEvent, number> = {
  profile_completeness: 10,
  review_collected: 15,
  first_review: 50,
  fast_reply: 5,
  referral_activated: 150,
  booking_confirmed: 60,
  repeat_booking: 0, // legacy, see the event union
  admin_adjustment: 0,
};

/** An inquiry answered within this window counts as a fast reply. Measured
 *  server-side from `supplier_bookings.created_at` to the first status change
 *  the vendor makes (`first_response_at`), never self-reported. */
export const FAST_REPLY_HOURS = 24;

/** The rules a vendor can actually go and DO, in the order the "how do I earn
 *  points" panel lists them: cheapest and most controllable first.
 *
 *  Deliberately not the full event list. `admin_adjustment` is a correction, not
 *  an action, and `referral_activated` has no vendor-facing surface yet: the
 *  engine pays for it, but nothing lets a vendor refer anyone, and advertising a
 *  way to earn that the product doesn't offer is worse than a shorter list. Add
 *  it here the day the referral link ships. */
export const EARNABLE_EVENTS = [
  "profile_completeness",
  "first_review",
  "review_collected",
  "fast_reply",
  "booking_confirmed",
] as const satisfies readonly VendorPointsEvent[];

/** Profile completeness is scored in 25% steps, so a vendor earns four times on
 *  the way to a finished profile instead of once at the very end. */
export const PROFILE_MILESTONES = [25, 50, 75, 100] as const;

// ── Caps ───────────────────────────────────────────────────────────────────
// Every repeatable rule has a ceiling. Without these, "invite yourself from ten
// addresses" and "ask the same couple for ten reviews" are the two obvious
// exploits, and both are cheap.

/** Referral points stop accruing after this many activations per calendar
 *  month. An honest vendor recommending colleagues never hits it. */
export const MAX_REFERRAL_POINTS_PER_MONTH = 3 * 150;
/** Review-collection points per calendar month. A busy venue does maybe a dozen
 *  weddings a month; twenty reviews in thirty days is a farm, not a business. */
export const MAX_REVIEW_POINTS_PER_MONTH = 10 * 15;
/** Confirmed-booking points per calendar month. This is the most valuable rule
 *  in the table, so it is also the most worth faking: a vendor with a friendly
 *  couple account could confirm bookings all afternoon. Six a month is more
 *  weddings than all but the largest venues actually take, and the cap costs an
 *  honest vendor nothing. */
export const MAX_BOOKING_POINTS_PER_MONTH = 6 * 60;

// ── Tiers ──────────────────────────────────────────────────────────────────

export type VendorTierKey = "blue" | "gold" | "platinum" | "black";

/** What a tier actually GIVES. Every field is enforced somewhere real; adding a
 *  cosmetic-only field here is how a tier system becomes a sticker. */
export interface VendorTierPerks {
  /** Ranking nudge in the public directory + browse teaser. Applied as a sort
   *  key ABOVE recency but BELOW the visitor's own country, so a boost can
   *  never show a Hungarian couple a Portuguese vendor first. */
  search_boost: number;
  /** Extra free couple inquiries before billing starts, on top of the standard
   *  VENDOR_FREE_LEAD_CREDITS. */
  extra_lead_credits: number;
  /** Percentage off the monthly subscription while the vendor holds the tier. */
  subscription_discount_pct: number;
  /** Tier badge rendered on the public profile + directory card. */
  profile_badge: boolean;
}

/** What a tier DEMANDS, beyond the point total.
 *
 *  Points are one fungible scalar, so a point floor alone can never say "you
 *  need reviews": `fast_reply` and `booking_confirmed` are capped per MONTH and
 *  not per lifetime, so for any floor a vendor with a single review reaches it
 *  by answering inquiries for long enough. Gold was landing on vendors with one
 *  review (40 profile + 50 first review + 15 review + 60 booking = 165) and the
 *  badge said "this business is proven" about a page with one testimonial on it.
 *  A requirement is the only shape that fixes that; re-pricing is not.
 *
 *  EVERY field here is counted off the LEDGER, never off the live tables, and
 *  that is what makes a requirement safe:
 *
 *    • The ledger is append-only, so a requirement count can only go UP. A
 *      review its author deletes, a review moderation unpublishes, a photo
 *      taken down: none of them can quietly take a tier away weeks later. That
 *      is the same rule profile milestones already follow ("crossing 75% and
 *      later deleting a photo keeps the points"), applied to the gate.
 *    • Nothing new is stored and nothing is a second source of truth: the tier
 *      is still a pure replay of the one table, just of its shape as well as
 *      its sum.
 *    • The monthly review cap can't distort it. The cap stops at ten reviews a
 *      month and the highest gate here is twenty, so no honest vendor is ever
 *      held below a rung by a ceiling meant for farms. */
export interface VendorTierRequirements {
  /** `review_collected` rows: one per review, the first one included. */
  min_reviews: number;
  /** `profile_completeness` rows, out of `PROFILE_MILESTONES.length`. The full
   *  four means the listing reached 100% at some point. A tier is a claim about
   *  a business a couple can actually read about, so every rung above the floor
   *  wants the page finished. */
  min_profile_milestones: number;
}

/** The three facts a tier is checked against, all derived from the ledger at
 *  read time. Nothing here is stored. */
export interface VendorTierFacts {
  points: number;
  reviews: number;
  profile_milestones: number;
}

/** One requirement measured against a vendor: what they have, what the rung
 *  wants. Rendered as the "why am I not Gold yet" list, which is the half of
 *  this change that keeps a gate from being a mystery. */
export type VendorTierGapKey = "points" | "reviews" | "profile";

export interface VendorTierGap {
  key: VendorTierGapKey;
  have: number;
  need: number;
  met: boolean;
}

export interface VendorTier {
  key: VendorTierKey;
  min_points: number;
  requires: VendorTierRequirements;
  perks: VendorTierPerks;
}

/** Ascending by min_points AND by every requirement. `blue` is the entry tier
 *  every vendor starts in, so its threshold must stay 0 and it must demand
 *  nothing: `vendorTierFor` relies on it as an unconditional floor.
 *
 *  THE THRESHOLDS ARE A TIMELINE, not round numbers picked for looks. The top
 *  of a ladder nobody can climb is worse than no ladder: it tells a vendor the
 *  program is decoration. So the table is calibrated against what a real vendor
 *  earns, and the arithmetic below is the thing to re-run before touching a
 *  number here.
 *
 *  A committed vendor — one review collected a month, three inquiries answered
 *  inside the day, a wedding booked through Weddly every second month — earns
 *  15 + 15 + 30 = 60 points a month, after a one-time 90 for finishing the
 *  profile (40) and landing a first review (50). Points alone would give Gold
 *  in month 1, which is exactly the complaint. With the review gate:
 *
 *    Gold      150 pts,  5 reviews   month 5    REVIEWS bind (points land month 1)
 *    Platinum  600 pts, 10 reviews   month 10   reviews bind (points land ~9)
 *    Black    1500 pts, 20 reviews   month 23   POINTS bind (reviews land 20)
 *
 *  So the gate bites low, where the ladder was too cheap, and lets go at the
 *  top, where the points were already the hard part. Black stays inside two
 *  wedding seasons; a vendor who logs in twice a year still never arrives.
 *
 *  Note what is deliberately NOT gated: confirmed bookings. Closing weddings
 *  through Weddly is the most valuable thing in POINTS_BY_EVENT and it is a
 *  harder, less fakeable proof of a real business than a review is, so a vendor
 *  whose couples simply do not write reviews is slowed by the gate rather than
 *  walled out by a second one. And the point floors did NOT move: the gate does
 *  the work, so a rebalance that would have rewritten every historic total is
 *  not needed. */
export const VENDOR_TIERS: readonly VendorTier[] = [
  {
    key: "blue",
    min_points: 0,
    requires: { min_reviews: 0, min_profile_milestones: 0 },
    perks: {
      search_boost: 0,
      extra_lead_credits: 0,
      subscription_discount_pct: 0,
      profile_badge: false,
    },
  },
  {
    key: "gold",
    min_points: 150,
    requires: { min_reviews: 5, min_profile_milestones: PROFILE_MILESTONES.length },
    perks: {
      search_boost: 1,
      extra_lead_credits: 1,
      subscription_discount_pct: 0,
      profile_badge: true,
    },
  },
  {
    key: "platinum",
    min_points: 600,
    requires: { min_reviews: 10, min_profile_milestones: PROFILE_MILESTONES.length },
    perks: {
      search_boost: 2,
      extra_lead_credits: 3,
      subscription_discount_pct: 10,
      profile_badge: true,
    },
  },
  {
    key: "black",
    min_points: 1500,
    requires: { min_reviews: 20, min_profile_milestones: PROFILE_MILESTONES.length },
    perks: {
      search_boost: 3,
      extra_lead_credits: 5,
      subscription_discount_pct: 20,
      profile_badge: true,
    },
  },
] as const;

/** Every requirement of one rung, measured against a vendor: met or not, with
 *  the two numbers that say how far. The order is the order the UI lists them,
 *  cheapest first. */
export function vendorTierGaps(facts: VendorTierFacts, tier: VendorTier): VendorTierGap[] {
  const gap = (key: VendorTierGapKey, have: number, need: number): VendorTierGap => ({
    key,
    have,
    need,
    met: have >= need,
  });
  return [
    gap("profile", facts.profile_milestones, tier.requires.min_profile_milestones),
    gap("reviews", facts.reviews, tier.requires.min_reviews),
    gap("points", facts.points, tier.min_points),
  ].filter((g) => g.need > 0);
}

/** Whether a vendor holds a rung: the point floor AND every requirement. */
export function meetsTier(facts: VendorTierFacts, tier: VendorTier): boolean {
  return (
    facts.points >= tier.min_points &&
    facts.reviews >= tier.requires.min_reviews &&
    facts.profile_milestones >= tier.requires.min_profile_milestones
  );
}

/** The tier a vendor holds. Never returns undefined: `blue` demands nothing and
 *  is the floor.
 *
 *  Walks UP and stops at the first rung that fails, rather than taking the
 *  highest rung that happens to pass. Every requirement in VENDOR_TIERS is
 *  non-decreasing (asserted in the suite), so the two readings agree today, and
 *  stopping at the first failure is the one that stays honest if a later edit
 *  makes some rung's demand dip: a vendor must never skip a rung they do not
 *  hold to land on one they do. */
export function vendorTierFor(facts: VendorTierFacts): VendorTier {
  let current = VENDOR_TIERS[0] as VendorTier;
  for (const tier of VENDOR_TIERS) {
    if (!meetsTier(facts, tier)) break;
    current = tier;
  }
  return current;
}

/** The next tier up, or null at the top. */
export function vendorNextTierFor(facts: VendorTierFacts): VendorTier | null {
  const held = vendorTierFor(facts);
  const i = VENDOR_TIERS.findIndex((t) => t.key === held.key);
  return VENDOR_TIERS[i + 1] ?? null;
}

export function perksForTier(key: VendorTierKey): VendorTierPerks {
  return (VENDOR_TIERS.find((t) => t.key === key) ?? VENDOR_TIERS[0])?.perks as VendorTierPerks;
}

/** 0..1 progress from the held rung to the next one. Returns 1 at the top tier
 *  so a ring renders full rather than empty.
 *
 *  It is the MINIMUM of the per-requirement fractions, not the points fraction:
 *  a ring reading 95% for a vendor who is four reviews short would be the same
 *  lie the old points-only Gold was, moved into the progress arc. The arc shows
 *  the requirement that is actually holding them back. */
export function vendorTierProgress(facts: VendorTierFacts): number {
  const current = vendorTierFor(facts);
  const next = vendorNextTierFor(facts);
  if (!next) return 1;
  const frac = (have: number, from: number, to: number) => {
    const span = to - from;
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, (have - from) / span));
  };
  return Math.min(
    frac(facts.points, current.min_points, next.min_points),
    frac(facts.reviews, current.requires.min_reviews, next.requires.min_reviews),
    frac(
      facts.profile_milestones,
      current.requires.min_profile_milestones,
      next.requires.min_profile_milestones,
    ),
  );
}

// ── DTO ────────────────────────────────────────────────────────────────────

/** One ledger row as the vendor sees it. */
export interface VendorPointsEntry {
  id: number;
  event_type: VendorPointsEvent;
  points: number;
  created_at: number;
}

/** Where a vendor stands among the other vendors in their own category.
 *
 *  Derived, like everything else here, and deliberately NOT a stored standing:
 *  a leaderboard row that outlives the points it was computed from is a
 *  leaderboard that lies the moment somebody else earns a point. */
export interface VendorCategoryRank {
  /** The category ranked in, as a SupplierCategory key. The label is the
   *  frontend's job (`suppliers.cat.<key>`), so the rank travels in every
   *  locale without the API picking one. */
  category: string;
  /** 1-based place. Ties SHARE it: two vendors on 40 points are both third,
   *  and the next one down is fifth. Breaking a tie on an arbitrary column
   *  would tell one of them they are behind for a reason they can't act on. */
  rank: number;
  /** Vendors in the pool, this one included. */
  total: number;
  /** Points that would draw level with the vendor immediately above (which is
   *  enough to share their place). null at the top of the category. */
  points_to_climb: number | null;
}

/** `GET /api/vendor/points`. Everything here is derived from the ledger at read
 *  time; no field is stored. */
export interface VendorPointsStatus {
  points: number;
  /** The three facts the tier is checked against, `points` included so the
   *  object stands on its own. Shipped rather than kept server-side because the
   *  tier table is shared: the UI calls `vendorTierGaps(facts, tier)` itself and
   *  renders "4 / 5 reviews" from the same rulebook the server graded against,
   *  which is what keeps the ladder and the verdict from drifting apart. */
  facts: VendorTierFacts;
  tier: VendorTierKey;
  perks: VendorTierPerks;
  /** null at the top tier. */
  next_tier: VendorTierKey | null;
  /** Points still needed for `next_tier`; 0 at the top. */
  points_to_next: number;
  /** 0..1, for the progress ring. */
  progress: number;
  /** Most recent ledger entries, newest first: the "how did I earn this" list. */
  recent: VendorPointsEntry[];
  /** Lifetime points per rule. The "how do I earn points" panel shows it beside
   *  each rule, which is what turns a help text into an answer to the question a
   *  vendor actually asks: "where did MY points come from". Every key is
   *  present, zero included, so the UI never branches on undefined. */
  earned_by_event: Record<VendorPointsEvent, number>;
  /** Standing inside the vendor's own category. null when there is nothing to
   *  rank: no listing yet, or a category this vendor is alone in, where
   *  "1st of 1" is a fact about the market and not about the vendor. */
  category_rank: VendorCategoryRank | null;
}
