// Google-Calendar-style week view for /app/timeline. Renders Mon..Sun in a
// 56px-gutter + 7-column grid: a day-header row, an all-day strip with
// multi-day task bars (lane-packed so overlapping spans stack vertically
// without colliding), and a 07:00..22:00 hour grid below. Tasks have no
// times in v1, so every bar lives in the all-day strip; the hour grid is
// drawn for future schedule entries plus the "now" indicator that ticks
// every minute on today's column only.

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

interface WeekViewProps {
  /** Any day in the week to show — we snap to that week's Monday. */
  currentDate: Date;
  /** Local-midnight Date for system today, used to position the "now" line. */
  today: Date;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  onOpenTask: (item: PlanningItem) => void;
}

// ── Tiny date helpers — inlined per task spec; mirror TimelinePage. ──────────

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

function startOfWeekMon(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -dow);
}

// ── Constants ────────────────────────────────────────────────────────────────

const HOUR_START = 7;
const HOUR_END = 22; // inclusive last label
const HOUR_ROW_PX = 48;
const LANE_HEIGHT_PX = 22;
const LANE_GAP_PX = 8;
const GUTTER_WIDTH_PX = 56;

const DAY_ABBR_HU: readonly string[] = ["H", "K", "SZE", "CS", "P", "SZO", "V"];
const DAY_ABBR_EN: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Lane packing for multi-day all-day bars ─────────────────────────────────

interface PlacedBar {
  item: PlanningItem;
  /** 0..6 — index relative to the visible Monday. Clamped into the window. */
  startCol: number;
  /** Number of columns the bar spans (>=1). Clamped so startCol+span<=7. */
  span: number;
  /** Lane assignment — `top: lane * (LANE_HEIGHT_PX + 2)`. */
  lane: number;
}

/** Pack tasks into the fewest vertical lanes such that no two bars in the
 *  same lane overlap. Greedy by start column then by length, which is the
 *  textbook lane-packing for non-preemptive interval scheduling and matches
 *  what Google Calendar shows for all-day events. */
function packLanes(tasks: PlanningItem[], monday: Date): { bars: PlacedBar[]; maxLane: number } {
  // 1. Compute each task's (start, end) column relative to `monday`, dropping
  //    items that fall entirely outside the visible week or have malformed
  //    dates. End column is inclusive.
  type Pending = { item: PlanningItem; startCol: number; endCol: number };
  const pending: Pending[] = [];
  for (const item of tasks) {
    const start = parseISODate(item.start_date);
    const end = parseISODate(item.due_date);
    if (!start || !end) continue;
    const rawStart = diffDays(monday, start);
    const rawEnd = diffDays(monday, end);
    if (rawEnd < 0 || rawStart > 6) continue; // entirely outside the week
    const startCol = Math.max(0, rawStart);
    const endCol = Math.min(6, rawEnd);
    if (endCol < startCol) continue;
    pending.push({ item, startCol, endCol });
  }

  // 2. Sort: earlier start first, longer span first on ties — this minimizes
  //    lane count for typical wedding-task densities (a few long bars + many
  //    short ones).
  pending.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return b.endCol - b.startCol - (a.endCol - a.startCol);
  });

  // 3. Walk in sorted order; for each bar pick the lowest lane index whose
  //    last-used end column is strictly less than this bar's start column.
  const laneEnds: number[] = []; // laneEnds[lane] = last endCol occupied
  const bars: PlacedBar[] = [];
  for (const p of pending) {
    let lane = laneEnds.findIndex((endCol) => endCol < p.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(p.endCol);
    } else {
      laneEnds[lane] = p.endCol;
    }
    bars.push({
      item: p.item,
      startCol: p.startCol,
      span: p.endCol - p.startCol + 1,
      lane,
    });
  }

  return { bars, maxLane: laneEnds.length === 0 ? -1 : laneEnds.length - 1 };
}

// ── The component ────────────────────────────────────────────────────────────

export default function WeekView({
  currentDate,
  today,
  tasks,
  supplierById,
  onOpenTask,
}: WeekViewProps) {
  const { locale } = useT();
  // Force re-render every 60s so the "now" line drifts down the today column.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const monday = useMemo(() => startOfWeekMon(currentDate), [currentDate]);
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) out.push(addDays(monday, i));
    return out;
  }, [monday]);

  const todayStart = startOfDay(today);
  const todayCol = diffDays(monday, todayStart); // 0..6 if in this week
  const todayInWeek = todayCol >= 0 && todayCol <= 6;

  const dayAbbr = locale === "hu" ? DAY_ABBR_HU : DAY_ABBR_EN;

  const { bars, maxLane } = useMemo(() => packLanes(tasks, monday), [tasks, monday]);
  const stripHeight =
    maxLane < 0 ? LANE_HEIGHT_PX + LANE_GAP_PX : (maxLane + 1) * (LANE_HEIGHT_PX + 2) + LANE_GAP_PX;

  // ── "Now" indicator — visible only when today is in-week AND clock is
  //    inside the rendered hour range. Re-derived on every render (interval
  //    above triggers them).
  const now = new Date();
  const nowHour = now.getHours();
  const nowMin = now.getMinutes();
  const nowInRange = nowHour >= HOUR_START && nowHour < HOUR_END + 1; // 07:00..22:59
  const showNow = todayInWeek && nowInRange;
  const nowTopPx = (nowHour + nowMin / 60 - HOUR_START) * HOUR_ROW_PX;

  const hours: number[] = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  const allDayLabel = locale === "hu" ? "egész napos" : "All-day";
  const todayAriaLabel = locale === "hu" ? "Jelenlegi idő" : "Current time";

  return (
    <div className="flex h-full flex-col">
      {/* ── Day-column headers ───────────────────────────────────────────── */}
      <div
        className="grid border-b border-paper-300 dark:border-umber-700"
        style={{ gridTemplateColumns: `${GUTTER_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
      >
        <div aria-hidden="true" />
        {days.map((d, i) => {
          const isToday = todayInWeek && i === todayCol;
          return (
            <div key={d.toISOString()} className="flex flex-col items-center justify-center py-2">
              <span
                className={`text-[11px] font-medium uppercase tracking-wider ${
                  isToday
                    ? "text-blush-700 dark:text-blush-300"
                    : "text-ink-500 dark:text-umber-300"
                }`}
              >
                {dayAbbr[i]}
              </span>
              <span
                className={
                  isToday
                    ? "mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blush-500 text-base font-semibold tabular-nums text-paper-50"
                    : "mt-1 text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50"
                }
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── All-day strip ────────────────────────────────────────────────── */}
      <div
        className="grid border-b border-paper-300 dark:border-umber-700"
        style={{ gridTemplateColumns: `${GUTTER_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
      >
        <div className="flex items-start justify-end pr-2 pt-1.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
            {allDayLabel}
          </span>
        </div>
        <div className="relative col-span-7" style={{ height: stripHeight, paddingTop: 4 }}>
          {/* Inner 7-col grid hosts the bars via grid-column placement so
              widths track the day columns exactly regardless of container
              width. */}
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              columnGap: 2,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            {bars.map(({ item, startCol, span, lane }) => {
              const done = item.done;
              const supplier = item.supplier_id
                ? (supplierById.get(item.supplier_id) ?? null)
                : null;
              const barClasses = done
                ? "bg-sage-300 dark:bg-sage-400/30 text-sage-900 dark:text-paper-50"
                : "bg-blush-300 dark:bg-blush-400/30 text-ink-900 dark:text-paper-50";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenTask(item)}
                  title={supplier ? `${item.title} — ${supplier.name}` : item.title}
                  className={`flex h-5 items-center truncate rounded-md px-2 text-xs transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100 ${barClasses}`}
                  style={{
                    gridColumnStart: startCol + 1,
                    gridColumnEnd: `span ${span}`,
                    marginTop: lane * (LANE_HEIGHT_PX + 2),
                    alignSelf: "start",
                  }}
                >
                  <span className={`truncate ${done ? "line-through" : ""}`}>{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Hour grid (scrollable) ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `${GUTTER_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
        >
          {/* Gutter column: hour labels stacked, each 48px tall. */}
          <div>
            {hours.map((h) => (
              <div
                key={h}
                className="h-12 pr-2 text-right text-[11px] text-ink-500 dark:text-umber-300"
                style={{ lineHeight: "1" }}
              >
                <span className="-translate-y-1/2 inline-block">
                  {h.toString().padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {/* Seven day columns, each painted with hour rules + a left border
              that produces the vertical separators between days. */}
          {days.map((d, i) => (
            <div
              key={d.toISOString()}
              className="relative border-l border-paper-200 dark:border-umber-700"
            >
              {hours.map((h) => (
                <div key={h} className="h-12 border-t border-paper-200 dark:border-umber-700" />
              ))}

              {/* Per-column "now" indicator — line + dot, painted only on
                  today's column for the Google-Calendar look. */}
              {showNow && i === todayCol && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10"
                  style={{ top: nowTopPx }}
                  aria-label={todayAriaLabel}
                  title={todayAriaLabel}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blush-500"
                  />
                  <div className="h-0.5 w-full bg-blush-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
