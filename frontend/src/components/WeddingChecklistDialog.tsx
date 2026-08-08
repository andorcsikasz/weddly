import { checklistSections, isChecklistItemApplicable } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import { CalendarDays, Check, ClipboardCheck, Download, Loader2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "./ui";
import {
  fetchPdfBlob,
  planningApi,
  type PlanningPromptTags,
  weddingChecklistPdfUrl,
} from "../lib/endpoints";
import { useToast } from "./ui";
import { type Locale, useT } from "../lib/i18n";

type ChecklistFilter = "all" | "todo" | "done";

interface WeddingChecklistDialogProps {
  open: boolean;
  onClose: () => void;
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

export function WeddingChecklistDialog({
  open,
  onClose,
  items,
  onItemsChange,
  weddingDate,
  profile,
}: WeddingChecklistDialogProps) {
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
    <Dialog
      open={open}
      onClose={onClose}
      title={t("planning.checklist.title")}
      role="dialog"
      size="xl"
      closeOnBackdrop
      titleClassName="text-2xl sm:text-3xl"
    >
      {!initialized ? (
        <div className="flex min-h-[26rem] flex-col items-center justify-center px-4 py-12 text-center">
          <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-ink-700 dark:bg-umber-700 dark:text-paper-100">
            <ClipboardCheck size={30} aria-hidden="true" />
          </span>
          <h3 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">
            {t("planning.checklist.create_title")}
          </h3>
          <p className="mt-2 max-w-md text-sm text-ink-600 dark:text-umber-200">
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
          <div className="flex flex-col gap-4 border-b border-paper-200 pb-5 dark:border-umber-700 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("planning.checklist.subtitle")}
              </p>
              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink-900 dark:text-paper-50">
                  {t("planning.checklist.completed_count", { done: completed, total })}
                </span>
                <span className="text-sm font-semibold text-ink-600 dark:text-umber-200">
                  {t("planning.checklist.percent_complete", { percent })}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="h-full rounded-full bg-sage-600 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDownloadOpen((value) => !value)}
              className="btn-primary inline-flex w-full shrink-0 items-center justify-center gap-2 lg:w-auto"
            >
              <Download size={16} aria-hidden="true" />
              {t("planning.checklist.download")}
            </button>
          </div>

          {downloadOpen && (
            <section
              className="mt-4 rounded-2xl border border-paper-300 bg-paper-100/70 p-4 dark:border-umber-600 dark:bg-umber-700/50"
              aria-label={t("planning.checklist.download_title")}
            >
              <h3 className="font-grotesk text-base text-ink-900 dark:text-paper-50">
                {t("planning.checklist.download_title")}
              </h3>
              <p className="mt-1 text-xs text-ink-600 dark:text-umber-200">
                {t("planning.checklist.download_body")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="checklist-pdf-mode"
                    checked={pdfMode === "progress"}
                    onChange={() => setPdfMode("progress")}
                    className="h-4 w-4 accent-ink-800"
                  />
                  <span>{t("planning.checklist.pdf_progress")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="checklist-pdf-mode"
                    checked={pdfMode === "blank"}
                    onChange={() => setPdfMode("blank")}
                    className="h-4 w-4 accent-ink-800"
                  />
                  <span>{t("planning.checklist.pdf_blank")}</span>
                </label>
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
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={downloading}
                  className="btn-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto disabled:opacity-60"
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

          <div
            className="my-5 flex flex-wrap gap-2"
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
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${filter === value ? "border-ink-800 bg-ink-800 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900" : "border-paper-300 text-ink-600 hover:bg-paper-100 dark:border-umber-600 dark:text-umber-200 dark:hover:bg-umber-700"}`}
              >
                {t(`planning.checklist.filter_${value}`)}
              </button>
            ))}
          </div>

          <div className="space-y-7">
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
                <section key={section.id}>
                  <div className="mb-2 flex items-center justify-between gap-3 border-b border-paper-200 pb-2 dark:border-umber-700">
                    <h3 className="font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-600 dark:text-umber-200">
                      {section.title}
                    </h3>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${complete ? "bg-sage-100 text-sage-800 dark:bg-sage-400/15 dark:text-sage-300" : "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-umber-200"}`}
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
                  <ul className="divide-y divide-paper-200 dark:divide-umber-700">
                    {rows.map(({ template, task }) => (
                      <li key={template.id} className="flex min-w-0 items-start gap-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggle(task)}
                          disabled={savingIds.has(task.id)}
                          aria-label={
                            task.done ? t("planning.mark_undone") : t("planning.mark_done")
                          }
                          aria-pressed={task.done}
                          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-60 ${task.done ? "border-sage-600 bg-sage-600 text-white" : "border-ink-400 bg-paper-50 text-transparent hover:border-ink-700 dark:border-umber-300 dark:bg-umber-800"}`}
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
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`break-words text-sm leading-5 ${task.done ? "text-ink-400 line-through dark:text-umber-300" : "text-ink-900 dark:text-paper-50"}`}
                          >
                            {template.title}
                          </p>
                          {(task.due_date || task.assignee) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500 dark:text-umber-300">
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
    </Dialog>
  );
}

function PdfOption({
  checked,
  onChange,
  label,
}: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded accent-ink-800"
      />
      <span>{label}</span>
    </label>
  );
}
