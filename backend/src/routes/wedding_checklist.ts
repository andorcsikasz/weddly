import { isUiLocale, type UiLocale } from "@shared/locales";
import type { ConditionTag, ManualTagAnswers } from "@shared/planning_prompts";
import {
  checklistSections,
  isChecklistItemApplicable,
  isChecklistTemplateId,
} from "@shared/wedding_checklist";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { markCoupleCalendarDirty } from "../domain/google_calendar";
import { listPlanningItemsByCouple } from "../domain/planning";
import { renderWeddingChecklistPdf } from "../domain/wedding_checklist_pdf";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function parseLocale(raw: unknown): UiLocale {
  return typeof raw === "string" && isUiLocale(raw) ? raw : "en";
}

function profileFor(coupleId: number): ManualTagAnswers {
  const row = db.prepare("SELECT planning_profile FROM couples WHERE id = ?").get(coupleId) as
    | { planning_profile: string | null }
    | undefined;
  if (!row?.planning_profile) return {};
  try {
    const parsed = JSON.parse(row.planning_profile) as Record<string, unknown>;
    const profile: ManualTagAnswers = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "yes" || value === "no") profile[key as ConditionTag] = value;
    }
    return profile;
  } catch {
    return {};
  }
}

async function handleInitialize(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const body = await readJson<{ locale?: unknown }>(ctx.req);
  const locale = parseLocale(body.locale);
  const sections = checklistSections(locale, couple.wedding_date);
  const existing = listPlanningItemsByCouple(couple.id);
  const existingIds = new Set(existing.map((entry) => entry.checklist_template_id).filter(Boolean));
  const reusable = existing.filter(
    (entry) => entry.kind === "task" && !entry.checklist_template_id && !entry.seed_key,
  );
  const knownTitlesById = new Map<string, Set<string>>();
  for (const candidateLocale of ["en", "hu", "es", "hr", "de"] as const) {
    for (const candidate of checklistSections(candidateLocale, couple.wedding_date).flatMap(
      (section) => section.items,
    )) {
      const titles = knownTitlesById.get(candidate.id) ?? new Set<string>();
      titles.add(candidate.title);
      knownTitlesById.set(candidate.id, titles);
    }
  }
  let position = existing.reduce((maximum, entry) => Math.max(maximum, entry.position), -1) + 1;
  const ts = now();
  const attach = db.prepare(
    "UPDATE planning_items SET checklist_template_id = ?, updated_at = ? WHERE id = ? AND couple_id = ? AND checklist_template_id IS NULL",
  );
  const insert = db.prepare(
    `INSERT INTO planning_items
      (couple_id, kind, topic, title, body, done, due_date, scheduled_time, assignee,
       suggested_by_user_id, start_date, supplier_id, priority, position,
       checklist_template_id, created_at, updated_at)
     VALUES (?, 'task', 'wedding', ?, NULL, 0, ?, NULL, NULL,
       NULL, ?, NULL, 0, ?, ?, ?, ?)`,
  );
  let created = 0;
  let linked = 0;

  const transaction = db.transaction(() => {
    for (const template of sections.flatMap((section) => section.items)) {
      if (existingIds.has(template.id)) continue;
      // Evolve the old Task template / Timeline output instead of duplicating
      // the same real-world to-do. Titles are matched across every UI locale.
      const knownTitles = knownTitlesById.get(template.id) ?? new Set([template.title]);
      const reuseIndex = reusable.findIndex((entry) => knownTitles.has(entry.title));
      if (reuseIndex >= 0) {
        const [row] = reusable.splice(reuseIndex, 1);
        if (row) {
          attach.run(template.id, ts, row.id, couple.id);
          linked += 1;
          continue;
        }
      }
      insert.run(
        couple.id,
        template.title,
        template.dueDate,
        template.dueDate,
        position,
        template.id,
        ts,
        ts,
      );
      position += 1;
      created += 1;
    }
  });
  transaction();

  if (created > 0 || linked > 0) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "planning.checklist.initialize",
      target_kind: "couple",
      target_id: couple.id,
      after: {
        created,
        linked,
        template_size: sections.flatMap((section) => section.items).length,
      },
    });
    markCoupleCalendarDirty(couple.id);
  }
  return json({ items: listPlanningItemsByCouple(couple.id), created, linked });
}

async function handlePdf(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const locale = parseLocale(ctx.url.searchParams.get("locale"));
  const includeProgress = ctx.url.searchParams.get("mode") !== "blank";
  const includeDates = ctx.url.searchParams.get("dates") === "1";
  const includeOwners = ctx.url.searchParams.get("owners") === "1";
  const remainingOnly = ctx.url.searchParams.get("remaining") === "1";
  const profile = profileFor(couple.id);
  const tasks = new Map(
    listPlanningItemsByCouple(couple.id)
      .filter(
        (entry) =>
          entry.checklist_template_id && isChecklistTemplateId(entry.checklist_template_id),
      )
      .map((entry) => [entry.checklist_template_id as string, entry]),
  );
  const sections = checklistSections(locale, couple.wedding_date)
    .map((section) => ({
      title: section.title,
      items: section.items
        .filter((template) => isChecklistItemApplicable(template, profile))
        .map((template) => {
          const task = tasks.get(template.id);
          return {
            title: template.title,
            done: Boolean(task?.done),
            dueDate: task?.due_date ?? template.dueDate,
            owner: task?.assignee ?? null,
          };
        }),
    }))
    .filter((section) => section.items.length > 0);
  const allItems = sections.flatMap((section) => section.items);
  const completed = allItems.filter((entry) => entry.done).length;
  const pdf = await renderWeddingChecklistPdf({
    locale,
    coupleName: couple.display_name,
    weddingDate: couple.wedding_date,
    completed,
    total: allItems.length,
    includeProgress,
    includeDates,
    includeOwners,
    remainingOnly,
    sections,
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "print.wedding_checklist",
    target_kind: "couple",
    target_id: couple.id,
    after: { locale, include_progress: includeProgress, remaining_only: remainingOnly },
  });
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="weddly-wedding-checklist.pdf"',
      "Cache-Control": "no-store",
    },
  });
}

export function registerWeddingChecklistRoutes(router: Router) {
  router.post("/api/planning/checklist/initialize", handleInitialize, true);
  router.get("/api/print/wedding-checklist", handlePdf, true);
}
