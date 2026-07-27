// Contract for the campaign PLAN: the standing recipes that keep the outreach
// consoles stocked without an operator having to remember they exist.
//
// The four campaign families already know how to target, pace and track. What
// they lacked was the decision "is it worth running one right now, and when is
// the next one due" — which in practice meant nothing ran, because composing a
// campaign is five fields and a judgement call. A schedule answers that once:
// every `interval_days` the worker builds the next campaign of its kind, PAUSED,
// with its targets resolved, and the operator only has to press Run. Turning
// `auto_start` on removes even that step.
//
// Deliberately NOT a generic cron: the knobs are the two an operator actually
// changes (does it repeat, and how often), plus the daily cap the send pacing
// already understands. Segment filters, copy and reminder gates stay in the
// per-kind consoles where they belong.

/** Which campaign family a schedule composes.
 *
 *  The personal-invite family is absent on purpose: its audience is a CSV of
 *  the founder's own contacts, so there is no live segment to re-query and
 *  "prepare the next one automatically" has no meaning. It stays manual. */
export const CAMPAIGN_SCHEDULE_KINDS = ["vendor_claim", "vendor_review", "onboarding"] as const;
export type CampaignScheduleKind = (typeof CAMPAIGN_SCHEDULE_KINDS)[number];

export const CAMPAIGN_SCHEDULE_MAX_INTERVAL_DAYS = 365;
export const CAMPAIGN_SCHEDULE_MAX_DAILY_CAP = 200;

/** The fixed part of a recipe: what the schedule was born with, and the two
 *  safety rails that are NOT operator knobs.
 *
 *  `cooldown_days` is what makes a repeating campaign safe. Every family's
 *  targeting only excludes addresses THIS campaign already wrote to, so a
 *  second campaign of the same kind would otherwise re-mail everyone who
 *  ignored the first one. The scheduler suppresses any address the same family
 *  mailed inside this window, so "repeat" means "reach the people we haven't
 *  reached", not "send it all again".
 *
 *  `min_targets` stops a schedule from minting a campaign for four addresses —
 *  it just waits for the next tick instead, and the queue keeps growing. */
export interface CampaignScheduleRecipe {
  kind: CampaignScheduleKind;
  /** Slug stem; the scheduler appends the date, e.g. `reviews-2026-08-14`. */
  slug_prefix: string;
  interval_days: number;
  daily_cap: number;
  cooldown_days: number;
  min_targets: number;
}

export const CAMPAIGN_SCHEDULE_RECIPES: Record<CampaignScheduleKind, CampaignScheduleRecipe> = {
  // The directory keeps growing (curation + community suggestions), so there is
  // a fresh cohort of unclaimed listings every month. Cold mail to a business
  // that ignored us twice is how a domain earns a spam reputation, hence the
  // long cooldown: half a year before the same address hears from us again.
  vendor_claim: {
    kind: "vendor_claim",
    slug_prefix: "claim-invite",
    interval_days: 30,
    daily_cap: 50,
    cooldown_days: 180,
    min_targets: 10,
  },
  // Warm audience (they run a Weddly account), so a quarterly "go collect a few
  // reviews" is welcome rather than intrusive, and every new claimed vendor is
  // a target the day they finish onboarding.
  vendor_review: {
    kind: "vendor_review",
    slug_prefix: "reviews",
    interval_days: 90,
    daily_cap: 50,
    cooldown_days: 120,
    min_targets: 5,
  },
  // Orphans (verified, never onboarded) accumulate continuously and go cold
  // fast, so this is the tightest loop of the three. The automatic 24h + 1-week
  // drip fires once per account forever; this is what reaches the ones it has
  // already spent.
  onboarding: {
    kind: "onboarding",
    slug_prefix: "reengage",
    interval_days: 21,
    daily_cap: 50,
    cooldown_days: 60,
    min_targets: 5,
  },
};

/** A stored schedule. `enabled` is the "repeat" switch; turning it off leaves
 *  any already-prepared campaign alone (it is still yours to run) and only
 *  stops the next one from being built. */
export interface CampaignSchedule {
  id: number;
  kind: CampaignScheduleKind;
  enabled: boolean;
  interval_days: number;
  daily_cap: number;
  /** Start the prepared campaign immediately instead of leaving it paused. */
  auto_start: boolean;
  last_prepared_at: number | null;
  next_due_at: number;
  last_campaign_id: number | null;
  created_at: number;
  updated_at: number;
}

/** The campaign a schedule most recently built, as the plan view needs it. */
export interface CampaignSchedulePrepared {
  id: number;
  slug: string;
  status: "paused" | "running" | "done";
  /** Addresses this campaign can still write to right now. */
  remaining: number;
  sent: number;
  created_at: number;
  started_at: number | null;
}

export interface CampaignScheduleView {
  schedule: CampaignSchedule;
  recipe: CampaignScheduleRecipe;
  /** Addresses a campaign built right now would reach, cooldown applied. */
  reach: number;
  /** Suppressed by the cooldown window, i.e. eligible but mailed too recently. */
  cooling_down: number;
  prepared: CampaignSchedulePrepared | null;
}

export interface CampaignPlanView {
  items: CampaignScheduleView[];
}

// Loose input shape — validated server-side (no runtime validator in this repo).
export interface UpdateCampaignScheduleInput {
  enabled?: unknown;
  interval_days?: unknown;
  daily_cap?: unknown;
  auto_start?: unknown;
}

/** Milliseconds in a day, so both sides do the due-date arithmetic the same. */
export const CAMPAIGN_SCHEDULE_DAY_MS = 86_400_000;
