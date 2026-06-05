// Range Gantt for /app/timeline at 3M (quarter) and ALL zoom.
//
// 3M anchors on `currentDate` snapped to its month boundary and expands
// forward 3 months. ALL spans the whole plan — earliest of (first task,
// today, wedding) to latest of (last task, today, wedding), so the couple
// sees the entire timeline in one scroll. Both render:
//   - a left task gutter (name + supplier chip) aligned to the chart rows
//   - a stacked header: year ribbon → month labels → (3M only) week ticks
//   - alternating month background bands + 1px month dividers
//   - lighter week dividers on every Monday inside the window
//   - "today" vertical line with a floating label
//   - "wedding day" vertical line with a heart marker (when set)
//   - per-row dividers + soft alternating row tint so a long list scans easy
//   - bars are one per task with a generous 24px min width so a 1-day task
//     stays readable even at the widest zoom
//
// Bars get clipped corners on the side that runs past the visible window so
// it's obvious a task extends beyond what you're looking at.

import type { PlanningItem } from "@shared/types";
import { Heart, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";

interface ResolvedSupplier {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface GanttViewProps {
  /** Any day inside the desired window — snapped to its month boundary. */
  currentDate: Date;
  today: Date;
  weddingDate: Date | null;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  mode: "quarter" | "all";
  onOpenTask: (item: PlanningItem) => void;
  onSupplierChipClick: (supplierId: string) => void;
}

// ── date helpers (inlined to match MonthView/WeekView/DayView convention) ──

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
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday-anchored week start. JS `getDay()` is Sunday-zeroed; rotate so
 *  Monday is the canonical week start for HU + EN conventions. */
function startOfWeekMon(d: Date): Date {
  const dow = d.getDay(); // 0=Sun .. 6=Sat
  const delta = (dow + 6) % 7; // Mon=0, Sun=6
  return addDays(startOfDay(d), -delta);
}

/** ISO week number — matches what a Gantt user expects on the time axis. */
function isoWeek(d: Date): number {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
  const jan1 = new Date(dt.getFullYear(), 0, 1);
  return Math.ceil(((dt.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
}

// ── geometry ──────────────────────────────────────────────────────────────

interface MonthBand {
  start: Date;
  /** Inclusive last day of the month. */
  end: Date;
  label: string;
  /** Filled when the year flips relative to the previous band — also on the
   *  first band so the user sees the year once at the start of the window. */
  yearLabel: string | null;
  offsetPct: number;
  widthPct: number;
}

interface WeekTick {
  /** Monday this tick anchors to. */
  start: Date;
  weekNumber: number;
  offsetPct: number;
  /** True when this Monday is the 1st of the month — we skip the divider
   *  here because the month rule is dominant, but we still render the
   *  label. */
  coincidesWithMonth: boolean;
}

interface Geometry {
  windowStart: Date;
  /** Inclusive last day of the window. */
  windowEnd: Date;
  totalDays: number;
  months: MonthBand[];
  weeks: WeekTick[];
}

/** Whole-plan window for the ALL zoom: from the earliest of (first task,
 *  today, wedding) to the latest of the same, snapped out to month
 *  boundaries. Returns the start month + how many months the window spans
 *  so `buildGeometry` can lay it out exactly like the fixed-count zooms. */
export function computeAllRange(
  tasks: PlanningItem[],
  today: Date,
  weddingDate: Date | null,
): { windowStart: Date; monthCount: number } {
  let min = startOfDay(today);
  let max = startOfDay(today);
  for (const item of tasks) {
    const s = parseISODate(item.start_date);
    const e = parseISODate(item.due_date);
    if (s) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
    if (e) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  if (weddingDate) {
    if (weddingDate < min) min = weddingDate;
    if (weddingDate > max) max = weddingDate;
  }
  const windowStart = startOfMonth(min);
  const endMonthStart = startOfMonth(max);
  const monthCount =
    (endMonthStart.getFullYear() - windowStart.getFullYear()) * 12 +
    (endMonthStart.getMonth() - windowStart.getMonth()) +
    1;
  return { windowStart, monthCount: Math.max(1, monthCount) };
}

function buildGeometry(
  windowStart: Date,
  monthCount: number,
  includeWeeks: boolean,
  locale: "hu" | "en",
): Geometry {
  const windowEnd = addDays(addMonths(windowStart, monthCount), -1);
  const totalDays = diffDays(windowStart, windowEnd) + 1;

  const intl = locale === "hu" ? "hu-HU" : "en-US";
  const monthFmt = new Intl.DateTimeFormat(intl, { month: "short" });
  const yearFmt = new Intl.DateTimeFormat(intl, { year: "numeric" });
  const months: MonthBand[] = [];
  let lastYear: number | null = null;
  for (let i = 0; i < monthCount; i++) {
    const start = addMonths(windowStart, i);
    const end = addDays(addMonths(start, 1), -1);
    const offsetDays = diffDays(windowStart, start);
    const spanDays = diffDays(start, end) + 1;
    const showYear = lastYear === null || start.getFullYear() !== lastYear;
    months.push({
      start,
      end,
      label: monthFmt.format(start),
      yearLabel: showYear ? yearFmt.format(start) : null,
      offsetPct: (offsetDays / totalDays) * 100,
      widthPct: (spanDays / totalDays) * 100,
    });
    lastYear = start.getFullYear();
  }

  // Week dividers — every Monday inside the window. Built whenever the
  // caller asks for weekly subdivisions (3M and ALL both do).
  const weeks: WeekTick[] = [];
  if (includeWeeks) {
    let cursor = startOfWeekMon(windowStart);
    // Skip the first tick if it falls before the window — its label would
    // sit at a negative offset and the divider would clip outside the chart.
    if (cursor < windowStart) cursor = addDays(cursor, 7);
    while (cursor <= windowEnd) {
      const offsetDays = diffDays(windowStart, cursor);
      weeks.push({
        start: new Date(cursor),
        weekNumber: isoWeek(cursor),
        offsetPct: (offsetDays / totalDays) * 100,
        coincidesWithMonth: cursor.getDate() === 1,
      });
      cursor = addDays(cursor, 7);
    }
  }

  return { windowStart, windowEnd, totalDays, months, weeks };
}

interface BarLayout {
  item: PlanningItem;
  leftPct: number;
  widthPct: number;
  /** Bar starts before the visible window — render flush-left, no rounded left. */
  clipLeft: boolean;
  /** Bar ends after the visible window — render flush-right, no rounded right. */
  clipRight: boolean;
}

function layoutTask(item: PlanningItem, geo: Geometry): BarLayout | null {
  const start = parseISODate(item.start_date);
  const end = parseISODate(item.due_date);
  if (!start || !end) return null;
  if (end < geo.windowStart || start > geo.windowEnd) return null;
  const clipLeft = start < geo.windowStart;
  const clipRight = end > geo.windowEnd;
  const clampedStart = clipLeft ? geo.windowStart : start;
  const clampedEnd = clipRight ? geo.windowEnd : end;
  const offsetDays = diffDays(geo.windowStart, clampedStart);
  const spanDays = diffDays(clampedStart, clampedEnd) + 1;
  return {
    item,
    leftPct: (offsetDays / geo.totalDays) * 100,
    widthPct: (spanDays / geo.totalDays) * 100,
    clipLeft,
    clipRight,
  };
}

// ── component ─────────────────────────────────────────────────────────────

/** Sticky left task-name column. Wide enough for short titles + a small
 *  supplier chip on the right, narrow enough to leave the chart room. */
const TASK_GUTTER_WIDTH = 220;
/** 44px gives the 24px bars (h-6) generous vertical padding so a long task
 *  list reads as airy, not crammed. */
const ROW_HEIGHT = 44;
/** Fixed pixel width per day per zoom level. The chart canvas overflows
 *  the card horizontally on purpose: at 3M a comfortable week is ~125px
 *  (so the whole quarter is ~1650px and overflows a typical 1100px card
 *  by ~50%), at ALL each month gets ~270px so a year-long plan scrolls
 *  comfortably with the weekly lines still legible. Users scroll right
 *  inside the card to reach later weeks/months. Picking widths here drives
 *  every band, divider, bar, and marker position because they're all CSS-%
 *  values relative to the fixed-width chart container. */
const DAY_WIDTH_PX: Record<"quarter" | "all", number> = {
  quarter: 18,
  all: 9,
};

export default function GanttView({
  currentDate,
  today,
  weddingDate,
  tasks,
  supplierById,
  mode,
  onOpenTask,
  onSupplierChipClick,
}: GanttViewProps) {
  const { t, locale } = useT();

  // ALL spans the whole plan; 3M is a fixed 3-month window off `currentDate`.
  const { windowStart, monthCount } = useMemo(() => {
    if (mode === "all") return computeAllRange(tasks, today, weddingDate);
    return { windowStart: startOfMonth(currentDate), monthCount: 3 };
  }, [mode, currentDate, tasks, today, weddingDate]);

  // Body week dividers on both zooms; the header W-number ticks stay 3M-only
  // (ALL keeps the clean monthly header: the lines alone give the rhythm).
  const showWeekTicks = mode === "quarter";

  const geometry = useMemo(
    () => buildGeometry(windowStart, monthCount, true, locale),
    [windowStart, monthCount, locale],
  );
  const chartWidthPx = geometry.totalDays * DAY_WIDTH_PX[mode];

  const ordered = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const sa = a.start_date ?? "";
      const sb = b.start_date ?? "";
      if (sa !== sb) return sa.localeCompare(sb);
      return (a.due_date ?? "").localeCompare(b.due_date ?? "");
    });
  }, [tasks]);

  // Split into visible + off-window so the gutter can surface "+N earlier /
  // +N later" hints. Without that the empty space reads as "no tasks at all"
  // when really the couple just needs to scroll the window.
  const { visible, beforeCount, afterCount } = useMemo(() => {
    const v: BarLayout[] = [];
    let before = 0;
    let after = 0;
    for (const item of ordered) {
      const layout = layoutTask(item, geometry);
      if (layout) {
        v.push(layout);
        continue;
      }
      const end = parseISODate(item.due_date);
      if (end && end < geometry.windowStart) before++;
      else after++;
    }
    return { visible: v, beforeCount: before, afterCount: after };
  }, [ordered, geometry]);

  const todayInWindow = today >= geometry.windowStart && today <= geometry.windowEnd;
  const todayLeftPct = todayInWindow
    ? (diffDays(geometry.windowStart, today) / geometry.totalDays) * 100
    : null;

  const weddingInWindow =
    weddingDate !== null &&
    weddingDate >= geometry.windowStart &&
    weddingDate <= geometry.windowEnd;
  const weddingLeftPct = weddingInWindow
    ? (diffDays(geometry.windowStart, weddingDate as Date) / geometry.totalDays) * 100
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Single scroll container handles BOTH axes. The chart canvas has a
          fixed pixel width (`chartWidthPx`) wider than the card, so the
          user scrolls horizontally to reach later weeks/months. The header
          pins via `sticky top-0`; both gutter cells pin via `sticky left-0`
          so the time axis + task-name column stay anchored while the chart
          slides under them. */}
      <div className="relative flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div
          className="flex min-h-full flex-col"
          style={{ minWidth: TASK_GUTTER_WIDTH + chartWidthPx }}
        >
          {/* Header — task-column spacer + year ribbon + month labels (+ week
          ticks at 3M). Sticky-top so it stays as the couple scrolls vertically;
          its gutter cell is sticky-left so it stays anchored as the chart
          slides horizontally underneath. */}
          {/* No backdrop-blur here: backdrop-filter makes Safari clip the
              today/wedding marker badges that straddle this header's bottom
              edge (bottom-0 translate-y-1/2), cutting off the "TODAY" pill.
              A solid 95%-opaque fill hides scrolled content just as well. */}
          <div className="sticky top-0 z-30 flex shrink-0 border-b border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900">
            <div
              className="sticky left-0 z-40 shrink-0 border-r border-paper-200 bg-paper-50/95 px-3 py-2.5 font-grotesk text-[12px] uppercase tracking-wider text-ink-500 backdrop-blur dark:border-umber-700 dark:bg-umber-900/95 dark:text-umber-300"
              style={{ width: TASK_GUTTER_WIDTH }}
            >
              {t("timeline.task_column")}
            </div>
            <div className="relative" style={{ width: chartWidthPx }}>
              {/* Year ribbon — only printed when the year flips so we don't repeat
              "2026" twelve times across a long window. */}
              <div className="relative h-6">
                {geometry.months.map((m) =>
                  m.yearLabel ? (
                    <span
                      key={`yr-${m.start.toISOString()}`}
                      className="absolute top-1.5 px-2 font-grotesk text-[11px] text-ink-400 dark:text-umber-400"
                      style={{ left: `${m.offsetPct}%` }}
                    >
                      {m.yearLabel}
                    </span>
                  ) : null,
                )}
              </div>
              <div className="relative h-8">
                {geometry.months.map((m, idx) => {
                  // A year-flip is signalled by `yearLabel` being set — except for
                  // the first band, which always shows the year (so the user has
                  // a reference) but isn't structurally a section break.
                  const isYearChange = m.yearLabel !== null && idx !== 0;
                  // First month always gets the "ink-700" treatment so the eye
                  // lands on the start of the window; subsequent year-flips also
                  // bump up the weight so section breaks read at a glance.
                  const isPrimary = idx === 0 || isYearChange;
                  const dividerClass = isYearChange
                    ? "border-l border-paper-300 dark:border-umber-600"
                    : idx === 0
                      ? ""
                      : "border-l border-paper-200 dark:border-umber-700";
                  const labelClass = isPrimary
                    ? "font-grotesk text-[13px] font-medium text-ink-700 dark:text-paper-100"
                    : "font-grotesk text-[13px] text-ink-500 dark:text-umber-300";
                  return (
                    <div
                      key={m.start.toISOString()}
                      className={`absolute top-0 flex h-full items-center px-2 ${dividerClass} ${labelClass}`}
                      style={{ left: `${m.offsetPct}%`, width: `${m.widthPct}%` }}
                    >
                      <span className="capitalize">{m.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Week-number tick row — only on 3M. ALL keeps the clean
              monthly header (its weekly rhythm comes from the dividers in the
              body); printing W-numbers across a year-long span is static. */}
              {showWeekTicks && (
                <div className="relative h-6">
                  {geometry.weeks.map((w) => (
                    <span
                      key={`wk-${w.start.toISOString()}`}
                      className="absolute top-1.5 px-1 font-grotesk text-[11px] text-ink-400 dark:text-umber-400"
                      style={{ left: `${w.offsetPct}%` }}
                    >
                      W{w.weekNumber}
                    </span>
                  ))}
                </div>
              )}

              {/* Marker badges live in the header (which the body's
              `overflow-y-auto` doesn't clip) and straddle its bottom border
              via `bottom-0 translate-y-1/2`. The vertical lines themselves
              stay in the body so they run top-to-bottom of the chart. */}
              {weddingLeftPct !== null && (
                <span
                  className="pointer-events-none absolute bottom-0 inline-flex h-7 w-7 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full bg-sage-500 text-paper-50 shadow-soft ring-2 ring-paper-50 dark:ring-umber-900"
                  style={{ left: `${weddingLeftPct}%` }}
                  aria-label={t("timeline.wedding_marker")}
                  title={t("timeline.wedding_marker")}
                >
                  <Heart size={14} aria-hidden="true" fill="currentColor" />
                </span>
              )}
              {todayLeftPct !== null && (
                <span
                  className="pointer-events-none absolute bottom-0 z-10 -translate-x-1/2 translate-y-full whitespace-nowrap rounded-full bg-blush-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper-50 shadow-soft"
                  style={{ left: `${todayLeftPct}%` }}
                  aria-label={t("timeline.today_label")}
                  title={t("timeline.today_label")}
                >
                  {t("timeline.today_label")}
                </span>
              )}
            </div>
          </div>

          {/* Body — sits inside the shared scroll container. `flex-1 min-h-0`
          makes it fill the remaining vertical space, so month bands, week
          dividers, and the today line read as a real chart canvas instead
          of a thin strip at the top when the task list is short. */}
          <div className="relative flex min-h-0 flex-1">
            {/* Task-name gutter — pins to the left while the chart scrolls.
              When the couple has no tasks in the visible window we surface
              an editorial empty state here (not floating on the chart canvas,
              which scrolls off-screen at 3M/ALL zoom) with a + link straight
              to /app/planning where the wand generates a full plan. */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-paper-200 bg-paper-50/95 backdrop-blur dark:border-umber-700 dark:bg-umber-900/95"
              style={{ width: TASK_GUTTER_WIDTH }}
            >
              {visible.length === 0 && beforeCount === 0 && afterCount === 0 ? (
                <div className="flex flex-col items-start gap-3 px-4 py-5">
                  <p className="font-grotesk text-[15px] text-ink-700 dark:text-paper-100">
                    {t("timeline.empty_gutter_title")}
                  </p>
                  <p className="text-xs leading-relaxed text-ink-500 dark:text-umber-300">
                    {t("timeline.empty_gutter_sub")}
                  </p>
                  <Link
                    to="/app/planning"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-xs font-medium text-paper-50 transition-colors hover:bg-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900"
                  >
                    <Plus size={13} aria-hidden="true" />
                    <span>{t("timeline.empty_gutter_cta")}</span>
                  </Link>
                </div>
              ) : (
                visible.map((bar, idx) => {
                  const item = bar.item;
                  const supplier = item.supplier_id
                    ? (supplierById.get(item.supplier_id) ?? null)
                    : null;
                  const zebra = idx % 2 === 1 ? "bg-paper-50/60 dark:bg-umber-900/30" : "";
                  return (
                    <button
                      type="button"
                      key={`gutter-${item.id}`}
                      onClick={() => onOpenTask(item)}
                      className={`flex w-full items-center gap-2 border-b border-paper-200 px-3 text-left transition-colors hover:bg-paper-100 dark:border-umber-700/60 dark:hover:bg-umber-700/40 ${zebra}`}
                      style={{ height: ROW_HEIGHT }}
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          item.done
                            ? "text-ink-400 line-through dark:text-umber-300"
                            : "text-ink-900 dark:text-paper-50"
                        }`}
                      >
                        {item.title}
                      </span>
                      {supplier && (
                        <span
                          className="inline-flex shrink-0 items-center truncate text-[10px] text-ink-500 dark:text-umber-300"
                          style={{ maxWidth: 80 }}
                          title={supplier.name}
                        >
                          {supplier.name}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              {visible.length > 0 && (beforeCount > 0 || afterCount > 0) && (
                <div className="space-y-0.5 px-3 py-2 text-[11px] text-ink-500 dark:text-umber-300">
                  {beforeCount > 0 && (
                    <div>← {t("timeline.outside_before", { count: beforeCount })}</div>
                  )}
                  {afterCount > 0 && (
                    <div>{t("timeline.outside_after", { count: afterCount })} →</div>
                  )}
                </div>
              )}
              {visible.length === 0 && (beforeCount > 0 || afterCount > 0) && (
                <div className="space-y-1 border-t border-paper-200 px-4 py-3 text-[11px] text-ink-500 dark:border-umber-700/60 dark:text-umber-300">
                  {beforeCount > 0 && (
                    <div>← {t("timeline.outside_before", { count: beforeCount })}</div>
                  )}
                  {afterCount > 0 && (
                    <div>{t("timeline.outside_after", { count: afterCount })} →</div>
                  )}
                </div>
              )}
            </div>

            {/* Chart — bands + dividers + markers + bars. Fixed pixel width;
              percentage positions inside compute relative to this width. */}
            <div className="relative shrink-0" style={{ width: chartWidthPx }}>
              {/* Alternating month bands */}
              {geometry.months.map((m, idx) => (
                <div
                  key={`band-${m.start.toISOString()}`}
                  className={`absolute inset-y-0 ${
                    idx % 2 === 0 ? "" : "bg-paper-100/50 dark:bg-umber-900/30"
                  }`}
                  style={{ left: `${m.offsetPct}%`, width: `${m.widthPct}%` }}
                  aria-hidden="true"
                />
              ))}

              {/* Week dividers (3M + ALL). Lighter than the month rules so
                they read as a subdivision, not a section break. Skip the
                Mondays that coincide with a month-1st — the month divider
                owns that vertical. */}
              {geometry.weeks.map((w) =>
                w.coincidesWithMonth ? null : (
                  <div
                    key={`wkdiv-${w.start.toISOString()}`}
                    className="pointer-events-none absolute inset-y-0 w-px bg-paper-200/60 dark:bg-umber-700/40"
                    style={{ left: `${w.offsetPct}%` }}
                    aria-hidden="true"
                  />
                ),
              )}

              {/* Month dividers (skip first — the gutter border handles that
                edge). Year-change ticks get a slightly stronger value so the
                section break reads at a glance. */}
              {geometry.months.map((m, idx) => {
                if (idx === 0) return null;
                const isYearChange = m.yearLabel !== null;
                const tickClass = isYearChange
                  ? "bg-paper-300 dark:bg-umber-600"
                  : "bg-paper-200 dark:bg-umber-700";
                return (
                  <div
                    key={`divider-${m.start.toISOString()}`}
                    className={`absolute inset-y-0 w-px ${tickClass}`}
                    style={{ left: `${m.offsetPct}%` }}
                    aria-hidden="true"
                  />
                );
              })}

              {/* Wedding-day vertical (sage). The badge sits in the header
                so this is just the line — `-translate-x-1/2` centres a 1px
                line on the percent-based x position. */}
              {weddingLeftPct !== null && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-[1] w-px -translate-x-1/2 bg-sage-500/70"
                  style={{ left: `${weddingLeftPct}%` }}
                  aria-hidden="true"
                />
              )}

              {/* Today vertical (blush). Badge is in the header. Kept as a
                plain rule — no glow — to match the Day/Week clean-line
                treatment the user signed off on. */}
              {todayLeftPct !== null && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-blush-500"
                  style={{ left: `${todayLeftPct}%` }}
                  aria-hidden="true"
                />
              )}

              {/* No on-canvas empty state — at 3M/ALL the chart canvas is
                wider than the viewport, so an `absolute inset-0` centred
                message scrolls off-screen on first paint. The gutter (which
                is sticky-left) now hosts the editorial empty state instead. */}

              {/* Rows — borders + bars. Rows are transparent so the month bands
                provide the horizontal rhythm — no per-row zebra on top of the
                month bands or the chart reads like a spreadsheet. */}
              <div className="relative">
                {visible.length === 0
                  ? null
                  : visible.map((bar) => {
                      const item = bar.item;
                      const supplier = item.supplier_id
                        ? (supplierById.get(item.supplier_id) ?? null)
                        : null;
                      const done = item.done;
                      // Mirror MonthView's polished bar treatment: completed
                      // tasks retreat (opacity-70 + line-through + thinner sage
                      // border), active tasks get a blush bottom-border accent.
                      const barClasses = done
                        ? "bg-sage-300 opacity-70 border-b-2 border-sage-500/40 text-sage-900 ring-sage-400/60 dark:bg-sage-400/30 dark:text-paper-50"
                        : "bg-blush-300 border-b-2 border-blush-500/60 text-ink-900 ring-blush-400/60 dark:bg-blush-400/30 dark:text-paper-50 dark:ring-blush-300/40";
                      const corners = `${bar.clipLeft ? "rounded-l-none" : "rounded-l-md"} ${
                        bar.clipRight ? "rounded-r-none" : "rounded-r-md"
                      }`;
                      return (
                        <div
                          key={`row-${item.id}`}
                          className="relative border-b border-paper-200 dark:border-umber-700/60"
                          style={{ height: ROW_HEIGHT }}
                        >
                          <button
                            type="button"
                            onClick={() => onOpenTask(item)}
                            title={item.title}
                            className={`absolute top-1/2 z-[2] flex h-6 -translate-y-1/2 items-center gap-1 px-2 text-[11px] shadow-soft transition-colors hover:brightness-95 hover:ring-1 ${barClasses} ${corners}`}
                            style={{
                              left: `${bar.leftPct}%`,
                              width: `max(${bar.widthPct}%, 24px)`,
                              minWidth: 24,
                            }}
                          >
                            <span
                              className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""}`}
                            >
                              {item.title}
                            </span>
                            {supplier && bar.widthPct > 14 && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSupplierChipClick(supplier.id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSupplierChipClick(supplier.id);
                                  }
                                }}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-100/80 px-1.5 py-0.5 text-[9px] text-ink-800 hover:bg-paper-100 dark:bg-umber-900/60 dark:text-paper-100 dark:hover:bg-umber-900/80"
                              >
                                {supplier.name}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
