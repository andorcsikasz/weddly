// Google-Calendar-style Day view for the timeline page. Renders a single
// day as: a date header, an all-day strip of task bars (any task whose
// [start_date..due_date] window covers `currentDate`), and a 07:00–22:00
// hour grid below. Tasks have no times so they live exclusively in the
// all-day strip; the hour grid only carries the "now" indicator. The grid
// scrolls inside the outer flex container so the header + all-day strip
// stay pinned while a long day scrolls.

import type { PlanningItem } from "@shared/types";
import { Calendar } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

// All 24 hours render at a fixed pixel height per row so spacing stays
// "lazább" (relaxed) — the container scrolls vertically when there isn't
// room. Default scroll position lands on 06:00 so the morning–evening
// window the couple actually plans against is visible without scrolling,
// while early hours (00–05) and late hours (22–23) remain one swipe away.
const HOUR_PX = 48;
const DAY_HOURS = 24;
const DEFAULT_VISIBLE_START_HOUR = 6;
const GUTTER_WIDTH_PX = 56;
const HOURS: number[] = [];
for (let h = 0; h < DAY_HOURS; h++) HOURS.push(h);

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
  const { t, locale } = useT();
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

  // Scroll the hour rail on mount + every focal-day change. When the
  // visible day IS today, place the "now" line at 1/3 of the viewport
  // height so the user sees ~1 part of already-elapsed hours above and
  // ~2 parts of upcoming hours below. Other days default to 06:00 at the
  // top of the visible window. After the auto-snap, the user owns scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-snap on day change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focalIsToday = startOfDay(currentDate).getTime() === startOfDay(today).getTime();
    if (focalIsToday) {
      const n = new Date();
      const nowPx = (n.getHours() + n.getMinutes() / 60) * HOUR_PX;
      el.scrollTop = Math.max(0, nowPx - el.clientHeight / 3);
    } else {
      el.scrollTop = DEFAULT_VISIBLE_START_HOUR * HOUR_PX;
    }
  }, [currentDate, today]);

  const intl = locale === "hu" ? "hu-HU" : "en-GB";
  const dayStart = startOfDay(currentDate);
  const isToday = dayStart.getTime() === startOfDay(today).getTime();
  const dow = dayStart.getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dow === 0 || dow === 6;

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

  // "Now" indicator position — renders whenever the view is on today.
  // The whole 24h rail is rendered, so the line is always reachable via
  // scroll; we just place it at its absolute pixel offset from midnight.
  const now = new Date();
  const nowTopPx = isToday ? (now.getHours() + now.getMinutes() / 60) * HOUR_PX : null;

  const emptyHint = t("timeline.day_empty");
  const allDayLabel = t("timeline.all_day_label");
  const todayLabel = t("timeline.today_label");
  const nowLabel = t("timeline.now_label");

  // Weekend tint for the hour-grid column matches the WeekView treatment so
  // Saturday/Sunday days feel quieter than weekdays. Applied to both the
  // header background and the hour-grid container.
  const weekendBgClass = isWeekend ? "bg-paper-100/30 dark:bg-umber-900/30" : "";

  return (
    <div className="flex h-full flex-col">
      <header
        className={`flex items-center gap-3 px-5 py-4 ${weekendBgClass}`}
        aria-label={weekdayLabel}
      >
        <Calendar
          aria-hidden="true"
          className="h-4 w-4 text-blush-500 dark:text-blush-400"
          strokeWidth={1.75}
        />
        <div className="flex flex-col">
          <span
            className={`text-[11px] font-semibold uppercase tracking-widest ${
              isWeekend ? "text-ink-600 dark:text-umber-300" : "text-ink-500 dark:text-umber-300"
            }`}
          >
            {weekdayLabel}
          </span>
          <span className="text-xs text-ink-500 dark:text-umber-300">{monthLabel}</span>
        </div>
        {isToday ? (
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blush-500 font-grotesk text-3xl text-paper-50 ring-2 ring-blush-200 dark:ring-blush-400/30"
            aria-label={todayLabel}
          >
            {dayNumber}
          </span>
        ) : (
          <span className="font-grotesk text-3xl text-ink-900 dark:text-paper-50">{dayNumber}</span>
        )}
      </header>

      <div
        className={`border-paper-200 border-y px-5 py-2 dark:border-umber-700 ${
          isWeekend
            ? "bg-paper-100/50 dark:bg-umber-900/40"
            : "bg-paper-100/50 dark:bg-umber-900/30"
        }`}
      >
        <div className="mb-1">
          <span className="text-[10px] uppercase tracking-widest text-ink-500 dark:text-umber-300">
            {allDayLabel}
          </span>
        </div>
        {allDayTasks.length === 0 ? (
          <p className="text-[11px] italic text-ink-400 dark:text-umber-300">{emptyHint}</p>
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
                    className={`flex h-6 w-full items-center rounded-md px-2 text-xs ring-1 ring-transparent transition-all hover:ring-blush-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:hover:ring-blush-400/40 dark:focus-visible:ring-paper-100 ${barClasses}`}
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        style={{ scrollbarWidth: "thin" }}
      >
        <div
          className={`grid ${weekendBgClass}`}
          style={{ gridTemplateColumns: `${GUTTER_WIDTH_PX}px 1fr` }}
        >
          <div
            className="grid border-r border-paper-200 dark:border-umber-700"
            style={{ gridTemplateRows: `repeat(${DAY_HOURS}, ${HOUR_PX}px)` }}
            aria-hidden="true"
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-t border-paper-200 pr-2 text-right text-[11px] leading-none text-ink-500 tabular-nums dark:border-umber-700 dark:text-umber-300"
              >
                <span className={`-translate-y-1/2 inline-block ${h === 12 ? "font-medium" : ""}`}>
                  <time dateTime={`${h.toString().padStart(2, "0")}:00`}>{formatHour(h)}</time>
                </span>
              </div>
            ))}
          </div>
          <div
            className="relative grid"
            style={{ gridTemplateRows: `repeat(${DAY_HOURS}, ${HOUR_PX}px)` }}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className="relative border-t border-paper-200 dark:border-umber-700"
                aria-hidden="true"
              >
                {/* Half-hour rule — fainter than the full-hour border so the
                    grid reads as a calendar without feeling busy. */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-paper-200/50 dark:bg-umber-700/40" />
              </div>
            ))}
            {nowTopPx !== null && (
              <div
                className="pointer-events-none absolute inset-x-0"
                style={{ top: `${nowTopPx}px` }}
                aria-label={nowLabel}
                aria-live="polite"
              >
                <div className="relative h-0.5 bg-blush-500">
                  <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 h-2.5 w-2.5 rounded-full bg-blush-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
