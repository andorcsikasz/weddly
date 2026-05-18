// Calendar-grid half-year view for /app/timeline at the 6M zoom level. The
// visible window is the 6 months starting from `startOfMonth(currentDate)`,
// rendered as a single horizontal row of 6 month-cells. Tasks lane-pack
// ACROSS the whole row (not per-cell) so a multi-month bar reads as one
// continuous stroke from "Anniversary planning" → "Honeymoon booking".
//
// Two markers ride on top of the grid: a blush "today" line and a darker
// blush "wedding day" line with a tiny Heart icon. Both use the same
// percent-of-row positioning so they stay aligned with the month columns.

import type { PlanningItem } from "@shared/types";
import { Heart } from "lucide-react";
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

interface HalfYearViewProps {
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

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function monthIndex(d: Date): number {
  // Stable cross-year ordinal: year * 12 + month. Used to map a date to the
  // visible 6-month column without worrying about year rollover.
  return d.getFullYear() * 12 + d.getMonth();
}

// ─── layout primitives ───────────────────────────────────────────────────────

interface PlacedBar {
  item: PlanningItem;
  /** 0..5 — month-column the bar starts in. */
  startCol: number;
  /** Number of month columns the bar spans (>=1). */
  span: number;
  /** Lane index (0..MAX_LANES-1). */
  lane: number;
}

const MAX_LANES = 6;
const LANE_HEIGHT_PX = 24;
const HEADER_OFFSET_PX = 40;
const COLS = 6;

function compareItems(a: PlanningItem, b: PlanningItem): number {
  const sa = a.start_date ?? "";
  const sb = b.start_date ?? "";
  if (sa !== sb) return sa.localeCompare(sb);
  const da = a.due_date ?? "";
  const db = b.due_date ?? "";
  if (da !== db) return db.localeCompare(da);
  return a.id - b.id;
}

function packRow(months: Date[], items: PlanningItem[]): PlacedBar[] {
  if (months.length === 0) return [];
  const firstMonth = months[0] as Date;
  const lastMonth = months[months.length - 1] as Date;
  const rangeStart = startOfDay(firstMonth);
  const rangeEnd = startOfDay(lastDayOfMonth(lastMonth));
  const baseIdx = monthIndex(firstMonth);

  type Candidate = { item: PlanningItem; startCol: number; span: number };
  const candidates: Candidate[] = [];

  for (const item of items) {
    const start = parseISODate(item.start_date);
    const end = parseISODate(item.due_date);
    if (!start || !end) continue;
    if (end < rangeStart || start > rangeEnd) continue;
    const clampedStart = start < rangeStart ? rangeStart : start;
    const clampedEnd = end > rangeEnd ? rangeEnd : end;
    if (clampedEnd < clampedStart) continue;
    const startCol = Math.max(0, monthIndex(clampedStart) - baseIdx);
    const endCol = Math.min(COLS - 1, monthIndex(clampedEnd) - baseIdx);
    if (startCol > COLS - 1 || endCol < 0) continue;
    candidates.push({ item, startCol, span: endCol - startCol + 1 });
  }

  candidates.sort((a, b) => compareItems(a.item, b.item));

  const lanes: number[] = []; // lanes[i] = last endCol occupied (inclusive)
  const bars: PlacedBar[] = [];
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
    }
    // Bars past MAX_LANES are silently dropped at this zoom — 6 lanes of
    // wedding tasks is already a dense view, and "+N more" pills would
    // collide with month-cell chrome. The user can zoom to 3M / 1M to
    // see everything.
  }
  return bars;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function HalfYearView({
  currentDate,
  today,
  tasks,
  supplierById,
  onOpenTask,
  weddingDate,
}: HalfYearViewProps) {
  const { t, locale } = useT();

  void supplierById;

  const months = useMemo(() => {
    const first = startOfMonth(currentDate);
    const out: Date[] = [];
    for (let i = 0; i < COLS; i++) out.push(addMonths(first, i));
    return out;
  }, [currentDate]);

  const bars = useMemo(() => packRow(months, tasks), [months, tasks]);

  const todayLabel = t("timeline.today_button");

  const monthFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
        month: "long",
      }),
    [locale],
  );

  // Today + wedding-day relative-x calculation. Each month column is
  // (100/6)% wide; within a column the day-of-month maps linearly to
  // `dayOfMonth / daysInMonth`. Returns `null` when the date falls
  // outside the visible 6 months.
  const dateToOffsetPct = (d: Date): number | null => {
    const firstMonth = months[0];
    const lastMonth = months[months.length - 1];
    if (!firstMonth || !lastMonth) return null;
    const dayStart = startOfDay(d);
    const rangeStart = startOfDay(firstMonth);
    const rangeEnd = startOfDay(lastDayOfMonth(lastMonth));
    if (dayStart < rangeStart || dayStart > rangeEnd) return null;
    const baseIdx = monthIndex(firstMonth);
    const colOffset = monthIndex(dayStart) - baseIdx;
    const monthCol = months[colOffset];
    if (!monthCol) return null;
    const daysInMonth = lastDayOfMonth(monthCol).getDate();
    const colWidth = 100 / COLS;
    const intraCol = (dayStart.getDate() - 1 + 0.5) / daysInMonth; // mid-day
    return colOffset * colWidth + intraCol * colWidth;
  };

  const todayPct = dateToOffsetPct(today);
  const weddingPct = weddingDate ? dateToOffsetPct(weddingDate) : null;

  const todayMonthCol = (() => {
    const firstMonth = months[0];
    if (!firstMonth) return -1;
    const baseIdx = monthIndex(firstMonth);
    const idx = monthIndex(today) - baseIdx;
    return idx >= 0 && idx < COLS ? idx : -1;
  })();

  // Show year suffix on the first cell and whenever the year flips. Keeps
  // the header strip readable without repeating "2026" across all six cells.
  let prevYear: number | null = null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col">
        {/* Header strip — month titles. Sits as its own grid row so the
            bar-overlay can align to the same columns without inheriting
            the title heights. */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {months.map((m, idx) => {
            const isToday = idx === todayMonthCol;
            const showYear = prevYear !== m.getFullYear();
            prevYear = m.getFullYear();
            const monthName = monthFmt.format(m);
            // hu-HU's `month: "long"` yields lowercase "május" — keep as is;
            // matches the typography elsewhere in the app.
            return (
              <div
                key={m.toISOString()}
                className={`flex items-baseline gap-2 px-3 pt-2 ${
                  idx === 0 ? "" : "border-l border-paper-200 dark:border-umber-700"
                }`}
                style={{ height: HEADER_OFFSET_PX }}
              >
                <span className="font-serif text-lg text-ink-900 dark:text-paper-50">
                  {monthName}
                </span>
                {showYear && (
                  <span className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
                    {m.getFullYear()}
                  </span>
                )}
                {isToday && (
                  <span className="text-[10px] uppercase tracking-wider text-blush-700 dark:text-blush-300">
                    {todayLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Body — month cells + lane-packed bars + today / wedding markers.
            One relative container hosts three stacked layers: the cell
            chrome (background tints + borders), the bar overlay (grid
            placement), and the marker overlay (today + wedding). */}
        <div className="relative flex-1">
          {/* Cell chrome */}
          <div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          >
            {months.map((m, idx) => {
              const isToday = idx === todayMonthCol;
              const ring = isToday
                ? "ring-1 ring-inset ring-blush-400/40 dark:ring-blush-300/40"
                : "";
              return (
                <div
                  key={m.toISOString()}
                  className={`min-h-[200px] transition-colors hover:bg-paper-100/60 dark:hover:bg-umber-900/40 ${
                    idx === 0 ? "" : "border-l border-paper-200 dark:border-umber-700"
                  } ${ring}`}
                />
              );
            })}
          </div>

          {/* Bar overlay */}
          <div
            className="pointer-events-none absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
              paddingTop: 8,
            }}
          >
            {bars.map((bar) => {
              const item = bar.item;
              const done = item.done;
              const barClasses = done
                ? "bg-sage-300 dark:bg-sage-400/30 text-sage-900 dark:text-paper-50 line-through opacity-70 border-b-2 border-sage-500/40 hover:ring-1 hover:ring-sage-400/60"
                : "bg-blush-300 dark:bg-blush-400/30 text-ink-900 dark:text-paper-50 border-b-2 border-blush-500/60 hover:ring-1 hover:ring-blush-400/60";
              return (
                <button
                  key={`bar-${item.id}-${bar.startCol}`}
                  type="button"
                  onClick={() => onOpenTask(item)}
                  title={item.title}
                  className={`pointer-events-auto h-5 truncate rounded-sm px-2 text-left text-[11px] transition-all hover:brightness-95 ${barClasses}`}
                  style={{
                    gridColumnStart: bar.startCol + 1,
                    gridColumnEnd: `span ${bar.span}`,
                    gridRowStart: 1,
                    marginTop: bar.lane * LANE_HEIGHT_PX,
                    marginLeft: 6,
                    marginRight: 6,
                    alignSelf: "start",
                  }}
                >
                  {item.title}
                </button>
              );
            })}
          </div>

          {/* Today vertical line. Spans from below the header strip to
              the bottom of the body so it reads as a continuous "now"
              marker across all bars in the column. */}
          {todayPct !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-blush-500"
              style={{ left: `${todayPct}%` }}
            />
          )}

          {/* Wedding-day vertical line + Heart cap. Darker blush so it
              reads distinctly from the today line. */}
          {weddingPct !== null && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-blush-700"
                style={{ left: `${weddingPct}%` }}
              />
              <Heart
                aria-hidden="true"
                className="pointer-events-none absolute h-3 w-3 text-blush-700"
                style={{
                  left: `calc(${weddingPct}% - 6px)`,
                  top: 2,
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
