// "Ütemező varázsló" — the magic-wand dialog launched from the undated-tasks
// card. For every dateless task it proposes a DUE date (backwards-planned off
// the wedding day by task type, see shared/planning_wand.ts), orders them by
// priority-then-deadline, and lets the couple drag to re-prioritise and tweak
// each date before applying the lot in one round-trip. Clearing a row's date
// skips it (stays undated). There is no AI in the loop — the suggestions are a
// deterministic runway plan.

import { suggestSchedule, wandLeadFor } from "@shared/planning_wand";
import { parseIsoDate, toIsoDate } from "@shared/planning_timeline";
import type { PlanningItem } from "@shared/types";
import { ArrowDown, ArrowUp, GripVertical, Sparkles, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { planningApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

interface WandRow {
  id: number;
  title: string;
  priority: 0 | 1 | 2;
  /** YYYY-MM-DD, or "" to skip this task (leave it undated). */
  due: string;
  /** Gantt window in days; start_date = due − windowDays on apply. */
  windowDays: number;
  /** Existing position, used to permute this task's own order slot on apply so
   *  re-prioritising the undated set doesn't shove dated tasks around. */
  basePosition: number;
}

function subtractDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

function buildRows(tasks: PlanningItem[], weddingDateIso: string | null): WandRow[] {
  const rows: WandRow[] = tasks.map((task) => {
    const suggestion = suggestSchedule(task, weddingDateIso);
    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      due: suggestion?.due_date ?? "",
      windowDays: wandLeadFor(task).windowDays,
      basePosition: task.position,
    };
  });
  // Default order: important flag first (!! before !), then earliest deadline,
  // undated rows last, then the existing position as a stable tie-break.
  return rows.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return a.basePosition - b.basePosition;
  });
}

export default function ScheduleWand({
  tasks,
  weddingDateIso,
  onClose,
  onApplied,
}: {
  tasks: PlanningItem[];
  weddingDateIso: string | null;
  onClose: () => void;
  onApplied: (items: PlanningItem[]) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [rows, setRows] = useState<WandRow[]>(() => buildRows(tasks, weddingDateIso));
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const applyCount = useMemo(() => rows.filter((r) => r.due).length, [rows]);

  function move(index: number, dir: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const [row] = next.splice(index, 1);
      if (row) next.splice(target, 0, row);
      return next;
    });
  }

  function reorderTo(targetId: number) {
    setRows((prev) => {
      if (draggingId === null || draggingId === targetId) return prev;
      const from = prev.findIndex((r) => r.id === draggingId);
      const to = prev.findIndex((r) => r.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      if (row) next.splice(to, 0, row);
      return next;
    });
  }

  function setDue(id: number, due: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, due } : r)));
  }

  async function apply() {
    // Only rows that still carry a date get scheduled. To re-prioritise without
    // displacing dated tasks, permute the applied rows into their own existing
    // position slots (sorted ascending) following the new visual order.
    const applied = rows.filter((r) => r.due);
    if (applied.length === 0) return;
    const slots = applied.map((r) => r.basePosition).sort((a, b) => a - b);
    const updates = applied.map((r, i) => ({
      id: r.id,
      due_date: r.due,
      start_date: subtractDays(r.due, r.windowDays),
      position: slots[i] ?? r.basePosition,
    }));
    setSaving(true);
    try {
      const res = await planningApi.applySchedule(updates);
      onApplied(res.items);
      toast.success(t("timeline.wand_applied", { count: res.applied }));
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("timeline.wand_title")}
        className="card relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl p-0 shadow-pop sm:rounded-3xl dark:bg-umber-800 dark:border-umber-700"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-50 text-blush-600 dark:bg-blush-400/15 dark:text-blush-300">
              <Wand2 size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
                {t("timeline.wand_title")}
              </h2>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-umber-300">
                {t("timeline.wand_subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {!weddingDateIso && (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
            {t("timeline.wand_no_wedding_date")}
          </div>
        )}

        <ul className="min-h-0 flex-1 divide-y divide-paper-200 overflow-y-auto dark:divide-umber-700">
          {rows.map((row, index) => (
            <li
              key={row.id}
              draggable
              onDragStart={() => setDraggingId(row.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(e) => {
                e.preventDefault();
                reorderTo(row.id);
              }}
              className={`flex items-center gap-2 px-3 py-2.5 sm:px-4 ${
                draggingId === row.id ? "opacity-50" : ""
              } ${row.due ? "" : "opacity-60"}`}
            >
              <span
                className="hidden shrink-0 cursor-grab text-ink-300 active:cursor-grabbing sm:inline-flex dark:text-umber-500"
                aria-hidden="true"
              >
                <GripVertical size={16} />
              </span>
              <div className="flex shrink-0 flex-col sm:hidden">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="text-ink-400 disabled:opacity-30 dark:text-umber-400"
                  aria-label={t("timeline.wand_move_up")}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                  className="text-ink-400 disabled:opacity-30 dark:text-umber-400"
                  aria-label={t("timeline.wand_move_down")}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
              {row.priority > 0 && (
                <span
                  className="shrink-0 font-sans text-xs font-bold text-blush-600 dark:text-blush-300"
                  aria-hidden="true"
                >
                  {row.priority === 2 ? "!!" : "!"}
                </span>
              )}
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  row.due
                    ? "text-ink-900 dark:text-paper-50"
                    : "text-ink-500 line-through dark:text-umber-300"
                }`}
                title={row.title}
              >
                {row.title}
              </span>
              <input
                type="date"
                value={row.due}
                onChange={(e) => setDue(row.id, e.target.value)}
                className="shrink-0 rounded-md border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-ink-900 focus:border-blush-400 focus:outline-none focus:ring-1 focus:ring-blush-400 dark:border-umber-600 dark:bg-umber-900 dark:text-paper-50"
                aria-label={t("timeline.wand_deadline_for", { title: row.title })}
              />
            </li>
          ))}
        </ul>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-paper-200 px-5 py-4 dark:border-umber-700">
          <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-umber-200">
            <Sparkles size={14} className="text-blush-400 dark:text-blush-300" aria-hidden="true" />
            <span>{t("timeline.wand_apply_count", { count: applyCount })}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={applyCount === 0 || saving}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("timeline.wand_apply")}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
