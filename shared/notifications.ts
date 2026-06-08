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
  | "timeline_email_sent";

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
