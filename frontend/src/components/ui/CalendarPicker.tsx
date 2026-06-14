import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Monday-first offset (0=Mon … 6=Sun)
function firstWeekdayOffset(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const WEEKDAYS_HU = ["H", "K", "Sz", "Cs", "P", "Szo", "V"] as const;
const WEEKDAYS_EN = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Self-contained calendar grid meant to be rendered inside a `position:
 *  relative` wrapper as `position: absolute top-full`. Click-outside and
 *  Escape handling belong to the parent — this component only renders the
 *  grid and calls `onSelect` when the user picks a day. */
export function CalendarPicker({
  value,
  min,
  onSelect,
  locale,
}: {
  /** Currently selected date as ISO-8601 (YYYY-MM-DD), or null. */
  value: string | null;
  /** Earliest selectable date as ISO-8601. Days before this are disabled. */
  min?: string;
  /** Called with the chosen YYYY-MM-DD string. */
  onSelect: (ymd: string) => void;
  locale: "hu" | "en";
}) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const initYear = value ? Number(value.slice(0, 4)) : today.getFullYear();
  const initMonth = value ? Number(value.slice(5, 7)) - 1 : today.getMonth();

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);

  const monthLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const totalDays = daysInMonth(year, month);
  const offset = firstWeekdayOffset(year, month);
  const cells: Array<number | null> = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dayHeaders = locale === "hu" ? WEEKDAYS_HU : WEEKDAYS_EN;

  return (
    <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-2xl border border-paper-200 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800">
      {/* Month navigation */}
      <div className="flex items-center justify-between border-b border-paper-200 px-3 py-2.5 dark:border-umber-700">
        <button
          type="button"
          onClick={prevMonth}
          aria-label={locale === "hu" ? "Előző hónap" : "Previous month"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-700"
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        <span className="text-sm font-semibold capitalize text-ink-900 dark:text-paper-50">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label={locale === "hu" ? "Következő hónap" : "Next month"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-700"
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {/* Day grid */}
      <div className="p-3">
        <div className="mb-1.5 grid grid-cols-7 text-center">
          {dayHeaders.map((d) => (
            <span
              key={d}
              className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-umber-500"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((day, i) => {
            if (day === null) return <span key={`b-${i}`} />;
            const iso = toIso(year, month, day);
            const selected = iso === value;
            const disabled = min !== undefined && iso < min;
            const isToday = iso === todayIso;
            return (
              <button
                key={iso}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(iso)}
                aria-label={iso}
                aria-pressed={selected}
                className={[
                  "rounded-lg py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-300",
                  selected
                    ? "bg-blush-600 font-semibold text-white dark:bg-blush-500"
                    : disabled
                      ? "cursor-not-allowed text-ink-200 dark:text-umber-700"
                      : isToday
                        ? "font-semibold text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/10"
                        : "text-ink-800 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700",
                ].join(" ")}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
