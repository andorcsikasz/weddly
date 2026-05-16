// Google-Calendar-style Day view for the timeline page. Renders a single
// day as: a date header, an all-day strip of task bars (any task whose
// [start_date..due_date] window covers `currentDate`), and a 07:00–22:00
// hour grid below. Tasks have no times so they live exclusively in the
// all-day strip; the hour grid only carries the "now" indicator. The grid
// scrolls inside the outer flex container so the header + all-day strip
// stay pinned while a long day scrolls.

import type { PlanningItem } from "@shared/types";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";

interface ResolvedSupplier {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface DayViewProps {
  currentDate: Date;
  today: Date;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  onOpenTask: (item: PlanningItem) => void;
}

/** Parse a YYYY-MM-DD literal into a local-midnight Date, or null on bad input. */
function parseISODate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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

function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

const HOUR_START = 7;
const HOUR_END = 22;
const HOUR_HEIGHT_PX = 48;
const HOURS: number[] = [];
for (let h = HOUR_START; h <= HOUR_END; h++) HOURS.push(h);

function formatHour(h: number): string {
  // 24-hour clock per spec — same in HU and EN.
  return `${h.toString().padStart(2, "0")}:00`;
}

export default function DayView({
  currentDate,
  today,
  tasks,
  supplierById,
  onOpenTask,
}: DayViewProps) {
  const { locale } = useT();
  // Suppress unused-variable warnings when supplierById isn't needed for
  // rendering — kept on the props contract so future work can surface a
  // supplier chip on each bar without changing the call sites.
  void supplierById;

  // Re-render every minute so the "now" indicator stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const intl = locale === "hu" ? "hu-HU" : "en-US";
  const dayStart = startOfDay(currentDate);
  const isToday = dayStart.getTime() === startOfDay(today).getTime();

  const weekdayLabel = useMemo(
    () => new Intl.DateTimeFormat(intl, { weekday: "long" }).format(dayStart),
    [intl, dayStart],
  );
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(intl, { month: "long", year: "numeric" }).format(dayStart),
    [intl, dayStart],
  );
  const dayNumber = dayStart.getDate();

  // Tasks whose [start_date..due_date] window covers this day.
  const allDayTasks = useMemo(() => {
    const rows: PlanningItem[] = [];
    for (const item of tasks) {
      const s = parseISODate(item.start_date);
      const e = parseISODate(item.due_date);
      if (!s || !e) continue;
      if (diffDays(s, dayStart) >= 0 && diffDays(dayStart, e) >= 0) {
        rows.push(item);
      }
    }
    // Sort: not-done first, then by start_date, then title — keeps urgent
    // bars at the top of the strip.
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const sa = a.start_date ?? "";
      const sb = b.start_date ?? "";
      if (sa !== sb) return sa.localeCompare(sb);
      return a.title.localeCompare(b.title, locale === "hu" ? "hu" : "en");
    });
    return rows;
  }, [tasks, dayStart, locale]);

  // "Now" indicator position — only meaningful when the current view is
  // today and local time is within the grid window.
  const now = new Date();
  let nowTopPx: number | null = null;
  if (isToday) {
    const minutesSinceStart = (now.getHours() - HOUR_START) * 60 + now.getMinutes();
    const totalMinutes = (HOUR_END - HOUR_START) * 60;
    if (minutesSinceStart >= 0 && minutesSinceStart <= totalMinutes) {
      nowTopPx = (minutesSinceStart / 60) * HOUR_HEIGHT_PX;
    }
  }

  const emptyHint = locale === "hu" ? "Nincs feladat erre a napra" : "No tasks for this day";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 px-5 py-4">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
            {weekdayLabel}
          </span>
          <span className="text-xs text-ink-500 dark:text-umber-300">{monthLabel}</span>
        </div>
        {isToday ? (
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blush-500 text-3xl font-serif text-paper-50"
            aria-label={locale === "hu" ? "Ma" : "Today"}
          >
            {dayNumber}
          </span>
        ) : (
          <span className="text-3xl font-serif text-ink-900 dark:text-paper-50">{dayNumber}</span>
        )}
      </header>

      <div className="bg-paper-100 px-5 py-2 dark:bg-umber-900/40">
        {allDayTasks.length === 0 ? (
          <p className="text-xs italic text-ink-500 dark:text-umber-300">{emptyHint}</p>
        ) : (
          <ul className="space-y-1">
            {allDayTasks.map((item) => {
              const barClasses = item.done
                ? "bg-sage-300 dark:bg-sage-400/30 text-sage-900 dark:text-paper-50"
                : "bg-blush-300 dark:bg-blush-400/30 text-ink-900 dark:text-paper-50";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(item)}
                    title={item.title}
                    className={`flex h-6 w-full items-center rounded-md px-2 text-xs transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100 ${barClasses}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-left ${
                        item.done ? "line-through" : ""
                      }`}
                    >
                      {item.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          <div className="w-14 shrink-0" aria-hidden="true">
            {HOURS.map((h) => (
              <div
                key={h}
                className="flex h-12 items-start justify-end pr-2 pt-0.5 text-[11px] text-ink-500 dark:text-umber-300"
              >
                <time dateTime={`${h.toString().padStart(2, "0")}:00`}>{formatHour(h)}</time>
              </div>
            ))}
          </div>
          <div className="relative flex-1">
            {HOURS.map((h) => (
              <div
                key={h}
                className="h-12 border-t border-paper-200 dark:border-umber-700"
                aria-hidden="true"
              />
            ))}
            {nowTopPx !== null && (
              <div
                className="pointer-events-none absolute inset-x-0"
                style={{ top: nowTopPx }}
                aria-label={locale === "hu" ? "Most" : "Now"}
              >
                <div className="relative h-0.5 bg-blush-500">
                  <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blush-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
