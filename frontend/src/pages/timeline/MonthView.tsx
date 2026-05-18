// Google-Calendar-style month grid for /app/timeline. Renders the visible
// month as a 7-column (Mon..Sun) grid plus a leading ISO-week gutter, with
// task bars that span across the days they cover. Each bar is drawn once per
// week-row — a task that crosses a week boundary is split into two bars, one
// in each row, so the layout stays a clean grid instead of an absolute
// overlay across the whole month.

import type { PlanningItem } from "@shared/types";
import { useT } from "../../lib/i18n";

interface ResolvedSupplier {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface MonthViewProps {
  currentDate: Date;
  today: Date;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  onOpenTask: (item: PlanningItem) => void;
}

// ─── tiny date helpers (re-implemented per spec; not shared with TimelinePage) ─

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

function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeekMon(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -dow);
}

function isoWeek(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  return Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── layout types ────────────────────────────────────────────────────────────

interface PlacedBar {
  item: PlanningItem;
  /** 0-based column within the 7-day week row (0 = Monday). */
  startCol: number;
  /** Inclusive width in columns (1..7). */
  span: number;
  /** Lane index (0-based). */
  lane: number;
}

interface WeekLayout {
  weekStart: Date;
  bars: PlacedBar[];
  /** Per-column count of bars that overflowed past `MAX_LANES`. Each entry
   *  is the list of items the cell would have shown if there were more
   *  lanes — used to render the "+N more" link. */
  overflow: PlanningItem[][];
}

const MAX_LANES = 3;
const LANE_HEIGHT_PX = 22; // 20px bar + 2px gap
const HEADER_OFFSET_PX = 24; // space reserved at the top of a cell for the date number

/** Sort key for stable lane assignment — earlier start first, then longer
 *  span first (so wider bars get the lower lanes), then id as a tiebreaker. */
function compareItems(a: PlanningItem, b: PlanningItem): number {
  const sa = a.start_date ?? "";
  const sb = b.start_date ?? "";
  if (sa !== sb) return sa.localeCompare(sb);
  const da = a.due_date ?? "";
  const db = b.due_date ?? "";
  if (da !== db) return db.localeCompare(da); // longer end-date first
  return a.id - b.id;
}

/** Greedy lane packing: for each item, pick the lowest lane where no
 *  previously-placed item in this week overlaps its column range. */
function packIntoLanes(weekStart: Date, items: PlanningItem[]): WeekLayout {
  const weekEnd = addDays(weekStart, 6);
  const candidates: { item: PlanningItem; startCol: number; span: number }[] = [];
  for (const item of items) {
    const start = parseISODate(item.start_date);
    const end = parseISODate(item.due_date);
    if (!start || !end) continue;
    const clampedStart = start < weekStart ? weekStart : start;
    const clampedEnd = end > weekEnd ? weekEnd : end;
    if (clampedEnd < clampedStart) continue;
    const startCol = diffDays(weekStart, clampedStart);
    const endCol = diffDays(weekStart, clampedEnd);
    if (startCol > 6 || endCol < 0) continue;
    candidates.push({ item, startCol, span: endCol - startCol + 1 });
  }
  candidates.sort((a, b) => compareItems(a.item, b.item));

  // lanes[laneIdx] = highest endCol (inclusive) occupied so far on that lane.
  const lanes: number[] = [];
  const bars: PlacedBar[] = [];
  const overflow: PlanningItem[][] = Array.from({ length: 7 }, () => []);

  for (const c of candidates) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      const occUntil = lanes[i] as number;
      if (occUntil < c.startCol) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(-1);
    }
    lanes[lane] = c.startCol + c.span - 1;

    if (lane < MAX_LANES) {
      bars.push({ item: c.item, startCol: c.startCol, span: c.span, lane });
    } else {
      // Spill over into every column this bar would have touched.
      for (let col = c.startCol; col < c.startCol + c.span; col++) {
        const list = overflow[col];
        if (list) list.push(c.item);
      }
    }
  }
  return { weekStart, bars, overflow };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function MonthView({
  currentDate,
  today,
  tasks,
  supplierById: _supplierById,
  onOpenTask,
}: MonthViewProps) {
  const { locale } = useT();

  // Reference; the supplier map isn't used in the month view's bar UI (bars
  // are intentionally compact), but the prop is part of the contract. Touch
  // the parameter so TS strict-noUnusedParameters stays clean.
  void _supplierById;

  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeekMon(monthStart);

  // Compute how many week-rows we need (5 or 6) so the grid covers the whole
  // month, then snap-end on the last visible Sunday.
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const lastWeekStart = startOfWeekMon(lastDayOfMonth);
  const weekCount = Math.round(diffDays(gridStart, lastWeekStart) / 7) + 1;

  const weeks: Date[] = [];
  for (let i = 0; i < weekCount; i++) weeks.push(addDays(gridStart, i * 7));

  const dayAbbrevs =
    locale === "hu"
      ? ["H", "K", "SZE", "CS", "P", "SZO", "V"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const moreLabel = (n: number) => (locale === "hu" ? `+${n} további` : `+${n} more`);

  const layouts = weeks.map((w) => packIntoLanes(w, tasks));

  // Tailwind needs literal class names — predeclare the grid-rows variants
  // we expect (4–6 weeks covers every real month).
  const gridRowsClass =
    weekCount === 4
      ? "grid-rows-4"
      : weekCount === 5
        ? "grid-rows-5"
        : weekCount === 6
          ? "grid-rows-6"
          : "grid-rows-5";

  return (
    <div className="flex h-full flex-col">
      {/* Day-of-week header */}
      <div
        className="grid border-b border-paper-300 dark:border-umber-700"
        style={{ gridTemplateColumns: "40px repeat(7, 1fr)" }}
      >
        <div aria-hidden="true" />
        {dayAbbrevs.map((label, idx) => {
          // Mon..Fri = 0..4 weekday, Sat/Sun = 5/6 weekend.
          const isWeekend = idx === 5 || idx === 6;
          const headerClass = isWeekend
            ? "text-ink-600 dark:text-umber-300"
            : "text-ink-500 dark:text-umber-300";
          return (
            <div
              key={idx}
              className={`px-2 py-2 text-[11px] uppercase tracking-widest ${headerClass}`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div className={`grid flex-1 ${gridRowsClass}`}>
        {weeks.map((weekStart, weekIdx) => {
          const layout = layouts[weekIdx];
          return (
            <div
              key={weekStart.toISOString()}
              className="relative grid border-b border-paper-200 last:border-b-0 dark:border-umber-700"
              style={{ gridTemplateColumns: "40px repeat(7, 1fr)" }}
            >
              {/* ISO week gutter */}
              <div className="flex items-start justify-center pt-1.5 font-serif text-sm text-ink-400 dark:text-umber-400">
                {isoWeek(weekStart)}
              </div>

              {/* 7 day cells */}
              {Array.from({ length: 7 }).map((_, col) => {
                const day = addDays(weekStart, col);
                const inMonth = day.getMonth() === currentDate.getMonth();
                const isToday = sameDay(day, today);
                const isPast = day < today && !isToday;
                const isWeekend = col === 5 || col === 6;
                // Three-tier dimming: in-month future = full ink, in-month
                // past = muted (already happened — couples don't need them
                // to compete visually with what's still ahead), out-of-month
                // = the lightest tier so the month boundary still reads.
                const dayNumClass = !inMonth
                  ? "text-ink-400 dark:text-umber-400"
                  : isPast
                    ? "text-ink-400 dark:text-umber-300"
                    : "text-ink-900 dark:text-paper-50";
                // Stacked tints, weakest at the bottom. Out-of-month wins
                // over weekend (the soft month-boundary band reads first).
                // Past in-month is muted on top of the weekend wash so the
                // weekend column still reads on already-passed days.
                const cellTintClass = !inMonth
                  ? "bg-paper-50/40 dark:bg-umber-900/40"
                  : isPast
                    ? isWeekend
                      ? "bg-paper-100/50 dark:bg-umber-900/40"
                      : "bg-paper-100/40 dark:bg-umber-900/30"
                    : isWeekend
                      ? "bg-paper-100/30 dark:bg-umber-900/30"
                      : "";
                const todayRing = isToday
                  ? "ring-1 ring-inset ring-blush-400/40 dark:ring-blush-300/40"
                  : "";
                return (
                  <div
                    key={col}
                    className={`relative min-h-[80px] border-r border-paper-200 transition-colors last:border-r-0 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-900/50 ${cellTintClass} ${todayRing}`}
                  >
                    <div className="px-1.5 pt-1">
                      {isToday ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blush-500 text-sm font-medium text-paper-50">
                          {day.getDate()}
                        </span>
                      ) : (
                        <span className={`font-serif text-sm ${dayNumClass}`}>{day.getDate()}</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Task bars — absolutely positioned over the 7 day cells of
                  this week row. Left/width are percent-based off the 7-day
                  area (cols 1..7 of the 8-column grid). */}
              {layout?.bars.map((bar) => {
                const item = bar.item;
                const done = item.done;
                // Completed tasks retreat: same sage tint, 70% opacity, line-
                // through, and a thinner border accent. Active tasks get a
                // refined Gantt-bar feel — bottom-border in blush-500/60.
                const barClasses = done
                  ? "bg-sage-300 opacity-70 line-through border-b-2 border-sage-500/40 text-sage-900 ring-sage-400/60 dark:bg-sage-400/30 dark:text-paper-50"
                  : "bg-blush-300 border-b-2 border-blush-500/60 text-ink-900 ring-blush-400/60 dark:bg-blush-400/30 dark:text-paper-50 dark:ring-blush-300/40";
                // The 7-day region begins at the 40px gutter and fills the
                // remainder of the row. Express position as `calc()` so it
                // tracks any container width.
                const leftCalc = `calc(40px + (100% - 40px) * ${bar.startCol} / 7)`;
                const widthCalc = `calc((100% - 40px) * ${bar.span} / 7)`;
                const topPx = HEADER_OFFSET_PX + bar.lane * LANE_HEIGHT_PX;
                return (
                  <button
                    type="button"
                    key={`bar-${item.id}-${bar.startCol}`}
                    onClick={() => onOpenTask(item)}
                    title={item.title}
                    className={`absolute h-5 truncate rounded-sm px-1.5 text-left text-[11px] transition-colors hover:brightness-95 hover:ring-1 ${barClasses}`}
                    style={{
                      left: leftCalc,
                      width: widthCalc,
                      top: topPx,
                      marginLeft: 2,
                      marginRight: 2,
                      maxWidth: `calc(${widthCalc} - 4px)`,
                    }}
                  >
                    {item.title}
                  </button>
                );
              })}

              {/* Overflow "+N more" pills */}
              {layout?.overflow.map((list, col) => {
                if (list.length === 0) return null;
                const first = list[0];
                if (!first) return null;
                const leftCalc = `calc(40px + (100% - 40px) * ${col} / 7)`;
                const widthCalc = `calc((100% - 40px) / 7)`;
                const topPx = HEADER_OFFSET_PX + MAX_LANES * LANE_HEIGHT_PX;
                return (
                  <button
                    type="button"
                    key={`more-${weekIdx}-${col}`}
                    onClick={() => onOpenTask(first)}
                    className="absolute h-5 truncate px-1.5 text-left text-[11px] text-ink-500 underline decoration-paper-300 underline-offset-2 transition-colors hover:text-ink-900 hover:decoration-ink-500 dark:text-umber-300 dark:decoration-umber-600 dark:hover:text-paper-100 dark:hover:decoration-umber-300"
                    style={{
                      left: leftCalc,
                      width: widthCalc,
                      top: topPx,
                    }}
                  >
                    {moreLabel(list.length)}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
