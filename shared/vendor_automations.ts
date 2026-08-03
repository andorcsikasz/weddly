// Vendor automation layer: the three things Weddly is allowed to do on a
// vendor's behalf, each switched on one at a time, each off until they say so.
//
// The whole design rests on one decision: THIS MODULE OWNS NO TRIGGER RULE.
// "Unanswered" and "review due" already have exactly one definition in
// `shared/vendor_next_action.ts`, and the automations wait on THAT verdict
// rather than on a second reading of the same booking. The listing checklist
// and the reminder email drifted apart precisely because the mail wrote its own
// definition of "unfinished", and a mail that leaves the building on a rule the
// vendor's own screen disagrees with is worse than no mail. So the map below is
// a POINTER into `VendorAttentionKey`, not a copy of the conditions.
//
// Rules worth not re-deriving:
//
//   * OFF is the resting state of all three, and the acknowledgement cannot
//     even be armed until the vendor has written the words. An auto-reply with
//     no body is a machine answering a couple with silence, which is worse than
//     not answering at all.
//
//   * The body comes from `vendor_message_templates`, the canned replies the
//     vendor already writes for the composer. A second template store would
//     mean a vendor editing "their" text in one place and the robot sending the
//     other one.
//
//   * The reminder's delay FLOOR is `REPLY_DUE_HOURS`, and that is not a
//     coincidence: below it `vendorAttention` does not call the lead unanswered
//     yet, so a shorter delay could only be honoured by inventing a second
//     opinion about the same booking. The vendor may wait LONGER than the
//     queue does, never less.
//
//   * The review request is the one couple-facing send that is never automatic
//     end to end. It is PROPOSED to the vendor and waits for a human click,
//     because asking a couple for stars in a vendor's name is a reputational
//     act, not a notification.

import type { VendorAttentionKey } from "./vendor_next_action";
import { REPLY_DUE_HOURS } from "./vendor_next_action";
import type { VendorPlan } from "./vendor_plan";
import type { UnixMs } from "./types";

/** The three automations. Adding a fourth means a trigger entry below, a copy
 *  bucket, and a branch in the sweep, and nothing else. */
export type VendorAutomationKey = "inquiry_ack" | "unanswered_reminder" | "review_request";

export const VENDOR_AUTOMATION_KEYS: readonly VendorAutomationKey[] = [
  "inquiry_ack",
  "unanswered_reminder",
  "review_request",
] as const;

export function isVendorAutomationKey(v: unknown): v is VendorAutomationKey {
  return typeof v === "string" && (VENDOR_AUTOMATION_KEYS as readonly string[]).includes(v);
}

/**
 * The attention verdicts each automation waits for, straight out of
 * `vendorAttention`. An empty list means the automation is not an attention
 * rule at all: the acknowledgement answers an inquiry ARRIVING, which is an
 * event, not a state the queue tracks.
 *
 * This map is the single link between the two modules. It SUBSCRIBES to
 * verdicts, it never restates their conditions, so if a trigger ever needs to
 * change it changes in `vendor_next_action.ts` and every reader moves with it,
 * the vendor's own attention band included.
 *
 * The reminder subscribes to TWO of them, and they are the top two of
 * `ATTENTION_ORDER`. `unopened` and `unanswered` are one thing seen from the
 * couple's side: the ball is in the vendor's court and nobody has picked it up.
 * The band keeps them apart because the vendor's next STEP differs (open it
 * versus answer it); a reminder that fired on only one of them would go silent
 * on exactly the lead that most needs it, the one nobody has looked at.
 * Their `since` stamps coincide (both are the newest thing the vendor has not
 * responded to), so the dedupe key is stable across the transition and merely
 * opening an inquiry cannot earn a second reminder.
 */
export const AUTOMATION_ATTENTION: Record<VendorAutomationKey, readonly VendorAttentionKey[]> = {
  inquiry_ack: [],
  unanswered_reminder: ["unopened", "unanswered"],
  review_request: ["review_due"],
};

/** How long the reminder waits by default. A full day rather than the queue's
 *  12 hours: the band is a glance the vendor chooses to take, an email is an
 *  interruption they did not, so the automatic one is deliberately slower. */
export const REMINDER_DELAY_DEFAULT_HOURS = 24;

/** The floor, and it IS `REPLY_DUE_HOURS`. See the module header: under it the
 *  lead is not unanswered by the only definition we have. */
export const REMINDER_DELAY_MIN_HOURS = REPLY_DUE_HOURS;

/** A week. Past that the `going_cold` rule has taken the lead over anyway, so a
 *  longer reminder would arrive about a verdict that no longer holds. */
export const REMINDER_DELAY_MAX_HOURS = 168;

/**
 * How old an inquiry may be and still earn an acknowledgement.
 *
 * The sweep, not the request, is what fires the ack, so a worker that was down
 * for a day must not wake up and answer a week of inquiries at once with "thank
 * you, we will be in touch shortly" to couples the vendor already replied to by
 * hand. Combined with the arm stamp below, an ack only ever goes to an inquiry
 * that landed AFTER the vendor switched it on and is still fresh.
 */
export const ACK_MAX_AGE_HOURS = 24;

/** What the automation did about one occurrence.
 *
 *  `sent` is terminal and is the only status that means an email left the
 *  building. `proposed` is the review request waiting on the vendor, and it
 *  resolves to `approved` (sent) or `dismissed` (never sent, never re-asked).
 *  `skipped` records a fire that was correctly refused, so "why did nothing
 *  happen?" has an answer that is not silence. */
export type VendorAutomationStatus = "sent" | "proposed" | "approved" | "dismissed" | "skipped";

/** Statuses the vendor can still act on: the approval queue. */
export const OPEN_AUTOMATION_STATUSES: readonly VendorAutomationStatus[] = ["proposed"] as const;

/** Everything already decided. The activity list, and the reason a `skipped`
 *  status exists at all: a switch nobody can audit is a switch nobody trusts,
 *  so a refused send is on the record rather than silent. */
export const CLOSED_AUTOMATION_STATUSES: readonly VendorAutomationStatus[] = [
  "sent",
  "approved",
  "dismissed",
  "skipped",
] as const;

/** One automation's configuration, as the vendor set it. */
export interface VendorAutomation {
  key: VendorAutomationKey;
  enabled: boolean;
  /** `vendor_message_templates.id` for the acknowledgement body. Null on the
   *  other two, which carry Weddly's own copy. */
  template_id: number | null;
  /** Hours to wait, on `unanswered_reminder` only. Null elsewhere. */
  delay_hours: number | null;
  /** When it was last switched ON. The floor for what it may act on, so arming
   *  an automation is never retroactive. Null while it has never been on. */
  armed_at: UnixMs | null;
  updated_at: UnixMs;
}

/** One thing an automation did (or is asking to do), for the activity list and
 *  the approval queue. */
export interface VendorAutomationRun {
  id: number;
  key: VendorAutomationKey;
  booking_id: number | null;
  /** The couple's workspace name, so the vendor recognises the row. */
  couple_name: string;
  event_date: string;
  status: VendorAutomationStatus;
  /** Short machine-readable note on a `skipped` row ("no_body", "opted_out"). */
  detail: string | null;
  created_at: UnixMs;
  resolved_at: UnixMs | null;
}

/** Everything `/vendor/settings/automations` renders in one response. */
export interface VendorAutomationsView {
  /** FREE keeps the page and the configured text; the writes are refused. */
  plan: VendorPlan;
  automations: VendorAutomation[];
  /** Review requests waiting for a human click. */
  proposals: VendorAutomationRun[];
  /** Newest first, capped. What actually went out, in the vendor's own words. */
  recent: VendorAutomationRun[];
}

/** How many activity rows the read returns. Enough to answer "did it fire?"
 *  without turning the settings tab into a log viewer. */
export const AUTOMATION_ACTIVITY_LIMIT = 20;

/** The resting state of an automation nobody has configured yet. Every default
 *  is OFF, and the two nullable fields default to "nothing chosen". */
export function defaultAutomation(key: VendorAutomationKey, updatedAt: UnixMs): VendorAutomation {
  return {
    key,
    enabled: false,
    template_id: null,
    delay_hours: key === "unanswered_reminder" ? REMINDER_DELAY_DEFAULT_HOURS : null,
    armed_at: null,
    updated_at: updatedAt,
  };
}

/** Whether an automation has everything it needs to be switched on. Only the
 *  acknowledgement can fail this, and it is the whole reason the switch exists
 *  separately from the text: an armed auto-reply with no body would answer a
 *  couple with an empty message signed by the vendor. */
export function canArm(a: Pick<VendorAutomation, "key" | "template_id">): boolean {
  if (a.key === "inquiry_ack") return a.template_id !== null;
  return true;
}

/** Clamp a delay the vendor typed into the window the queue can actually
 *  justify. Non-numeric input falls back to the default rather than throwing,
 *  the route validates shape; this validates meaning. */
export function clampDelayHours(raw: number): number {
  if (!Number.isFinite(raw)) return REMINDER_DELAY_DEFAULT_HOURS;
  return Math.min(REMINDER_DELAY_MAX_HOURS, Math.max(REMINDER_DELAY_MIN_HOURS, Math.round(raw)));
}

/** The dedupe key for one occurrence. Same idiom as
 *  `vendor_points_ledger.dedupe_key`: it names the THING THAT HAPPENED, never
 *  the attempt, so a replay, a worker restart and a double delivery collapse
 *  onto the one row a unique index already refuses to duplicate.
 *
 *  The reminder carries `since` (the stamp `vendorAttention` says the wait
 *  started at) because a couple who writes again starts a NEW wait, and that
 *  genuinely deserves a new reminder. The other two name the booking alone:
 *  one inquiry is acknowledged once, one wedding is asked about once. */
export function automationDedupeKey(
  key: VendorAutomationKey,
  bookingId: number,
  since?: UnixMs,
): string {
  if (key === "unanswered_reminder") return `unanswered_reminder:${bookingId}:${since ?? 0}`;
  return `${key}:${bookingId}`;
}
