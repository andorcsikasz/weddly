// Vendor claim-invite campaign contract, shared by the admin console and the
// backend. The campaign mails the UNCLAIMED listings in the directory and asks
// their owner to take the profile over; the CTA carries a pre-minted
// listing_claims token, so one click lands them on the claim form instead of
// the "type your email and wait" start step.
//
// Deliberate constraints, encoded here so both sides agree:
//   - one mail per ADDRESS per campaign (a vendor with three listings is one
//     recipient), which is why sends are keyed by email, not listing_id
//   - paced by a rolling-24h `daily_cap`, because cold volume burns the same
//     sending reputation that verify + RSVP mail depends on
//   - the reminder fires on NOT CLICKED, not on NOT OPENED: Apple Mail Privacy
//     Protection and the Gmail image proxy pre-fetch the pixel, so "opened" is
//     inflated and would silently suppress reminders to people who never read
//     the mail. Opens are still recorded, they just don't gate anything.

import type { VendorOffer } from "./vendor_billing";
import type { UiLocale } from "./locales";

export type VendorCampaignStatus = "paused" | "running" | "done";
export type VendorCampaignSendStatus = "queued" | "sent" | "failed" | "skipped";

/** Default rolling-24h ceiling for a new campaign. Chosen for deliverability,
 *  not throughput: ~300 addresses spread over roughly a week. */
export const VENDOR_CAMPAIGN_DEFAULT_DAILY_CAP = 50;
export const VENDOR_CAMPAIGN_MAX_DAILY_CAP = 500;

/** How long after the first mail an unclicked invite gets one nudge. Exactly
 *  one reminder ever goes out per recipient. */
export const VENDOR_CAMPAIGN_REMINDER_AFTER_MS = 1000 * 60 * 60 * 24 * 2;

/** Monthly visitor figure quoted in the invite copy. Lives here so the number
 *  is edited in ONE place when traffic moves, rather than in four translated
 *  strings. Phrased as a floor ("several thousand") in the copy itself. */
export const VENDOR_CAMPAIGN_MONTHLY_VISITORS = 3000;

export interface VendorCampaign {
  id: number;
  slug: string;
  status: VendorCampaignStatus;
  daily_cap: number;
  /** ISO alpha-2 segment filter. Null = every country in the directory. */
  country: string | null;
  created_at: number;
  updated_at: number;
  /** When the campaign first went Running (the launch). Null until launched;
   *  never overwritten on a later re-launch. */
  started_at: number | null;
  /** When the campaign retired to Done (all targets written to, or set by the
   *  operator). Null while it can still send. */
  ended_at: number | null;
}

/** Per-recipient row. `claimed` is COMPUTED at read time from the listing's
 *  current ownership rather than stored, so a vendor who claimed through any
 *  other route still shows as converted. */
export interface VendorCampaignSend {
  id: number;
  listing_id: string;
  listing_name: string;
  email: string;
  locale: UiLocale;
  country: string | null;
  category: string;
  status: VendorCampaignSendStatus;
  error: string | null;
  sent_at: number | null;
  opened_at: number | null;
  clicked_at: number | null;
  reminder_sent_at: number | null;
  claimed: boolean;
}

/** Funnel counters for the admin console. `remaining` is how many eligible
 *  addresses the campaign has not written to yet. */
export interface VendorCampaignStats {
  remaining: number;
  queued: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
  reminded: number;
  claimed: number;
  /** Sends in the last rolling 24h, against `daily_cap`. */
  sent_last_24h: number;
}

/** A candidate recipient the campaign has not written to yet. Powers the
 *  "who would this send to?" preview, so an operator can eyeball the segment
 *  before starting a campaign that cannot be unsent. */
export interface VendorCampaignTarget {
  listing_id: string;
  listing_name: string;
  email: string;
  category: string;
  city: string;
  country: string;
  locale: UiLocale;
  /** Whether a Weddly user really did put this business forward, i.e. a
   *  community row a couple submitted. The invite's opening sentence branches
   *  on it, and it rides on the TARGET rather than being re-derived in the
   *  mailer so the operator's preview and the mail that goes out cannot tell
   *  two different stories about where a listing came from. */
  suggested_by_user: boolean;
}

/** One country's share of the reachable audience, as a brand-new campaign would
 *  see it. Powers the country picker on the create form so an operator chooses
 *  from real options with real counts instead of typing an ISO code blind. */
export interface VendorCampaignSegment {
  country: string;
  addresses: number;
  locale: UiLocale;
}

export interface VendorCampaignSegments {
  /** Addresses across every country. The "Mind" option. */
  total: number;
  segments: VendorCampaignSegment[];
}

export interface VendorCampaignDetail {
  campaign: VendorCampaign;
  stats: VendorCampaignStats;
  /** The free window a vendor claiming right now would receive. The invite copy
   *  quotes it, so the console shows the operator exactly what is being promised. */
  offer: VendorOffer;
}

export interface CreateVendorCampaignInput {
  slug: string;
  daily_cap?: number;
  country?: string | null;
}

export interface UpdateVendorCampaignInput {
  status?: VendorCampaignStatus;
  daily_cap?: number;
}
