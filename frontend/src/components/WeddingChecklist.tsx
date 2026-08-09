// Persistent fourth Planning surface. This deliberately is not a Dialog: its
// progress, filters, and two-column task list stay visible and trackable in the
// normal page flow.
import { checklistSections, isChecklistItemApplicable } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  Loader2,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  fetchPdfBlob,
  planningApi,
  type PlanningPromptTags,
  weddingChecklistPdfUrl,
} from "../lib/endpoints";
import { useToast } from "./ui";
import { type Locale, useT } from "../lib/i18n";

type ChecklistFilter = "all" | "todo" | "done";

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

export function WeddingChecklist({
  items,
  onItemsChange,
  weddingDate,
  profile,
}: WeddingChecklistProps) {
  const { t, locale } = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [initializing, setInitializing] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<number>>(() => new Set());
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pdfMode, setPdfMode] = useState<"progress" | "blank">("progress");
  const [includeDates, setIncludeDates] = useState(false);
  const [includeOwners, setIncludeOwners] = useState(false);
  const [remainingOnly, setRemainingOnly] = useState(false);

  const taskByTemplateId = useMemo(
    () =>
      new Map(
        items
          .filter((entry) => entry.checklist_template_id)
          .map((entry) => [entry.checklist_template_id as string, entry]),
      ),
    [items],
  );
  const initialized = taskByTemplateId.size > 0;
  const sections = useMemo(
    () =>
      checklistSections(locale, weddingDate).map((section) => ({
        ...section,
        items: section.items.filter((entry) => isChecklistItemApplicable(entry, profile)),
      })),
    [locale, weddingDate, profile],
  );
  const applicable = sections.flatMap((section) => section.items);
  const completed = applicable.filter((entry) => taskByTemplateId.get(entry.id)?.done).length;
  const total = applicable.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  async function initialize() {
    if (initializing) return;
    setInitializing(true);
    try {
      const result = await planningApi.initializeChecklist(locale);
      onItemsChange(() => result.items);
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setInitializing(false);
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
          locale,
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
      {!initialized ? (
        <div className="flex min-h-[26rem] flex-col items-center justify-center px-4 py-12 text-center">
          <span className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-950 text-white dark:bg-paper-100 dark:text-neutral-950">
            <ClipboardCheck size={30} aria-hidden="true" />
          </span>
          <h2
            id="wedding-checklist-title"
            className="font-grotesk text-2xl font-semibold tracking-[-0.025em] text-ink-900 sm:text-3xl dark:text-paper-50"
          >
            {t("planning.checklist.create_title")}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-ink-600 dark:text-umber-200">
            {t("planning.checklist.create_body")}
          </p>
          <button
            type="button"
            onClick={initialize}
            disabled={initializing}
            className="btn-primary mt-6 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {initializing ? (
              <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            ) : (
              <ClipboardCheck size={17} aria-hidden="true" />
            )}
            {initializing
              ? t("planning.checklist.initializing")
              : t("planning.checklist.create_action")}
          </button>
        </div>
      ) : (
        <div className="pb-2">
          <header className="mb-7 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <h2
                id="wedding-checklist-title"
                className="font-grotesk text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-900 sm:text-4xl dark:text-paper-50"
              >
                {t("planning.checklist.title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-600 sm:text-base dark:text-umber-200">
                {t("planning.checklist.subtitle")}
              </p>
            </div>
          </header>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-h-48 flex-col justify-between rounded-lg bg-neutral-950 p-5 text-white sm:p-6 dark:bg-black">
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
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
                  <span className="text-sm font-medium">
                    {t("planning.checklist.pdf_progress")}
                  </span>
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
              const rows = section.items.flatMap((template) => {
                const task = taskByTemplateId.get(template.id);
                if (!task) return [];
                if (filter === "todo" && task.done) return [];
                if (filter === "done" && !task.done) return [];
                return [{ template, task }];
              });
              if (rows.length === 0) return null;
              const sectionDone = section.items.filter(
                (entry) => taskByTemplateId.get(entry.id)?.done,
              ).length;
              const complete = section.items.length > 0 && sectionDone === section.items.length;
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
                      {t("planning.checklist.section_count", {
                        done: sectionDone,
                        total: section.items.length,
                      })}
                      {complete && (
                        <Check size={12} aria-label={t("planning.checklist.section_complete")} />
                      )}
                    </span>
                  </div>
                  <ul className="divide-y divide-ink-900/10 dark:divide-paper-50/10">
                    {rows.map(({ template, task }) => (
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
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
                              {task.due_date && (
                                <span className="inline-flex items-center gap-1">
                                  <CalendarDays size={12} aria-hidden="true" />
                                  {t("planning.checklist.due_date", {
                                    date: formatShortDate(task.due_date, locale),
                                  })}
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
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
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
