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
  /** A couple who already booked this vendor confirmed another booking. */
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
  repeat_booking: 40,
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
  "repeat_booking",
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

// ── Tiers ──────────────────────────────────────────────────────────────────

export type VendorTierKey = "blue" | "gold" | "platinum" | "diamond";

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

export interface VendorTier {
  key: VendorTierKey;
  min_points: number;
  perks: VendorTierPerks;
}

/** Ascending by min_points. `blue` is the entry tier every vendor starts in, so
 *  its threshold must stay 0: `tierForPoints` relies on it as the floor. */
export const VENDOR_TIERS: readonly VendorTier[] = [
  {
    key: "blue",
    min_points: 0,
    perks: {
      search_boost: 0,
      extra_lead_credits: 0,
      subscription_discount_pct: 0,
      profile_badge: false,
    },
  },
  {
    key: "gold",
    min_points: 250,
    perks: {
      search_boost: 1,
      extra_lead_credits: 1,
      subscription_discount_pct: 0,
      profile_badge: true,
    },
  },
  {
    key: "platinum",
    min_points: 750,
    perks: {
      search_boost: 2,
      extra_lead_credits: 3,
      subscription_discount_pct: 10,
      profile_badge: true,
    },
  },
  {
    key: "diamond",
    min_points: 2000,
    perks: {
      search_boost: 3,
      extra_lead_credits: 5,
      subscription_discount_pct: 20,
      profile_badge: true,
    },
  },
] as const;

/** The tier a total lands in. Never returns undefined: `blue` is the floor. */
export function tierForPoints(points: number): VendorTier {
  let current = VENDOR_TIERS[0] as VendorTier;
  for (const tier of VENDOR_TIERS) {
    if (points >= tier.min_points) current = tier;
  }
  return current;
}

/** The next tier up, or null at the top. */
export function nextTierForPoints(points: number): VendorTier | null {
  for (const tier of VENDOR_TIERS) {
    if (points < tier.min_points) return tier;
  }
  return null;
}

export function perksForTier(key: VendorTierKey): VendorTierPerks {
  return (VENDOR_TIERS.find((t) => t.key === key) ?? VENDOR_TIERS[0])?.perks as VendorTierPerks;
}

/** 0..1 progress from the current tier's floor to the next tier's. Returns 1 at
 *  the top tier so a ring renders full rather than empty. */
export function tierProgress(points: number): number {
  const current = tierForPoints(points);
  const next = nextTierForPoints(points);
  if (!next) return 1;
  const span = next.min_points - current.min_points;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - current.min_points) / span));
}

// ── DTO ────────────────────────────────────────────────────────────────────

/** One ledger row as the vendor sees it. */
export interface VendorPointsEntry {
  id: number;
  event_type: VendorPointsEvent;
  points: number;
  created_at: number;
}

/** `GET /api/vendor/points`. Everything here is derived from the ledger at read
 *  time; no field is stored. */
export interface VendorPointsStatus {
  points: number;
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
}
