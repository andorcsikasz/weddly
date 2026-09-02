// Public, no-auth wedding checklist widget — same canonical data as the real
// Planning > Checklist tab (WeddingChecklist.tsx), but with zero backend calls
// of its own. In `teaser` mode (the landing page) it is a single stat card:
// title, live progress, download — clicking the card hands the visitor off to
// the full tool page rather than expanding a section list in place. The full
// section-by-section accordion with per-item checkboxes only renders when
// `teaser` is false (the dedicated /eszkozok tool page). Checking an item
// there is the one action that surfaces the "save this" invitation, since
// there is nowhere to persist a check-mark without a couple workspace. The
// checked set lives in localStorage under CHECKLIST_DEMO_PROGRESS_KEY, so
// WeddingChecklist's initialize() can replay it onto the couple's real
// checklist right after signup — see the read of that key there for the
// other half of the handoff.

import { ArrowRight, Check, ChevronDown, ClipboardCheck, Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toolPathFor } from "@shared/tool_faq";
import type { ChecklistSectionId } from "@shared/wedding_checklist";
import { checklistSections, isChecklistItemApplicable } from "@shared/wedding_checklist";
import { fetchPdfBlob, publicWeddingChecklistPdfUrl } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export const CHECKLIST_DEMO_PROGRESS_KEY = "weddly.checklist_demo_progress";
const DISMISS_SESSION_KEY = "weddly.checklist_demo_convert_dismissed";

function loadStashedProgress(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CHECKLIST_DEMO_PROGRESS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

function saveStashedProgress(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHECKLIST_DEMO_PROGRESS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage can throw in private mode / quota — the demo still works
    // locally, it just won't carry the progress into signup.
  }
}

function convertAlreadyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function PublicWeddingChecklist({
  previewSectionCount = 3,
  teaser = false,
  showHeader = true,
}: {
  /** How many sections start expanded. Only matters when `teaser` is false —
   *  the dedicated tool page passes a number ≥ the section count so
   *  everything is open. Every section header and item count is always
   *  visible either way — this only controls the default fold. */
  previewSectionCount?: number;
  /** Landing-page mode: title, live progress and download only, no section
   *  list. The progress card becomes a link to the full tool page — the
   *  actual checking-things-off experience lives there. */
  teaser?: boolean;
  /** The "Try your wedding checklist" title + subtitle. Off on the dedicated
   *  tool page, which already carries its own SEO h1 + intro right above
   *  this component — both together read as the same heading said twice. */
  showHeader?: boolean;
}) {
  const { t, locale } = useT();
  const toolHref = toolPathFor(locale, "wedding_checklist");
  const sections = useMemo(
    () =>
      checklistSections(locale).map((section) => ({
        ...section,
        items: section.items.filter((entry) => isChecklistItemApplicable(entry, {})),
      })),
    [locale],
  );
  const [openIds, setOpenIds] = useState<Set<ChecklistSectionId>>(
    () => new Set(sections.slice(0, previewSectionCount).map((section) => section.id)),
  );
  const [checked, setChecked] = useState<Set<string>>(() => loadStashedProgress());
  const [dismissed, setDismissed] = useState(() => convertAlreadyDismissed());
  const [downloading, setDownloading] = useState(false);

  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const done = checked.size;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  function toggleOpen(id: ChecklistSectionId) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleItem(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStashedProgress(next);
      return next;
    });
  }

  function dismissConvert() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_SESSION_KEY, "1");
    } catch {
      // ignore — worst case the card reappears next click, which is harmless
    }
  }

  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchPdfBlob(publicWeddingChecklistPdfUrl(locale));
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "weddly-wedding-checklist.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Best-effort on a marketing page — no toast infra out here. A failed
      // click is simply a click the visitor can retry.
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="relative bg-paper-50 dark:bg-umber-900">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        {showHeader && (
          <div className="text-center">
            <h2 className="font-grotesk text-xl font-semibold leading-[1.15] tracking-tight text-umber-900 sm:text-3xl lg:text-4xl dark:text-paper-50">
              {t("landing.checklist_demo_title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-umber-700 sm:text-base dark:text-umber-300">
              {t("landing.checklist_demo_subtitle")}
            </p>
          </div>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          {teaser ? (
            <Link
              to={toolHref}
              className="group rounded-2xl bg-neutral-950 p-5 text-white transition-shadow hover:shadow-pop sm:p-6 dark:bg-black"
            >
              <StatCardBody t={t} done={done} total={total} percent={percent} />
              <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/80 transition-colors group-hover:text-white">
                {t("landing.checklist_demo_open_link")}
                <ArrowRight size={14} aria-hidden="true" />
              </p>
            </Link>
          ) : (
            <div className="rounded-2xl bg-neutral-950 p-5 text-white sm:p-6 dark:bg-black">
              <StatCardBody t={t} done={done} total={total} percent={percent} />
            </div>
          )}
          <button
            type="button"
            onClick={downloadPdf}
            disabled={downloading}
            className="btn-outline btn-lifted inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {t("landing.checklist_demo_download")}
          </button>
        </div>

        {checked.size > 0 && !dismissed && (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl bg-white p-5 shadow-pop ring-1 ring-paper-300 sm:flex-row sm:items-center sm:justify-between dark:bg-umber-800 dark:ring-umber-700">
            <div>
              <p className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
                {t("landing.checklist_demo_convert_title")}
              </p>
              <p className="mt-1 text-sm text-umber-700 dark:text-umber-300">
                {t("landing.checklist_demo_convert_body")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <button
                type="button"
                onClick={dismissConvert}
                className="text-sm font-medium text-umber-600 underline-offset-4 hover:underline dark:text-umber-300"
              >
                {t("landing.checklist_demo_convert_dismiss")}
              </button>
              <Link
                to="/signup?source=checklist"
                className="btn-primary btn-lifted whitespace-nowrap"
              >
                {t("landing.checklist_demo_convert_cta")}
              </Link>
            </div>
          </div>
        )}

        {!teaser && (
          <div className="mt-6 space-y-3">
            {sections.map((section) => {
              const sectionDone = section.items.filter((entry) => checked.has(entry.id)).length;
              const open = openIds.has(section.id);
              return (
                <div
                  key={section.id}
                  className="overflow-hidden rounded-xl border border-ink-900/15 bg-white dark:border-paper-50/15 dark:bg-umber-800"
                >
                  <button
                    type="button"
                    onClick={() => toggleOpen(section.id)}
                    aria-expanded={open}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
                  >
                    <span className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
                      {section.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums text-ink-500 dark:text-umber-300">
                        {sectionDone}/{section.items.length}
                      </span>
                      <ChevronDown
                        size={16}
                        aria-hidden="true"
                        className={`text-ink-500 transition-transform dark:text-umber-300 ${open ? "" : "-rotate-90"}`}
                      />
                    </span>
                  </button>
                  {open && (
                    <ul className="divide-y divide-ink-900/10 border-t border-ink-900/10 dark:divide-paper-50/10 dark:border-paper-50/10">
                      {section.items.map((entry) => {
                        const isChecked = checked.has(entry.id);
                        return (
                          <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                            <label className="inline-flex shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleItem(entry.id)}
                                className="peer sr-only"
                                aria-label={entry.title}
                              />
                              <span
                                aria-hidden="true"
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-colors ${
                                  isChecked
                                    ? "border-neutral-950 bg-neutral-950 text-white dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                                    : "border-ink-400 bg-paper-50 text-transparent dark:border-umber-300 dark:bg-umber-800"
                                }`}
                              >
                                <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                              </span>
                            </label>
                            <p
                              className={`text-sm leading-5 ${
                                isChecked
                                  ? "text-ink-400 line-through dark:text-umber-400"
                                  : "text-ink-800 dark:text-paper-100"
                              }`}
                            >
                              {entry.title}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function StatCardBody({
  t,
  done,
  total,
  percent,
}: {
  t: ReturnType<typeof useT>["t"];
  done: number;
  total: number;
  percent: number;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-white/60">
            {t("landing.checklist_demo_progress_label", { done, total })}
          </p>
          <p className="mt-1 font-grotesk text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-5xl">
            {percent}%
          </p>
        </div>
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
          <ClipboardCheck size={20} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  );
}
