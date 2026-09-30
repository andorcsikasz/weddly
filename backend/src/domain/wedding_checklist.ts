// Materializing a single catalog suggestion onto the couple's own Planning
// list. The catalog itself (shared/wedding_checklist.ts) is a read-only
// reference — nothing here ever removes a planning_items row. An item only
// exists on the couple's list once they've explicitly approved adding it.
import { isUiLocale, type UiLocale } from "@shared/locales";
import { parseIsoDate, timelineDatesFor, toIsoDate } from "@shared/planning_timeline";
import type { PlanningItem } from "@shared/types";
import {
  CHOOSE_DATE_TEMPLATE_ID,
  checklistItemById,
  checklistLeadDaysById,
  DEFAULT_PLANNING_PACE,
  isChecklistTemplateId,
  isPlanningPace,
  type PlanningPace,
} from "@shared/wedding_checklist";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { HttpError } from "../lib/http";
import { markCoupleCalendarDirty } from "./google_calendar";
import { getPlanningItemJoined, listPlanningItemsByCouple, toPlanningItem } from "./planning";

const UI_LOCALES: readonly UiLocale[] = ["en", "hu", "es", "hr", "de"];

export interface AddChecklistItemResult {
  item: PlanningItem;
  created: boolean;
}

export function addChecklistItem(
  coupleId: number,
  userId: number,
  templateId: string,
  weddingDate: string | null,
  rawLocale: unknown,
  /** Explicit due date the couple confirmed in the approve UI. `undefined`
   *  (the field omitted) means "use the catalog's computed date" — the old
   *  behaviour, still what the demo-progress replay relies on. `null` means
   *  the couple cleared the suggested date on purpose. */
  dueDateOverride?: string | null,
): AddChecklistItemResult {
  if (!isChecklistTemplateId(templateId)) {
    throw new HttpError(400, "Unknown checklist template id");
  }
  const locale: UiLocale =
    typeof rawLocale === "string" && isUiLocale(rawLocale) ? rawLocale : "en";
  const todayIso = toIsoDate(new Date(now()));
  const pace = getPlanningPace(coupleId) ?? DEFAULT_PLANNING_PACE;
  const template = checklistItemById(templateId, locale, weddingDate, todayIso, pace);
  if (!template) throw new HttpError(400, "Unknown checklist template id");
  const resolvedDueDate = dueDateOverride !== undefined ? dueDateOverride : template.dueDate;

  const existing = listPlanningItemsByCouple(coupleId);
  const already = existing.find((entry) => entry.checklist_template_id === templateId);
  if (already) return { item: already, created: false };

  // Evolve the old Task template / Timeline output instead of duplicating the
  // same real-world to-do. Titles are matched across every UI locale.
  const knownTitles = new Set(
    UI_LOCALES.map(
      (candidateLocale) =>
        checklistItemById(templateId, candidateLocale, weddingDate, todayIso)?.title,
    ).filter((title): title is string => Boolean(title)),
  );
  const reusable = existing.find(
    (entry) =>
      entry.kind === "task" &&
      !entry.checklist_template_id &&
      !entry.seed_key &&
      knownTitles.has(entry.title),
  );

  // Choosing the date is usually already done by the time this row is
  // materialized — the couple typed it at onboarding, or edits it from the
  // dashboard, and every other section's due date is computed from it. Land
  // it pre-ticked rather than making the couple re-confirm a decision the
  // rest of the app already treats as settled.
  const initialDone = templateId === CHOOSE_DATE_TEMPLATE_ID && Boolean(weddingDate);

  const ts = now();
  let id: number;
  if (reusable) {
    // Never clobber a date the couple (or another wand) already set on the
    // row being adopted — only fill the gap. `done` only ever moves 0 → 1
    // here, never back, so a task the couple already unchecked stays that way.
    db.prepare(
      `UPDATE planning_items
         SET checklist_template_id = ?, due_date = COALESCE(due_date, ?),
             done = CASE WHEN ? THEN 1 ELSE done END, updated_at = ?
       WHERE id = ? AND couple_id = ? AND checklist_template_id IS NULL`,
    ).run(templateId, resolvedDueDate, initialDone ? 1 : 0, ts, reusable.id, coupleId);
    id = reusable.id;
  } else {
    const position = existing.reduce((max, entry) => Math.max(max, entry.position), -1) + 1;
    const result = db
      .prepare(
        `INSERT INTO planning_items
          (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
           suggested_by_user_id, start_date, supplier_id, priority, position,
           checklist_template_id, created_at, updated_at)
         VALUES (?, 'task', 'wedding', ?, NULL, ?, ?, NULL, NULL,
           NULL, ?, NULL, 0, ?, ?, ?, ?)`,
      )
      .run(
        coupleId,
        template.title,
        initialDone ? 1 : 0,
        resolvedDueDate,
        resolvedDueDate,
        position,
        templateId,
        ts,
        ts,
      );
    id = Number(result.lastInsertRowid);
  }

  const joined = getPlanningItemJoined(id, coupleId);
  if (!joined) throw new HttpError(500, "Failed to load checklist item after write");
  const item = toPlanningItem(joined);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planning.checklist.add_item",
    target_kind: "planning_item",
    target_id: id,
    after: { template_id: templateId, reused: Boolean(reusable) },
  });
  markCoupleCalendarDirty(coupleId);

  return { item, created: true };
}

/** Ticks the couple's own "choose your wedding date" task the moment they
 *  set (or change) an exact date — called from the couple PATCH handler
 *  right after `wedding_date` lands, so a task added back when the date was
 *  still TBD doesn't sit there stale and eventually read as overdue. A no-op
 *  when the item was never approved, or is already done; never un-ticks —
 *  clearing the date back to TBD leaves a manually-confirmed choice alone. */
export function autoCompleteChooseDateItem(coupleId: number): void {
  db.prepare(
    "UPDATE planning_items SET done = 1, updated_at = ? WHERE couple_id = ? AND checklist_template_id = ? AND done = 0",
  ).run(now(), coupleId, CHOOSE_DATE_TEMPLATE_ID);
}

/** The couple's stored pace, or null when they have never answered. */
export function getPlanningPace(coupleId: number): PlanningPace | null {
  const row = db.prepare("SELECT planning_pace FROM couples WHERE id = ?").get(coupleId) as {
    planning_pace: string | null;
  } | null;
  return isPlanningPace(row?.planning_pace) ? row.planning_pace : null;
}

/** A due date the catalog itself would have written for this item at `pace`:
 *  the plain calendar lead, or the "due now" clamp, which lands on the day the
 *  row was added. Anything else was typed by a person and is theirs. */
function isSuggestedDate(
  dueDate: string,
  weddingDate: string,
  leadDays: number,
  createdAt: number,
): boolean {
  const natural = timelineDatesFor(weddingDate, { lead: { days: leadDays }, windowDays: 0 });
  if (natural?.due_date === dueDate) return true;
  return toIsoDate(new Date(createdAt)) === dueDate && dueDate > (natural?.due_date ?? "");
}

/** Stores the pace and re-times the checklist tasks that are still on the
 *  catalog's own schedule. A done task, an undated one and one whose date the
 *  couple edited all stay exactly as they are: a pace is a suggestion about
 *  the plan, never a reason to overwrite a date somebody chose. Returns the
 *  rows it moved so the client can patch its list without a refetch. */
export function setPlanningPace(
  coupleId: number,
  userId: number,
  weddingDate: string | null,
  pace: PlanningPace,
): { pace: PlanningPace; items: PlanningItem[] } {
  const previous = getPlanningPace(coupleId) ?? DEFAULT_PLANNING_PACE;
  const todayIso = toIsoDate(new Date(now()));
  const moved: number[] = [];

  db.transaction(() => {
    db.prepare("UPDATE couples SET planning_pace = ? WHERE id = ?").run(pace, coupleId);
    if (previous === pace || !weddingDate || !parseIsoDate(weddingDate)) return;
    const oldLeads = checklistLeadDaysById(previous);
    const newLeads = checklistLeadDaysById(pace);
    const rows = db
      .prepare(
        `SELECT id, checklist_template_id, due_date, start_date, created_at
           FROM planning_items
          WHERE couple_id = ? AND checklist_template_id IS NOT NULL
            AND done = 0 AND due_date IS NOT NULL`,
      )
      .all(coupleId) as {
      id: number;
      checklist_template_id: string;
      due_date: string;
      start_date: string | null;
      created_at: number;
    }[];
    const update = db.prepare(
      "UPDATE planning_items SET due_date = ?, start_date = ?, updated_at = ? WHERE id = ?",
    );
    const ts = now();
    for (const row of rows) {
      const oldLead = oldLeads.get(row.checklist_template_id);
      const newLead = newLeads.get(row.checklist_template_id);
      if (oldLead === undefined || newLead === undefined || oldLead === newLead) continue;
      if (!isSuggestedDate(row.due_date, weddingDate, oldLead, row.created_at)) continue;
      const next = timelineDatesFor(
        weddingDate,
        { lead: { days: newLead }, windowDays: 0 },
        { todayIso },
      );
      if (!next || next.due_date === row.due_date) continue;
      // The checklist writes start = due; a start the couple moved stays put.
      const start = row.start_date === row.due_date ? next.due_date : row.start_date;
      update.run(next.due_date, start, ts, row.id);
      moved.push(row.id);
    }
  })();

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planning.checklist.set_pace",
    target_kind: "couple",
    target_id: coupleId,
    after: { pace, previous, rescheduled: moved.length },
  });
  if (moved.length > 0) markCoupleCalendarDirty(coupleId);

  const items = moved
    .map((id) => getPlanningItemJoined(id, coupleId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map(toPlanningItem);
  return { pace, items };
}
