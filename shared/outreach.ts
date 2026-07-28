// Supplier Outreach Inbox — Q3 (P2.E). The couple picks suppliers from
// their shortlist (`couple_picks` etc.) and Weddly sends a localised mail
// per supplier. Each mail carries the couple's email as Reply-To so the
// vendor replies directly to them; the in-app "inbox" shows the sent
// state of every campaign. The Resend inbound webhook + reply archival
// land in v1.5 — for now the couple manages threads in their own email
// client and uses /app/outreach as a send + sent-history surface.

export type OutreachMessageStatus = "queued" | "sent" | "bounced" | "replied";

export interface OutreachMessage {
  id: number;
  campaign_id: number;
  /** Public id from the suppliers directory — curated slug, `c{N}` for
   *  community, `v{N}` for claimed. Same shape as `couple_picks.supplier_id`. */
  supplier_id: string;
  /** Cached supplier name as it was when the campaign was sent. Lets the
   *  in-app thread render even if the supplier's listing is later renamed
   *  or hidden from the directory. */
  supplier_name: string;
  supplier_email: string;
  sent_at: number | null;
  status: OutreachMessageStatus;
  /** Per-message UNIQUE token. Embedded in the Reply-To address (v1.5)
   *  so an inbound webhook can route the vendor's reply back to the
   *  campaign + couple. v1 doesn't yet consume this — the token is
   *  reserved so v1.5 can ship without a schema migration. */
  reply_token: string;
  created_at: number;
}

export interface OutreachReply {
  id: number;
  message_id: number;
  from_email: string;
  body: string;
  received_at: number;
}

export interface OutreachCampaign {
  id: number;
  couple_id: number;
  subject: string;
  body_template: string;
  created_at: number;
  /** Denormalised count of messages on this campaign, computed by the
   *  list/detail mappers so the index view doesn't need a join per row. */
  message_count: number;
}

export interface OutreachCampaignDetail extends OutreachCampaign {
  messages: OutreachMessage[];
  replies: OutreachReply[];
}

/** Input shape for `POST /api/outreach/campaigns`. Subject + body are
 *  free text the couple composes; `supplier_ids` references the public
 *  ids on the suppliers directory cards. */
export interface CreateOutreachCampaignInput {
  subject: string;
  body_template: string;
  supplier_ids: string[];
}

// ─── v1 limits — also enforced by the route ───────────────────────────────

/** Max suppliers in a single campaign. Keeps the couple from accidentally
 *  spamming half the directory; the rate limit + the per-supplier throttle
 *  cap the longer-term volume. */
export const OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP = 5;

/** Soft cap on RECIPIENTS (not campaigns) per couple per rolling 7-day
 *  window. Hits a 429 with `code: "campaign_rate_limited"` when the batch
 *  would push the couple past it.
 *
 *  This used to count campaigns, capped at 3 — which was the wrong unit and
 *  bit real couples. The supplier detail page's "Send inquiry" CTA opens the
 *  composer with ONE vendor attached, so the natural way to use the product
 *  (message vendors one at a time as you find them) burned a whole campaign
 *  per vendor and hit the wall on the 4th. Meanwhile a couple who batched 5
 *  recipients per campaign was allowed 15 mails on the same budget. Counting
 *  what we actually send makes the limit mean the same thing either way, and
 *  20/week comfortably covers a real shopping week while still bounding what
 *  one workspace can do to our sending reputation. */
export const OUTREACH_MESSAGES_PER_WEEK_CAP = 20;

export const OUTREACH_SUBJECT_MAX_LEN = 200;
export const OUTREACH_BODY_MAX_LEN = 5000;
