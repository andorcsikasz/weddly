// Planner calendar — a month grid of every client's wedding day plus task
// deadlines, colour-coded per couple. Purely derived from the existing
// listClients (wedding_date) + listTasks (due_date) endpoints; no new backend.

import { CalendarDays, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";

// Warm, muted couple palette (design-system tokens, not raw Tailwind colors).
const COUPLE_DOTS = [
  "bg-blush-400",
  "bg-eucalyptus-500",
  "bg-amber-400",
  "bg-violet-400",
  "bg-eucalyptus-400",
  "bg-blush-500",
  "bg-amber-500",
  "bg-umber-400",
] as const;

function coupleDot(coupleId: number): string {
  return COUPLE_DOTS[coupleId % COUPLE_DOTS.length] ?? COUPLE_DOTS[0];
}

/** Local YYYY-MM-DD for a Date (avoids UTC drift from toISOString). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default function PlannerCalendarPage() {
  const { t, locale } = useT();
  useDocumentMeta("planner_calendar.meta_title", "planner_calendar.meta_description");

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [tasks, setTasks] = useState<PlannerTaskRow[]>([]);

  const todayDate = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  }));

  useEffect(() => {
    Promise.all([plannerApi.listClients(), plannerApi.listTasks()])
      .then(([cr, tr]) => {
        setClients(cr.clients);
        setTasks(tr.tasks);
      })
      .catch(() => {});
  }, []);

  // Index weddings + task counts by day for O(1) cell lookups.
  const weddingsByDate = useMemo(() => {
    const map = new Map<string, PlannerClientView[]>();
    for (const c of clients) {
      if (!c.wedding_date) continue;
      const list = map.get(c.wedding_date) ?? [];
      list.push(c);
      map.set(c.wedding_date, list);
    }
    return map;
  }, [clients]);

  const taskCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const tk of tasks) {
      if (!tk.due_date) continue;
      map.set(tk.due_date, (map.get(tk.due_date) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const upcomingWeddings = useMemo(() => {
    return clients
      .filter((c) => c.wedding_date && daysUntil(c.wedding_date) >= 0)
      .sort((a, b) => (a.wedding_date ?? "").localeCompare(b.wedding_date ?? ""));
  }, [clients]);

  // Build a 6-week grid starting on Monday for the cursor month.
  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const start = new Date(cursor.year, cursor.month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", { weekday: "short" });
    // Monday-first reference week.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [locale]);

  const monthLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month, 1));

  const todayStr = ymd(todayDate);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function goToday() {
    setCursor({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  }

  return (
    <div className="py-2">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
            {t("planner_calendar.title")}
          </h1>
          <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
            {t("planner_calendar.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={goToday} className="btn-outline btn-sm">
            {t("planner_calendar.today")}
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label={t("planner_calendar.prev_month")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={t("planner_calendar.next_month")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <p className="mb-3 font-grotesk text-lg font-medium capitalize text-umber-800 dark:text-paper-200">
        {monthLabel}
      </p>

      <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
        <div className="grid grid-cols-7 border-b border-paper-200 dark:border-umber-800">
          {weekdayNames.map((w) => (
            <div
              key={w}
              className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-umber-400 dark:text-umber-500"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const cellStr = ymd(d);
            const inMonth = d.getMonth() === cursor.month;
            const isToday = cellStr === todayStr;
            const weddings = weddingsByDate.get(cellStr) ?? [];
            const taskCount = taskCountByDate.get(cellStr) ?? 0;
            return (
              <div
                key={cellStr}
                className={`min-h-[5.5rem] border-b border-r border-paper-100 p-1.5 dark:border-umber-800 ${
                  inMonth ? "" : "bg-paper-50/60 dark:bg-umber-950/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday
                        ? "bg-umber-800 font-semibold text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                        : inMonth
                          ? "text-umber-700 dark:text-paper-200"
                          : "text-umber-300 dark:text-umber-600"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {taskCount > 0 && (
                    <span
                      className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      title={t("planner_calendar.tasks_due").replace("{{n}}", String(taskCount))}
                    >
                      {taskCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {weddings.map((c) => (
                    <Link
                      key={c.couple_id}
                      to={`/app/planner/clients/${c.couple_id}`}
                      className="flex items-center gap-1 truncate rounded bg-paper-100 px-1 py-0.5 text-[11px] text-umber-800 transition-colors hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
                      title={`${t("planner_calendar.wedding_label")}: ${c.display_name}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${coupleDot(c.couple_id)}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{c.display_name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-umber-500 dark:text-umber-400">
        <span className="flex items-center gap-1.5">
          <Heart size={12} className="text-blush-500" aria-hidden="true" />
          {t("planner_calendar.legend_weddings")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            n
          </span>
          {t("planner_calendar.legend_tasks")}
        </span>
      </div>

      {/* Upcoming weddings list */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
          <CalendarDays size={18} aria-hidden="true" className="text-umber-400" />
          {t("planner_calendar.upcoming_title")}
        </h2>
        {upcomingWeddings.length === 0 ? (
          <p className="text-sm text-umber-400 dark:text-umber-500">
            {t("planner_calendar.no_weddings")}
          </p>
        ) : (
          <div className="space-y-2">
            {upcomingWeddings.map((c) => {
              const days = c.wedding_date ? daysUntil(c.wedding_date) : 0;
              return (
                <Link
                  key={c.couple_id}
                  to={`/app/planner/clients/${c.couple_id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-paper-200 bg-white px-4 py-3 transition-colors hover:border-paper-300 dark:border-umber-800 dark:bg-umber-900 dark:hover:border-umber-700"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${coupleDot(c.couple_id)}`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-grotesk font-medium text-umber-900 dark:text-paper-50">
                      {c.display_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    <span className="text-umber-500 dark:text-umber-400">
                      {new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }).format(new Date(`${c.wedding_date}T00:00:00`))}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        days <= 30
                          ? "bg-blush-100 text-blush-700 dark:bg-blush-900/30 dark:text-blush-300"
                          : "bg-paper-200 text-umber-600 dark:bg-umber-700 dark:text-umber-200"
                      }`}
                    >
                      {days === 0
                        ? t("planner_home.pipeline_today")
                        : t("planner_home.pipeline_days_until").replace("{{n}}", String(days))}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
