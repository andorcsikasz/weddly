// Growth instrumentation contract — feeds the founder's 60-day commitment
// metric ("≥40% couples publish /w/<slug>, ≥15% new signup via microsite
// referrer"). Decided via multi-agent debate 2026-05-21 (path D synthesis):
// instrument the existing surfaces BEFORE shipping new features so the
// microsite metric has a baseline to compare against.

/**
 * Allowlist of event kinds we track. Each is recorded server-side EXCEPT
 * the share-link copy event, which is a frontend-only signal pinged through
 * `POST /api/growth/event`. Keep this list tight — every new kind is a
 * commitment to add a column to the admin growth dashboard.
 */
export type GrowthEventKind =
  /** Guest opened the /rsvp/<slug>/<code> landing — the main viral surface
   *  today. Recorded by the rsvp.lookup handler when it returns 200. */
  | "rsvp.page.view"
  /** Guest household submitted RSVPs (yes/no/maybe + meal). Recorded by
   *  the rsvp.checkin handler on success. payload carries the response
   *  count breakdown. */
  | "rsvp.submitted"
  /** Guest viewed the post-RSVP "for guests" bundle (schedule, location,
   *  household members). Strong signal of return-visit intent. */
  | "guest.portal.view"
  /** Couple clicked "copy share link" in the in-app RSVP / share UI.
   *  Frontend-only ping — answers "do couples actually share Weddly?". */
  | "rsvp.share_link.copied"
  /** Brand-new signup whose `Referer` header points at a `/rsvp/*` URL.
   *  Direct readout of the "guests convert to new couples" hypothesis.
   *  Legacy — superseded by `signup.from_referrer` below; both fire while
   *  the frontend rolls out the explicit `?ref` param across CTAs. */
  | "signup.from_rsvp_referrer"
  /** Brand-new signup that carried an explicit `?ref=<source>` query
   *  param from a public Weddly surface — `rsvp`, `site`, or `share`.
   *  `payload.referrer` holds the allow-listed source, not a raw URL. */
  | "signup.from_referrer"
  /** Every POST /api/auth/register that parked a pending signup — i.e. someone
   *  filled in the form and we mailed them a link. `user_id` is always NULL:
   *  no account exists at this point (see domain/pending_signups.ts).
   *  Pairs with signup.completed to read verify drop-off:
   *  1 - completed / started = % who never clicked the link. */
  | "signup.started"
  /** An account actually came into existence — the verify link was clicked and
   *  the pending signup was promoted. Fires at VERIFY, not register: before
   *  that there is no user to attribute. Pairs with signup.from_referrer to
   *  compute attribution rate: attributed / total = % of signups we can source. */
  | "signup.completed"
  /** Couple workspace created via POST /api/couples/onboard. Distinct
   *  from signup.completed because there's a gap (verify-email, optional
   *  drop-off) between the two; the funnel needs both to compute
   *  signup → activation conversion. */
  | "couple.created"
  /** Public wedding website at /w/:slug was fetched. Same shape as
   *  guest.portal.view but for the cover-letter URL the couple shares
   *  on social. `payload.couple_id` carries the workspace; the slug
   *  itself is not duplicated into payload (it's the URL). */
  | "wedding_site.view"
  /** Couple started the payment process — a Stripe Checkout session was
   *  minted for them via POST /api/billing/checkout (they're about to be
   *  redirected to Stripe). Top of the paid-conversion funnel: lets the
   *  admin see how many couples reached the pay screen vs. converted. */
  | "checkout.started";

export interface GrowthEvent {
  id: number;
  kind: GrowthEventKind;
  /** Null for pre-auth events (anonymous guest on /rsvp/*). */
  couple_id: number | null;
  user_id: number | null;
  household_id: number | null;
  /** HTTP Referer, truncated to 500 chars; null when absent. */
  referrer: string | null;
  /** 16-hex SHA-256 prefix of the user-agent string. Lets us dedupe
   *  same-user repeat hits without storing the raw UA (privacy). */
  user_agent_hash: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
}

/** Body shape for the frontend ping endpoint. Server validates `kind` is
 *  in the frontend-eligible allowlist. */
export interface RecordGrowthEventInput {
  kind: GrowthEventKind;
  payload?: Record<string, unknown>;
}

/** Only these kinds may originate from the browser. Server-side hooks
 *  cover the rest. Keeps drive-by spam from filling the table with fake
 *  RSVP-view counts. */
export const FRONTEND_GROWTH_EVENT_KINDS: ReadonlySet<GrowthEventKind> = new Set([
  "rsvp.share_link.copied",
]);

/** Admin-dashboard aggregate row. Powered by a single GROUP BY query per
 *  kind across (total, last_24h, last_7d) windows. */
export interface GrowthEventAggregate {
  kind: GrowthEventKind;
  total: number;
  last_24h: number;
  last_7d: number;
  last_event_at: number | null;
}
