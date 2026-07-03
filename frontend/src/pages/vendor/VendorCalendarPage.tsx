// Vendor calendar + to-do board, rendered inside VendorShell. Mirrors the
// planner's Google-Calendar-style page: the same six views (Day / 4 days /
// Week / Month / Year / Schedule) behind the same view dropdown, plus the
// Calendar<->Tasks mode toggle (deep-linkable via ?mode=tasks, persisted).
//
// The vendor's calendar "events" are: confirmed bookings (booked weddings),
// pending inquiries (requested / vendor_seen), self-blocked Foglaltsag days,
// and open task deadlines from the board. CALENDAR mode is also the blocking
// editor: clicking a free future day in the month grid blocks it, clicking a
// blocked day (or its pill in any view) unblocks it, and the classic
// date-input + chips + next-free-date section sits below. Couples see the
// blocked days on the public busy calendar. Blocking is a PRO feature; a
// FREE vendor gets the read-only calendar plus the upgrade prompt.
//
// TASKS mode is the Trello-style board (todo / doing / done) with native
// HTML5 drag & drop lifted from the planner board, plus create and delete.

import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  ListChecks,
  Lock,
  SquareKanban,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { VendorAvailabilityView } from "@shared/listings";
import type { VendorClientView } from "@shared/vendor_clients";
import type { VendorBoardStatus, VendorTask } from "@shared/vendor_tasks";
import { useConfirm } from "../../components/ui/ConfirmDialogProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  vendorAvailabilityApi,
  vendorBillingApi,
  vendorClientsApi,
  vendorTaskApi,
} from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

type CalView = "day" | "4day" | "week" | "month" | "year" | "schedule";
type Mode = "calendar" | "tasks";

const VIEW_KEY = "weddly.vendor_cal_view";
const MODE_KEY = "weddly.vendor_cal_mode";

/** One pill on the calendar. `bookingId` set for booked/pending (links to the
 *  client), `date` doubles as the unblock target for kind 'blocked'. */
interface CalEvent {
  kind: "booked" | "pending" | "blocked" | "task";
  date: string; // YYYY-MM-DD
  label: string;
  bookingId?: number;
}

// ── date helpers (local-time safe, same as the planner page) ────────────────

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function startOfWeekMonday(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

/** Render an ISO 'YYYY-MM-DD' in the vendor's locale ("2026. aug. 2."). */
function formatDay(iso: string, locale: string): string {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

// ── event pills ──────────────────────────────────────────────────────────────

function pillColor(kind: CalEvent["kind"]): string {
  switch (kind) {
    case "booked":
      return "bg-steel-100 text-steel-800 hover:brightness-95 dark:bg-steel-900/60 dark:text-steel-100";
    case "pending":
      return "bg-amber-100 text-amber-800 hover:brightness-95 dark:bg-amber-900/40 dark:text-amber-100";
    case "blocked":
      return "bg-blush-100 text-blush-800 hover:brightness-95 dark:bg-blush-900/40 dark:text-blush-100";
    case "task":
      return "bg-moss-100 text-moss-900 hover:brightness-95 dark:bg-moss-900/40 dark:text-moss-100";
  }
}

function PillBody({ ev }: { ev: CalEvent }) {
  return (
    <>
      {ev.kind === "booked" ? (
        <Heart size={10} className="shrink-0" aria-hidden="true" />
      ) : ev.kind === "pending" ? (
        <Clock size={10} className="shrink-0" aria-hidden="true" />
      ) : ev.kind === "blocked" ? (
        <Lock size={10} className="shrink-0" aria-hidden="true" />
      ) : (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
          aria-hidden="true"
        />
      )}
      <span className="truncate">{ev.label}</span>
    </>
  );
}

/** Booked/pending pills link to the client, task pills jump to the board,
 *  blocked pills unblock on click (when the vendor may edit). Blocked pills
 *  are role="button" spans because month-grid cells are themselves <button>s
 *  and nesting buttons is invalid markup. */
function EventPill({
  ev,
  onUnblock,
  unblockTitle,
}: {
  ev: CalEvent;
  onUnblock?: (iso: string) => void;
  unblockTitle?: string;
}) {
  const base = `flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] transition-colors ${pillColor(
    ev.kind,
  )}`;
  if (ev.kind === "blocked") {
    if (!onUnblock) {
      return (
        <span title={ev.label} className={base}>
          <PillBody ev={ev} />
        </span>
      );
    }
    const iso = ev.date;
    return (
      <span
        role="button"
        tabIndex={0}
        title={unblockTitle ?? ev.label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onUnblock(iso);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onUnblock(iso);
          }
        }}
        className={`${base} cursor-pointer text-left`}
      >
        <PillBody ev={ev} />
      </span>
    );
  }
  const to =
    ev.kind === "task"
      ? "/vendor/calendar?mode=tasks"
      : ev.bookingId != null
        ? `/vendor/clients/${ev.bookingId}`
        : "/vendor/clients";
  return (
    <Link to={to} title={ev.label} onClick={(e) => e.stopPropagation()} className={base}>
      <PillBody ev={ev} />
    </Link>
  );
}

// ── Year view ────────────────────────────────────────────────────────────────

function YearView({
  year,
  eventsByDate,
  weekdays,
  onPickDay,
  onPickMonth,
  todayStr,
}: {
  year: number;
  eventsByDate: Map<string, CalEvent[]>;
  weekdays: string[];
  onPickDay: (d: Date) => void;
  onPickMonth: (month: number) => void;
  todayStr: string;
}) {
  const { locale } = useT();
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", { month: "long" }).format(
      new Date(year, m, 1),
    );
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(year, m, 1);
        const offset = (first.getDay() + 6) % 7;
        const start = new Date(year, m, 1 - offset);
        const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
        return (
          <div key={m}>
            <button
              type="button"
              onClick={() => onPickMonth(m)}
              className="mb-2 font-grotesk text-base font-medium capitalize text-umber-800 hover:text-steel-700 dark:text-paper-200 dark:hover:text-steel-300"
            >
              {monthName(m)}
            </button>
            <div className="grid grid-cols-7 text-center">
              {weekdays.map((w) => (
                <div key={w} className="pb-1 text-[9px] text-umber-400 dark:text-umber-500">
                  {w}
                </div>
              ))}
              {cells.map((d) => {
                const inMonth = d.getMonth() === m;
                const key = ymd(d);
                const evs = eventsByDate.get(key);
                const isToday = key === todayStr;
                const hasBooked = evs?.some((e) => e.kind === "booked" || e.kind === "blocked");
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => onPickDay(d)}
                    className={`relative flex h-7 items-center justify-center text-[11px] ${
                      inMonth
                        ? "text-umber-700 dark:text-paper-200"
                        : "text-umber-300 dark:text-umber-600"
                    } ${isToday ? "font-semibold" : ""}`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        isToday
                          ? "bg-steel-600 text-paper-50 dark:bg-steel-400 dark:text-umber-900"
                          : "hover:bg-steel-50 dark:hover:bg-umber-800"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {evs && inMonth && !isToday && (
                      <span
                        className={`absolute bottom-0 h-1 w-1 rounded-full ${
                          hasBooked ? "bg-steel-500" : "bg-amber-500"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  cursor,
  eventsByDate,
  blockedSet,
  weekdays,
  todayStr,
  canEdit,
  busy,
  onToggleDay,
  onUnblock,
  unblockTitleFor,
  blockTitleFor,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalEvent[]>;
  blockedSet: Set<string>;
  weekdays: string[];
  todayStr: string;
  canEdit: boolean;
  busy: boolean;
  onToggleDay: (iso: string, isBlocked: boolean) => void;
  onUnblock?: (iso: string) => void;
  unblockTitleFor: (iso: string) => string;
  blockTitleFor: (iso: string) => string;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      <div className="grid grid-cols-7 border-b border-paper-200 dark:border-umber-800">
        {weekdays.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-umber-400 dark:text-umber-500"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = key === todayStr;
          const isBlocked = blockedSet.has(key);
          const evs = eventsByDate.get(key) ?? [];
          const hasBooking = evs.some((e) => e.kind === "booked");
          // The month grid doubles as the blocking editor: a click on a free
          // future day blocks it, a click on a blocked day unblocks it.
          // Booked days and the past stay inert.
          const editable = canEdit && !busy && inMonth && key >= todayStr && !hasBooking;
          return (
            <button
              type="button"
              key={key}
              disabled={!editable}
              onClick={() => onToggleDay(key, isBlocked)}
              title={editable ? (isBlocked ? unblockTitleFor(key) : blockTitleFor(key)) : undefined}
              className={`min-h-[6rem] border-b border-r border-paper-100 p-1.5 text-left transition-colors disabled:cursor-default dark:border-umber-800 ${
                isBlocked
                  ? "bg-blush-100/60 dark:bg-blush-900/20"
                  : inMonth
                    ? editable
                      ? "hover:bg-paper-50 dark:hover:bg-umber-800/60"
                      : ""
                    : "bg-paper-50/60 dark:bg-umber-950/40"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-steel-600 font-semibold text-paper-50 dark:bg-steel-400 dark:text-umber-900"
                    : inMonth
                      ? "text-umber-700 dark:text-paper-200"
                      : "text-umber-300 dark:text-umber-600"
                }`}
              >
                {d.getDate()}
              </span>
              <div className="mt-1 space-y-1">
                {evs.slice(0, 3).map((ev, i) => (
                  <EventPill
                    key={`${ev.kind}-${ev.bookingId ?? ev.date}-${i}`}
                    ev={ev}
                    onUnblock={onUnblock}
                    unblockTitle={unblockTitleFor(ev.date)}
                  />
                ))}
                {evs.length > 3 && (
                  <span className="block px-1 text-[10px] text-umber-400">+{evs.length - 3}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Time-grid view (day / 4day / week) ───────────────────────────────────────

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 - 20:00

function TimeGridView({
  days,
  eventsByDate,
  todayStr,
  allDayLabel,
  onUnblock,
  unblockTitleFor,
}: {
  days: Date[];
  eventsByDate: Map<string, CalEvent[]>;
  todayStr: string;
  allDayLabel: string;
  onUnblock?: (iso: string) => void;
  unblockTitleFor: (iso: string) => string;
}) {
  const { locale } = useT();
  const now = new Date();
  const nowTop =
    HOURS[0] !== undefined
      ? ((now.getHours() + now.getMinutes() / 60 - HOURS[0]) / HOURS.length) * 100
      : 0;
  const showNow = days.some((d) => ymd(d) === todayStr) && nowTop >= 0 && nowTop <= 100;
  const wd = (d: Date) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", { weekday: "short" }).format(d);

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      {/* Day headers */}
      <div
        className="grid border-b border-paper-200 dark:border-umber-800"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}
      >
        <div />
        {days.map((d) => {
          const isToday = ymd(d) === todayStr;
          return (
            <div key={ymd(d)} className="px-1 py-2 text-center">
              <div className="text-[10px] uppercase tracking-wide text-umber-400 dark:text-umber-500">
                {wd(d)}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isToday
                    ? "bg-steel-600 text-paper-50 dark:bg-steel-400 dark:text-umber-900"
                    : "text-umber-800 dark:text-paper-100"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day band: bookings, inquiries, blocked days and task deadlines
          are all date-only, so everything the vendor tracks lives here. */}
      <div
        className="grid border-b border-paper-200 dark:border-umber-800"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}
      >
        <div className="px-1 py-1 text-right text-[9px] uppercase tracking-wide text-umber-400">
          {allDayLabel}
        </div>
        {days.map((d) => {
          const evs = eventsByDate.get(ymd(d)) ?? [];
          return (
            <div
              key={ymd(d)}
              className="min-h-[2.5rem] space-y-1 border-l border-paper-100 p-1 dark:border-umber-800"
            >
              {evs.map((ev, i) => (
                <EventPill
                  key={`${ev.kind}-${ev.bookingId ?? ev.date}-${i}`}
                  ev={ev}
                  onUnblock={onUnblock}
                  unblockTitle={unblockTitleFor(ev.date)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Hour grid (kept for planner parity; vendor events are date-only) */}
      <div className="relative max-h-[60vh] overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}
        >
          <div className="col-span-1">
            {HOURS.map((h) => (
              <div
                key={h}
                className="h-12 pr-1 text-right text-[10px] text-umber-400 dark:text-umber-500"
              >
                {h}:00
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={ymd(d)} className="relative border-l border-paper-100 dark:border-umber-800">
              {HOURS.map((h) => (
                <div key={h} className="h-12 border-b border-paper-100 dark:border-umber-800/60" />
              ))}
              {showNow && ymd(d) === todayStr && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
                  style={{ top: `${nowTop}%` }}
                >
                  <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                  <span className="h-px flex-1 bg-red-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Schedule (agenda) view ───────────────────────────────────────────────────

function ScheduleView({
  events,
  onUnblock,
  unblockTitleFor,
}: {
  events: CalEvent[];
  onUnblock?: (iso: string) => void;
  unblockTitleFor: (iso: string) => string;
}) {
  const { t, locale } = useT();
  const todayStr = ymd(new Date());
  const upcoming = events
    .filter((e) => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length === 0) {
    return (
      <p className="text-sm text-umber-400 dark:text-umber-500">
        {t("vendor_calendar.schedule_empty")}
      </p>
    );
  }
  const fmt = (s: string) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(parseYmd(s));
  const dot = (kind: CalEvent["kind"]) =>
    kind === "booked"
      ? "bg-steel-500"
      : kind === "pending"
        ? "bg-amber-500"
        : kind === "blocked"
          ? "bg-blush-500"
          : "bg-moss-500";
  const rowClass =
    "flex w-full items-center gap-4 border-b border-paper-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-steel-50 dark:border-umber-800 dark:hover:bg-steel-900/20";
  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      {upcoming.map((ev, i) => {
        const body = (
          <>
            <span className="w-28 shrink-0 text-sm text-umber-500 dark:text-umber-400">
              {fmt(ev.date)}
            </span>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(ev.kind)}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-umber-900 dark:text-paper-50">
              {ev.label}
            </span>
          </>
        );
        const key = `${ev.date}-${ev.kind}-${ev.bookingId ?? i}`;
        if (ev.kind === "blocked" && onUnblock) {
          return (
            <button
              key={key}
              type="button"
              onClick={() => onUnblock(ev.date)}
              title={unblockTitleFor(ev.date)}
              className={rowClass}
            >
              {body}
            </button>
          );
        }
        if (ev.kind === "blocked") {
          return (
            <div key={key} className={rowClass}>
              {body}
            </div>
          );
        }
        const to =
          ev.kind === "task"
            ? "/vendor/calendar?mode=tasks"
            : ev.bookingId != null
              ? `/vendor/clients/${ev.bookingId}`
              : "/vendor/clients";
        return (
          <Link key={key} to={to} className={rowClass}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}

// ── View dropdown ────────────────────────────────────────────────────────────

const VIEW_ORDER: CalView[] = ["day", "4day", "week", "month", "year", "schedule"];
const VIEW_KEYS: Record<CalView, string> = {
  day: "vendor_calendar.view_day",
  "4day": "vendor_calendar.view_4day",
  week: "vendor_calendar.view_week",
  month: "vendor_calendar.view_month",
  year: "vendor_calendar.view_year",
  schedule: "vendor_calendar.view_schedule",
};

function ViewDropdown({ view, onChange }: { view: CalView; onChange: (v: CalView) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 px-3.5 py-1.5 text-sm text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
      >
        {t(VIEW_KEYS[view] as Parameters<typeof t>[0])}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 origin-top-right rounded-xl border border-paper-300 bg-white p-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {VIEW_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(v);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                v === view
                  ? "bg-steel-100 text-steel-800 dark:bg-steel-900/60 dark:text-steel-100"
                  : "text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
              }`}
            >
              {t(VIEW_KEYS[v] as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── tasks board ──────────────────────────────────────────────────────────────

const BOARD_LANES: VendorBoardStatus[] = ["todo", "doing", "done"];
const BOARD_LANE_KEYS: Record<VendorBoardStatus, string> = {
  todo: "vendor_calendar.board_todo",
  doing: "vendor_calendar.board_doing",
  done: "vendor_calendar.board_done",
};

function BoardCard({
  task,
  todayStr,
  onMove,
  onDelete,
}: {
  task: VendorTask;
  todayStr: string;
  onMove: (taskId: number, status: VendorBoardStatus) => void;
  onDelete: (task: VendorTask) => void;
}) {
  const { t, locale } = useT();
  const lane = BOARD_LANES.indexOf(task.board_status);
  const prev = BOARD_LANES[lane - 1];
  const next = BOARD_LANES[lane + 1];
  const done = task.board_status === "done";
  const overdue = !done && task.due_date !== null && task.due_date < todayStr;

  const fmt = (s: string) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "short",
      day: "numeric",
    }).format(parseYmd(s));

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group cursor-grab rounded-xl border border-paper-200 bg-white p-3 shadow-soft transition-shadow hover:shadow-md active:cursor-grabbing dark:border-umber-700 dark:bg-umber-800 ${
        done ? "opacity-70" : ""
      }`}
    >
      <p
        className={`min-w-0 text-sm leading-snug text-ink-800 dark:text-paper-100 ${
          done ? "line-through decoration-umber-300" : ""
        }`}
      >
        {task.title}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        {task.due_date ? (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              overdue
                ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300"
                : "bg-paper-200 text-umber-600 dark:bg-umber-700 dark:text-umber-200"
            }`}
          >
            {fmt(task.due_date)}
          </span>
        ) : (
          <span aria-hidden="true" />
        )}

        {/* Touch / keyboard fallback for drag & drop + delete. */}
        <span className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && onMove(task.id, prev)}
            aria-label={t("vendor_calendar.board_move_prev")}
            title={t("vendor_calendar.board_move_prev")}
            className="rounded p-0.5 text-umber-400 transition-colors hover:bg-paper-100 hover:text-ink-700 disabled:invisible dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && onMove(task.id, next)}
            aria-label={t("vendor_calendar.board_move_next")}
            title={t("vendor_calendar.board_move_next")}
            className="rounded p-0.5 text-umber-400 transition-colors hover:bg-paper-100 hover:text-ink-700 disabled:invisible dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task)}
            aria-label={t("vendor_calendar.task_delete")}
            title={t("vendor_calendar.task_delete")}
            className="rounded p-0.5 text-umber-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}

function TasksBoard({
  tasks,
  onMove,
  onDelete,
  onCreate,
  createBusy,
}: {
  tasks: VendorTask[];
  onMove: (taskId: number, status: VendorBoardStatus) => void;
  onDelete: (task: VendorTask) => void;
  onCreate: (title: string, dueDate: string | null) => Promise<boolean>;
  createBusy: boolean;
}) {
  const { t } = useT();
  const [dragOverLane, setDragOverLane] = useState<VendorBoardStatus | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const todayStr = ymd(new Date());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (title.length === 0) return;
    const ok = await onCreate(title, newDue.trim() === "" ? null : newDue);
    if (ok) {
      setNewTitle("");
      setNewDue("");
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 basis-52">
          <span className="field-label">{t("vendor_calendar.task_add_label")}</span>
          <input
            type="text"
            className="input w-full"
            value={newTitle}
            maxLength={200}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("vendor_calendar.task_add_placeholder")}
            disabled={createBusy}
          />
        </label>
        <label className="block">
          <span className="field-label">{t("vendor_calendar.task_due_label")}</span>
          <input
            type="date"
            className="input"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            disabled={createBusy}
          />
        </label>
        <button
          type="submit"
          className="btn bg-steel-600 text-white hover:bg-steel-700"
          disabled={createBusy || newTitle.trim().length === 0}
        >
          {t("vendor_calendar.task_add")}
        </button>
      </form>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-paper-200 bg-white p-10 text-center dark:border-umber-800 dark:bg-umber-900">
          <ListChecks
            size={40}
            strokeWidth={1.3}
            className="mx-auto text-umber-300 dark:text-umber-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-umber-500 dark:text-umber-400">
            {t("vendor_calendar.tasks_empty")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
          {BOARD_LANES.map((lane) => {
            const laneTasks = tasks.filter((tk) => tk.board_status === lane);
            return (
              <div
                key={lane}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverLane(lane);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverLane(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverLane(null);
                  const id = Number(e.dataTransfer.getData("text/plain"));
                  if (Number.isFinite(id) && id > 0) onMove(id, lane);
                }}
                className={`rounded-2xl border p-3 transition-colors ${
                  dragOverLane === lane
                    ? "border-steel-400 bg-steel-50 dark:border-steel-600 dark:bg-steel-900/20"
                    : "border-paper-200 bg-paper-50/60 dark:border-umber-800 dark:bg-umber-950/40"
                }`}
              >
                <p className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-umber-500 dark:text-umber-400">
                  {t(BOARD_LANE_KEYS[lane] as Parameters<typeof t>[0])}
                  <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-umber-600 dark:bg-umber-700 dark:text-umber-200">
                    {laneTasks.length}
                  </span>
                </p>
                <div className="min-h-[6rem] space-y-2">
                  {laneTasks.map((tk) => (
                    <BoardCard
                      key={tk.id}
                      task={tk}
                      todayStr={todayStr}
                      onMove={onMove}
                      onDelete={onDelete}
                    />
                  ))}
                  {laneTasks.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs italic text-umber-400 dark:text-umber-500">
                      {t("vendor_calendar.board_empty")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function VendorCalendarPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  useDocumentTitle(t("vendor_calendar.page_title"));

  const [mode, setMode] = useState<Mode>("calendar");
  const [view, setView] = useState<CalView>("month");
  const [searchParams] = useSearchParams();
  const [cursor, setCursor] = useState(() => new Date());
  const todayStr = ymd(new Date());

  const [availability, setAvailability] = useState<VendorAvailabilityView | null>(null);
  const [availabilityMissing, setAvailabilityMissing] = useState(false);
  const [clients, setClients] = useState<VendorClientView[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [availBusy, setAvailBusy] = useState(false);
  const [newDate, setNewDate] = useState("");

  const [tasks, setTasks] = useState<VendorTask[]>([]);
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as Mode | null;
      if (m === "tasks" || m === "calendar") setMode(m);
      const v = localStorage.getItem(VIEW_KEY) as CalView | null;
      if (v && VIEW_ORDER.includes(v)) setView(v);
    } catch {
      /* localStorage unavailable */
    }
    // A ?mode=tasks deep link (e.g. from the nav or dashboard) wins.
    const qmode = searchParams.get("mode");
    if (qmode === "tasks" || qmode === "calendar") setMode(qmode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a deep-linked mode switch working while the page stays mounted
  // (a task-pill click re-renders without remounting).
  useEffect(() => {
    const qmode = searchParams.get("mode");
    if (qmode === "tasks" || qmode === "calendar") setMode(qmode);
  }, [searchParams]);

  function changeMode(m: Mode) {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* best-effort */
    }
  }
  function changeView(v: CalView) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* best-effort */
    }
  }

  useEffect(() => {
    vendorAvailabilityApi
      .me()
      .then((v) => setAvailability(v))
      .catch(() => setAvailabilityMissing(true));
    vendorClientsApi
      .list()
      .then((r) => setClients(r.clients))
      .catch(() => {});
    vendorBillingApi
      .get()
      .then((r) => setCanEdit(r.features.calendar_availability))
      .catch(() => {
        /* keep the optimistic default; a FREE vendor's write would 402 anyway */
      });
    vendorTaskApi
      .list()
      .then((r) => setTasks(r.tasks))
      .catch(() => {});
  }, []);

  const blockedSet = useMemo(() => new Set(availability?.blocked_dates ?? []), [availability]);

  // Everything the vendor tracks, as date-keyed pills: confirmed bookings,
  // pending inquiries, blocked days, open task deadlines.
  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const c of clients) {
      if (c.status === "confirmed") {
        out.push({
          kind: "booked",
          date: c.event_date,
          label: c.couple_display_name,
          bookingId: c.id,
        });
      } else if (c.status === "requested" || c.status === "vendor_seen") {
        out.push({
          kind: "pending",
          date: c.event_date,
          label: c.couple_display_name,
          bookingId: c.id,
        });
      }
    }
    for (const d of blockedSet) {
      out.push({ kind: "blocked", date: d, label: t("vendor_calendar.blocked_pill_label") });
    }
    for (const tk of tasks) {
      if (tk.due_date && tk.board_status !== "done") {
        out.push({ kind: "task", date: tk.due_date, label: tk.title });
      }
    }
    return out;
  }, [clients, blockedSet, tasks, t]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [events]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i))); // Mon-first
  }, [locale]);

  // Days shown by the time-grid views.
  const gridDays = useMemo(() => {
    if (view === "day") return [cursor];
    if (view === "4day") return Array.from({ length: 4 }, (_, i) => addDays(cursor, i));
    if (view === "week") {
      const start = startOfWeekMonday(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return [];
  }, [view, cursor]);

  function shift(dir: number) {
    if (view === "day") setCursor((c) => addDays(c, dir));
    else if (view === "4day") setCursor((c) => addDays(c, dir * 4));
    else if (view === "week") setCursor((c) => addDays(c, dir * 7));
    else if (view === "month" || view === "schedule")
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
    else if (view === "year") setCursor((c) => new Date(c.getFullYear() + dir, c.getMonth(), 1));
  }

  const intl = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", opts);
  const title = useMemo(() => {
    if (mode === "tasks") return t("vendor_calendar.mode_tasks");
    if (view === "year") return String(cursor.getFullYear());
    if (view === "month") return intl({ year: "numeric", month: "long" }).format(cursor);
    if (view === "day")
      return intl({ year: "numeric", month: "long", day: "numeric" }).format(cursor);
    if (view === "schedule") return intl({ year: "numeric", month: "long" }).format(cursor);
    // week / 4day: a range
    const last = gridDays[gridDays.length - 1] ?? cursor;
    const first = gridDays[0] ?? cursor;
    const sameMonth = first.getMonth() === last.getMonth();
    return sameMonth
      ? intl({ year: "numeric", month: "long" }).format(first)
      : `${intl({ month: "short" }).format(first)} - ${intl({ year: "numeric", month: "short" }).format(last)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, view, cursor, gridDays, locale, t]);

  async function blockDay(iso: string) {
    setAvailBusy(true);
    try {
      setAvailability(await vendorAvailabilityApi.block(iso));
      toast.success(t("vendor_calendar.availability_blocked"));
    } catch {
      toast.error(t("vendor_calendar.availability_block_failed"));
    } finally {
      setAvailBusy(false);
    }
  }

  async function unblockDay(iso: string) {
    setAvailBusy(true);
    try {
      setAvailability(await vendorAvailabilityApi.unblock(iso));
      toast.success(t("vendor_calendar.availability_unblocked"));
    } catch {
      toast.error(t("vendor_calendar.availability_unblock_failed"));
    } finally {
      setAvailBusy(false);
    }
  }

  function onToggleDay(iso: string, isBlocked: boolean) {
    if (isBlocked) void unblockDay(iso);
    else void blockDay(iso);
  }

  function onAddBlock(e: FormEvent) {
    e.preventDefault();
    if (newDate.trim().length === 0) return;
    void blockDay(newDate.trim()).then(() => setNewDate(""));
  }

  const unblockTitleFor = useCallback(
    (iso: string) => t("vendor_calendar.availability_remove", { date: formatDay(iso, locale) }),
    [t, locale],
  );
  const blockTitleFor = useCallback(
    (iso: string) => t("vendor_calendar.block_day_title", { date: formatDay(iso, locale) }),
    [t, locale],
  );
  // Blocked pills / rows unblock on click only when the vendor may edit.
  const unblockHandler = canEdit && !availabilityMissing && !availBusy ? unblockDay : undefined;

  /** Optimistic kanban move: flip the lane locally, then persist; roll back
   *  with a toast if the API rejects it. */
  const moveTask = useCallback(
    (taskId: number, status: VendorBoardStatus) => {
      let prevTasks: VendorTask[] = [];
      setTasks((ts) => {
        prevTasks = ts;
        return ts.map((tk) => (tk.id === taskId ? { ...tk, board_status: status } : tk));
      });
      vendorTaskApi.move(taskId, status).catch(() => {
        setTasks(prevTasks);
        toast.error(t("vendor_calendar.task_move_error"));
      });
    },
    [toast, t],
  );

  async function createTask(title: string, dueDate: string | null): Promise<boolean> {
    setCreateBusy(true);
    try {
      await vendorTaskApi.create({ title, due_date: dueDate });
      // Re-fetch so the new card lands in server order (deadline-sorted).
      const r = await vendorTaskApi.list();
      setTasks(r.tasks);
      return true;
    } catch {
      toast.error(t("vendor_calendar.task_add_failed"));
      return false;
    } finally {
      setCreateBusy(false);
    }
  }

  async function deleteTask(task: VendorTask) {
    const ok = await confirm({
      title: t("vendor_calendar.task_delete_title"),
      body: t("vendor_calendar.task_delete_body", { title: task.title }),
      confirmLabel: t("vendor_calendar.task_delete_confirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await vendorTaskApi.remove(task.id);
      setTasks((ts) => ts.filter((tk) => tk.id !== task.id));
      toast.success(t("vendor_calendar.task_deleted"));
    } catch {
      toast.error(t("vendor_calendar.task_delete_failed"));
    }
  }

  return (
    <div className="py-2">
      {/* Toolbar: Today, prev/next, dynamic title, view dropdown, mode toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="rounded-full border border-paper-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
        >
          {t("vendor_calendar.today")}
        </button>
        {mode === "calendar" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label={t("vendor_calendar.nav_prev")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-umber-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label={t("vendor_calendar.nav_next")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-umber-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <h1 className="font-grotesk text-xl font-semibold capitalize tracking-tight text-umber-900 dark:text-paper-50">
          {title}
        </h1>

        <div className="ml-auto flex items-center gap-2.5">
          {mode === "calendar" && <ViewDropdown view={view} onChange={changeView} />}

          <div className="inline-flex rounded-full border border-paper-300 p-0.5 dark:border-umber-700">
            <button
              type="button"
              onClick={() => changeMode("calendar")}
              aria-label={t("vendor_calendar.mode_calendar")}
              title={t("vendor_calendar.mode_calendar")}
              aria-pressed={mode === "calendar"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                mode === "calendar"
                  ? "bg-steel-600 text-white"
                  : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
              }`}
            >
              <CalendarDays size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{t("vendor_calendar.mode_calendar")}</span>
            </button>
            <button
              type="button"
              onClick={() => changeMode("tasks")}
              aria-label={t("vendor_calendar.mode_tasks")}
              title={t("vendor_calendar.mode_tasks")}
              aria-pressed={mode === "tasks"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                mode === "tasks"
                  ? "bg-steel-600 text-white"
                  : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
              }`}
            >
              <SquareKanban size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{t("vendor_calendar.mode_tasks")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {mode === "tasks" ? (
        <TasksBoard
          tasks={tasks}
          onMove={moveTask}
          onDelete={(task) => void deleteTask(task)}
          onCreate={createTask}
          createBusy={createBusy}
        />
      ) : (
        <>
          {availabilityMissing && (
            <div className="card mb-4 p-4">
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_calendar.availability_no_listing")}
              </p>
            </div>
          )}

          {view === "year" ? (
            <YearView
              year={cursor.getFullYear()}
              eventsByDate={eventsByDate}
              weekdays={weekdays}
              todayStr={todayStr}
              onPickDay={(d) => {
                setCursor(d);
                changeView("day");
              }}
              onPickMonth={(m) => {
                setCursor(new Date(cursor.getFullYear(), m, 1));
                changeView("month");
              }}
            />
          ) : view === "month" ? (
            <MonthView
              cursor={cursor}
              eventsByDate={eventsByDate}
              blockedSet={blockedSet}
              weekdays={weekdays}
              todayStr={todayStr}
              canEdit={canEdit && !availabilityMissing}
              busy={availBusy}
              onToggleDay={onToggleDay}
              onUnblock={unblockHandler}
              unblockTitleFor={unblockTitleFor}
              blockTitleFor={blockTitleFor}
            />
          ) : view === "schedule" ? (
            <ScheduleView
              events={events}
              onUnblock={unblockHandler}
              unblockTitleFor={unblockTitleFor}
            />
          ) : (
            <TimeGridView
              days={gridDays}
              eventsByDate={eventsByDate}
              todayStr={todayStr}
              allDayLabel={t("vendor_calendar.all_day")}
              onUnblock={unblockHandler}
              unblockTitleFor={unblockTitleFor}
            />
          )}

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-umber-500 dark:text-umber-400">
            <span className="flex items-center gap-1.5">
              <Heart size={12} className="text-steel-600 dark:text-steel-300" aria-hidden="true" />
              {t("vendor_calendar.legend_booked")}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={12} className="text-amber-500" aria-hidden="true" />
              {t("vendor_calendar.legend_pending")}
            </span>
            <span className="flex items-center gap-1.5">
              <Lock size={12} className="text-blush-500" aria-hidden="true" />
              {t("vendor_calendar.legend_blocked")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-moss-500" aria-hidden="true" />
              {t("vendor_calendar.legend_tasks")}
            </span>
          </div>

          {/* Freemium: blocking is PRO. A FREE vendor sees the locked state
              with the upgrade path instead of a form whose writes would 402. */}
          {!availabilityMissing && !canEdit && (
            <section className="card mt-4 flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2.5">
                <Lock
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-500"
                />
                <p className="text-sm text-ink-600 dark:text-umber-200">
                  {t("vendor_calendar.availability_locked")}
                </p>
              </div>
              <Link
                to="/vendor/settings/billing"
                className="btn w-fit bg-steel-600 text-white hover:bg-steel-700"
              >
                {t("vendor.upgrade.cta")}
              </Link>
            </section>
          )}

          {!availabilityMissing && canEdit && availability && (
            <section className="card mt-4 space-y-2.5 p-4">
              <h2 className="font-semibold">{t("vendor_calendar.section_availability")}</h2>
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_calendar.availability_intro")}
              </p>

              <form onSubmit={onAddBlock} className="flex flex-wrap items-end gap-2">
                <label className="block" htmlFor="vendor-cal-block-date">
                  <span className="field-label">{t("vendor_calendar.availability_add_label")}</span>
                  <input
                    id="vendor-cal-block-date"
                    type="date"
                    className="input"
                    value={newDate}
                    min={todayStr}
                    onChange={(e) => setNewDate(e.target.value)}
                    disabled={availBusy}
                  />
                </label>
                <button
                  type="submit"
                  className="btn bg-steel-600 text-white hover:bg-steel-700"
                  disabled={availBusy || newDate.trim().length === 0}
                >
                  {t("vendor_calendar.availability_add")}
                </button>
              </form>

              {availability.blocked_dates.length === 0 ? (
                <p className="text-sm text-ink-500 dark:text-umber-300">
                  {t("vendor_calendar.availability_empty")}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {availability.blocked_dates.map((d) => (
                    <li
                      key={d}
                      className="inline-flex items-center gap-2 rounded-full bg-paper-100 py-1 pl-3 pr-1 text-sm text-ink-800 ring-1 ring-paper-300 dark:bg-umber-800 dark:text-umber-100 dark:ring-umber-700"
                    >
                      <span>{formatDay(d, locale)}</span>
                      <button
                        type="button"
                        onClick={() => void unblockDay(d)}
                        disabled={availBusy}
                        aria-label={unblockTitleFor(d)}
                        title={unblockTitleFor(d)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-300 hover:text-ink-800 disabled:opacity-50 dark:text-umber-300 dark:hover:bg-umber-700"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-ink-500 dark:text-umber-300">
                {availability.next_available
                  ? t("vendor_calendar.availability_next_free", {
                      date: formatDay(availability.next_available, locale),
                    })
                  : t("vendor_calendar.availability_none_free")}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
