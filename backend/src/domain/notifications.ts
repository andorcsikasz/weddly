// Notification-center domain. The feed is HYBRID:
//   - timeline overdue / due-soon items are COMPUTED live from planning_items
//     (via the shared timeline helpers) — never stored, so a completed or
//     re-dated task's nudge updates for free;
//   - discrete events (RSVP came in, a partner added a to-do, an escalation
//     email went out) are stored rows in couple_notifications.
// Read state is a per-(user,couple) watermark in notification_seen — NOT a flag
// on the event row — so partner A opening the bell never clears partner B's
// badge, mirroring how the email worker fans out per (couple,user).
//
// Pure infra-on-top-of-db domain helper: routes + worker call in; it never
// imports from routes.

import {
  type NotificationFeed,
  type NotificationItem,
  type NotificationKind,
} from "@shared/notifications";
import {
  TIMELINE_DUE_SOON_DAYS,
  parseIsoDate,
  summarizeTimeline,
  timelineStatus,
  toIsoDate,
} from "@shared/planning_timeline";
import { db, now } from "../db";
import { getCoupleForUser } from "./couples";

/** Most recent events surfaced in the bell. Older history isn't paged — the
 *  feed is a "what needs attention" surface, not an audit trail. */
const FEED_EVENT_LIMIT = 50;
/** Hard cap on the merged (timeline + events) list returned to the client. */
const FEED_TOTAL_CAP = 40;

interface TaskRow {
  id: number;
  title: string;
  due_date: string | null;
  done: number;
}

interface EventRow {
  id: number;
  kind: string;
  actor_user_id: number | null;
  data_json: string | null;
  link: string | null;
  created_at: number;
}

/** Insert a discrete event. `dedupe_key` (when given) makes the insert
 *  idempotent via the partial unique index, collapsing bursts (a family RSVP, a
 *  bulk edit) into a single row. Fire-and-forget from action sites. */
export function insertCoupleNotification(input: {
  couple_id: number;
  kind: NotificationKind;
  actor_user_id?: number | null;
  data?: Record<string, string | number>;
  link?: string | null;
  dedupe_key?: string | null;
}): void {
  db.prepare(
    `INSERT OR IGNORE INTO couple_notifications
       (couple_id, kind, actor_user_id, data_json, link, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.couple_id,
    input.kind,
    input.actor_user_id ?? null,
    input.data ? JSON.stringify(input.data) : null,
    input.link ?? null,
    input.dedupe_key ?? null,
    now(),
  );
}

function getSeenAt(userId: number, coupleId: number): number | null {
  const row = db
    .prepare("SELECT seen_at FROM notification_seen WHERE user_id = ? AND couple_id = ?")
    .get(userId, coupleId) as { seen_at: number } | undefined;
  return row?.seen_at ?? null;
}

/** Advance the caller's read watermark to now — the "I opened the bell" action.
 *  Per (user,couple), so it never touches the partner's unread state. */
export function markNotificationsSeen(userId: number, coupleId: number): number {
  const ts = now();
  db.prepare(
    `INSERT INTO notification_seen (user_id, couple_id, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, couple_id) DO UPDATE SET seen_at = excluded.seen_at`,
  ).run(userId, coupleId, ts);
  return ts;
}

/** ISO date minus N days, at local midnight. Used to place a due-soon item at
 *  the day it entered its window (its feed timestamp + read-watermark anchor). */
function isoMinusDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

function loadTasks(coupleId: number): TaskRow[] {
  return db
    .prepare(
      "SELECT id, title, due_date, done FROM planning_items WHERE couple_id = ? AND kind = 'task'",
    )
    .all(coupleId) as TaskRow[];
}

const SURVEY_ACTION_THRESHOLD = 120;

/** Build the merged feed for a user: computed timeline items + stored events,
 *  newest-first, with per-item read state and the live timeline rollup the
 *  dashboard card uses. */
export function getNotificationFeed(userId: number): NotificationFeed {
  const couple = getCoupleForUser(userId);
  if (!couple) return { items: [], unread: 0, overdue: 0, due_soon: 0 };

  const seenAt = getSeenAt(userId, couple.id);
  const todayIso = toIsoDate(new Date());
  const tasks = loadTasks(couple.id);
  const items: NotificationItem[] = [];

  // ── computed timeline half ──
  for (const t of tasks) {
    const status = timelineStatus(t.due_date, Boolean(t.done), todayIso);
    if (status !== "overdue" && status !== "due_soon") continue;
    const due = t.due_date as string; // non-null: undated tasks never reach here
    const triggerIso = status === "overdue" ? due : isoMinusDays(due, TIMELINE_DUE_SOON_DAYS);
    const createdAt = parseIsoDate(triggerIso)?.getTime() ?? now();
    items.push({
      id: `tl:${t.id}`,
      kind: status === "overdue" ? "timeline_overdue" : "timeline_due",
      data: { taskTitle: t.title },
      link: "/app/timeline",
      created_at: createdAt,
      read: seenAt != null && createdAt <= seenAt,
    });
  }

  // ── stored events half (all couple events; own-action rows are pre-read) ──
  const events = db
    .prepare(
      `SELECT id, kind, actor_user_id, data_json, link, created_at
         FROM couple_notifications
        WHERE couple_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(couple.id, FEED_EVENT_LIMIT) as EventRow[];
  for (const e of events) {
    let data: Record<string, string | number> = {};
    if (e.data_json) {
      try {
        data = JSON.parse(e.data_json) as Record<string, string | number>;
      } catch {
        data = {};
      }
    }
    const isOwnAction = e.actor_user_id != null && e.actor_user_id === userId;
    items.push({
      id: `evt:${e.id}`,
      kind: e.kind as NotificationKind,
      data,
      link: e.link,
      created_at: e.created_at,
      // Own-action rows are always pre-read (history, not fresh notifications).
      read: isOwnAction || (seenAt != null && e.created_at <= seenAt),
      is_own_action: isOwnAction || undefined,
    });
  }

  // ── feedback survey prompt (virtual, computed) ──
  // Inject once when the user has reached 120 actions and hasn't dismissed yet.
  const userRow = db.prepare("SELECT survey_prompted_at FROM users WHERE id = ?").get(userId) as
    | { survey_prompted_at: number | null }
    | undefined;
  if (userRow && userRow.survey_prompted_at == null) {
    const actionCount = (
      db.prepare("SELECT COUNT(*) AS cnt FROM audit_log WHERE actor_user_id = ?").get(userId) as {
        cnt: number;
      }
    ).cnt;
    if (actionCount >= SURVEY_ACTION_THRESHOLD) {
      items.push({
        id: "survey:prompt",
        kind: "feedback_survey",
        data: {},
        link: null,
        created_at: now(),
        read: false,
      });
    }
  }

  items.sort((a, b) => b.created_at - a.created_at);
  const capped = items.slice(0, FEED_TOTAL_CAP);
  const unread = capped.filter((i) => !i.read).length;
  const rollup = summarizeTimeline(
    tasks.map((t) => ({ due_date: t.due_date, done: Boolean(t.done) })),
    todayIso,
  );
  return { items: capped, unread, overdue: rollup.overdue, due_soon: rollup.dueSoon };
}

/** Worker helper (M3 email escalation): the couple's actionable timeline tasks
 *  with their status, so the sweep can decide whether to email and name the
 *  items. Reuses the same `timelineStatus` the UI + feed use, so email and
 *  in-app never disagree about who's behind. */
export function listActionableTimelineTasks(
  coupleId: number,
  todayIso: string,
): { title: string; status: "overdue" | "due_soon" }[] {
  const out: { title: string; status: "overdue" | "due_soon" }[] = [];
  for (const t of loadTasks(coupleId)) {
    const status = timelineStatus(t.due_date, Boolean(t.done), todayIso);
    if (status === "overdue" || status === "due_soon") out.push({ title: t.title, status });
  }
  return out;
}
