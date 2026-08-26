// Persistent fourth Planning surface. This deliberately is not a Dialog: its
// progress, filters, and two-column task list stay visible and trackable in the
// normal page flow. The catalog itself is a browsable reference — every item is
// always visible, and nothing here is ever deletable. An item only joins the
// couple's own to-do list (and counts toward progress) once they approve it by
// tapping its "+".
import { timelineStatus } from "@shared/planning_timeline";
import { checklistSections, isChecklistItemApplicable } from "@shared/wedding_checklist";
import type { WeddingChecklistItem } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import { CHECKLIST_DEMO_PROGRESS_KEY } from "./PublicWeddingChecklist";
import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  Loader2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPdfBlob,
  planningApi,
  type PlanningPromptTags,
  weddingChecklistPdfUrl,
} from "../lib/endpoints";
import { todayIso } from "../lib/format";
import { useToast } from "./ui";
import { type Locale, LOCALES, LOCALE_NAMES, useT } from "../lib/i18n";

type ChecklistFilter = "all" | "todo" | "done";
type ChecklistRow = { template: WeddingChecklistItem; task: PlanningItem | null };

interface WeddingChecklistProps {
  items: PlanningItem[];
  onItemsChange: (updater: (items: PlanningItem[]) => PlanningItem[]) => void;
  weddingDate: string | null;
  profile: PlanningPromptTags;
}

function formatShortDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const localeTag: Record<Locale, string> = {
    en: "en-GB",
    hu: "hu-HU",
    es: "es-ES",
    hr: "hr-HR",
    de: "de-DE",
  };
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Replays the public landing/tool-page demo's locally-checked items onto the
 *  couple's own checklist the first time this tab is open: approves each
 *  stashed item (materialising its task if it isn't already added) and marks
 *  it done, then clears the stash. A no-op for couples who never touched the
 *  public demo. Silently best-effort — a failure here must never surface as
 *  a checklist error. */
async function applyStashedDemoProgress(
  applicableIds: ReadonlySet<string>,
  taskByTemplateId: ReadonlyMap<string, PlanningItem>,
  locale: Locale,
  onItemsChange: WeddingChecklistProps["onItemsChange"],
): Promise<void> {
  try {
    const raw = localStorage.getItem(CHECKLIST_DEMO_PROGRESS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const stashedIds = parsed.filter(
      (entry): entry is string => typeof entry === "string" && applicableIds.has(entry),
    );
    if (stashedIds.length === 0) {
      localStorage.removeItem(CHECKLIST_DEMO_PROGRESS_KEY);
      return;
    }
    for (const templateId of stashedIds) {
      const existing = taskByTemplateId.get(templateId);
      if (existing?.done) continue;
      const item = existing ?? (await planningApi.addChecklistItem(templateId, locale)).item;
      if (item.done) continue;
      const result = await planningApi.update(item.id, { done: true });
      onItemsChange((current) => [
        ...current.filter((entry) => entry.id !== result.item.id),
        result.item,
      ]);
    }
    localStorage.removeItem(CHECKLIST_DEMO_PROGRESS_KEY);
  } catch {
    // Best-effort handoff — never blocks or errors out the checklist tab.
  }
}

export function WeddingChecklist({
  items,
  onItemsChange,
  weddingDate,
  profile,
}: WeddingChecklistProps) {
  const { t, locale } = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [savingIds, setSavingIds] = useState<Set<number>>(() => new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  const [applyingAll, setApplyingAll] = useState(false);
  // The couple's own edit of a not-yet-approved item's suggested due date,
  // keyed by template id. Nothing is written until they tap "+" — that's the
  // confirm. Absent = still showing the catalog's own suggested date.
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pdfLocale, setPdfLocale] = useState<Locale>(locale);
  const [pdfMode, setPdfMode] = useState<"progress" | "blank">("progress");
  const [includeDates, setIncludeDates] = useState(false);
  const [includeOwners, setIncludeOwners] = useState(false);
  const [remainingOnly, setRemainingOnly] = useState(false);
  const demoProgressApplied = useRef(false);

  useEffect(() => setPdfLocale(locale), [locale]);

  // Computed once per render so the catalog's compressed suggestions and each
  // added row's overdue check agree on what "today" is.
  const today = todayIso();

  const taskByTemplateId = useMemo(
    () =>
      new Map(
        items
          .filter((entry) => entry.checklist_template_id)
          .map((entry) => [entry.checklist_template_id as string, entry]),
      ),
    [items],
  );
  const sections = useMemo(
    () =>
      checklistSections(locale, weddingDate, today).map((section) => ({
        ...section,
        items: section.items.filter((entry) => isChecklistItemApplicable(entry, profile)),
      })),
    [locale, weddingDate, profile, today],
  );
  const applicable = sections.flatMap((section) => section.items);
  const added = applicable.filter((entry) => taskByTemplateId.has(entry.id));
  const completed = added.filter((entry) => taskByTemplateId.get(entry.id)?.done).length;
  const total = added.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  // Not-yet-approved items — what "Suggest deadlines" bulk-adds. Every one of
  // these already carries a catalog date that can't be in the past (the
  // wedding-date compression in checklistSections handles that), so there's
  // nothing left to confirm beyond the couple choosing to do this.
  const remaining = applicable.filter((entry) => !taskByTemplateId.has(entry.id));

  useEffect(() => {
    if (demoProgressApplied.current) return;
    demoProgressApplied.current = true;
    const applicableIds = new Set(applicable.map((entry) => entry.id));
    void applyStashedDemoProgress(applicableIds, taskByTemplateId, locale, onItemsChange);
  }, [applicable, taskByTemplateId, locale, onItemsChange]);

  async function addItem(template: (typeof applicable)[number]) {
    if (addingIds.has(template.id)) return;
    // Whatever the couple sees in the date field right now is what gets
    // written — the suggested default if they left it alone, their own edit
    // if they changed it, or no date at all if they cleared it.
    const confirmedDate = (dateOverrides[template.id] ?? template.dueDate ?? "").trim();
    setAddingIds((current) => new Set(current).add(template.id));
    try {
      const result = await planningApi.addChecklistItem(template.id, locale, confirmedDate || null);
      onItemsChange((current) => [
        ...current.filter((entry) => entry.id !== result.item.id),
        result.item,
      ]);
      setDateOverrides((current) => {
        if (!(template.id in current)) return current;
        const next = { ...current };
        delete next[template.id];
        return next;
      });
    } catch {
      toast.error(t("planning.checklist.add_error"));
    } finally {
      setAddingIds((current) => {
        const next = new Set(current);
        next.delete(template.id);
        return next;
      });
    }
  }

  /** Approves every not-yet-added catalog item at once, each with its own
   *  catalog-suggested date (already guaranteed sane by the wedding-date
   *  compression in checklistSections — never in the past, never later than
   *  the wedding day). One request per item, sequential like `bulkCreate` in
   *  PlanningPage, so the couple's own list order stays predictable and a
   *  failure partway through still keeps everything added so far. */
  async function applySuggestedDeadlines() {
    if (applyingAll || remaining.length === 0) return;
    setApplyingAll(true);
    let addedCount = 0;
    try {
      const created: PlanningItem[] = [];
      for (const template of remaining) {
        const result = await planningApi.addChecklistItem(template.id, locale, template.dueDate);
        created.push(result.item);
        addedCount += 1;
      }
      onItemsChange((current) => [
        ...current.filter((entry) => !created.some((item) => item.id === entry.id)),
        ...created,
      ]);
      if (addedCount > 0) {
        toast.success(t("planning.checklist.suggest_deadlines_done", { count: addedCount }));
      }
    } catch {
      toast.error(t("planning.checklist.add_error"));
    } finally {
      setApplyingAll(false);
    }
  }

  async function toggle(task: PlanningItem) {
    if (savingIds.has(task.id)) return;
    const nextDone = !task.done;
    const previous = task;
    setSavingIds((current) => new Set(current).add(task.id));
    onItemsChange((current) =>
      current.map((entry) => (entry.id === task.id ? { ...entry, done: nextDone } : entry)),
    );
    try {
      const result = await planningApi.update(task.id, { done: nextDone });
      onItemsChange((current) =>
        current.map((entry) => (entry.id === task.id ? result.item : entry)),
      );
    } catch {
      onItemsChange((current) => current.map((entry) => (entry.id === task.id ? previous : entry)));
      toast.error(t("planning.checklist.save_error"));
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchPdfBlob(
        weddingChecklistPdfUrl({
          locale: pdfLocale,
          blank: pdfMode === "blank",
          dates: includeDates,
          owners: includeOwners,
          remaining: remainingOnly,
        }),
      );
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "weddly-wedding-checklist.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadOpen(false);
    } catch {
      toast.error(t("planning.checklist.download_error"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section
      className="min-h-[36rem] border-t border-ink-900/10 py-7 sm:py-10 dark:border-paper-50/10"
      aria-labelledby="wedding-checklist-title"
      data-checklist-surface="persistent"
    >
      <h2 id="wedding-checklist-title" className="sr-only">
        {t("planning.checklist.title")}
      </h2>
      <div className="pb-2">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-h-48 flex-col justify-between rounded-lg bg-neutral-950 p-5 text-white sm:p-6 dark:border dark:border-paper-50/15 dark:bg-umber-950">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-sm font-medium text-white/60">
                  {t("planning.checklist.completed_count", { done: completed, total })}
                </p>
                <p className="mt-2 font-grotesk text-5xl font-semibold leading-none tracking-[-0.055em] tabular-nums sm:text-6xl">
                  {percent}%
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-white/10 text-white">
                <ClipboardCheck size={21} aria-hidden="true" />
              </span>
            </div>
            {weddingDate && remaining.length > 0 && (
              <button
                type="button"
                onClick={applySuggestedDeadlines}
                disabled={applyingAll}
                title={t("planning.checklist.suggest_deadlines_hint", { count: remaining.length })}
                className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-wait disabled:opacity-60"
              >
                {applyingAll ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
                {t("planning.checklist.suggest_deadlines_action")}
              </button>
            )}
            <div
              className="mt-8 h-1.5 overflow-hidden bg-white/20"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t("planning.checklist.percent_complete", { percent })}
            >
              <div
                className="h-full bg-white transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="flex min-h-48 flex-col justify-between rounded-lg border border-ink-900/15 bg-paper-50 p-5 sm:p-6 lg:w-72 dark:border-paper-50/15 dark:bg-umber-800">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-ink-900/[0.06] text-ink-900 dark:bg-paper-50/10 dark:text-paper-50">
              <Download size={20} aria-hidden="true" />
            </span>
            <div className="mt-7">
              <p className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {t("planning.checklist.download_title")}
              </p>
              <button
                type="button"
                onClick={() => setDownloadOpen((value) => !value)}
                aria-expanded={downloadOpen}
                aria-controls="wedding-checklist-download-options"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-white dark:focus-visible:ring-paper-100"
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                {t("planning.checklist.download_options")}
              </button>
            </div>
          </div>
        </div>

        {downloadOpen && (
          <section
            id="wedding-checklist-download-options"
            className="mt-3 rounded-lg border border-ink-900/15 bg-paper-50 p-5 sm:p-6 dark:border-paper-50/15 dark:bg-umber-800"
            aria-label={t("planning.checklist.download_title")}
          >
            <h3 className="font-grotesk text-xl font-semibold tracking-[-0.02em] text-ink-900 dark:text-paper-50">
              {t("planning.checklist.download_title")}
            </h3>
            <p className="mt-1.5 text-sm text-ink-600 dark:text-umber-200">
              {t("planning.checklist.download_body")}
            </p>
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500 dark:text-umber-300">
                {t("planning.checklist.pdf_language")}
              </legend>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-ink-900/15 bg-ink-900/10 sm:grid-cols-5 dark:border-paper-50/15 dark:bg-paper-50/10">
                {LOCALES.map((option) => (
                  <label
                    key={option}
                    className={`flex min-h-11 cursor-pointer items-center justify-center px-3 py-2 text-center text-sm font-semibold transition-colors ${pdfLocale === option ? "bg-neutral-950 text-white dark:bg-paper-100 dark:text-umber-900" : "bg-paper-50 text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:bg-umber-800 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-paper-50"}`}
                  >
                    <input
                      type="radio"
                      name="checklist-pdf-locale"
                      value={option}
                      checked={pdfLocale === option}
                      onChange={() => setPdfLocale(option)}
                      className="sr-only"
                    />
                    {LOCALE_NAMES[option]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-md border p-4 transition-colors ${pdfMode === "progress" ? "border-neutral-950 bg-neutral-950 text-white dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900" : "border-ink-900/15 text-ink-900 hover:border-ink-900/40 dark:border-paper-50/15 dark:text-paper-50 dark:hover:border-paper-50/40"}`}
              >
                <input
                  type="radio"
                  name="checklist-pdf-mode"
                  checked={pdfMode === "progress"}
                  onChange={() => setPdfMode("progress")}
                  className="h-4 w-4 shrink-0 accent-white dark:accent-neutral-950"
                />
                <span className="text-sm font-medium">{t("planning.checklist.pdf_progress")}</span>
              </label>
              <label
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-md border p-4 transition-colors ${pdfMode === "blank" ? "border-neutral-950 bg-neutral-950 text-white dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900" : "border-ink-900/15 text-ink-900 hover:border-ink-900/40 dark:border-paper-50/15 dark:text-paper-50 dark:hover:border-paper-50/40"}`}
              >
                <input
                  type="radio"
                  name="checklist-pdf-mode"
                  checked={pdfMode === "blank"}
                  onChange={() => setPdfMode("blank")}
                  className="h-4 w-4 shrink-0 accent-white dark:accent-neutral-950"
                />
                <span className="text-sm font-medium">{t("planning.checklist.pdf_blank")}</span>
              </label>
            </div>
            <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-ink-900/15 bg-ink-900/10 sm:grid-cols-3 dark:border-paper-50/15 dark:bg-paper-50/10">
              <PdfOption
                checked={includeDates}
                onChange={setIncludeDates}
                label={t("planning.checklist.include_dates")}
              />
              <PdfOption
                checked={includeOwners}
                onChange={setIncludeOwners}
                label={t("planning.checklist.include_owners")}
              />
              <PdfOption
                checked={remainingOnly}
                onChange={setRemainingOnly}
                label={t("planning.checklist.only_remaining")}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={downloading}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-white dark:focus-visible:ring-paper-100"
              >
                {downloading ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                {t("planning.checklist.download_action")}
              </button>
            </div>
          </section>
        )}

        <div className="sticky top-2 z-20 my-6 flex justify-center sm:my-8">
          <div
            className="inline-grid w-full grid-cols-3 rounded-lg border border-ink-900/15 bg-paper-50/95 p-1 shadow-soft backdrop-blur sm:w-auto dark:border-paper-50/15 dark:bg-umber-900/95"
            role="radiogroup"
            aria-label={t("planning.checklist.title")}
          >
            {(["all", "todo", "done"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-10 min-w-24 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${filter === value ? "bg-neutral-950 text-white dark:bg-paper-100 dark:text-umber-900" : "text-ink-600 hover:bg-ink-900/[0.06] hover:text-ink-900 dark:text-umber-200 dark:hover:bg-paper-50/10 dark:hover:text-paper-50"}`}
              >
                {t(`planning.checklist.filter_${value}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-2" data-checklist-layout="two-column">
          {sections.map((section) => {
            const rows = section.items.flatMap((template): ChecklistRow[] => {
              const task = taskByTemplateId.get(template.id) ?? null;
              if (task) {
                if (filter === "todo" && task.done) return [];
                if (filter === "done" && !task.done) return [];
                return [{ template, task }];
              }
              if (filter === "all") return [{ template, task: null }];
              return [];
            });
            if (rows.length === 0) return null;
            const sectionAdded = section.items.filter((entry) => taskByTemplateId.has(entry.id));
            const sectionDone = sectionAdded.filter(
              (entry) => taskByTemplateId.get(entry.id)?.done,
            ).length;
            const complete = sectionAdded.length > 0 && sectionDone === sectionAdded.length;
            return (
              <section
                key={section.id}
                className="overflow-hidden rounded-lg border border-ink-900/15 bg-paper-50 dark:border-paper-50/15 dark:bg-umber-800"
              >
                <div className="flex min-h-16 items-center justify-between gap-3 border-b border-ink-900/10 bg-ink-900/[0.035] px-4 py-3.5 sm:px-5 dark:border-paper-50/10 dark:bg-paper-50/[0.035]">
                  <h3 className="font-grotesk text-base font-semibold tracking-[-0.015em] text-ink-900 dark:text-paper-50">
                    {section.title}
                  </h3>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums ${complete ? "bg-sage-100 text-sage-800 dark:bg-sage-400/15 dark:text-sage-300" : "bg-ink-900/[0.07] text-ink-600 dark:bg-paper-50/10 dark:text-umber-200"}`}
                  >
                    {sectionAdded.length > 0
                      ? t("planning.checklist.section_count", {
                          done: sectionDone,
                          total: sectionAdded.length,
                        })
                      : t("planning.checklist.section_suggestions", {
                          count: section.items.length,
                        })}
                    {complete && (
                      <Check size={12} aria-label={t("planning.checklist.section_complete")} />
                    )}
                  </span>
                </div>
                <ul className="divide-y divide-ink-900/10 dark:divide-paper-50/10">
                  {rows.map(({ template, task }) => {
                    const status = task ? timelineStatus(task.due_date, task.done, today) : null;
                    return task ? (
                      <li
                        key={template.id}
                        className="group flex min-w-0 items-start gap-3 px-4 py-4 transition-colors hover:bg-ink-900/[0.025] sm:px-5 dark:hover:bg-paper-50/[0.025]"
                      >
                        <label className="inline-flex shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={() => toggle(task)}
                            disabled={savingIds.has(task.id)}
                            aria-label={
                              task.done ? t("planning.mark_undone") : t("planning.mark_done")
                            }
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-950 peer-focus-visible:ring-offset-2 peer-disabled:cursor-wait peer-disabled:opacity-60 dark:peer-focus-visible:ring-paper-100 ${task.done ? "border-neutral-950 bg-neutral-950 text-white dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900" : "border-ink-400 bg-paper-50 text-transparent group-hover:border-ink-900 dark:border-umber-300 dark:bg-umber-800 dark:group-hover:border-paper-100"}`}
                          >
                            {savingIds.has(task.id) ? (
                              <Loader2
                                size={13}
                                className="animate-spin text-ink-500"
                                aria-hidden="true"
                              />
                            ) : (
                              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                            )}
                          </span>
                        </label>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`break-words text-sm font-medium leading-5 ${task.done ? "text-ink-400 line-through dark:text-umber-300" : "text-ink-900 dark:text-paper-50"}`}
                          >
                            {template.title}
                          </p>
                          {(task.due_date || task.assignee) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
                              {task.due_date && (
                                <span className="inline-flex items-center gap-1">
                                  <CalendarDays size={12} aria-hidden="true" />
                                  {t("planning.checklist.due_date", {
                                    date: formatShortDate(task.due_date, locale),
                                  })}
                                </span>
                              )}
                              {status === "overdue" && (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-blush-500 px-2 py-0.5 text-[11px] font-medium text-paper-50">
                                  {t("planning.status_overdue")}
                                </span>
                              )}
                              {status === "due_soon" && (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-blush-50 px-2 py-0.5 text-[11px] font-medium text-blush-700 ring-1 ring-blush-200 dark:bg-blush-400/15 dark:text-blush-300 dark:ring-blush-400/30">
                                  {t("planning.status_due_soon")}
                                </span>
                              )}
                              {task.assignee && (
                                <span className="inline-flex min-w-0 items-center gap-1">
                                  <UserRound size={12} className="shrink-0" aria-hidden="true" />
                                  <span className="break-words">
                                    {t("planning.checklist.owner", { name: task.assignee })}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ) : (
                      <li
                        key={template.id}
                        className="group flex min-w-0 items-start gap-3 px-4 py-4 transition-colors hover:bg-ink-900/[0.025] sm:px-5 dark:hover:bg-paper-50/[0.025]"
                      >
                        <button
                          type="button"
                          onClick={() => addItem(template)}
                          disabled={addingIds.has(template.id)}
                          aria-label={t("planning.checklist.add_action")}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 border-dashed border-ink-300 text-ink-400 transition-colors hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-umber-500 dark:text-umber-300 dark:hover:border-paper-100 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
                        >
                          {addingIds.has(template.id) ? (
                            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium leading-5 text-ink-900 dark:text-paper-50">
                            {template.title}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
                            <CalendarDays size={12} className="shrink-0" aria-hidden="true" />
                            <input
                              type="date"
                              value={dateOverrides[template.id] ?? template.dueDate ?? ""}
                              onChange={(e) =>
                                setDateOverrides((current) => ({
                                  ...current,
                                  [template.id]: e.target.value,
                                }))
                              }
                              aria-label={t("planning.due_date_label")}
                              className="shrink-0 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PdfOption({
  checked,
  onChange,
  label,
}: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 bg-paper-50 px-4 py-3 text-ink-900 dark:bg-umber-800 dark:text-paper-50">
      <span className="text-sm font-medium leading-5">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-ink-900/15 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-neutral-950 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-950 peer-focus-visible:ring-offset-2 dark:bg-paper-50/20 dark:peer-checked:bg-paper-100 dark:peer-checked:after:bg-umber-900 dark:peer-focus-visible:ring-paper-100"
      />
    </label>
  );
}
