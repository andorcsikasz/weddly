// Dashboard "your upcoming tasks" card. Sits directly below the setup checklist
// and hands the baton from the finite onboarding ritual to the couple's living
// plan. Self-fetches the planning items and surfaces the next dated, undone
// wedding tasks — rendered like the onboarding checklist (checkmark + label) but
// with real due chips, assignees, and an inline toggle that actually ticks them
// off. The "is anything overdue" classification reuses the shared `timelineStatus`
// classifier, so this never drifts from the timeline page, the bell, or the
// email nudge — there is one brain, this is just another view of it.

import type { PlanningItem } from "@shared/types";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { planningApi } from "../lib/endpoints";
import { todayIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const MAX_ROWS = 5;
const MS_PER_DAY = 86_400_000;

/** Whole days from today to an ISO due date (negative = overdue). Both sides are
 *  parsed at UTC midnight so DST and local offset never shift the count. */
function daysUntil(dueIso: string, today: string): number {
  const due = Date.parse(`${dueIso}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.round((due - now) / MS_PER_DAY);
}

/** A dated, undone wedding task that hasn't happened yet — sorted soonest-first
 *  (overdue naturally floats to the top), capped, ready to render. */
function selectUpcoming(items: PlanningItem[]): PlanningItem[] {
  return items
    .filter(
      (it) => it.kind === "task" && !it.done && it.due_date !== null && it.topic !== "honeymoon",
    )
    .sort((a, b) => {
      // due_date is non-null here (filtered above); ISO strings sort lexically.
      const byDate = (a.due_date as string).localeCompare(b.due_date as string);
      if (byDate !== 0) return byDate;
      if (a.priority !== b.priority) return b.priority - a.priority; // "!!" before "!"
      return a.id - b.id; // stable tiebreak
    })
    .slice(0, MAX_ROWS);
}

export function UpcomingTasksCard({ weddingDate }: { weddingDate: string | null }) {
  const { t } = useT();
  const toast = useToast();
  const [items, setItems] = useState<PlanningItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    planningApi
      .list()
      .then((res) => {
        if (!cancelled) setItems(Array.isArray(res.items) ? res.items : []);
      })
      .catch(() => {
        // Non-critical — the card just stays hidden until the next load.
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Still loading: render nothing rather than a skeleton — the onboarding card
  // above already anchors the section.
  if (items === null) return null;

  const today = todayIso();
  const upcoming = selectUpcoming(items);
  const hasAnyTask = items.some((it) => it.kind === "task");
  const totalUpcoming = items.filter(
    (it) => it.kind === "task" && !it.done && it.due_date !== null && it.topic !== "honeymoon",
  ).length;

  /** Optimistic done-toggle. The row no longer qualifies once done, so it drops
   *  out of `upcoming` on the next render. Revert + toast on failure. */
  async function toggleDone(item: PlanningItem) {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === item.id ? { ...it, done: true } : it)) : prev,
    );
    try {
      await planningApi.update(item.id, { done: true });
    } catch (e) {
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === item.id ? { ...it, done: false } : it)) : prev,
      );
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  function dueChip(dueIso: string) {
    const d = daysUntil(dueIso, today);
    if (d < 0) {
      return {
        label: t("dashboard.upcoming_due_overdue", { n: -d }),
        tone: "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
      };
    }
    if (d === 0) {
      return {
        label: t("dashboard.upcoming_due_today"),
        tone: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
      };
    }
    return {
      label: t("dashboard.upcoming_due_in", { n: d }),
      tone: "bg-paper-200 text-umber-600 dark:bg-umber-700 dark:text-umber-200",
    };
  }

  return (
    <section className="card mb-8 p-0 font-grotesk">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <h2 className="min-w-0 flex-1 truncate font-grotesk text-base font-medium text-umber-900 md:text-lg md:font-semibold dark:text-paper-50">
          {t("dashboard.upcoming_title")}
        </h2>
        {upcoming.length > 0 && (
          <span className="shrink-0 text-xs text-umber-500 dark:text-umber-300">
            {t("dashboard.upcoming_count", { n: totalUpcoming })}
          </span>
        )}
      </div>

      <div className="px-4 pb-4 md:px-6 md:pb-6">
        {upcoming.length === 0 ? (
          // Two distinct empties: a couple with no tasks at all gets a nudge to
          // start; one whose tasks are all done/undated gets reassurance.
          hasAnyTask ? (
            <div className="py-2">
              <p className="text-sm text-umber-500 dark:text-umber-300">
                {t("dashboard.upcoming_empty_clear")}
              </p>
              {!weddingDate && (
                <p className="mt-1 text-sm font-medium text-umber-700 dark:text-umber-200">
                  {t("dashboard.upcoming_next_step_lock_date")}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
              <p className="text-sm text-umber-600 dark:text-umber-200">
                {t("dashboard.upcoming_empty_none")}
              </p>
              <Link
                to="/app/planning"
                className="btn-outline btn-sm inline-flex shrink-0 items-center gap-1.5"
              >
                <span>{t("dashboard.upcoming_empty_none_cta")}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          )
        ) : (
          <>
            <ul className="grid gap-1">
              {upcoming.map((item) => {
                const chip = dueChip(item.due_date as string);
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-umber-900 transition hover:bg-paper-100 dark:text-paper-50 dark:hover:bg-umber-700"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDone(item)}
                      aria-label={t("common.done")}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-paper-400 bg-white transition hover:border-blush-500 dark:border-umber-600 dark:bg-umber-800"
                    />
                    <Link to="/app/planning" className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.priority === 2 && (
                        <span
                          className="shrink-0 font-bold text-blush-700 dark:text-blush-300"
                          aria-hidden="true"
                        >
                          !!
                        </span>
                      )}
                      {item.assignee && (
                        <span className="shrink-0 truncate text-xs text-umber-500 dark:text-umber-300">
                          {item.assignee}
                        </span>
                      )}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.tone}`}
                      >
                        {chip.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              to="/app/planning"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blush-700 hover:underline dark:text-blush-300"
            >
              <span>{t("dashboard.upcoming_view_all")}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
