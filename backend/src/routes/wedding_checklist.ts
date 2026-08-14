import { isUiLocale, type UiLocale } from "@shared/locales";
import type { ConditionTag, ManualTagAnswers } from "@shared/planning_prompts";
import {
  checklistSections,
  isChecklistItemApplicable,
  isChecklistTemplateId,
} from "@shared/wedding_checklist";
import { db } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { listPlanningItemsByCouple } from "../domain/planning";
import { addChecklistItem } from "../domain/wedding_checklist";
import { renderWeddingChecklistPdf } from "../domain/wedding_checklist_pdf";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { PUBLIC_CHECKLIST_PDF_BUCKET, rateLimit } from "../lib/rate_limit";

function parseLocale(raw: unknown): UiLocale {
  return typeof raw === "string" && isUiLocale(raw) ? raw : "en";
}

// YYYY-MM-DD, same loose shape check used across the planning routes.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `undefined` (field omitted) = keep the old default-date behaviour;
 *  `null` = the couple explicitly cleared the suggested date; a string must
 *  be a valid-shaped date. */
function parseDueDateOverride(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string" || !DATE_RE.test(raw)) {
    throw new HttpError(400, "due_date must be YYYY-MM-DD or null");
  }
  return raw;
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

async function handleAddItem(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const body = await readJson<{ template_id?: unknown; locale?: unknown; due_date?: unknown }>(
    ctx.req,
  );
  if (typeof body.template_id !== "string" || !body.template_id) {
    throw new HttpError(400, "template_id is required");
  }
  const result = addChecklistItem(
    couple.id,
    userId,
    body.template_id,
    couple.wedding_date,
    body.locale,
    parseDueDateOverride(body.due_date),
  );
  return json(result);
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

/** Anonymous version of the print route: the landing-page and /eszkozok tool-page
 *  widgets have no couple to scope to, so this always renders the full, blank
 *  canonical checklist — no wedding date, no personalization, no progress. It
 *  is what makes "download the checklist" true regardless of how much of the
 *  demo a visitor has checked off locally in their own browser. */
async function handlePublicPdf(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "public_checklist_pdf", PUBLIC_CHECKLIST_PDF_BUCKET);
  const locale = parseLocale(ctx.url.searchParams.get("locale"));
  const sections = checklistSections(locale).map((section) => ({
    title: section.title,
    items: section.items.map((template) => ({
      title: template.title,
      done: false,
      dueDate: null,
      owner: null,
    })),
  }));
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const pdf = await renderWeddingChecklistPdf({
    locale,
    coupleName: null,
    weddingDate: null,
    completed: 0,
    total,
    includeProgress: false,
    includeDates: false,
    includeOwners: false,
    remainingOnly: false,
    sections,
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
  router.post("/api/planning/checklist/items", handleAddItem, true);
  router.get("/api/print/wedding-checklist", handlePdf, true);
  router.get("/api/public/checklist/pdf", handlePublicPdf);
}
