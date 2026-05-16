// Range Gantt for /app/timeline at 3M (quarter) and 6M (half) zoom.
//
// Anchors on `currentDate` snapped to its month boundary, expands forward by
// the mode's month count, then renders:
//   - a left task gutter (name + supplier chip) aligned to the chart rows
//   - a header row with year ribbon + month labels
//   - alternating month background bands + 1px month dividers
//   - "today" vertical line with a floating label
//   - "wedding day" vertical line with a heart marker (when set)
//   - per-row dividers; bars are one per task with min width so a 1-day
//     task stays clickable even at the 6-month zoom
//
// Bars get clipped corners on the side that runs past the visible window so
// it's obvious a task extends beyond what you're looking at.

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

interface GanttViewProps {
  /** Any day inside the desired window — snapped to its month boundary. */
  currentDate: Date;
  today: Date;
  weddingDate: Date | null;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  mode: "quarter" | "half";
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

interface Geometry {
  windowStart: Date;
  /** Inclusive last day of the window. */
  windowEnd: Date;
  totalDays: number;
  months: MonthBand[];
}

function buildGeometry(currentDate: Date, mode: "quarter" | "half", locale: "hu" | "en"): Geometry {
  const monthCount = mode === "quarter" ? 3 : 6;
  const windowStart = startOfMonth(currentDate);
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
  return { windowStart, windowEnd, totalDays, months };
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
const ROW_HEIGHT = 40;

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

  const geometry = useMemo(
    () => buildGeometry(currentDate, mode, locale),
    [currentDate, mode, locale],
  );

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
      {/* Header — task-column spacer + year ribbon + month labels.
          Stays outside the scrollable body so it never disappears as the
          couple scrolls a long task list. */}
      <div className="flex shrink-0 border-b border-paper-300 dark:border-umber-700">
        <div
          className="shrink-0 border-r border-paper-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:border-umber-700 dark:text-umber-300"
          style={{ width: TASK_GUTTER_WIDTH }}
        >
          {t("timeline.task_column")}
        </div>
        <div className="relative flex-1">
          {/* Year ribbon — only printed when the year flips so we don't repeat
              "2026" twelve times across the 6M view. */}
          <div className="relative h-4">
            {geometry.months.map((m) =>
              m.yearLabel ? (
                <span
                  key={`yr-${m.start.toISOString()}`}
                  className="absolute top-0 px-2 text-[10px] uppercase tracking-wider text-ink-400 dark:text-umber-400"
                  style={{ left: `${m.offsetPct}%` }}
                >
                  {m.yearLabel}
                </span>
              ) : null,
            )}
          </div>
          <div className="relative h-7">
            {geometry.months.map((m, idx) => (
              <div
                key={m.start.toISOString()}
                className={`absolute top-0 flex h-full items-center px-2 text-[12px] font-medium ${
                  idx === 0 ? "" : "border-l border-paper-300 dark:border-umber-700"
                } text-ink-800 dark:text-paper-100`}
                style={{ left: `${m.offsetPct}%`, width: `${m.widthPct}%` }}
              >
                <span className="capitalize">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body — single vertical scroll container so the gutter rows and the
          chart bars stay aligned. */}
      <div className="flex-1 overflow-y-auto">
        <div className="relative flex">
          {/* Task-name gutter */}
          <div
            className="shrink-0 border-r border-paper-200 dark:border-umber-700"
            style={{ width: TASK_GUTTER_WIDTH }}
          >
            {visible.length === 0 ? (
              <div
                className="flex items-center px-3 text-xs text-ink-500 dark:text-umber-300"
                style={{ height: ROW_HEIGHT }}
              >
                {t("timeline.window_empty")}
              </div>
            ) : (
              visible.map((bar) => {
                const item = bar.item;
                const supplier = item.supplier_id
                  ? (supplierById.get(item.supplier_id) ?? null)
                  : null;
                return (
                  <button
                    type="button"
                    key={`gutter-${item.id}`}
                    onClick={() => onOpenTask(item)}
                    className="flex w-full items-center gap-2 border-b border-paper-200 px-3 text-left text-xs transition-colors hover:bg-paper-100 dark:border-umber-700/60 dark:hover:bg-umber-700/40"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        item.done
                          ? "text-ink-400 line-through dark:text-umber-300"
                          : "text-ink-900 dark:text-paper-50"
                      }`}
                    >
                      {item.title}
                    </span>
                    {supplier && (
                      <span
                        className="inline-flex shrink-0 items-center truncate rounded-full bg-paper-100 px-1.5 py-0.5 text-[10px] text-ink-700 dark:bg-umber-700 dark:text-paper-100"
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
            {(beforeCount > 0 || afterCount > 0) && (
              <div className="space-y-0.5 px-3 py-2 text-[11px] text-ink-500 dark:text-umber-300">
                {beforeCount > 0 && (
                  <div>← {t("timeline.outside_before", { count: beforeCount })}</div>
                )}
                {afterCount > 0 && (
                  <div>{t("timeline.outside_after", { count: afterCount })} →</div>
                )}
              </div>
            )}
          </div>

          {/* Chart — bands + dividers + markers + bars. `relative` so absolute
              overlays span the full body height (which equals the gutter's
              height because rows are the same fixed pixel size). */}
          <div className="relative flex-1">
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

            {/* Month dividers (skip first — the gutter border handles that edge) */}
            {geometry.months.map((m, idx) =>
              idx === 0 ? null : (
                <div
                  key={`divider-${m.start.toISOString()}`}
                  className="absolute inset-y-0 w-px bg-paper-300 dark:bg-umber-700"
                  style={{ left: `${m.offsetPct}%` }}
                  aria-hidden="true"
                />
              ),
            )}

            {/* Wedding-day marker — sage to set it apart from today's blush. */}
            {weddingLeftPct !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-sage-500/70"
                style={{ left: `${weddingLeftPct}%` }}
                aria-label={t("timeline.wedding_marker")}
                title={t("timeline.wedding_marker")}
              >
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 transform">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sage-500 text-paper-50 shadow-soft">
                    <Heart size={11} aria-hidden="true" fill="currentColor" />
                  </span>
                </span>
              </div>
            )}

            {/* Today marker */}
            {todayLeftPct !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-[1]"
                style={{ left: `${todayLeftPct}%` }}
                aria-label={t("timeline.today_label")}
                title={t("timeline.today_label")}
              >
                <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-blush-500" />
                <span className="absolute -top-2 left-1 rounded-full bg-blush-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper-50">
                  {t("timeline.today_label")}
                </span>
              </div>
            )}

            {/* Rows — borders + bars. Rows are transparent so the month bands
                show through. */}
            <div className="relative">
              {visible.length === 0 ? (
                <div style={{ height: ROW_HEIGHT }} aria-hidden="true" />
              ) : (
                visible.map((bar) => {
                  const item = bar.item;
                  const supplier = item.supplier_id
                    ? (supplierById.get(item.supplier_id) ?? null)
                    : null;
                  const done = item.done;
                  const barClasses = done
                    ? "bg-sage-300 text-sage-900 dark:bg-sage-400/30 dark:text-paper-50"
                    : "bg-blush-300 text-ink-900 dark:bg-blush-400/30 dark:text-paper-50";
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
                        className={`absolute top-1/2 z-[2] flex h-6 -translate-y-1/2 items-center gap-1 px-2 text-[11px] shadow-soft transition-colors hover:brightness-95 ${barClasses} ${corners}`}
                        style={{
                          left: `${bar.leftPct}%`,
                          width: `max(${bar.widthPct}%, 12px)`,
                          minWidth: 12,
                        }}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""}`}
                        >
                          {item.title}
                        </span>
                        {supplier && bar.widthPct > 10 && (
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
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
