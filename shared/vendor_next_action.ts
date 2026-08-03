// Vendor Next Best Action + the attention queue behind it.
//
// ONE definition of "what should this vendor do about this client, and does it
// need them RIGHT NOW", derived from the facts already on the booking. Both
// answers come out of this module and nowhere else: the clients list draws the
// attention band from it, the client detail draws its primary CTA from it, and
// the copy keys are derived from the returned key rather than written twice.
// Same rule as `listingChecklist` — a second hand-written definition drifts, and
// when it does, two screens tell the vendor different things about the same lead.
//
// Rules worth not re-deriving:
//
//   * NOTHING here is a score. Every verdict is a named rule with a reason the
//     vendor can read ("waiting 14h"), because a lead list that reorders itself
//     by an opaque number is a list the vendor stops trusting. The reason string
//     is not decoration — it IS the feature.
//
//   * The ACTION and the ATTENTION are different questions. Every open client
//     has a next action; only some need attention now. A client whose ball is in
//     the couple's court has the action `await` and no attention at all, and
//     that pair is the honest answer rather than an invented task.
//
//   * ARCHIVED means archived. `declined` / `cancelled` / `expired` never
//     produce an action or an attention row, ever. A vendor who closed a lead is
//     not asking to be reminded about it.
//
//   * A PAST event date is not urgent, it is over. An OPEN inquiry whose date
//     has gone is a lost lead, not a deadline, so it drops out of the queue
//     silently instead of nagging the vendor to tidy up admin that earns nothing.
//     The one thing a past date DOES trigger is on a confirmed booking: ask for
//     the review.
//
//   * PRO-derived rules are omitted on FREE rather than shown locked. The
//     payment schedule is PRO, so `chase_payment` / `payment_overdue` simply do
//     not exist for a FREE vendor — dangling a lock in the one surface whose job
//     is "do not lose this lead" would make the free tier worse at the only
//     thing it promises. The queue ITSELF is free for the same reason.
//
//   * The snooze mutes the ATTENTION BAND ONLY. The Ügyfelek nav badge, the
//     unread-message count and the next action are all untouched by it, so a
//     snoozed lead can go quiet in the queue without going invisible in the app.

import { HOLD_EXPIRING_SOON_HOURS, holdState } from "./date_holds";
import type { UnixMs } from "./types";

/** The single primary action for a client. `await` and `prepare` are the two
 *  "nothing is owed by you right now" verdicts, kept distinct because they mean
 *  different things: one is a lead you are waiting on, the other is a booked
 *  wedding with nothing outstanding. `none` is an archived or finished row. */
export type VendorActionKey =
  | "open"
  | "reply"
  | "follow_up"
  | "await"
  | "record_contract"
  | "add_schedule"
  | "chase_payment"
  /** A live date hold is about to run out. The vendor owes a DECISION, not a
   *  message: give the couple more time, or put the date back on the market. */
  | "release_or_extend"
  | "request_review"
  | "prepare"
  | "none";

/** Why a client is in the attention band. One per client — the first rule that
 *  fires in `ATTENTION_ORDER` wins, so the band never says two things at once. */
export type VendorAttentionKey =
  | "unopened"
  | "unanswered"
  | "hold_expiring"
  | "payment_overdue"
  | "date_soon"
  | "going_cold"
  | "review_due";

/** Most urgent first. Doubles as the severity rank: a key's index is its
 *  position in the band, so ordering and precedence can't disagree.
 *
 *  `hold_expiring` sits third because it is the only rule with a CLIFF: inside
 *  a day a date the vendor took off the market goes back on it, and nothing
 *  runs to tell anyone. An overdue installment is already late and gets no
 *  later; an approaching wedding date arrives whatever the vendor does. Above
 *  it are the two rules about a couple waiting on a human being, which is the
 *  one promise the marketplace makes on the vendor's behalf. */
export const ATTENTION_ORDER: readonly VendorAttentionKey[] = [
  "unopened",
  "unanswered",
  "hold_expiring",
  "payment_overdue",
  "date_soon",
  "going_cold",
  "review_due",
] as const;

/** A couple's message left unanswered this long is a lead at risk. 12h rather
 *  than 24h because the `fast_reply` points rule already tells vendors speed is
 *  the thing, and a queue that agrees with the scoreboard is one story. */
export const REPLY_DUE_HOURS = 12;

/** The vendor answered and the couple went quiet: after this many days it is a
 *  follow-up, not patience. */
export const GOING_COLD_DAYS = 7;

/** An undecided inquiry this close to its own event date needs a verdict. */
export const DATE_SOON_DAYS = 30;

/** Days after the wedding before asking for the review. Not the next morning:
 *  the couple is on a plane, and the vendor's own delivery is usually not out. */
export const REVIEW_DUE_DAYS = 3;

/** Default snooze length when the vendor dismisses an attention row. */
export const SNOOZE_DAYS = 7;

/** Statuses that are still live leads. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["requested", "vendor_seen"]);

/** Statuses the vendor has closed. No action, no attention, no exceptions. */
const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["declined", "cancelled", "expired"]);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Everything the rules need about one client, gathered server-side. Kept flat
 *  and primitive so the derivation is trivially testable without a database. */
export interface VendorClientSignals {
  /** BookingStatus off `supplier_bookings.status`. */
  status: string;
  /** When the inquiry landed. Doubles as the couple's first "message" for any
   *  booking whose ask lives in the legacy `notes` blob rather than a message
   *  row — most of the older rows, and every admin-created one. */
  created_at: UnixMs;
  /** When the vendor first OPENED the inquiry, null while they never have. */
  vendor_seen_at: UnixMs | null;
  /** ISO 'YYYY-MM-DD'. */
  event_date: string;
  /** Newest message FROM the couple, or null when they never wrote. */
  last_couple_message_at: UnixMs | null;
  /** Newest message FROM the vendor, or null when they never replied. */
  last_vendor_message_at: UnixMs | null;
  contract_value: number | null;
  /** How many installments are on the schedule (PRO data; 0 on FREE). */
  payment_count: number;
  /** Earliest unpaid installment due date ('YYYY-MM-DD'), or null. */
  next_unpaid_due: string | null;
  /** Whether this couple has already published a review on the vendor. */
  reviewed: boolean;
  /** Attention muted until this stamp, or null. */
  snoozed_until: UnixMs | null;
  /** When the vendor's date hold on this client runs out, or null when they
   *  never placed one. RAW, both of these: whether the hold is still LIVE is
   *  derived here from the same two columns everything else derives it from
   *  (`holdState`), so a hold that lapsed an hour ago needs nothing to have run
   *  for this queue to agree with the calendar. */
  hold_until: UnixMs | null;
  /** When the vendor let the hold go early, or null. */
  hold_released_at: UnixMs | null;
  /** False on the FREE tier: every money-derived rule is skipped. */
  pro: boolean;
}

/** A client's place in the attention band. `since` is when the condition
 *  started, and is what breaks ties within one key — the oldest neglect wins,
 *  which is the ordering a vendor would pick by hand. */
export interface VendorAttention {
  key: VendorAttentionKey;
  /** Index in ATTENTION_ORDER. Lower is more urgent. */
  severity: number;
  since: UnixMs;
  /** Whole hours the condition has held. Feeds "waiting 14h" copy. */
  hours: number;
  /** Whole days the condition has held, or the days until/since a date for the
   *  date-anchored rules. Feeds "12 days away" / "quiet for 9 days" copy. */
  days: number;
}

/** Parse a bare 'YYYY-MM-DD' to a UTC midnight stamp. Returns null for anything
 *  that isn't a well-formed date, so a junk column can't produce a NaN deadline
 *  that silently sorts to the top of the queue. */
function dateToUtcMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days from `nowMs` to a bare date, positive when the date is ahead.
 *  Both sides are floored to UTC midnight so "today" is a day, not a moment:
 *  an event at 09:00 must not read as "in 0 days" at 10:00 and "in 1 day" at
 *  08:00 the same morning. */
export function daysUntilDate(iso: string, nowMs: UnixMs): number | null {
  const target = dateToUtcMs(iso);
  if (target === null) return null;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Math.round((target - today) / DAY_MS);
}

function hoursSince(ts: UnixMs, nowMs: UnixMs): number {
  return Math.max(0, Math.floor((nowMs - ts) / HOUR_MS));
}

function daysSince(ts: UnixMs, nowMs: UnixMs): number {
  return Math.max(0, Math.floor((nowMs - ts) / DAY_MS));
}

/** When the couple started waiting on the vendor, or null when the ball is not
 *  in the vendor's court.
 *
 *  The inquiry ITSELF counts as the couple's first message even when it has no
 *  message row: the ask can live in the legacy `supplier_bookings.notes` blob,
 *  which is where every pre-thread inquiry and every admin-created booking
 *  still keeps it. Keying purely on `booking_messages` made exactly those leads
 *  fall out of the queue the moment the vendor opened them, which is the one
 *  case the queue exists for. */
function coupleWaitingSince(s: VendorClientSignals): UnixMs | null {
  const askedAt = s.last_couple_message_at ?? s.created_at;
  if (s.last_vendor_message_at === null) return askedAt;
  return askedAt > s.last_vendor_message_at ? askedAt : null;
}

/** When a LIVE date hold entered its last `HOLD_EXPIRING_SOON_HOURS`, or null
 *  when there is no live hold that close to lapsing.
 *
 *  Deliberately silent on an ALREADY-lapsed hold: the date is back on the
 *  market, nothing is owed, and a queue row about it would be a reminder to
 *  regret something. It is also silent on the FREE tier, because holds are PRO
 *  and a locked row in the one surface whose job is "do not lose this lead"
 *  makes the free tier worse at the only thing it promises. */
function holdExpiringSince(s: VendorClientSignals, nowMs: UnixMs): UnixMs | null {
  if (!s.pro || s.hold_until === null) return null;
  const live =
    holdState({ hold_until: s.hold_until, released_at: s.hold_released_at }, nowMs) === "live";
  if (!live) return null;
  const window = HOLD_EXPIRING_SOON_HOURS * HOUR_MS;
  if (s.hold_until - nowMs > window) return null;
  return s.hold_until - window;
}

/** An unpaid installment whose due date has gone by, for a PRO vendor. */
function paymentOverdueSince(s: VendorClientSignals, nowMs: UnixMs): number | null {
  if (!s.pro || s.next_unpaid_due === null) return null;
  const due = dateToUtcMs(s.next_unpaid_due);
  if (due === null) return null;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return due < today ? due : null;
}

/** THE next action for a client. Exactly one, always defined, and every branch
 *  is reachable from a state the app can actually produce. */
export function vendorNextAction(s: VendorClientSignals, nowMs: UnixMs): VendorActionKey {
  if (ARCHIVED_STATUSES.has(s.status)) return "none";
  const daysToEvent = daysUntilDate(s.event_date, nowMs);
  const eventPassed = daysToEvent !== null && daysToEvent < 0;

  if (OPEN_STATUSES.has(s.status)) {
    // A live inquiry for a date that has already gone is a lost lead, not a
    // deadline. Nothing to ask of the vendor.
    if (eventPassed) return "none";
    if (s.vendor_seen_at === null) return "open";
    if (coupleWaitingSince(s) !== null) return "reply";
    // A hold the vendor placed themselves, about to run out. It ranks under
    // "reply" for the same reason `hold_expiring` ranks under `unanswered`: a
    // couple waiting on an answer comes first, and the answer is usually the
    // thing that settles the date anyway.
    if (holdExpiringSince(s, nowMs) !== null) return "release_or_extend";
    // The vendor answered and the couple is deciding. Two things turn patience
    // into a nudge, and both produce the SAME action, which is what keeps the
    // CTA and the reason chip from telling two stories about one lead.
    const gone = daysSince(s.last_vendor_message_at ?? nowMs, nowMs) >= GOING_COLD_DAYS;
    const near = daysToEvent !== null && daysToEvent <= DATE_SOON_DAYS;
    if (gone || near) return "follow_up";
    return "await";
  }

  if (s.status === "confirmed") {
    if (eventPassed) return s.reviewed ? "none" : "request_review";
    if (paymentOverdueSince(s, nowMs) !== null) return "chase_payment";
    if (s.pro && s.contract_value === null) return "record_contract";
    if (s.pro && s.contract_value !== null && s.payment_count === 0) return "add_schedule";
    return "prepare";
  }

  // An unknown status is not an invitation to guess at a workflow.
  return "none";
}

/** Whether a client belongs in the attention band, and why. Null means "not
 *  now" — which is the answer for most clients most of the time, and a band
 *  that is usually short is the only kind anyone reads. */
export function vendorAttention(s: VendorClientSignals, nowMs: UnixMs): VendorAttention | null {
  if (ARCHIVED_STATUSES.has(s.status)) return null;
  if (s.snoozed_until !== null && s.snoozed_until > nowMs) return null;

  const daysToEvent = daysUntilDate(s.event_date, nowMs);
  const eventPassed = daysToEvent !== null && daysToEvent < 0;
  const build = (key: VendorAttentionKey, since: UnixMs): VendorAttention => ({
    key,
    severity: ATTENTION_ORDER.indexOf(key),
    since,
    hours: hoursSince(since, nowMs),
    days: daysSince(since, nowMs),
  });

  if (OPEN_STATUSES.has(s.status)) {
    if (eventPassed) return null;
    // Never opened. `since` is the newest thing the vendor hasn't looked at, so
    // a couple who followed up moves the lead UP the band rather than resetting
    // its clock to the original inquiry.
    if (s.vendor_seen_at === null) {
      return build("unopened", s.last_couple_message_at ?? s.created_at);
    }
    const waitingSince = coupleWaitingSince(s);
    if (waitingSince !== null && hoursSince(waitingSince, nowMs) >= REPLY_DUE_HOURS) {
      return build("unanswered", waitingSince);
    }
    // A date the vendor took off the market is about to go back on it, and
    // nothing runs to tell them. Checked BEFORE the reply-window early return
    // below, because a hold with two hours left is an alarm even while the
    // couple's message is still inside the window it is fine to be answering.
    const holdSince = holdExpiringSince(s, nowMs);
    if (holdSince !== null) {
      const attention = build("hold_expiring", holdSince);
      // Forward-anchored, like `date_soon`: `hours` is the time LEFT, rounded
      // up so a live hold never reads "0h".
      const left = Math.max(1, Math.ceil(((s.hold_until ?? nowMs) - nowMs) / HOUR_MS));
      return { ...attention, hours: left, days: Math.floor(left / 24) };
    }
    // Inside the reply window nothing is wrong yet; the next action still says
    // "reply", it just isn't an alarm.
    if (waitingSince !== null) return null;
    if (daysToEvent !== null && daysToEvent >= 0 && daysToEvent <= DATE_SOON_DAYS) {
      const eventMs = dateToUtcMs(s.event_date);
      const attention = build("date_soon", eventMs ?? nowMs);
      // For a date-anchored rule `days` is days UNTIL the event, not elapsed.
      return { ...attention, days: daysToEvent, hours: daysToEvent * 24 };
    }
    if (
      s.last_vendor_message_at !== null &&
      daysSince(s.last_vendor_message_at, nowMs) >= GOING_COLD_DAYS
    ) {
      return build("going_cold", s.last_vendor_message_at);
    }
    return null;
  }

  if (s.status === "confirmed") {
    const overdueSince = paymentOverdueSince(s, nowMs);
    if (overdueSince !== null) return build("payment_overdue", overdueSince);
    if (eventPassed && !s.reviewed) {
      const eventMs = dateToUtcMs(s.event_date);
      if (eventMs !== null && daysSince(eventMs, nowMs) >= REVIEW_DUE_DAYS) {
        return build("review_due", eventMs);
      }
    }
    return null;
  }

  return null;
}

/** Band ordering: severity first, then the oldest condition. Stable and total,
 *  so the band doesn't reshuffle between two renders of the same data. */
export function compareAttention(a: VendorAttention, b: VendorAttention): number {
  if (a.severity !== b.severity) return a.severity - b.severity;
  return a.since - b.since;
}

/** How many rows the band shows before it stops being a summary. The audit's
 *  "max 3-5"; five, because a vendor with a busy week should see the whole bad
 *  news at once rather than a truncated version of it. */
export const ATTENTION_BAND_MAX = 5;

/** Actions that are informational — the vendor is not being asked for anything.
 *  Rendered as a quiet label rather than a button. */
export const PASSIVE_ACTIONS: ReadonlySet<VendorActionKey> = new Set(["await", "prepare", "none"]);
