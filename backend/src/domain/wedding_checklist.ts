// Materializing a single catalog suggestion onto the couple's own Planning
// list. The catalog itself (shared/wedding_checklist.ts) is a read-only
// reference — nothing here ever removes a planning_items row. An item only
// exists on the couple's list once they've explicitly approved adding it.
import { isUiLocale, type UiLocale } from "@shared/locales";
import { toIsoDate } from "@shared/planning_timeline";
import type { PlanningItem } from "@shared/types";
import { checklistItemById, isChecklistTemplateId } from "@shared/wedding_checklist";
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
  const template = checklistItemById(templateId, locale, weddingDate, todayIso);
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

  const ts = now();
  let id: number;
  if (reusable) {
    // Never clobber a date the couple (or another wand) already set on the
    // row being adopted — only fill the gap.
    db.prepare(
      "UPDATE planning_items SET checklist_template_id = ?, due_date = COALESCE(due_date, ?), updated_at = ? WHERE id = ? AND couple_id = ? AND checklist_template_id IS NULL",
    ).run(templateId, resolvedDueDate, ts, reusable.id, coupleId);
    id = reusable.id;
  } else {
    const position = existing.reduce((max, entry) => Math.max(max, entry.position), -1) + 1;
    const result = db
      .prepare(
        `INSERT INTO planning_items
          (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
           suggested_by_user_id, start_date, supplier_id, priority, position,
           checklist_template_id, created_at, updated_at)
         VALUES (?, 'task', 'wedding', ?, NULL, 0, ?, NULL, NULL,
           NULL, ?, NULL, 0, ?, ?, ?, ?)`,
      )
      .run(
        coupleId,
        template.title,
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
