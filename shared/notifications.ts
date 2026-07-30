// Notification-center contract. Its own module because the cluster is self-
// contained (DTO + kind union + the email-escalation setting) and shared by the
// bell, the dashboard "how are you doing" card, and the Profile settings.
//
// The feed is HYBRID: timeline overdue / due-soon items are computed live from
// planning_items at read time (never stored), while discrete events (RSVP came
// in, a partner added a to-do, "we emailed you a nudge") are stored rows in
// couple_notifications. The backend merges both into one `NotificationItem[]`.
// Human labels are NOT carried in the payload — the frontend composes them with
// t() from `kind` + `data`, so locale is never frozen at write time.

/** Discriminates how a feed item is rendered + which surface it links to.
 *  `timeline_*` are computed; the rest are stored events. */
export type NotificationKind =
  | "timeline_overdue"
  | "timeline_due"
  | "rsvp_received"
  | "rsvp_received_household"
  | "partner_task_added"
  | "timeline_email_sent"
  | "admin_message"
  | "feedback_survey"
  // Post-wedding: ~7 days after the wedding, a nudge to rate the vendors the
  // couple used. Stored (not computed); links to /app/rate-vendors.
  | "review_vendors"
  // A vendor answered on a booking thread. Stored; links to /app/messages/:id.
  // Written once per burst (domain/booking_notify.ts debounces on "already has
  // something unseen from this sender"), so a chatty vendor is one row, not ten.
  | "vendor_message"
  // Computed (like the timeline_* pair): a dateless to-do that's been parked
  // for a week, and a decisions category that's piled up untouched. Both are
  // gentle, derived live from planning_items — never stored.
  | "planning_stale_task"
  | "planning_decisions_stale";

/** One row in the bell / dashboard feed. `id` is a namespaced string ("tl:<taskId>"
 *  for computed timeline items, "evt:<rowId>" for stored events) so the two
 *  sources coexist in one list without colliding. `data` holds render params
 *  (guest name, task title, counts) the frontend interpolates via t(). */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  /** Render params, all stringifiable. e.g. { taskTitle }, { guestName, rsvpStatus }. */
  data: Record<string, string | number>;
  /** In-app deep link the row navigates to, or null. Always a local path. */
  link: string | null;
  /** Epoch ms. For stored events: the insert time. For computed timeline items:
   *  the day the task crossed into overdue / due-soon (local midnight), so the
   *  feed orders sensibly and the read watermark can compare against it. */
  created_at: number;
  /** Computed against the per-user `notification_seen` watermark. */
  read: boolean;
  /** True when the viewing user is the actor who caused this event — used to
   *  label own-action history rows differently ("You added a to-do" vs
   *  "Partner added a to-do") and to treat them as pre-read. */
  is_own_action?: boolean;
}

/** GET /api/notifications response. `unread` drives the bell badge; `overdue` +
 *  `due_soon` are the live timeline rollup the dashboard card headlines with. */
export interface NotificationFeed {
  items: NotificationItem[];
  unread: number;
  overdue: number;
  due_soon: number;
}

/** Per-couple email-escalation trigger (couples.timeline_email_escalation).
 *  The in-app bell is always on; this only governs the email push. */
export type TimelineEmailEscalation = "off" | "overdue" | "overdue_due_soon";

export const TIMELINE_EMAIL_ESCALATION_VALUES: readonly TimelineEmailEscalation[] = [
  "off",
  "overdue",
  "overdue_due_soon",
];

export function isTimelineEmailEscalation(s: string): s is TimelineEmailEscalation {
  return (TIMELINE_EMAIL_ESCALATION_VALUES as readonly string[]).includes(s);
}

/** How often the couple wants email digests (all channels combined).
 *  "never" = email opt-out; the in-app bell is always on regardless. */
export type NotifEmailCadence = "never" | "1_weekly" | "2_weekly" | "4_weekly";

export const NOTIF_EMAIL_CADENCE_VALUES: readonly NotifEmailCadence[] = [
  "never",
  "1_weekly",
  "2_weekly",
  "4_weekly",
];

export function isNotifEmailCadence(s: string): s is NotifEmailCadence {
  return (NOTIF_EMAIL_CADENCE_VALUES as readonly string[]).includes(s);
}

/** Which categories of email notifications the couple wants.
 *  Stored as a comma-separated string; defaults to all three. */
export type NotifFocus = "timeline" | "rsvp" | "partner";

export const NOTIF_FOCUS_ALL: readonly NotifFocus[] = ["timeline", "rsvp", "partner"];

export function parseNotifFocus(raw: string | null | undefined): NotifFocus[] {
  if (!raw) return [...NOTIF_FOCUS_ALL];
  const parts = raw.split(",").map((s) => s.trim());
  return parts.filter((p): p is NotifFocus => (NOTIF_FOCUS_ALL as readonly string[]).includes(p));
}

export function serializeNotifFocus(focus: NotifFocus[]): string {
  return focus.join(",");
}
