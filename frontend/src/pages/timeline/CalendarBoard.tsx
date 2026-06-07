// Traditional 4-month calendar board for /app/timeline, shown below the
// task chart. Renders four real month grids (28–31 days, Mon..Sun) side by
// side, deliberately NOT a Gantt: each month is its own little calendar. The
// window is anchored so TODAY always lands in the SECOND month, i.e. one
// month of lookback, the current month, and two months ahead. Days that any
// dated task overlaps are marked with a dot; clicking such a day opens the
// first task on it.

import type { PlanningItem } from "@shared/types";
import { useMemo } from "react";
import { useT } from "../../lib/i18n";

interface CalendarBoardProps {
  /** Anchor date, i.e. TODAY. The board shows [anchor-1mo .. anchor+2mo]. */
  today: Date;
  tasks: PlanningItem[];
  onOpenTask: (item: PlanningItem) => void;
}

// ─── tiny date helpers (kept local; mirror MonthView's) ──────────────────────

function parseISODate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function startOfWeekMon(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -dow);
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export default function CalendarBoard({ today, tasks, onOpenTask }: CalendarBoardProps) {
  const { t, locale } = useT();
  const intl = locale === "hu" ? "hu-HU" : "en-US";

  // One month of lookback so TODAY sits in the SECOND of the four months.
  const months = useMemo(() => {
    const out: Date[] = [];
    for (let i = -1; i <= 2; i++) out.push(new Date(today.getFullYear(), today.getMonth() + i, 1));
    return out;
  }, [today]);

  // dateKey → tasks overlapping that day. A task counts on every day in its
  // inclusive [start_date, due_date] span so a multi-day task dots its range.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, PlanningItem[]>();
    for (const task of tasks) {
      const start = parseISODate(task.start_date);
      const end = parseISODate(task.due_date);
      if (!start || !end || end < start) continue;
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const key = dateKey(d);
        const list = map.get(key);
        if (list) list.push(task);
        else map.set(key, [task]);
      }
    }
    return map;
  }, [tasks]);

  const dayAbbrevs =
    locale === "hu" ? ["H", "K", "Sz", "Cs", "P", "Sz", "V"] : ["M", "T", "W", "T", "F", "S", "S"];

  const hasAnyTask = tasksByDay.size > 0;

  return (
    <section className="card p-0 rounded-3xl ring-1 ring-paper-300/60 dark:ring-umber-700/60">
      <header className="flex items-baseline gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="flex items-center gap-2.5 font-grotesk text-lg text-ink-900 dark:text-paper-50">
          <span className="inline-block h-5 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          {t("timeline.calendar_title")}
        </h2>
        <p className="hidden text-xs text-ink-500 sm:block dark:text-umber-300">
          {t("timeline.calendar_sub")}
        </p>
      </header>

      <div className="grid gap-px bg-paper-200 p-px sm:grid-cols-2 xl:grid-cols-4 dark:bg-umber-700">
        {months.map((monthStart) => (
          <MiniMonth
            key={dateKey(monthStart)}
            monthStart={monthStart}
            today={today}
            intl={intl}
            dayAbbrevs={dayAbbrevs}
            tasksByDay={tasksByDay}
            eventLabel={(n) => t("timeline.calendar_event", { count: n })}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>

      {!hasAnyTask && (
        <p className="border-t border-paper-200 px-5 py-3 text-xs italic text-ink-500 dark:border-umber-700 dark:text-umber-300">
          {t("timeline.calendar_no_tasks")}
        </p>
      )}
    </section>
  );
}

function MiniMonth({
  monthStart,
  today,
  intl,
  dayAbbrevs,
  tasksByDay,
  eventLabel,
  onOpenTask,
}: {
  monthStart: Date;
  today: Date;
  intl: string;
  dayAbbrevs: string[];
  tasksByDay: Map<string, PlanningItem[]>;
  eventLabel: (n: number) => string;
  onOpenTask: (item: PlanningItem) => void;
}) {
  const monthLabel = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric" }).format(
    monthStart,
  );
  const isCurrentMonth =
    monthStart.getFullYear() === today.getFullYear() && monthStart.getMonth() === today.getMonth();

  // 6 week-rows × 7 columns always, which keeps every mini-month the same height
  // regardless of how the days fall, so the four panels line up.
  const gridStart = startOfWeekMon(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));

  return (
    <div className="bg-white px-3 py-3 dark:bg-umber-800">
      <div className="mb-2 flex items-center gap-2">
        <h3
          className={`font-grotesk text-sm capitalize ${
            isCurrentMonth
              ? "font-semibold text-ink-900 dark:text-paper-50"
              : "text-ink-600 dark:text-umber-200"
          }`}
        >
          {monthLabel}
        </h3>
        {isCurrentMonth && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blush-500" aria-hidden="true" />
        )}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px">
        {dayAbbrevs.map((label, idx) => (
          <div
            key={idx}
            className={`pb-1 text-center text-[10px] uppercase tracking-wider ${
              idx >= 5 ? "text-ink-400 dark:text-umber-400" : "text-ink-400 dark:text-umber-400"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day) => {
          const inMonth = day.getMonth() === monthStart.getMonth();
          const isToday = sameDay(day, today);
          const dayTasks = inMonth ? (tasksByDay.get(dateKey(day)) ?? []) : [];
          const hasTask = dayTasks.length > 0;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          if (!inMonth) {
            // Out-of-month days stay as faint placeholders so the grid keeps
            // its shape without pulling focus.
            return (
              <div
                key={dateKey(day)}
                className="flex h-8 items-center justify-center text-[11px] text-ink-300 dark:text-umber-600"
                aria-hidden="true"
              >
                {day.getDate()}
              </div>
            );
          }

          const numClass = isToday
            ? "text-paper-50"
            : isWeekend
              ? "text-ink-500 dark:text-umber-300"
              : "text-ink-800 dark:text-paper-100";

          const content = (
            <span className="relative flex h-6 w-6 items-center justify-center">
              {isToday && (
                <span className="absolute inset-0 rounded-full bg-blush-500" aria-hidden="true" />
              )}
              <span className={`relative font-grotesk text-[12px] ${numClass}`}>
                {day.getDate()}
              </span>
            </span>
          );

          if (!hasTask) {
            return (
              <div key={dateKey(day)} className="flex h-8 flex-col items-center justify-center">
                {content}
              </div>
            );
          }

          const first = dayTasks[0];
          return (
            <button
              key={dateKey(day)}
              type="button"
              onClick={() => first && onOpenTask(first)}
              title={`${eventLabel(dayTasks.length)}: ${dayTasks.map((task) => task.title).join(", ")}`}
              className="flex h-8 flex-col items-center justify-center rounded-md transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 dark:hover:bg-umber-900/60"
            >
              {content}
              <span
                className={`mt-0.5 inline-block h-1 w-1 rounded-full ${
                  dayTasks.every((task) => task.done) ? "bg-sage-400" : "bg-blush-500"
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
