// Calendar-grid quarter view for /app/timeline at the 3M zoom level. Mirrors
// MonthView's visual language but the cell unit is a WEEK rather than a day:
// the visible quarter is laid out as a 3-row × ceil(N/3)-column grid of week
// cells (typical N = 13 for a real calendar quarter, occasionally 14 when the
// quarter-start week straddles).
//
// Why the 3-row split: a single long strip of 13 cells reads cramped at any
// realistic container width and wastes vertical space. Three rows × ~4 cols
// each fills the page like a desk calendar and keeps each cell big enough to
// show 3 task lanes + a "+N more" pill without truncating titles to nothing.

import type { PlanningItem } from "@shared/types";
import { useMemo } from "react";
import { useT } from "../../lib/i18n";

interface ResolvedSupplier {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface QuarterViewProps {
  currentDate: Date;
  today: Date;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  onOpenTask: (item: PlanningItem) => void;
  weddingDate?: Date | null;
}

// ─── tiny date helpers (inlined per spec) ────────────────────────────────────

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

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function isoWeek(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  return Math.ceil(((date.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── layout primitives ───────────────────────────────────────────────────────

interface PlacedBar {
  item: PlanningItem;
  /** 0-based column within THIS row (0..cols-1). */
  startCol: number;
  /** Inclusive width in columns (>= 1). */
  span: number;
  /** Lane (0..MAX_LANES-1). Bars at lane >= MAX_LANES go into overflow. */
  lane: number;
}

interface RowLayout {
  bars: PlacedBar[];
  /** Per-column lists of items spilled past `MAX_LANES`. Used for "+N" pill. */
  overflow: PlanningItem[][];
}

const MAX_LANES = 3;
const LANE_HEIGHT_PX = 22;
const HEADER_OFFSET_PX = 32; // header strip height inside each cell

function compareItems(a: PlanningItem, b: PlanningItem): number {
  const sa = a.start_date ?? "";
  const sb = b.start_date ?? "";
  if (sa !== sb) return sa.localeCompare(sb);
  const da = a.due_date ?? "";
  const db = b.due_date ?? "";
  if (da !== db) return db.localeCompare(da);
  return a.id - b.id;
}

/** Pack one row of week-cells. `weeks` is the row's slice of all weeks; the
 *  row's first day is `weeks[0]`, last day is `addDays(weeks[last], 6)`. */
function packRow(weeks: Date[], items: PlanningItem[]): RowLayout {
  const cols = weeks.length;
  if (cols === 0) return { bars: [], overflow: [] };
  const firstWeek = weeks[0] as Date;
  const lastWeek = weeks[cols - 1] as Date;
  const rowStart = firstWeek;
  const rowEnd = addDays(lastWeek, 6);

  type Candidate = { item: PlanningItem; startCol: number; span: number };
  const candidates: Candidate[] = [];

  for (const item of items) {
    const start = parseISODate(item.start_date);
    const end = parseISODate(item.due_date);
    if (!start || !end) continue;
    if (end < rowStart || start > rowEnd) continue;
    const clampedStart = start < rowStart ? rowStart : start;
    const clampedEnd = end > rowEnd ? rowEnd : end;
    if (clampedEnd < clampedStart) continue;
    // Convert clamped day-range into the week-column range within this row.
    const startCol = Math.floor(diffDays(rowStart, clampedStart) / 7);
    const endCol = Math.floor(diffDays(rowStart, clampedEnd) / 7);
    if (startCol > cols - 1 || endCol < 0) continue;
    const sCol = Math.max(0, startCol);
    const eCol = Math.min(cols - 1, endCol);
    candidates.push({ item, startCol: sCol, span: eCol - sCol + 1 });
  }

  candidates.sort((a, b) => compareItems(a.item, b.item));

  const lanes: number[] = []; // lanes[i] = last endCol occupied (inclusive)
  const bars: PlacedBar[] = [];
  const overflow: PlanningItem[][] = Array.from({ length: cols }, () => []);

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
      for (let col = c.startCol; col < c.startCol + c.span; col++) {
        const list = overflow[col];
        if (list) list.push(c.item);
      }
    }
  }
  return { bars, overflow };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function QuarterView({
  currentDate,
  today,
  tasks,
  supplierById,
  onOpenTask,
  weddingDate: _weddingDate,
}: QuarterViewProps) {
  const { t, locale } = useT();

  // Supplier map + wedding date aren't used in this view's UI — the cells
  // are intentionally compact — but they're part of the contract. Touch
  // both so TS strict-noUnusedParameters stays happy.
  void supplierById;
  void _weddingDate;

  // Compute the visible window: snap to weeks bracketing the calendar quarter.
  const { weeks, qStart, qEnd } = useMemo(() => {
    const qs = startOfQuarter(currentDate);
    const qe = new Date(qs.getFullYear(), qs.getMonth() + 3, 0); // last day of quarter
    const gridStart = startOfWeekMon(qs);
    const gridLastWeek = startOfWeekMon(qe);
    const weekCount = Math.round(diffDays(gridStart, gridLastWeek) / 7) + 1;
    const out: Date[] = [];
    for (let i = 0; i < weekCount; i++) out.push(addDays(gridStart, i * 7));
    return { weeks: out, qStart: qs, qEnd: qe };
  }, [currentDate]);

  const cols = Math.ceil(weeks.length / 3);

  // Build the 3 row-slices. Row k spans weeks[k*cols .. (k+1)*cols - 1],
  // clamped to weeks.length. If the last row has fewer than `cols` weeks
  // (e.g. N=13 → rows of 5,5,3) we still render `cols` cells per row but
  // mark the trailing ones as "filler" so the grid stays rectangular.
  const rowSlices: Date[][] = [];
  for (let r = 0; r < 3; r++) {
    const start = r * cols;
    const end = Math.min(start + cols, weeks.length);
    rowSlices.push(weeks.slice(start, end));
  }

  const rowLayouts = rowSlices.map((slice) => packRow(slice, tasks));

  const todayLabel = t("timeline.today_button");

  // Date-range formatter inside a week cell: "máj. 4 – 10" or, if the week
  // straddles two months, "máj. 30 – jún. 5". `Intl` handles the locale
  // detail; we choose the joining dash explicitly to keep punctuation
  // consistent across locales.
  const monthDayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
        month: "short",
        day: "numeric",
      }),
    [locale],
  );
  const dayOnlyFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
        day: "numeric",
      }),
    [locale],
  );

  const formatWeekRange = (weekStart: Date): string => {
    const weekEnd = addDays(weekStart, 6);
    const sameMonth =
      weekStart.getMonth() === weekEnd.getMonth() &&
      weekStart.getFullYear() === weekEnd.getFullYear();
    if (sameMonth) {
      return `${monthDayFmt.format(weekStart)} – ${dayOnlyFmt.format(weekEnd)}`;
    }
    return `${monthDayFmt.format(weekStart)} – ${monthDayFmt.format(weekEnd)}`;
  };

  // Tailwind needs literal class names for `grid-cols-N` (no JIT for arbitrary
  // values when the column count is dynamic at runtime). We always have
  // 4 or 5 columns in practice (13 weeks → cols=5, 14 weeks → cols=5).
  // Use inline `gridTemplateColumns` to stay safe regardless.
  const cellGridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  const moreLabel = (n: number) => (locale === "hu" ? `+${n}` : `+${n}`);

  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1" style={{ gridTemplateRows: "repeat(3, minmax(0, 1fr))" }}>
        {rowSlices.map((slice, rowIdx) => {
          const layout = rowLayouts[rowIdx];
          const isLastRow = rowIdx === 2;
          return (
            <div key={rowIdx} className="relative grid" style={cellGridStyle}>
              {/* Cells */}
              {Array.from({ length: cols }).map((_, colIdx) => {
                const weekStart = slice[colIdx];
                const isLastCol = colIdx === cols - 1;
                if (!weekStart) {
                  // Filler cell (when N % 3 !== 0); render dim chrome so the
                  // grid stays rectangular without pretending to be a week.
                  return (
                    <div
                      key={`filler-${rowIdx}-${colIdx}`}
                      className={`min-h-[100px] bg-paper-50/40 dark:bg-umber-900/40 ${
                        isLastCol ? "" : "border-r border-paper-200 dark:border-umber-700"
                      } ${isLastRow ? "" : "border-b border-paper-200 dark:border-umber-700"}`}
                    />
                  );
                }
                const weekEnd = addDays(weekStart, 6);
                const containsToday = today >= weekStart && today <= weekEnd;
                // A week is "in quarter" if any of its days fall inside
                // [qStart..qEnd]. The leading/trailing weeks of the grid
                // straddle into neighbouring quarters — dim those.
                const inQuarter = weekEnd >= qStart && weekStart <= qEnd;
                const cellTint = inQuarter ? "" : "bg-paper-50/40 dark:bg-umber-900/40";
                const todayRing = containsToday
                  ? "ring-1 ring-inset ring-blush-400/40 dark:ring-blush-300/40"
                  : "";
                const weekNumClass = inQuarter
                  ? "text-ink-400 dark:text-umber-400"
                  : "text-ink-300 dark:text-umber-500";
                return (
                  <div
                    key={`cell-${rowIdx}-${colIdx}`}
                    className={`relative min-h-[100px] transition-colors hover:bg-paper-100/60 dark:hover:bg-umber-900/40 ${cellTint} ${todayRing} ${
                      isLastCol ? "" : "border-r border-paper-200 dark:border-umber-700"
                    } ${isLastRow ? "" : "border-b border-paper-200 dark:border-umber-700"}`}
                  >
                    <div className="flex items-start justify-between px-2 pt-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className={`font-serif text-sm ${weekNumClass}`}>
                          W{isoWeek(weekStart)}
                        </span>
                        {containsToday && (
                          <span className="text-[10px] uppercase tracking-wider text-blush-700 dark:text-blush-300">
                            {todayLabel}
                          </span>
                        )}
                      </div>
                      <span className="font-serif text-[11px] text-ink-500 dark:text-umber-300">
                        {formatWeekRange(weekStart)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Task bars + overflow pills — overlay locked to the same
                  column grid as the cells, so widths track exactly. Lane
                  height comes from `marginTop` + `alignSelf: start` (the
                  same pattern WeekView uses for its all-day strip). */}
              <div
                className="pointer-events-none absolute inset-0 grid"
                style={{ ...cellGridStyle, paddingTop: HEADER_OFFSET_PX }}
              >
                {layout?.bars.map((bar) => {
                  const item = bar.item;
                  const done = item.done;
                  const barClasses = done
                    ? "bg-sage-300 dark:bg-sage-400/30 text-sage-900 dark:text-paper-50 line-through opacity-70 border-b-2 border-sage-500/40 hover:ring-1 hover:ring-sage-400/60"
                    : "bg-blush-300 dark:bg-blush-400/30 text-ink-900 dark:text-paper-50 border-b-2 border-blush-500/60 hover:ring-1 hover:ring-blush-400/60";
                  return (
                    <button
                      key={`bar-${rowIdx}-${item.id}-${bar.startCol}`}
                      type="button"
                      onClick={() => onOpenTask(item)}
                      title={item.title}
                      className={`pointer-events-auto h-5 truncate rounded-sm px-1.5 text-left text-[11px] transition-all hover:brightness-95 ${barClasses}`}
                      style={{
                        gridColumnStart: bar.startCol + 1,
                        gridColumnEnd: `span ${bar.span}`,
                        gridRowStart: 1,
                        marginTop: bar.lane * LANE_HEIGHT_PX,
                        marginLeft: 4,
                        marginRight: 4,
                        alignSelf: "start",
                      }}
                    >
                      {item.title}
                    </button>
                  );
                })}
                {layout?.overflow.map((list, colIdx) => {
                  if (list.length === 0) return null;
                  const first = list[0];
                  if (!first) return null;
                  return (
                    <button
                      key={`more-${rowIdx}-${colIdx}`}
                      type="button"
                      onClick={() => onOpenTask(first)}
                      className="pointer-events-auto h-5 truncate px-1.5 text-left text-[10px] text-ink-500 underline decoration-paper-300 underline-offset-2 transition-colors hover:text-ink-900 dark:text-umber-300 dark:decoration-umber-600 dark:hover:text-paper-50"
                      style={{
                        gridColumnStart: colIdx + 1,
                        gridColumnEnd: "span 1",
                        gridRowStart: 1,
                        marginTop: MAX_LANES * LANE_HEIGHT_PX,
                        marginLeft: 4,
                        marginRight: 4,
                        alignSelf: "start",
                      }}
                    >
                      {moreLabel(list.length)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
