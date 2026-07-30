// Weddly Points, planner side: the tier + reputation currency for
// `user_type='planner'` accounts.
//
// This is the planner twin of `shared/vendor_points.ts` and it deliberately
// keeps that file's four design rules, because they are what make a points
// system survive contact with the people it scores:
//
//   1. The LEDGER is the truth. `planner_points_ledger` is append-only; the
//      total, the tier and the standing are DERIVED by replaying it. No mutable
//      counter on `users`, because a counter drifts and a drifted gamification
//      total is unfixable without an audit trail nobody kept.
//   2. NOTHING is awarded for a star VALUE. Collecting a review earns points;
//      whether it was 5 stars or 3 changes nothing. Paying for good ratings is
//      how a marketplace buys itself a fake reputation.
//   3. Tiers are config, not scattered ifs, and a perk is only a perk if some
//      code ENFORCES it. That is why the planner perk table has two fields and
//      not five: the directory sort reads `directory_boost`, the directory card
//      reads `profile_badge`, and there is nothing else a planner tier can
//      currently promise without lying.
//   4. Everything repeatable is CAPPED. The cheapest attack on a points system
//      is doing the cheap thing a thousand times.
//
// The tier NAMES are shared vocabulary with the vendor ladder (Blue, Gold,
// Platinum, Black) and render through the same `TierBadge` component and the
// same `vendor.points.tier.*` copy. A planner and a vendor holding Gold hold
// the same rung of the same idea; only what the rung pays differs, and that
// lives in the perk table below.

import type { PlannerProfileChecklist } from "./types";

/** Every event the planner points engine understands. The string is persisted
 *  in the ledger, so renaming one is a data migration, not a refactor. */
export type PlannerPointsEvent =
  /** A public-profile milestone crossed (business name, city, bio, styles,
   *  photo, package, availability). Scored in 25% steps. */
  | "profile_completeness"
  /** The planner collected a review. Value-blind by rule 2. */
  | "review_collected"
  /** The FIRST review on the profile, once ever: the hardest one to get. */
  | "first_review"
  /** A couple accepted the planner link. This is the planner's equivalent of a
   *  confirmed booking and the most valuable repeatable rule here: the consent
   *  handshake means both sides agreed inside the product, which is a stronger
   *  proof of real work than anything self-reported. */
  | "client_linked"
  /** A couple the planner invited by email signed up and onboarded. Distinct
   *  from `client_linked` on purpose: bringing a NEW couple to Weddly is worth
   *  paying for separately from linking one who was already here, and an
   *  invited couple who accepts fires both. */
  | "couple_invited"
  /** Manual admin correction. Can be negative; never emitted by the engine. */
  | "admin_adjustment";

/** Points per event. Coarse round numbers on purpose: this is a progress bar,
 *  not an accounting system, and fine-grained values invite fine-grained
 *  arguments about fairness. */
export const PLANNER_POINTS_BY_EVENT: Record<PlannerPointsEvent, number> = {
  profile_completeness: 10,
  first_review: 50,
  review_collected: 15,
  client_linked: 60,
  couple_invited: 40,
  admin_adjustment: 0,
};

/** The rules a planner can actually go and DO, in the order the "how do I earn
 *  points" panel lists them: cheapest and most controllable first.
 *
 *  Deliberately not the full event list. `admin_adjustment` is a correction,
 *  not an action, and advertising a way to earn that the product does not offer
 *  is worse than a shorter list. */
export const PLANNER_EARNABLE_EVENTS = [
  "profile_completeness",
  "first_review",
  "review_collected",
  "client_linked",
  "couple_invited",
] as const satisfies readonly PlannerPointsEvent[];

/** Profile completeness is scored in 25% steps, so a planner earns four times
 *  on the way to a finished profile instead of once at the very end. */
export const PLANNER_PROFILE_MILESTONES = [25, 50, 75, 100] as const;

// -- Caps ------------------------------------------------------------------
// Every repeatable rule has a ceiling, evaluated against the ledger itself, so
// a replay of the engine can never launder past one.

/** Review-collection points per calendar month. A busy planner runs maybe two
 *  or three weddings a month; ten reviews in thirty days is a farm. */
export const MAX_PLANNER_REVIEW_POINTS_PER_MONTH = 10 * 15;
/** Accepted-client points per calendar month. This is the most valuable rule in
 *  the table, so it is also the most worth faking: a planner with a friendly
 *  couple account could link all afternoon. Six a month is more new clients
 *  than a full-service planner actually takes. */
export const MAX_PLANNER_CLIENT_POINTS_PER_MONTH = 6 * 60;
/** Invited-couple points per calendar month. Generous enough that an honest
 *  planner onboarding their existing book of clients never notices it. */
export const MAX_PLANNER_INVITE_POINTS_PER_MONTH = 5 * 40;

// -- Tiers -----------------------------------------------------------------

/** Shared tier vocabulary with the vendor ladder. Structurally identical to
 *  `VendorTierKey`, which is what lets `TierBadge` render both without knowing
 *  which side it is drawing. */
export type PlannerTierKey = "blue" | "gold" | "platinum" | "black";

/** What a planner tier actually GIVES. Both fields are enforced by real code
 *  (the directory ORDER BY and the directory card); adding a cosmetic-only
 *  field here is how a tier system becomes a sticker. */
export interface PlannerTierPerks {
  /** Ranking nudge in the couple-facing planner directory. Applied ABOVE
   *  profile richness but BELOW the admin `verified` flag, so points can never
   *  outrank a human's trust decision. */
  directory_boost: number;
  /** Tier badge rendered on the directory card and the profile a couple opens. */
  profile_badge: boolean;
}

export interface PlannerTier {
  key: PlannerTierKey;
  min_points: number;
  perks: PlannerTierPerks;
}

/** Ascending by min_points. `blue` is the entry tier every planner starts in,
 *  so its threshold must stay 0: `plannerTierForPoints` relies on it as the
 *  floor.
 *
 *  THE THRESHOLDS ARE A TIMELINE, not round numbers picked for looks, and they
 *  match the vendor ladder because the planner earning rate works out close
 *  enough that a second set of numbers would be a second thing to explain.
 *
 *  A working planner earns a one-time 90 (40 for finishing the profile, 50 for
 *  a first review), then roughly one accepted client and one review a month,
 *  which is 75 a month. That gives:
 *
 *    Gold      150   month 1     finish the profile, land a first review
 *    Platinum  600   month ~7    a season of real clients
 *    Black    1500   month ~19   two wedding seasons
 *
 *  A planner who logs in twice a year never reaches Black, which is the point:
 *  the top rung exists to be reached inside two years, not admired from below
 *  forever. */
export const PLANNER_TIERS: readonly PlannerTier[] = [
  {
    key: "blue",
    min_points: 0,
    perks: { directory_boost: 0, profile_badge: false },
  },
  {
    key: "gold",
    min_points: 150,
    perks: { directory_boost: 1, profile_badge: true },
  },
  {
    key: "platinum",
    min_points: 600,
    perks: { directory_boost: 2, profile_badge: true },
  },
  {
    key: "black",
    min_points: 1500,
    perks: { directory_boost: 3, profile_badge: true },
  },
] as const;

/** The tier a total lands in. Never returns undefined: `blue` is the floor. */
export function plannerTierForPoints(points: number): PlannerTier {
  let current = PLANNER_TIERS[0] as PlannerTier;
  for (const tier of PLANNER_TIERS) {
    if (points >= tier.min_points) current = tier;
  }
  return current;
}

/** The next tier up, or null at the top. */
export function plannerNextTierForPoints(points: number): PlannerTier | null {
  for (const tier of PLANNER_TIERS) {
    if (points < tier.min_points) return tier;
  }
  return null;
}

export function plannerPerksForTier(key: PlannerTierKey): PlannerTierPerks {
  return (PLANNER_TIERS.find((t) => t.key === key) ?? PLANNER_TIERS[0])?.perks as PlannerTierPerks;
}

/** 0..1 progress from the current tier's floor to the next tier's. Returns 1 at
 *  the top tier so a ring renders full rather than empty. */
export function plannerTierProgress(points: number): number {
  const current = plannerTierForPoints(points);
  const next = plannerNextTierForPoints(points);
  if (!next) return 1;
  const span = next.min_points - current.min_points;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - current.min_points) / span));
}

// -- Setup checklist -------------------------------------------------------

/** The public-profile steps, in the order a planner should work through them:
 *  the identity fields a couple filters and reads by, then the three showcase
 *  sections that only render when they have content.
 *
 *  The key doubles as the i18n suffix (`planner_setup.step_<key>`) and as the
 *  field the settings page focuses when the row is clicked, so adding a step
 *  means adding a locale string and nothing else.
 *
 *  Single-sourced here so the settings ring, the dashboard nudge and the
 *  server's profile-completeness milestones can never drift apart. */
export const PLANNER_CHECKLIST_STEPS = [
  "business_name",
  "city",
  "bio",
  "styles",
  "has_photo",
  "has_package",
  "has_availability",
] as const satisfies readonly (keyof PlannerProfileChecklist)[];

export type PlannerChecklistStep = (typeof PLANNER_CHECKLIST_STEPS)[number];

/** Percentage of the checklist done, rounded to the integer. The one function
 *  the ring, the copy and the points engine all call, which is what keeps "you
 *  are 71% done" and "you crossed 50%, here are 10 points" telling one story. */
export function plannerChecklistCompleteness(checklist: PlannerProfileChecklist): number {
  const done = PLANNER_CHECKLIST_STEPS.filter((step) => checklist[step]).length;
  return Math.round((done / PLANNER_CHECKLIST_STEPS.length) * 100);
}

// -- DTO -------------------------------------------------------------------

/** One ledger row as the planner sees it. */
export interface PlannerPointsEntry {
  id: number;
  event_type: PlannerPointsEvent;
  points: number;
  created_at: number;
}

/** Where a planner stands among the other planners a couple can actually find.
 *
 *  Derived, like everything else here, and deliberately NOT a stored standing:
 *  a leaderboard row that outlives the points it was computed from is a
 *  leaderboard that lies the moment somebody else earns a point. */
export interface PlannerRank {
  /** ISO country code the pool is scoped to, or null when the planner has no
   *  country set and the pool is the whole directory. A planner in Hungary
   *  competing against every planner in Europe learns nothing; a planner who
   *  never said where they work cannot be scoped, so they are ranked globally
   *  rather than dropped. */
  country: string | null;
  /** 1-based place. Ties SHARE it: two planners on 40 points are both third,
   *  and the next one down is fifth. Breaking a tie on an arbitrary column
   *  would tell one of them they are behind for a reason they cannot act on. */
  rank: number;
  /** Planners in the pool, this one included. */
  total: number;
  /** Points that would draw level with the planner immediately above (which is
   *  enough to share their place). null at the top of the pool. */
  points_to_climb: number | null;
}

/** `GET /api/planner/points`. Every field is derived from the ledger at read
 *  time; nothing here is stored. */
export interface PlannerPointsStatus {
  points: number;
  tier: PlannerTierKey;
  perks: PlannerTierPerks;
  /** null at the top tier. */
  next_tier: PlannerTierKey | null;
  /** Points still needed for `next_tier`; 0 at the top. */
  points_to_next: number;
  /** 0..1, for the progress ring. */
  progress: number;
  /** Most recent ledger entries, newest first: the "how did I earn this" list. */
  recent: PlannerPointsEntry[];
  /** Lifetime points per rule. Every key is present, zero included, so the UI
   *  never branches on undefined. */
  earned_by_event: Record<PlannerPointsEvent, number>;
  /** Standing in the directory pool. null when the ranking would say nothing:
   *  a profile no couple can find yet, or a pool of one, where "1st of 1" is a
   *  fact about the market and not about the planner. */
  rank: PlannerRank | null;
}
