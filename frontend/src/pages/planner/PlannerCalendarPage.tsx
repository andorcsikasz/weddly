// Planner calendar - a Google-Calendar-style multi-view of the whole book of
// business. The planner's "events" are: client weddings + task deadlines
// (derived from listClients + listTasks) PLUS standalone/scheduled events the
// planner adds here (plannerApi.listEvents/createEvent/deleteEvent). Each
// client is colour-coded via clientColor() so multiple clients are tellable
// apart at a glance. Views: Day / 4 days / Week / Month / Year / Schedule,
// plus a Calendar↔Tasks toggle.

import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PlannerClientView, PlannerEvent, PlannerTaskRow } from "@shared/types";
import { Button, Dialog, TextField, useConfirm, useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { clientColor, titleCaseName } from "../../lib/planner_display";
import { useDocumentMeta } from "../../lib/seo";

type CalView = "day" | "4day" | "week" | "month" | "year" | "schedule";
type Mode = "calendar" | "tasks";
type TaskPeriod = "week" | "next30" | "all";

const VIEW_KEY = "weddly.planner_cal_view";
const MODE_KEY = "weddly.planner_cal_mode";

interface CalEvent {
  kind: "wedding" | "task" | "event";
  date: string; // YYYY-MM-DD
  /** Owning client, or null for a standalone planner event. */
  coupleId: number | null;
  label: string;
  sublabel?: string;
  /** Set for kind === "event" - enables the edit/delete panel. */
  eventId?: number;
}

// ─── date helpers (local-time safe) ───────────────────────────────────────────

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

// ─── small shared bits ────────────────────────────────────────────────────────

/** Colour classes for a pill, by owning client (or neutral moss for a
 *  standalone event with no client). */
function pillColor(coupleId: number | null): string {
  if (coupleId == null)
    return "bg-moss-100 text-moss-900 hover:brightness-95 dark:bg-moss-900/40 dark:text-moss-100";
  const cc = clientColor(coupleId);
  return `${cc.soft} ${cc.text} hover:brightness-95`;
}

function PillBody({ ev }: { ev: CalEvent }) {
  return (
    <>
      {ev.kind === "wedding" ? (
        <Heart size={10} className="shrink-0" aria-hidden="true" />
      ) : ev.kind === "event" ? (
        <CalendarDays size={10} className="shrink-0" aria-hidden="true" />
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

function EventPill({
  ev,
  onEventClick,
}: {
  ev: CalEvent;
  onEventClick?: (id: number) => void;
}) {
  const base = `flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] transition-colors ${pillColor(
    ev.coupleId,
  )}`;
  // Standalone / scheduled events open an in-page edit panel. We use a
  // role="button" span (not a <button>) because month-grid cells are
  // themselves <button>s and nesting buttons is invalid markup.
  if (ev.kind === "event" && ev.eventId != null && onEventClick) {
    const id = ev.eventId;
    return (
      <span
        role="button"
        tabIndex={0}
        title={ev.label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onEventClick(id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onEventClick(id);
          }
        }}
        className={`${base} cursor-pointer text-left`}
      >
        <PillBody ev={ev} />
      </span>
    );
  }
  return (
    <Link to={`/app/planner/clients/${ev.coupleId}`} title={ev.label} className={base}>
      <PillBody ev={ev} />
    </Link>
  );
}

// ─── Year view ────────────────────────────────────────────────────────────────

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
              className="mb-2 font-grotesk text-base font-medium capitalize text-umber-800 hover:text-moss-700 dark:text-paper-200 dark:hover:text-moss-300"
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
                const hasMoss = evs?.some((e) => e.kind === "wedding" || e.kind === "event");
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
                          ? "bg-moss-600 text-paper-50 dark:bg-moss-400 dark:text-umber-900"
                          : "hover:bg-moss-50 dark:hover:bg-umber-800"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {evs && inMonth && !isToday && (
                      <span
                        className={`absolute bottom-0 h-1 w-1 rounded-full ${
                          hasMoss ? "bg-moss-500" : "bg-amber-500"
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

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  cursor,
  eventsByDate,
  weekdays,
  todayStr,
  onPickDay,
  onEventClick,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalEvent[]>;
  weekdays: string[];
  todayStr: string;
  onPickDay: (d: Date) => void;
  onEventClick: (id: number) => void;
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
          const evs = eventsByDate.get(key) ?? [];
          return (
            <button
              type="button"
              key={key}
              onClick={() => onPickDay(d)}
              className={`min-h-[6rem] border-b border-r border-paper-100 p-1.5 text-left dark:border-umber-800 ${
                inMonth ? "" : "bg-paper-50/60 dark:bg-umber-950/40"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-moss-600 font-semibold text-paper-50 dark:bg-moss-400 dark:text-umber-900"
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
                    key={`${ev.kind}-${ev.coupleId}-${ev.eventId ?? i}`}
                    ev={ev}
                    onEventClick={onEventClick}
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

// ─── Time-grid view (day / 4day / week) ───────────────────────────────────────

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 – 20:00

function TimeGridView({
  days,
  eventsByDate,
  todayStr,
  allDayLabel,
  onEventClick,
}: {
  days: Date[];
  eventsByDate: Map<string, CalEvent[]>;
  todayStr: string;
  allDayLabel: string;
  onEventClick: (id: number) => void;
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
                    ? "bg-moss-600 text-paper-50 dark:bg-moss-400 dark:text-umber-900"
                    : "text-umber-800 dark:text-paper-100"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day band - weddings + task deadlines + standalone events (date-only) */}
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
                  key={`${ev.kind}-${ev.coupleId}-${ev.eventId ?? i}`}
                  ev={ev}
                  onEventClick={onEventClick}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Hour grid */}
      <div className="relative max-h-[60vh] overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}
        >
          {/* Hour labels + row lines */}
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

// ─── Schedule (agenda) view ───────────────────────────────────────────────────

function ScheduleView({
  events,
  onEventClick,
}: {
  events: CalEvent[];
  onEventClick: (id: number) => void;
}) {
  const { t, locale } = useT();
  const todayStr = ymd(new Date());
  const upcoming = events
    .filter((e) => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length === 0) {
    return (
      <p className="text-sm text-umber-400 dark:text-umber-500">
        {t("planner_calendar.schedule_empty")}
      </p>
    );
  }
  const fmt = (s: string) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(parseYmd(s));
  const dot = (ev: CalEvent) =>
    ev.coupleId != null ? clientColor(ev.coupleId).dot : "bg-moss-500";
  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      {upcoming.map((ev, i) => {
        const rowClass =
          "flex w-full items-center gap-4 border-b border-paper-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-moss-50 dark:border-umber-800 dark:hover:bg-moss-900/20";
        const body = (
          <>
            <span className="w-28 shrink-0 text-sm text-umber-500 dark:text-umber-400">
              {fmt(ev.date)}
            </span>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(ev)}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-umber-900 dark:text-paper-50">
              {ev.label}
            </span>
            {ev.sublabel && (
              <span className="shrink-0 truncate text-xs text-umber-400 dark:text-umber-500">
                {ev.sublabel}
              </span>
            )}
          </>
        );
        if (ev.kind === "event" && ev.eventId != null) {
          const id = ev.eventId;
          return (
            <button
              key={`${ev.date}-event-${id}`}
              type="button"
              onClick={() => onEventClick(id)}
              className={rowClass}
            >
              {body}
            </button>
          );
        }
        return (
          <Link
            key={`${ev.date}-${ev.kind}-${ev.coupleId}-${i}`}
            to={`/app/planner/clients/${ev.coupleId}`}
            className={rowClass}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Tasks view (the check-icon toggle) ───────────────────────────────────────

const TASK_PERIODS: TaskPeriod[] = ["week", "next30", "all"];
const TASK_PERIOD_KEYS: Record<TaskPeriod, string> = {
  week: "planner_calendar.tasks_period_week",
  next30: "planner_calendar.tasks_period_30",
  all: "planner_calendar.tasks_period_all",
};

function TasksView({ tasks }: { tasks: PlannerTaskRow[] }) {
  const { t, locale } = useT();
  const [period, setPeriod] = useState<TaskPeriod>("all");
  const today = new Date();
  const todayStr = ymd(today);

  const visible = useMemo(() => {
    let lo = "";
    let hi = "￿";
    if (period === "week") {
      const start = startOfWeekMonday(today);
      lo = ymd(start);
      hi = ymd(addDays(start, 6));
    } else if (period === "next30") {
      lo = todayStr;
      hi = ymd(addDays(today, 30));
    }
    return [...tasks]
      .filter((tk) => tk.due_date >= lo && tk.due_date <= hi)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, period]);

  const fmt = (s: string) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
      month: "short",
      day: "numeric",
    }).format(parseYmd(s));

  return (
    <div>
      {/* Period selector + explicit count header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-full border border-paper-300 p-0.5 dark:border-umber-700"
          role="group"
          aria-label={t("planner_calendar.tasks_period_label")}
        >
          {TASK_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-moss-100 text-moss-800 dark:bg-moss-900/40 dark:text-moss-100"
                  : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
              }`}
            >
              {t(TASK_PERIOD_KEYS[p] as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        <span className="text-xs text-umber-500 dark:text-umber-400">
          {t("planner_calendar.tasks_count", { count: visible.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-paper-200 bg-white p-10 text-center dark:border-umber-800 dark:bg-umber-900">
          <ListChecks
            size={40}
            strokeWidth={1.3}
            className="mx-auto text-umber-300 dark:text-umber-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-umber-500 dark:text-umber-400">
            {t(
              period === "all"
                ? "planner_calendar.tasks_empty"
                : "planner_calendar.tasks_period_empty",
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
          {visible.map((tk) => {
            const overdue = tk.due_date < todayStr;
            return (
              <Link
                key={tk.task_id}
                to={`/app/planner/clients/${tk.couple_id}`}
                className="flex items-center gap-3 border-b border-paper-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-moss-50 dark:border-umber-800 dark:hover:bg-moss-900/20"
              >
                <span
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                    tk.priority >= 2 ? "border-red-400" : "border-moss-400"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-800 dark:text-paper-100">
                  {tk.title}
                </span>
                <span className="shrink-0 truncate text-xs text-umber-400 dark:text-umber-500">
                  {titleCaseName(tk.display_name)}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    overdue
                      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300"
                      : "bg-paper-200 text-umber-600 dark:bg-umber-700 dark:text-umber-200"
                  }`}
                >
                  {fmt(tk.due_date)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── View dropdown ────────────────────────────────────────────────────────────

const VIEW_ORDER: CalView[] = ["day", "4day", "week", "month", "year", "schedule"];
const VIEW_KEYS: Record<CalView, string> = {
  day: "planner_calendar.view_day",
  "4day": "planner_calendar.view_4day",
  week: "planner_calendar.view_week",
  month: "planner_calendar.view_month",
  year: "planner_calendar.view_year",
  schedule: "planner_calendar.view_schedule",
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
                  ? "bg-moss-100 text-moss-900 dark:bg-moss-900/40 dark:text-moss-100"
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

// ─── Add / edit event modal ───────────────────────────────────────────────────

function EventModal({
  open,
  editing,
  initialDate,
  clients,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: PlannerEvent | null;
  initialDate: string;
  clients: PlannerClientView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("");
  const [coupleId, setCoupleId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [showErr, setShowErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDate(editing.event_date);
      setTime(editing.start_time ?? "");
      setCoupleId(editing.couple_id != null ? String(editing.couple_id) : "");
      setNotes(editing.notes ?? "");
    } else {
      setTitle("");
      setDate(initialDate);
      setTime("");
      setCoupleId("");
      setNotes("");
    }
    setShowErr(false);
  }, [open, editing, initialDate]);

  const valid = title.trim().length > 0 && date.length > 0;

  async function save() {
    if (!valid) {
      setShowErr(true);
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        event_date: date,
        start_time: time ? time : null,
        couple_id: coupleId ? Number(coupleId) : null,
        notes: notes.trim() ? notes.trim() : null,
      };
      if (editing) await plannerApi.updateEvent(editing.id, body);
      else await plannerApi.createEvent(body);
      toast.success(t("planner_calendar.event_saved"));
      onSaved();
    } catch {
      toast.error(t("planner_calendar.event_error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    const ok = await confirm({
      title: t("planner_calendar.event_delete_confirm_title"),
      body: t("planner_calendar.event_delete_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await plannerApi.deleteEvent(editing.id);
      toast.success(t("planner_calendar.event_deleted"));
      onSaved();
    } catch {
      toast.error(t("planner_calendar.event_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      role="dialog"
      closeOnBackdrop
      title={t(
        editing ? "planner_calendar.event_edit_title" : "planner_calendar.event_new_title",
      )}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          {editing && (
            <Button
              variant="ghost"
              onClick={remove}
              disabled={busy}
              className="mr-auto text-blush-700 dark:text-blush-300"
            >
              <Trash2 size={15} aria-hidden="true" />
              {t("planner_calendar.event_delete")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <TextField
          id="ev-title"
          label={t("planner_calendar.field_title")}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          errorText={showErr && !title.trim() ? t("planner_calendar.field_required") : undefined}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            id="ev-date"
            type="date"
            label={t("planner_calendar.field_date")}
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            id="ev-time"
            type="time"
            label={t("planner_calendar.field_time")}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="block">
          <label htmlFor="ev-client" className="field-label">
            {t("planner_calendar.field_client")}
          </label>
          <select
            id="ev-client"
            className="input"
            value={coupleId}
            onChange={(e) => setCoupleId(e.target.value)}
          >
            <option value="">{t("planner_calendar.field_client_none")}</option>
            {clients.map((c) => (
              <option key={c.couple_id} value={c.couple_id}>
                {titleCaseName(c.display_name)}
              </option>
            ))}
          </select>
        </div>
        <div className="block">
          <label htmlFor="ev-notes" className="field-label">
            {t("planner_calendar.field_notes")}
          </label>
          <textarea
            id="ev-notes"
            className="input min-h-[4rem]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlannerCalendarPage() {
  const { t, locale } = useT();
  useDocumentMeta("planner_calendar.meta_title", "planner_calendar.meta_description");

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [tasks, setTasks] = useState<PlannerTaskRow[]>([]);
  const [plannerEvents, setPlannerEvents] = useState<PlannerEvent[]>([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<CalView>("month");
  const [mode, setMode] = useState<Mode>("calendar");
  const [searchParams] = useSearchParams();

  // Add / edit event modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [modalDate, setModalDate] = useState(() => ymd(new Date()));

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as CalView | null;
      if (v && VIEW_ORDER.includes(v)) setView(v);
      const m = localStorage.getItem(MODE_KEY) as Mode | null;
      if (m === "tasks" || m === "calendar") setMode(m);
    } catch {
      /* localStorage unavailable */
    }
    // A `?mode=tasks` deep link (e.g. from the dashboard's overdue card) wins.
    const qmode = searchParams.get("mode");
    if (qmode === "tasks" || qmode === "calendar") setMode(qmode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function changeView(v: CalView) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* best-effort */
    }
  }
  function changeMode(m: Mode) {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* best-effort */
    }
  }

  useEffect(() => {
    Promise.all([plannerApi.listClients(), plannerApi.listTasks()])
      .then(([cr, tr]) => {
        setClients(cr.clients);
        setTasks(tr.tasks);
      })
      .catch(() => {});
  }, []);

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

  // The visible date window - drives the events fetch so we only pull what's
  // on screen (schedule widens forward since it lists all upcoming).
  const range = useMemo(() => {
    if (view === "year") {
      const y = cursor.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (view === "month" || view === "schedule") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7;
      const start = addDays(first, -offset);
      const end = view === "schedule" ? addDays(start, 365) : addDays(start, 41);
      return { from: ymd(start), to: ymd(end) };
    }
    const first = gridDays[0] ?? cursor;
    const last = gridDays[gridDays.length - 1] ?? cursor;
    return { from: ymd(first), to: ymd(last) };
  }, [view, cursor, gridDays]);

  const reloadEvents = useCallback(() => {
    plannerApi
      .listEvents(range.from, range.to)
      .then((r) => setPlannerEvents(r.events))
      .catch(() => {});
  }, [range.from, range.to]);

  useEffect(() => {
    reloadEvents();
  }, [reloadEvents]);

  const clientNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) map.set(c.couple_id, titleCaseName(c.display_name));
    return map;
  }, [clients]);

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const c of clients) {
      if (c.wedding_date)
        out.push({
          kind: "wedding",
          date: c.wedding_date,
          coupleId: c.couple_id,
          label: titleCaseName(c.display_name),
        });
    }
    for (const tk of tasks) {
      if (tk.due_date)
        out.push({
          kind: "task",
          date: tk.due_date,
          coupleId: tk.couple_id,
          label: tk.title,
          sublabel: titleCaseName(tk.display_name),
        });
    }
    for (const ev of plannerEvents) {
      out.push({
        kind: "event",
        date: ev.event_date,
        coupleId: ev.couple_id,
        label: ev.start_time ? `${ev.start_time} ${ev.title}` : ev.title,
        sublabel:
          ev.couple_id != null ? (clientNameById.get(ev.couple_id) ?? undefined) : undefined,
        eventId: ev.id,
      });
    }
    return out;
  }, [clients, tasks, plannerEvents, clientNameById]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [events]);

  // Clients that actually appear on the calendar - drives the colour legend.
  const legendClients = useMemo(() => {
    const ids = new Set<number>();
    for (const ev of events) if (ev.coupleId != null) ids.add(ev.coupleId);
    return clients
      .filter((c) => ids.has(c.couple_id))
      .sort((a, b) => titleCaseName(a.display_name).localeCompare(titleCaseName(b.display_name)));
  }, [events, clients]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i))); // Mon-first
  }, [locale]);

  const todayStr = ymd(new Date());

  function shift(dir: number) {
    if (view === "day") setCursor((c) => addDays(c, dir));
    else if (view === "4day") setCursor((c) => addDays(c, dir * 4));
    else if (view === "week") setCursor((c) => addDays(c, dir * 7));
    else if (view === "month" || view === "schedule")
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
    else if (view === "year") setCursor((c) => new Date(c.getFullYear() + dir, c.getMonth(), 1));
  }

  function openAddEvent() {
    setEditingEvent(null);
    // Prefill from the focused day in day view, else today.
    setModalDate(view === "day" ? ymd(cursor) : todayStr);
    setModalOpen(true);
  }
  function openEditEvent(id: number) {
    const ev = plannerEvents.find((e) => e.id === id);
    if (!ev) return;
    setEditingEvent(ev);
    setModalDate(ev.event_date);
    setModalOpen(true);
  }

  const intl = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", opts);
  const title = useMemo(() => {
    if (mode === "tasks") return t("planner_calendar.tasks_title");
    if (view === "year") return String(cursor.getFullYear());
    if (view === "month") return intl({ year: "numeric", month: "long" }).format(cursor);
    if (view === "day")
      return intl({ year: "numeric", month: "long", day: "numeric" }).format(cursor);
    if (view === "schedule") return intl({ year: "numeric", month: "long" }).format(cursor);
    // week / 4day → range
    const last = gridDays[gridDays.length - 1] ?? cursor;
    const first = gridDays[0] ?? cursor;
    const sameMonth = first.getMonth() === last.getMonth();
    return sameMonth
      ? intl({ year: "numeric", month: "long" }).format(first)
      : `${intl({ month: "short" }).format(first)} – ${intl({ year: "numeric", month: "short" }).format(last)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, view, cursor, gridDays, locale, t]);

  return (
    <div className="py-2">
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="rounded-full border border-paper-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
        >
          {t("planner_calendar.today")}
        </button>
        {mode === "calendar" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label={t("planner_calendar.nav_prev")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-umber-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label={t("planner_calendar.nav_next")}
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
          {mode === "calendar" && (
            <Button variant="primary" size="sm" onClick={openAddEvent}>
              <Plus size={15} aria-hidden="true" />
              {t("planner_calendar.add_event")}
            </Button>
          )}
          {mode === "calendar" && <ViewDropdown view={view} onChange={changeView} />}

          {/* Calendar ↔ Tasks toggle (labelled so each icon's meaning is clear) */}
          <div className="inline-flex rounded-full border border-paper-300 p-0.5 dark:border-umber-700">
            <button
              type="button"
              onClick={() => changeMode("calendar")}
              aria-label={t("planner_calendar.mode_calendar")}
              title={t("planner_calendar.mode_calendar")}
              aria-pressed={mode === "calendar"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                mode === "calendar"
                  ? "bg-moss-100 text-moss-800 dark:bg-moss-900/40 dark:text-moss-100"
                  : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
              }`}
            >
              <CalendarDays size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{t("planner_calendar.mode_calendar")}</span>
            </button>
            <button
              type="button"
              onClick={() => changeMode("tasks")}
              aria-label={t("planner_calendar.mode_tasks")}
              title={t("planner_calendar.mode_tasks")}
              aria-pressed={mode === "tasks"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                mode === "tasks"
                  ? "bg-moss-100 text-moss-800 dark:bg-moss-900/40 dark:text-moss-100"
                  : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
              }`}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{t("planner_calendar.mode_tasks")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {mode === "tasks" ? (
        <TasksView tasks={tasks} />
      ) : view === "year" ? (
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
          weekdays={weekdays}
          todayStr={todayStr}
          onPickDay={(d) => {
            setCursor(d);
            changeView("day");
          }}
          onEventClick={openEditEvent}
        />
      ) : view === "schedule" ? (
        <ScheduleView events={events} onEventClick={openEditEvent} />
      ) : (
        <TimeGridView
          days={gridDays}
          eventsByDate={eventsByDate}
          todayStr={todayStr}
          allDayLabel={t("planner_calendar.all_day")}
          onEventClick={openEditEvent}
        />
      )}

      {/* Legend (calendar mode only) */}
      {mode === "calendar" && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-4 text-xs text-umber-500 dark:text-umber-400">
            <span className="flex items-center gap-1.5">
              <Heart size={12} className="text-moss-600" aria-hidden="true" />
              {t("planner_calendar.legend_weddings")}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={12} className="text-amber-500" aria-hidden="true" />
              {t("planner_calendar.legend_tasks")}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays size={12} className="text-moss-600" aria-hidden="true" />
              {t("planner_calendar.legend_events")}
            </span>
          </div>
          {legendClients.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-umber-500 dark:text-umber-400">
              {legendClients.map((c) => (
                <Link
                  key={c.couple_id}
                  to={`/app/planner/clients/${c.couple_id}`}
                  className="flex items-center gap-1.5 hover:text-moss-700 dark:hover:text-moss-300"
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${clientColor(c.couple_id).dot}`}
                    aria-hidden="true"
                  />
                  {titleCaseName(c.display_name)}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <EventModal
        open={modalOpen}
        editing={editingEvent}
        initialDate={modalDate}
        clients={clients}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          reloadEvents();
        }}
      />
    </div>
  );
}
