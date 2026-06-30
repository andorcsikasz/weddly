// Planning items — one table backs the three tabs on /app/planning:
// tasks (checklist), ideas (free-form notes), schedule (wedding-day timeline).
// All queries take a coupleId; the caller is responsible for scoping to the
// authenticated couple via getCoupleForUser.

import type {
  DecisionStatus,
  IdeaStatus,
  IdeaTag,
  PlanningItem,
  PlanningKind,
  PlanningTopic,
} from "@shared/types";
import { db } from "../db";

const VALID_KINDS: ReadonlySet<PlanningKind> = new Set(["task", "idea", "schedule"]);
const VALID_TOPICS: ReadonlySet<PlanningTopic> = new Set(["wedding", "honeymoon"]);
const VALID_IDEA_STATUSES: ReadonlySet<IdeaStatus> = new Set(["doing", "maybe", "skip"]);
const VALID_IDEA_TAGS: ReadonlySet<IdeaTag> = new Set([
  "program",
  "decor",
  "surprise",
  "keepsake",
  "experience",
]);

export function isPlanningKind(s: string): s is PlanningKind {
  return VALID_KINDS.has(s as PlanningKind);
}

export function isPlanningTopic(s: string): s is PlanningTopic {
  return VALID_TOPICS.has(s as PlanningTopic);
}

export function isIdeaStatus(s: string | null): s is IdeaStatus {
  return s !== null && VALID_IDEA_STATUSES.has(s as IdeaStatus);
}

export function isIdeaTag(s: string | null): s is IdeaTag {
  return s !== null && VALID_IDEA_TAGS.has(s as IdeaTag);
}

export interface PlanningItemRow {
  id: number;
  couple_id: number;
  kind: string;
  /** "wedding" | "honeymoon" | null. NULL on rows that pre-date the column. */
  topic: string | null;
  title: string;
  body: string | null;
  done: number;
  due_date: string | null;
  scheduled_time: string | null;
  assignee: string | null;
  suggested_by_user_id: number | null;
  start_date: string | null;
  supplier_id: string | null;
  /** 0 = no flag, 1 = important ("!"), 2 = SOS ("!!"). Tasks only. */
  priority: number;
  position: number;
  /** "Döntések" layer - stable seed identifier; NULL on normal rows. */
  seed_key: string | null;
  /** "Döntések" layer - 'open' | 'decided' | 'not_relevant' | 'promoted'; NULL
   *  on non-prompt rows. */
  decision_status: string | null;
  /** "Döntések" layer - resolved decision / supplier answer; NULL until decided. */
  resolution: string | null;
  /** Ideas only - 'doing' | 'maybe' | 'skip'; NULL on non-idea / untriaged rows. */
  idea_status: string | null;
  /** Ideas only - category tag; NULL when untagged. */
  idea_tag: string | null;
  created_at: number;
  updated_at: number;
}

/** Listing rows carry the resolved suggester name via LEFT JOIN on users.
 *  Single-row fetchers (`getPlanningItemScoped`) read without the join, so
 *  callers wrapping a write should hit `getPlanningItemJoined` to surface the
 *  display name in the response. */
export interface PlanningItemJoinedRow extends PlanningItemRow {
  suggested_by_name: string | null;
}

export function toPlanningItem(row: PlanningItemJoinedRow): PlanningItem {
  return {
    id: row.id,
    couple_id: row.couple_id,
    kind: (isPlanningKind(row.kind) ? row.kind : "task") as PlanningKind,
    topic: row.topic && isPlanningTopic(row.topic) ? row.topic : null,
    title: row.title,
    body: row.body,
    done: Boolean(row.done),
    due_date: row.due_date,
    scheduled_time: row.scheduled_time,
    assignee: row.assignee,
    suggested_by_user_id: row.suggested_by_user_id,
    suggested_by_name: row.suggested_by_name,
    start_date: row.start_date,
    supplier_id: row.supplier_id,
    priority: row.priority === 1 || row.priority === 2 ? (row.priority as 1 | 2) : 0,
    position: row.position,
    seed_key: row.seed_key,
    decision_status: isDecisionStatus(row.decision_status) ? row.decision_status : null,
    resolution: row.resolution,
    idea_status: isIdeaStatus(row.idea_status) ? row.idea_status : null,
    idea_tag: isIdeaTag(row.idea_tag) ? row.idea_tag : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const VALID_DECISION_STATUSES: ReadonlySet<DecisionStatus> = new Set([
  "open",
  "decided",
  "not_relevant",
  "promoted",
]);

export function isDecisionStatus(s: string | null): s is DecisionStatus {
  return s !== null && VALID_DECISION_STATUSES.has(s as DecisionStatus);
}

const LIST_SELECT = `
  SELECT pi.*, u.full_name AS suggested_by_name
    FROM planning_items pi
    LEFT JOIN users u ON u.id = pi.suggested_by_user_id
`;

export function listPlanningItemsByCouple(coupleId: number): PlanningItem[] {
  // Order: schedule entries by scheduled_time (then position) — the others
  // by position then created_at, so newest stays at the bottom of the list.
  const rows = db
    .prepare(
      `${LIST_SELECT}
         WHERE pi.couple_id = ?
         ORDER BY
           CASE WHEN pi.kind = 'schedule' AND pi.scheduled_time IS NOT NULL THEN 0 ELSE 1 END,
           pi.scheduled_time ASC,
           pi.position ASC,
           pi.created_at ASC,
           pi.id ASC`,
    )
    .all(coupleId) as PlanningItemJoinedRow[];
  return rows.map(toPlanningItem);
}

/** Guest-derived inputs for the decision-prompt visibility resolver. `guestCount`
 *  is null when the couple hasn't built a list yet (so conditional prompts stay
 *  inclusively visible rather than being hidden on an empty list). */
export function promptGuestStats(coupleId: number): {
  guestCount: number | null;
  hasChildren: boolean;
} {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN kind IN ('child', 'baby') THEN 1 ELSE 0 END) AS kids
         FROM guests WHERE couple_id = ?`,
    )
    .get(coupleId) as { total: number; kids: number | null } | undefined;
  const total = Number(row?.total ?? 0);
  return { guestCount: total > 0 ? total : null, hasChildren: Number(row?.kids ?? 0) > 0 };
}

export function getPlanningItemScoped(id: number, coupleId: number): PlanningItemRow | null {
  return (
    (db.prepare("SELECT * FROM planning_items WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | PlanningItemRow
      | undefined) ?? null
  );
}

/** Re-fetch after a write so the response carries the up-to-date
 *  `suggested_by_name` join. */
export function getPlanningItemJoined(id: number, coupleId: number): PlanningItemJoinedRow | null {
  return (
    (db.prepare(`${LIST_SELECT} WHERE pi.id = ? AND pi.couple_id = ?`).get(id, coupleId) as
      | PlanningItemJoinedRow
      | undefined) ?? null
  );
}
