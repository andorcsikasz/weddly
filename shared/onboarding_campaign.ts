// Contract for the admin-run onboarding re-engagement campaign: a paced,
// tracked blast to REGISTERED couple accounts that verified their email but
// never onboarded (no workspace). The manual counterpart to the automatic 24h
// + 1-week onboarding drip, so an operator can re-nudge a stale orphan cohort
// the drip already exhausted. Targets are a live query over `users` (synced
// into send rows, not imported from a CSV); conversion = the targeted user now
// has a workspace; one reminder wave is gated on still-not-onboarded.

export type OnboardingCampaignStatus = "paused" | "running" | "done";
export type OnboardingCampaignSendStatus = "queued" | "sent" | "failed" | "skipped";

export const ONBOARDING_CAMPAIGN_DEFAULT_DAILY_CAP = 50;
export const ONBOARDING_CAMPAIGN_MAX_DAILY_CAP = 200;

/** A campaign row. `started_at` is stamped once on first launch and never
 *  overwritten; `ended_at` is set when the campaign retires to 'done' (queue
 *  drained) and cleared if it is re-launched. */
export interface OnboardingCampaign {
  id: number;
  slug: string;
  status: OnboardingCampaignStatus;
  daily_cap: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

/** One targeted user per campaign. `converted` and `reminded` are computed at
 *  read time (a live join to `users` for onboarded-ness; the reminder stamp for
 *  the nudge wave). */
export interface OnboardingCampaignSend {
  id: number;
  user_id: number | null;
  name: string;
  email: string;
  locale: "hu" | "en";
  status: OnboardingCampaignSendStatus;
  error: string | null;
  sent_at: number | null;
  /** Tracking pixel on either wave. Inflated upward by Apple MPP + the Gmail
   *  image proxy. */
  opened_at: number | null;
  /** Click redirect on either wave. The trustworthy signal of the two. */
  clicked_at: number | null;
  reminded: boolean;
  converted: boolean; // the targeted user now has a workspace
  created_at: number;
}

export interface OnboardingCampaignStats {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  reminded: number; // send rows that also got the reminder wave
  /** Pixel loads. A ceiling, not a readership number. */
  opened: number;
  /** Click-redirect hits, across both the initial nudge and the reminder. */
  clicked: number;
  hu: number;
  en: number;
  converted: number; // targeted users who have since onboarded
  sent_last_24h: number;
  /** Orphan accounts currently eligible but NOT yet in this campaign, i.e. how
   *  many a "Sync" would add right now. Lets the console show the queue that a
   *  sync would pull in before sending. */
  eligible_unsynced: number;
}

export interface OnboardingCampaignDetail {
  campaign: OnboardingCampaign;
  stats: OnboardingCampaignStats;
}

/** Result of syncing the current orphan segment into a campaign's send rows. */
export interface OnboardingCampaignSyncResult {
  added: number;
  skipped_optout: number;
  skipped_existing: number;
  eligible_total: number; // orphans matched by the segment query this sync
}

// Loose input shapes — validated server-side (no runtime validator in this repo).
export interface CreateOnboardingCampaignInput {
  slug?: unknown;
  daily_cap?: unknown;
}
export interface UpdateOnboardingCampaignInput {
  status?: unknown;
  daily_cap?: unknown;
}
