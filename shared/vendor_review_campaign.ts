// Vendor review-invite campaign contract, shared by the admin console and the
// backend. This campaign is the mirror image of the claim-invite one: it mails
// the CLAIMED listings in the directory (vendors who already run a Weddly
// account) to announce that supplier reviews are now open to anyone, and hands
// each vendor their own public review link to forward to past clients. The ask
// is "collect a few honest 5-star reviews", the pitch is "let your past clients
// vouch for you to couples who don't know you yet".
//
// Deliberate constraints, encoded here so both sides agree:
//   - one mail per ADDRESS per campaign (a vendor account is one recipient),
//     which is why sends are keyed by email
//   - paced by a rolling-24h `daily_cap`, because even warm volume shares the
//     sending reputation that verify + RSVP mail depends on
//   - the reminder fires only when the mail was NEITHER clicked NOR opened after
//     the window. This is stricter than the claim campaign (which gates on
//     clicks alone): an operator explicitly wanted opens to also suppress the
//     nudge, so a vendor who read the mail but didn't act is left alone. Opens
//     are inflated by Apple Mail Privacy Protection and the Gmail image proxy,
//     so this errs toward NOT nudging, which is the safe direction for mail to
//     people we already have a relationship with.

export type VendorReviewCampaignStatus = "paused" | "running" | "done";
export type VendorReviewCampaignSendStatus = "queued" | "sent" | "failed" | "skipped";

/** Default rolling-24h ceiling for a new campaign. */
export const VENDOR_REVIEW_CAMPAIGN_DEFAULT_DAILY_CAP = 50;
export const VENDOR_REVIEW_CAMPAIGN_MAX_DAILY_CAP = 500;

/** How long after the first mail an untouched invite gets one nudge. Exactly
 *  one reminder ever goes out per recipient. The operator asked for 7 days. */
export const VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS = 1000 * 60 * 60 * 24 * 7;

export interface VendorReviewCampaign {
  id: number;
  slug: string;
  status: VendorReviewCampaignStatus;
  daily_cap: number;
  /** ISO alpha-2 segment filter. Null = every country in the directory. */
  country: string | null;
  created_at: number;
  updated_at: number;
}

/** Per-recipient row. `collected` is COMPUTED at read time from whether the
 *  vendor's listing gained a published review after the send, so a review that
 *  came in through any route still counts as this campaign's win. */
export interface VendorReviewCampaignSend {
  id: number;
  vendor_account_id: number;
  listing_id: string;
  listing_name: string;
  email: string;
  locale: "hu" | "en";
  country: string | null;
  review_url: string;
  status: VendorReviewCampaignSendStatus;
  error: string | null;
  sent_at: number | null;
  opened_at: number | null;
  clicked_at: number | null;
  reminder_sent_at: number | null;
  collected: boolean;
}

/** Funnel counters for the admin console. `remaining` is how many eligible
 *  addresses the campaign has not written to yet. */
export interface VendorReviewCampaignStats {
  remaining: number;
  queued: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
  reminded: number;
  /** Sends whose vendor gained at least one new published review after we
   *  wrote to them. The campaign's real success metric. */
  collected: number;
  /** Sends in the last rolling 24h, against `daily_cap`. */
  sent_last_24h: number;
}

/** A candidate recipient the campaign has not written to yet. Powers the
 *  "who would this send to?" preview so an operator can eyeball the segment
 *  before starting a campaign that cannot be unsent. */
export interface VendorReviewCampaignTarget {
  vendor_account_id: number;
  listing_id: string;
  listing_name: string;
  email: string;
  city: string;
  country: string;
  locale: "hu" | "en";
}

/** One country's share of the reachable audience, as a brand-new campaign would
 *  see it. Powers the country picker on the create form. */
export interface VendorReviewCampaignSegment {
  country: string;
  addresses: number;
  locale: "hu" | "en";
}

export interface VendorReviewCampaignSegments {
  /** Addresses across every country. The "All" option. */
  total: number;
  segments: VendorReviewCampaignSegment[];
}

export interface VendorReviewCampaignDetail {
  campaign: VendorReviewCampaign;
  stats: VendorReviewCampaignStats;
}

export interface CreateVendorReviewCampaignInput {
  slug: string;
  daily_cap?: number;
  country?: string | null;
}

export interface UpdateVendorReviewCampaignInput {
  status?: VendorReviewCampaignStatus;
  daily_cap?: number;
}
