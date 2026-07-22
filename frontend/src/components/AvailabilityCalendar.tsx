// A compact month-grid availability calendar shared by the couple-facing planner
// detail page (read-only: shows the planner's booked days in red, opens on the
// couple's wedding month) and the planner settings editor (editable: tap a
// future day to toggle it booked/free). Whole-day only — planners run one
// wedding a day, so there is no partial-hour concept like the vendor calendar.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { intlLocale } from "../lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";

/** Local-time 'YYYY-MM-DD' — matches the ISO strings the API stores/returns. */
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function AvailabilityCalendar({
  blockedDates,
  initialMonth = null,
  editable = false,
  busy = false,
  onToggle,
}: {
  /** Whole-day blocked dates, 'YYYY-MM-DD'. */
  blockedDates: string[];
  /** ISO date the calendar opens on (the couple's wedding month). Null = today. */
  initialMonth?: string | null;
  /** Planner editor: future days become toggle buttons. */
  editable?: boolean;
  /** Disable interaction while a block/unblock request is in flight. */
  busy?: boolean;
  /** Called with the clicked day + whether it was already blocked. */
  onToggle?: (date: string, currentlyBlocked: boolean) => void;
}) {
  const { t, locale } = useT();
  const today = useMemo(() => new Date(), []);
  const todayIso = ymd(today);
  const [cursor, setCursor] = useState<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  // Jump to the target month once, when it's known (it may arrive after the
  // first render). A ref guards it so navigating away isn't undone.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !initialMonth) return;
    const d = new Date(initialMonth);
    if (Number.isNaN(d.getTime())) return;
    applied.current = true;
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, [initialMonth]);

  const blocked = useMemo(() => new Set(blockedDates), [blockedDates]);

  const monthLabel = useMemo(() => {
    const d = new Date(cursor.year, cursor.month, 1);
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "long",
      year: "numeric",
    }).format(d);
  }, [cursor, locale]);

  // Monday-first 6×7 grid.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Mon=0..Sun=6
    const gridStart = new Date(cursor.year, cursor.month, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const dayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "narrow" });
    const monday = new Date(2026, 4, 25); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return fmt.format(d);
    });
  }, [locale]);

  const goto = (offset: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month + offset, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const blockedClass =
    "bg-rose-200/70 font-medium text-rose-800 line-through dark:bg-rose-500/40 dark:text-rose-50";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => goto(-1)}
          aria-label={t("availability_calendar.prev_month")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="text-sm font-medium capitalize text-ink-800 dark:text-umber-100">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => goto(1)}
          aria-label={t("availability_calendar.next_month")}
          className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:text-umber-300 dark:hover:bg-umber-800"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase text-ink-500 dark:text-umber-300">
        {dayLabels.map((l, i) => (
          <div key={i} className="py-1">
            {l}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.month;
          const iso = ymd(d);
          const isBlocked = blocked.has(iso);
          const isToday = iso === todayIso;
          const isFuture = iso >= todayIso;
          const canToggle = editable && !busy && inMonth && isFuture;
          const cellClass = `flex h-9 items-center justify-center rounded text-xs transition ${
            !inMonth
              ? "text-ink-300 dark:text-umber-500"
              : isBlocked
                ? blockedClass
                : "text-ink-700 dark:text-umber-100"
          } ${isToday && inMonth && !isBlocked ? "ring-1 ring-rose-400" : ""}`;

          if (canToggle) {
            return (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => onToggle?.(iso, isBlocked)}
                aria-label={t(
                  isBlocked
                    ? "availability_calendar.unblock_aria"
                    : "availability_calendar.block_aria",
                  { date: iso },
                )}
                className={`${cellClass} ${
                  isBlocked ? "hover:brightness-95" : "hover:bg-rose-100 dark:hover:bg-rose-500/20"
                }`}
              >
                {d.getDate()}
              </button>
            );
          }
          return (
            <div key={i} className={cellClass} title={isBlocked ? iso : undefined}>
              {d.getDate()}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1.5 text-[11px] text-ink-500 dark:text-umber-300">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded bg-rose-200/70 dark:bg-rose-500/40" />
          {blocked.size > 0 || editable
            ? t("availability_calendar.legend_booked")
            : t("availability_calendar.empty")}
        </div>
        {editable && <p>{t("availability_calendar.legend_free_hint")}</p>}
      </div>
    </div>
  );
}
