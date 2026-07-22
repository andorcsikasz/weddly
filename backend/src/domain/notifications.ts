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
import { PROMPTS_BY_KEY } from "@shared/planning_prompts";
import {
  TIMELINE_DUE_SOON_DAYS,
  parseIsoDate,
  summarizeTimeline,
  timelineStatus,
  toIsoDate,
} from "@shared/planning_timeline";
import { db, now } from "../db";
import { getCoupleForUser } from "./couples";

const DAY_MS = 86_400_000;
/** A dateless, not-done, non-prompt to-do nags once it's been parked this long. */
const STALE_TASK_DAYS = 7;
/** Surface at most this many stale-task nudges so a fresh idea dump can't flood the bell. */
const STALE_TASK_MAX = 3;
/** A decisions category piling up: at least this many still-open prompts… */
const DECISIONS_STALE_MIN_OPEN = 10;
/** …and untouched (no edit) for at least this long. */
const DECISIONS_STALE_DAYS = 14;

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
  seed_key: string | null;
  created_at: number;
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
 *  Per (user,couple), so it never touches the partner's unread state. This
 *  clears the BADGE only; it deliberately does NOT move unclicked items into
 *  history (that is per-item, see markNotificationItemRead). */
export function markNotificationsSeen(userId: number, coupleId: number): number {
  const ts = now();
  db.prepare(
    `INSERT INTO notification_seen (user_id, couple_id, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, couple_id) DO UPDATE SET seen_at = excluded.seen_at`,
  ).run(userId, coupleId, ts);
  return ts;
}

/** The set of feed-item ids this user has clicked. Drives the new-vs-history
 *  split so an item stays "new" until the user actually opens it. */
function getReadItemIds(userId: number): Set<string> {
  const rows = db
    .prepare("SELECT item_id FROM notification_reads WHERE user_id = ?")
    .all(userId) as { item_id: string }[];
  return new Set(rows.map((r) => r.item_id));
}

/** Mark ONE feed item read — the "I clicked this notification" action. Moves it
 *  to history without touching anything the user hasn't clicked. Idempotent. */
export function markNotificationItemRead(userId: number, itemId: string): void {
  db.prepare(
    `INSERT INTO notification_reads (user_id, item_id, read_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, item_id) DO NOTHING`,
  ).run(userId, itemId, now());
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
      "SELECT id, title, due_date, done, seed_key, created_at FROM planning_items WHERE couple_id = ? AND kind = 'task'",
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
  // Per-item read (clicked) drives the new-vs-history split; the seen watermark
  // above drives only the badge. So opening the bell zeroes the badge without
  // burying an unclicked item in "Korábbi értesítések".
  const readIds = getReadItemIds(userId);
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
      read: readIds.has(`tl:${t.id}`),
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
      // Own-action rows are always pre-read (history, not fresh notifications);
      // otherwise it stays new until the recipient clicks it.
      read: isOwnAction || readIds.has(`evt:${e.id}`),
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

  // ── stale dateless to-dos (computed) ──
  // A handful of not-done, undated, non-prompt tasks that have sat untouched
  // for a week. Capped so an idea dump can't flood the bell. The nudge "exists"
  // from the moment the task crossed the 7-day mark, so it orders + reads
  // against the watermark like the timeline items do.
  const nowTs = now();
  let staleCount = 0;
  for (const t of tasks) {
    if (staleCount >= STALE_TASK_MAX) break;
    if (t.done || t.due_date != null || t.seed_key != null) continue;
    const crossed = t.created_at + STALE_TASK_DAYS * DAY_MS;
    if (crossed > nowTs) continue;
    staleCount++;
    items.push({
      id: `stale:${t.id}`,
      kind: "planning_stale_task",
      data: { taskTitle: t.title },
      link: "/app/planning",
      created_at: crossed,
      read: readIds.has(`stale:${t.id}`),
    });
  }

  // ── stalled decisions category (computed) ──
  // A "Döntések" group that has piled up (≥10 still-open prompts) and hasn't
  // been touched in 14+ days gets one gentle nudge per group.
  const openPrompts = db
    .prepare(
      `SELECT seed_key, updated_at FROM planning_items
         WHERE couple_id = ? AND kind = 'task'
           AND seed_key IS NOT NULL AND decision_status = 'open'`,
    )
    .all(couple.id) as { seed_key: string; updated_at: number }[];
  const byGroup = new Map<string, { count: number; lastTouched: number }>();
  for (const p of openPrompts) {
    const group = PROMPTS_BY_KEY.get(p.seed_key)?.group;
    if (!group) continue;
    const agg = byGroup.get(group) ?? { count: 0, lastTouched: 0 };
    agg.count++;
    if (p.updated_at > agg.lastTouched) agg.lastTouched = p.updated_at;
    byGroup.set(group, agg);
  }
  for (const [group, agg] of byGroup) {
    if (agg.count < DECISIONS_STALE_MIN_OPEN) continue;
    const crossed = agg.lastTouched + DECISIONS_STALE_DAYS * DAY_MS;
    if (crossed > nowTs) continue;
    items.push({
      id: `decstale:${group}`,
      kind: "planning_decisions_stale",
      data: { count: agg.count, group },
      link: "/app/planning",
      created_at: crossed,
      read: readIds.has(`decstale:${group}`),
    });
  }

  items.sort((a, b) => b.created_at - a.created_at);
  const capped = items.slice(0, FEED_TOTAL_CAP);
  // Badge = fresh since the last bell-open (created after the seen watermark)
  // AND not yet clicked AND not the user's own action. Opening the bell advances
  // the watermark and clears this; clicking an item drops it from `read` above.
  const unread = capped.filter(
    (i) => !i.is_own_action && !readIds.has(i.id) && (seenAt == null || i.created_at > seenAt),
  ).length;
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
