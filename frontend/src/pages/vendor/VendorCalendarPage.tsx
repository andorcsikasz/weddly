// Vendor calendar + to-do board, rendered inside VendorShell. Mirrors the
// planner's Google-Calendar-style page: the same six views (Day / 4 days /
// Week / Month / Year / Schedule) behind the same view dropdown, plus the
// Calendar<->Tasks mode toggle (deep-linkable via ?mode=tasks, persisted).
//
// The vendor's calendar "events" are: confirmed bookings (booked weddings),
// pending inquiries (requested / vendor_seen), self-blocked Foglaltsag days,
// and open task deadlines from the board. CALENDAR mode is also the blocking
// editor: clicking any editable day (in the grid or its pill in any view) opens
// a small modal to block the whole day or only a from-to hour range. A
// whole-day block shows a bare lock ("zero text"), a partial one an hourglass +
// the blocked-hour count, and on the day/week hour grid a partial block is also
// painted as a band over the hours it covers (the grid widens past its
// 07:00-20:00 default if a block falls outside it, so nothing is ever clipped
// out of view). The auto-updating next-free date sits below. Couples see
// whole-day blocks as booked and partial blocks as a distinct "partly booked"
// marker on the public busy calendar. Blocking is a PRO feature; a FREE vendor
// gets the read-only calendar plus the upgrade prompt.
//
// TASKS mode is the Trello-style board (todo / doing / done) with native
// HTML5 drag & drop lifted from the planner board, plus create and delete.

import {
  Calendar1,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  CalendarSync,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns3,
  Grid3x3,
  Heart,
  Hourglass,
  List,
  ListChecks,
  Lock,
  SquareKanban,
  Trash2,
} from "lucide-react";
import { intlLocale } from "../../lib/format";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  blockedHoursRange,
  hourLabel,
  type VendorAvailabilityView,
  type VendorBlockedDay,
} from "@shared/listings";
import {
  DAY_MINUTES,
  hoursFromWeekdays,
  isoWeekday,
  minutesToLabel,
  type WeeklyHours,
} from "@shared/vendor_availability";
import type { VendorClientView } from "@shared/vendor_clients";
import type { VendorBoardStatus, VendorTask } from "@shared/vendor_tasks";
import { GoogleCalendarConnect } from "../../components/GoogleCalendarConnect";
import { useConfirm } from "../../components/ui/ConfirmDialogProvider";
import { DateField } from "../../components/ui/DateField";
import { Dialog } from "../../components/ui/Dialog";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useToast } from "../../components/ui/ToastProvider";
import { ViewSelect } from "../../components/ui/ViewSelect";
import {
  vendorAvailabilityApi,
  vendorBillingApi,
  vendorClientsApi,
  vendorGoogleCalendarApi,
  vendorTaskApi,
} from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";
import { useDocumentTitle } from "../../lib/seo";

type CalView = "day" | "4day" | "week" | "month" | "year" | "schedule";
type Mode = "calendar" | "tasks";

const VIEW_KEY = "weddly.vendor_cal_view";
const MODE_KEY = "weddly.vendor_cal_mode";

/** One pill on the calendar. `bookingId` set for booked/pending (links to the
 *  client), `date` doubles as the edit target for kind 'blocked'. For 'blocked',
 *  `hours` is null (whole day) or the sorted blocked hours; `hoursBadge` is the
 *  compact "4 ó" shown next to the lock on a partial-day pill (absent = whole
 *  day, so the pill is a lock icon with no text). */
interface CalEvent {
  kind: "booked" | "pending" | "blocked" | "task" | "external" | "buffer";
  date: string; // YYYY-MM-DD
  label: string;
  bookingId?: number;
  hours?: number[] | null;
  hoursBadge?: string;
  /** Minutes from local midnight, for 'external' blocks: free/busy reports real
   *  times, not the whole hours the in-app block editor produces. */
  minutes?: { start: number; end: number };
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
function formatDay(iso: string, locale: Locale): string {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

// ── event pills ──────────────────────────────────────────────────────────────

/** The complement of one day's working hours, in fractional hours, which is what
 *  the hour grid paints as "not working". A day with no working block at all
 *  comes back as the whole 0-24, so an off day reads as one shaded column. */
function offRanges(intervals: readonly { start_min: number; end_min: number }[]): Array<{
  start: number;
  end: number;
}> {
  const out: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const iv of intervals) {
    if (iv.start_min > cursor) out.push({ start: cursor / 60, end: iv.start_min / 60 });
    cursor = Math.max(cursor, iv.end_min);
  }
  if (cursor < DAY_MINUTES) out.push({ start: cursor / 60, end: DAY_MINUTES / 60 });
  return out;
}

function pillColor(kind: CalEvent["kind"]): string {
  switch (kind) {
    case "booked":
      return "bg-paper-100 text-ink-700 hover:brightness-95 dark:bg-umber-800 dark:text-paper-100";
    case "pending":
      return "bg-amber-100 text-amber-800 hover:brightness-95 dark:bg-amber-900/40 dark:text-amber-100";
    case "blocked":
      return "bg-blush-100 text-blush-800 hover:brightness-95 dark:bg-blush-900/40 dark:text-blush-100";
    case "task":
      return "bg-moss-100 text-moss-900 hover:brightness-95 dark:bg-moss-900/40 dark:text-moss-100";
    // Busy time from the vendor's OWN Google calendar. Neutral on purpose: it
    // is not something they marked in Weddly and there is nothing to act on
    // here, so it must not compete with a real inquiry for attention.
    case "external":
      return "bg-paper-200 text-ink-600 dark:bg-umber-800/80 dark:text-umber-200";
    // Setup / teardown the app added around an event. Quieter still: it is a
    // consequence, not an entry.
    case "buffer":
      return "bg-paper-100 text-ink-500 dark:bg-umber-800/50 dark:text-umber-300";
  }
}

/** True for a block that covers only part of the day. */
function isPartialBlock(ev: CalEvent): boolean {
  return ev.kind === "blocked" && Array.isArray(ev.hours) && ev.hours.length > 0;
}

/** Single source of truth for a category's glyph. Pills, the agenda rows and
 *  the legend all draw from here, so a category can never end up reading one
 *  way on the grid and another way in the list. A whole-day block is a closed
 *  lock, a partial one an hourglass. The two used to differ only by the
 *  opacity of the same lock, which was unreadable at pill size. */
function EventGlyph({ ev, size = 10 }: { ev: CalEvent; size?: number }) {
  switch (ev.kind) {
    case "booked":
      return <Heart size={size} className="shrink-0" aria-hidden="true" />;
    case "pending":
      return <Clock size={size} className="shrink-0" aria-hidden="true" />;
    case "blocked":
      return isPartialBlock(ev) ? (
        <Hourglass size={size} className="shrink-0" aria-hidden="true" />
      ) : (
        <Lock size={size} className="shrink-0" aria-hidden="true" />
      );
    case "task":
      return (
        <span
          className="shrink-0 rounded-full bg-current opacity-70"
          style={{ width: size * 0.6, height: size * 0.6 }}
          aria-hidden="true"
        />
      );
    case "external":
      return <CalendarSync size={size} className="shrink-0" aria-hidden="true" />;
    case "buffer":
      return <Hourglass size={size} className="shrink-0" aria-hidden="true" />;
  }
}

function PillBody({ ev }: { ev: CalEvent }) {
  // Blocked pills are icon-first with no day label: a whole-day block is a bare
  // lock ("zero text"), a partial block adds the blocked-hour count ("4 ó").
  if (ev.kind === "blocked") {
    return (
      <>
        <EventGlyph ev={ev} />
        {ev.hoursBadge ? <span className="truncate tabular-nums">{ev.hoursBadge}</span> : null}
      </>
    );
  }
  return (
    <>
      <EventGlyph ev={ev} />
      <span className="truncate">{ev.label}</span>
    </>
  );
}

/** Booked/pending pills link to the client, task pills jump to the board,
 *  blocked pills open the day-block editor on click (when the vendor may edit).
 *  Blocked pills are role="button" spans because month-grid cells are
 *  themselves <button>s and nesting buttons is invalid markup. */
function EventPill({
  ev,
  onOpenDay,
  openTitle,
}: {
  ev: CalEvent;
  onOpenDay?: (iso: string) => void;
  openTitle?: string;
}) {
  const base = `flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] transition-colors ${pillColor(
    ev.kind,
  )}`;
  if (ev.kind === "blocked") {
    if (!onOpenDay) {
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
        title={openTitle ?? ev.label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenDay(iso);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onOpenDay(iso);
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
    new Intl.DateTimeFormat(intlLocale(locale), { month: "long" }).format(new Date(year, m, 1));
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
              className="mb-2 font-grotesk text-base font-medium capitalize text-umber-800 hover:text-blush-700 dark:text-paper-200 dark:hover:text-blush-300"
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
                          ? "bg-blush-500 text-paper-50 dark:bg-blush-400 dark:text-umber-900"
                          : "hover:bg-paper-100 dark:hover:bg-umber-800"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {evs && inMonth && !isToday && (
                      <span
                        className={`absolute bottom-0 h-1 w-1 rounded-full ${
                          hasBooked ? "bg-blush-500" : "bg-amber-500"
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
  blockedDays,
  weekdays,
  todayStr,
  canEdit,
  busy,
  onOpenDay,
  openTitleFor,
  isOffDay,
  offDayTitle,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalEvent[]>;
  blockedDays: Map<string, number[] | null>;
  weekdays: string[];
  todayStr: string;
  canEdit: boolean;
  busy: boolean;
  onOpenDay: (iso: string) => void;
  openTitleFor: (iso: string) => string;
  /** From the weekly schedule, not from anything the vendor marked by hand. */
  isOffDay: (iso: string) => boolean;
  offDayTitle: string;
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
          const isBlocked = blockedDays.has(key);
          const isPartial = isBlocked && blockedDays.get(key) != null;
          // "Not working" comes from the weekly schedule, so it is drawn but
          // never counted as a block: no pill, no colour, just a muted cell and
          // a glyph. A day the vendor blocked BY HAND still wins the surface.
          const isOff = !isBlocked && isOffDay(key);
          const evs = eventsByDate.get(key) ?? [];
          const hasBooking = evs.some((e) => e.kind === "booked");
          // The month grid is the blocking editor: clicking a free future day
          // (or an already-blocked one) opens the day-block editor where the
          // vendor picks whole-day or specific hours. Booked days and the past
          // stay inert.
          const editable = canEdit && !busy && inMonth && key >= todayStr && !hasBooking;
          return (
            <button
              type="button"
              key={key}
              disabled={!editable}
              onClick={() => onOpenDay(key)}
              title={editable ? openTitleFor(key) : undefined}
              className={`min-h-[6rem] border-b border-r border-paper-100 p-1.5 text-left transition-colors disabled:cursor-default dark:border-umber-800 ${
                isBlocked
                  ? isPartial
                    ? "bg-blush-50 dark:bg-blush-900/10"
                    : "bg-blush-100/60 dark:bg-blush-900/20"
                  : isOff && inMonth
                    ? "bg-paper-100/70 dark:bg-umber-950/50"
                    : inMonth
                      ? editable
                        ? "hover:bg-paper-50 dark:hover:bg-umber-800/60"
                        : ""
                      : "bg-paper-50/60 dark:bg-umber-950/40"
              }`}
            >
              <span className="flex items-center justify-between gap-1">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-blush-500 font-semibold text-paper-50 dark:bg-blush-400 dark:text-umber-900"
                      : inMonth
                        ? "text-umber-700 dark:text-paper-200"
                        : "text-umber-300 dark:text-umber-600"
                  }`}
                >
                  {d.getDate()}
                </span>
                {isOff && inMonth && (
                  <CalendarOff
                    size={12}
                    strokeWidth={1.5}
                    aria-label={offDayTitle}
                    className="shrink-0 text-umber-400 dark:text-umber-500"
                  />
                )}
              </span>
              <div className="mt-1 space-y-1">
                {evs.slice(0, 3).map((ev, i) => (
                  <EventPill
                    key={`${ev.kind}-${ev.bookingId ?? ev.date}-${i}`}
                    ev={ev}
                    onOpenDay={editable ? onOpenDay : undefined}
                    openTitle={openTitleFor(ev.date)}
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

const DAY_START = 7; // default visible window: 07:00 - 20:00
const DAY_END = 21; // exclusive

/** 'HH:MM' for a fractional hour. `hourLabel` only speaks whole hours, and an
 *  external block starts whenever the vendor's own appointment starts. */
function clockLabel(hours: number): string {
  const total = Math.round(hours * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A block drawn over the hour grid at its true position: a partial-hour block
 *  the vendor made here (clickable, opens the day editor), or busy time pulled
 *  from their Google calendar (neutral and INERT, because the only place to
 *  change it is Google). */
function HourBand({
  ev,
  start,
  end,
  windowStart,
  span,
  onOpenDay,
  openTitle,
}: {
  ev: CalEvent;
  start: number;
  end: number;
  windowStart: number;
  span: number;
  onOpenDay?: (iso: string) => void;
  openTitle: string;
}) {
  const top = ((start - windowStart) / span) * 100;
  const height = ((end - start) / span) * 100;
  const external = ev.kind === "external" || ev.kind === "buffer";
  const shared =
    ev.kind === "buffer"
      ? "absolute inset-x-0.5 z-[3] overflow-hidden rounded-md border border-dashed border-paper-300 bg-paper-100/80 px-1 py-0.5 text-left text-[10px] leading-tight text-ink-500 dark:border-umber-700 dark:bg-umber-800/60 dark:text-umber-300"
      : external
        ? "absolute inset-x-0.5 z-[4] overflow-hidden rounded-md border border-paper-300 bg-paper-200/90 px-1 py-0.5 text-left text-[10px] leading-tight text-ink-600 dark:border-umber-700 dark:bg-umber-800/90 dark:text-umber-200"
        : "absolute inset-x-0.5 z-[5] overflow-hidden rounded-md border border-blush-300 bg-blush-100/85 px-1 py-0.5 text-left text-[10px] leading-tight text-blush-900 dark:border-blush-700 dark:bg-blush-900/50 dark:text-blush-100";
  const body = (
    <>
      <span className="flex items-center gap-1 font-medium tabular-nums">
        <EventGlyph ev={ev} />
        {`${clockLabel(start)}-${clockLabel(end)}`}
      </span>
    </>
  );
  const style = { top: `${top}%`, height: `${height}%` };
  if (!onOpenDay || external) {
    return (
      <div className={shared} style={style} title={ev.label}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenDay(ev.date)}
      title={openTitle}
      className={`${shared} cursor-pointer transition-colors hover:bg-blush-200/90 dark:hover:bg-blush-900/70`}
      style={style}
    >
      {body}
    </button>
  );
}

function TimeGridView({
  days,
  eventsByDate,
  todayStr,
  allDayLabel,
  onOpenDay,
  openTitleFor,
  offRangesFor,
}: {
  days: Date[];
  eventsByDate: Map<string, CalEvent[]>;
  todayStr: string;
  allDayLabel: string;
  onOpenDay?: (iso: string) => void;
  openTitleFor: (iso: string) => string;
  /** Non-working hours for a date, from the weekly schedule, in fractional
   *  hours. Shaded rather than blocked: nothing here is an event. */
  offRangesFor: (iso: string) => Array<{ start: number; end: number }>;
}) {
  const { locale } = useT();

  // Partial-hour blocks are drawn as real bands on the grid, so the window has
  // to stretch to whatever is actually blocked in view: a 05:00-06:00 block
  // would otherwise be silently clipped out of the 07:00-20:00 default.
  const {
    hours: HOURS,
    windowStart,
    windowEnd,
  } = useMemo(() => {
    let lo = DAY_START;
    let hi = DAY_END;
    for (const d of days) {
      for (const ev of eventsByDate.get(ymd(d)) ?? []) {
        if ((ev.kind === "external" || ev.kind === "buffer") && ev.minutes) {
          lo = Math.min(lo, Math.floor(ev.minutes.start / 60));
          hi = Math.max(hi, Math.ceil(ev.minutes.end / 60));
          continue;
        }
        if (!isPartialBlock(ev) || !ev.hours) continue;
        const { start, end } = blockedHoursRange(ev.hours);
        lo = Math.min(lo, start);
        hi = Math.max(hi, end);
      }
    }
    return {
      hours: Array.from({ length: hi - lo }, (_, i) => i + lo),
      windowStart: lo,
      windowEnd: hi,
    };
  }, [days, eventsByDate]);

  const span = windowEnd - windowStart;
  const now = new Date();
  const nowTop = ((now.getHours() + now.getMinutes() / 60 - windowStart) / span) * 100;
  const showNow = days.some((d) => ymd(d) === todayStr) && nowTop >= 0 && nowTop <= 100;
  const wd = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" }).format(d);

  // A day column has a floor. Seven of them in a 360px viewport used to get
  // 44px each: the weekday name truncated to a letter, every event pill an
  // unreadable sliver, and no way to widen them. Below the floor the three
  // grids overflow together inside one horizontal scroller, so they stay in
  // register and a week is something you swipe rather than squint at.
  const cols = `3.5rem repeat(${days.length}, minmax(4.5rem,1fr))`;

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      <div className="overflow-x-auto">
        {/* Day headers */}
        <div
          className="grid border-b border-paper-200 dark:border-umber-800"
          style={{ gridTemplateColumns: cols }}
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
                      ? "bg-blush-500 text-paper-50 dark:bg-blush-400 dark:text-umber-900"
                      : "text-umber-800 dark:text-paper-100"
                  }`}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day band: bookings, inquiries, whole-day blocks and task deadlines
          are date-only, so they live here. Partial-hour blocks are the one
          exception - they are drawn on the hour grid below at their real
          position, so repeating them here would double-count the day. */}
        <div
          className="grid border-b border-paper-200 dark:border-umber-800"
          style={{ gridTemplateColumns: cols }}
        >
          <div className="px-1 py-1 text-right text-[9px] uppercase tracking-wide text-umber-400">
            {allDayLabel}
          </div>
          {days.map((d) => {
            // Partial blocks AND external busy are drawn on the hour grid below
            // at their real position, so repeating them here would double-count
            // the day.
            const evs = (eventsByDate.get(ymd(d)) ?? []).filter(
              (ev) => !isPartialBlock(ev) && ev.kind !== "external" && ev.kind !== "buffer",
            );
            return (
              <div
                key={ymd(d)}
                className="min-h-[2.5rem] space-y-1 border-l border-paper-100 p-1 dark:border-umber-800"
              >
                {evs.map((ev, i) => (
                  <EventPill
                    key={`${ev.kind}-${ev.bookingId ?? ev.date}-${i}`}
                    ev={ev}
                    onOpenDay={onOpenDay}
                    openTitle={openTitleFor(ev.date)}
                  />
                ))}
              </div>
            );
          })}
        </div>

        {/* Hour grid. Partial-hour blocks are painted here as bands spanning the
          hours they actually cover, so the vendor can read their booked hours
          off the grid instead of having to open every day. */}
        <div className="relative max-h-[60vh] overflow-y-auto">
          <div className="relative grid" style={{ gridTemplateColumns: cols }}>
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
              <div
                key={ymd(d)}
                className="relative border-l border-paper-100 dark:border-umber-800"
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="h-12 border-b border-paper-100 dark:border-umber-800/60"
                  />
                ))}
                {/* Off hours, from the weekly schedule. Translucent so the hour
                    lines stay readable through them, and inert: this is the
                    absence of working time, not an event. */}
                {offRangesFor(ymd(d)).map((r) => {
                  const top = ((Math.max(r.start, windowStart) - windowStart) / span) * 100;
                  const bottom = ((Math.min(r.end, windowEnd) - windowStart) / span) * 100;
                  if (bottom <= 0 || top >= 100 || bottom <= top) return null;
                  return (
                    <div
                      key={`off-${r.start}-${r.end}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bg-paper-200/40 dark:bg-umber-950/40"
                      style={{ top: `${top}%`, height: `${bottom - top}%` }}
                    />
                  );
                })}
                {(eventsByDate.get(ymd(d)) ?? [])
                  .filter((ev) => (ev.kind === "external" || ev.kind === "buffer") && ev.minutes)
                  .map((ev) => {
                    const m = ev.minutes as { start: number; end: number };
                    return (
                      <HourBand
                        key={`${ev.kind}-${ev.date}-${m.start}-${m.end}`}
                        ev={ev}
                        start={m.start / 60}
                        end={m.end / 60}
                        windowStart={windowStart}
                        span={span}
                        openTitle={ev.label}
                      />
                    );
                  })}
                {(eventsByDate.get(ymd(d)) ?? [])
                  .filter((ev) => isPartialBlock(ev) && ev.hours)
                  .map((ev) => {
                    const { start, end } = blockedHoursRange(ev.hours as number[]);
                    return (
                      <HourBand
                        key={`${ev.date}-${start}-${end}`}
                        ev={ev}
                        start={start}
                        end={end}
                        windowStart={windowStart}
                        span={span}
                        onOpenDay={onOpenDay}
                        openTitle={openTitleFor(ev.date)}
                      />
                    );
                  })}
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
    </div>
  );
}

// ── Schedule (agenda) view ───────────────────────────────────────────────────

function ScheduleView({
  events,
  onOpenDay,
  openTitleFor,
  emptyFallback,
}: {
  events: CalEvent[];
  onOpenDay?: (iso: string) => void;
  openTitleFor: (iso: string) => string;
  /** Rendered under the "nothing upcoming" line. The page passes the month
   *  grid: an empty agenda on its own leaves the calendar tab with no calendar
   *  on it, and the view is restored across sessions, so that state is where a
   *  vendor lands rather than somewhere they pass through. */
  emptyFallback?: ReactNode;
}) {
  const { t, locale } = useT();
  const todayStr = ymd(new Date());
  const upcoming = events
    .filter((e) => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length === 0) {
    return (
      <div>
        <p className="mb-4 text-sm text-umber-400 dark:text-umber-500">
          {t("vendor_calendar.schedule_empty")}
        </p>
        {emptyFallback}
      </div>
    );
  }
  const fmt = (s: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(parseYmd(s));
  // Same glyph vocabulary as the grid pills and the legend: an agenda row has
  // to be readable as "manual block" vs "real booking" without parsing its
  // text, which a bare colour dot never allowed.
  const glyphColor = (kind: CalEvent["kind"]) =>
    kind === "booked"
      ? "text-blush-600 dark:text-paper-400"
      : kind === "pending"
        ? "text-amber-500"
        : kind === "blocked"
          ? "text-blush-500"
          : "text-moss-500";
  const rowClass =
    "flex w-full items-center gap-4 border-b border-paper-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-paper-100 dark:border-umber-800 dark:hover:bg-umber-800";
  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900">
      {upcoming.map((ev, i) => {
        const body = (
          <>
            <span className="w-28 shrink-0 text-sm text-umber-500 dark:text-umber-400">
              {fmt(ev.date)}
            </span>
            <span className={`flex w-4 shrink-0 justify-center ${glyphColor(ev.kind)}`}>
              <EventGlyph ev={ev} size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-umber-900 dark:text-paper-50">
              {ev.label}
            </span>
          </>
        );
        const key = `${ev.date}-${ev.kind}-${ev.bookingId ?? i}`;
        if (ev.kind === "blocked" && onOpenDay) {
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenDay(ev.date)}
              title={openTitleFor(ev.date)}
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

/** One glyph per view, so the trigger can drop its word on a phone and the menu
 *  rows can be scanned by shape. Each says what the view IS: one column, four,
 *  a span, a grid of days, a grid of months, a list. */
const VIEW_ICONS: Record<CalView, ReactNode> = {
  day: <Calendar1 size={15} aria-hidden="true" />,
  "4day": <Columns3 size={15} aria-hidden="true" />,
  week: <CalendarRange size={15} aria-hidden="true" />,
  month: <CalendarDays size={15} aria-hidden="true" />,
  year: <Grid3x3 size={15} aria-hidden="true" />,
  schedule: <List size={15} aria-hidden="true" />,
};

/** The two multi-day time grids, which a phone cannot draw: seven columns in
 *  360px leaves 44px each, so the header degrades to a bare day number and every
 *  event pill is an unreadable sliver. Landing on one is a dead end rather than
 *  a dense view, so a narrow viewport falls back to the single-day grid. */
const WIDE_VIEWS: CalView[] = ["week", "4day"];
const NARROW_MAX_PX = 640;

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_MAX_PX;
}

/** Thin wrapper over the shared `ViewSelect` — this control WAS the local
 *  implementation until the couple Timeline needed the same picker for its
 *  day/week/month/quarter range; it now lives in `components/ui` and the vendor
 *  side keeps only its option list, its icons and the steel tone. */
function ViewDropdown({ view, onChange }: { view: CalView; onChange: (v: CalView) => void }) {
  const { t } = useT();
  return (
    <ViewSelect
      value={view}
      options={VIEW_ORDER.map((v) => ({
        value: v,
        label: t(VIEW_KEYS[v] as Parameters<typeof t>[0]),
        icon: VIEW_ICONS[v],
      }))}
      onChange={onChange}
      ariaLabel={t("vendor_calendar.view_label")}
      tone="steel"
      compact
    />
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
    new Intl.DateTimeFormat(intlLocale(locale), {
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
  const { t, locale } = useT();
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
        <DateField
          label={t("vendor_calendar.task_due_label")}
          value={newDue}
          onChange={setNewDue}
          locale={locale}
          disabled={createBusy}
          clearable
        />
        <button
          type="submit"
          className="btn bg-blush-500 text-white hover:bg-blush-600"
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
                    ? "border-blush-400 bg-blush-50 dark:border-blush-400/40 dark:bg-blush-500/10"
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

// ── day-block editor ─────────────────────────────────────────────────────────

type BlockMode = "all_day" | "hours";

/** Modal to block a single day: the whole day, or a single from–to hour range.
 *  Opens on any editable day click in the calendar. When the day is already
 *  blocked it pre-fills the current state and offers "remove block". `current`:
 *  undefined = not blocked yet, null = whole day, number[] = partial. */
function DayBlockEditor({
  iso,
  current,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  iso: string;
  current: number[] | null | undefined;
  busy: boolean;
  onSave: (hours: number[] | null) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const alreadyBlocked = current !== undefined;
  // A day already blocked whole seeds the hour range as the FULL day, not the
  // 09:00-17:00 default a fresh day gets. Otherwise merely tabbing over to
  // "certain hours" and saving would quietly shrink a full block to 8 hours and
  // reopen the rest of the day for booking.
  const initialRange =
    current && current.length > 0
      ? blockedHoursRange(current)
      : current === null
        ? { start: 0, end: 24 }
        : { start: 9, end: 17 };
  const [mode, setMode] = useState<BlockMode>(current && current.length > 0 ? "hours" : "all_day");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);

  const validRange = end > start;
  const hourCount = validRange ? end - start : 0;

  function save() {
    if (mode === "all_day") {
      onSave(null);
      return;
    }
    if (!validRange) return;
    // A 00:00-24:00 "range" IS a whole-day block, and it has to be stored as
    // one: the public busy calendar treats a partial block as a day that is
    // still available, so persisting 24 hours would leave the day bookable.
    if (start === 0 && end === 24) {
      onSave(null);
      return;
    }
    onSave(Array.from({ length: end - start }, (_, i) => start + i));
  }

  return (
    <Dialog
      open
      role="dialog"
      closeOnBackdrop
      title={t("vendor_calendar.block_editor_title", { date: formatDay(iso, locale) })}
      onClose={onClose}
      footer={
        <>
          {alreadyBlocked && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="btn mr-auto text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/30"
            >
              {t("vendor_calendar.block_remove")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn border border-paper-300 dark:border-umber-700"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || (mode === "hours" && !validRange)}
            className="btn bg-blush-500 text-white hover:bg-blush-600 disabled:opacity-50"
          >
            {t("vendor_calendar.block_save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* The control is `inline-flex` (it hugs its labels), so it needs a
            flex wrapper to sit centred in the dialog rather than at the start
            of the block flow. */}
        <div className="flex justify-center">
          <SegmentedControl
            ariaLabel={t("vendor_calendar.block_mode_label")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "all_day", label: t("vendor_calendar.block_all_day") },
              { value: "hours", label: t("vendor_calendar.block_certain_hours") },
            ]}
          />
        </div>

        {mode === "all_day" ? (
          <p className="flex items-center gap-2 text-sm text-ink-600 dark:text-umber-200">
            <Lock size={14} aria-hidden="true" className="shrink-0 text-blush-500" />
            {t("vendor_calendar.block_all_day_hint")}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="field-label">{t("vendor_calendar.block_from")}</span>
                <select
                  className="input"
                  value={start}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setStart(v);
                    if (end <= v) setEnd(Math.min(v + 1, 24));
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 flex-1">
                <span className="field-label">{t("vendor_calendar.block_to")}</span>
                <select
                  className="input"
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, h) => h + 1)
                    .filter((h) => h > start)
                    .map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-600 dark:text-umber-200">
              <Lock size={14} aria-hidden="true" className="shrink-0 text-blush-500" />
              {t("vendor_calendar.block_hours_summary", { count: hourCount })}
            </p>
          </div>
        )}
      </div>
    </Dialog>
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
  // The recurring weekly schedule. Null until it lands (and if it never does,
  // the calendar simply draws no off days rather than guessing at them).
  const [workingHours, setWorkingHours] = useState<WeeklyHours | null>(null);
  const [clients, setClients] = useState<VendorClientView[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [availBusy, setAvailBusy] = useState(false);
  // ISO date whose block editor is open (null = closed).
  const [editorDate, setEditorDate] = useState<string | null>(null);

  const [tasks, setTasks] = useState<VendorTask[]>([]);
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as Mode | null;
      if (m === "tasks" || m === "calendar") setMode(m);
      const v = localStorage.getItem(VIEW_KEY) as CalView | null;
      // A stored week / 4-day view is honoured on a screen that can draw it and
      // swapped for the single day on one that cannot. Deliberately NOT
      // persisted: the vendor picked week on their laptop and that preference
      // should still be there when they open the same account on it.
      if (v && VIEW_ORDER.includes(v)) {
        setView(WIDE_VIEWS.includes(v) && isNarrowViewport() ? "day" : v);
      }
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
    vendorAvailabilityApi
      .schedule()
      .then((s) => setWorkingHours(s.working_hours))
      .catch(() => {
        /* no schedule, no off-day shading; the calendar still works */
      });
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

  // date → blocked hours (null = whole day). The month grid + editor read this.
  const blockedDays = useMemo(() => {
    const map = new Map<string, number[] | null>();
    for (const bd of availability?.blocked_days ?? []) map.set(bd.date, bd.hours);
    return map;
  }, [availability]);

  // A date the vendor exceptionally works, overriding their weekly schedule.
  // Kept apart from `blockedDays` because it is the opposite direction.
  const openDates = useMemo(() => new Set(availability?.open_dates ?? []), [availability]);

  // "Not working" per date, derived: the weekly schedule says this weekday is
  // off and no exception opens the date. Deliberately NOT stored per day, which
  // is the whole reason a weekly schedule exists.
  const isOffDay = useCallback(
    (iso: string): boolean =>
      workingHours !== null && workingHours[isoWeekday(iso)].length === 0 && !openDates.has(iso),
    [workingHours, openDates],
  );

  const offRangesFor = useCallback(
    (iso: string) => {
      if (workingHours === null) return [];
      // An exceptionally-open day has no hour detail on file, so it is treated
      // as a full working day rather than shaded shut.
      const intervals = openDates.has(iso)
        ? hoursFromWeekdays(null)[isoWeekday(iso)]
        : workingHours[isoWeekday(iso)];
      return offRanges(intervals);
    },
    [workingHours, openDates],
  );

  // Human summary for the schedule/agenda row + tooltip: "Egész nap foglalt"
  // for a whole-day block, "Foglalt 09:00-13:00 (4 ó)" for a partial one.
  const blockedLabel = useCallback(
    (hours: number[] | null): string => {
      if (hours == null || hours.length === 0) return t("vendor_calendar.blocked_all_day_label");
      const { start, end } = blockedHoursRange(hours);
      return t("vendor_calendar.blocked_hours_label", {
        from: hourLabel(start),
        to: hourLabel(end),
        count: hours.length,
      });
    },
    [t],
  );

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
    for (const [date, hours] of blockedDays) {
      out.push({
        kind: "blocked",
        date,
        label: blockedLabel(hours),
        hours,
        hoursBadge:
          hours && hours.length > 0
            ? t("vendor_calendar.block_hours_badge", { count: hours.length })
            : undefined,
      });
    }
    for (const tk of tasks) {
      if (tk.due_date && tk.board_status !== "done") {
        out.push({ kind: "task", date: tk.due_date, label: tk.title });
      }
    }
    // Busy time from the vendor's own Google calendars. Contentless by
    // construction (free/busy carries no title), so the label IS the time range.
    for (const b of availability?.external_busy ?? []) {
      out.push({
        kind: "external",
        date: b.date,
        label: t("vendor_calendar.external_busy_label", {
          from: minutesToLabel(b.start_min),
          to: minutesToLabel(b.end_min),
        }),
        minutes: { start: b.start_min, end: b.end_min },
      });
    }
    // Setup / teardown the schedule adds around a booking or an external event.
    // Drawn so a quiet Sunday morning explains itself.
    for (const b of availability?.buffer_blocks ?? []) {
      out.push({
        kind: "buffer",
        date: b.date,
        label: t("vendor_calendar.buffer_label", {
          from: minutesToLabel(b.start_min),
          to: minutesToLabel(b.end_min),
        }),
        minutes: { start: b.start_min, end: b.end_min },
      });
    }
    return out;
  }, [clients, blockedDays, blockedLabel, tasks, availability, t]);

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
    const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" });
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
    new Intl.DateTimeFormat(intlLocale(locale), opts);
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

  async function blockDay(iso: string, hours: number[] | null) {
    setAvailBusy(true);
    try {
      setAvailability(await vendorAvailabilityApi.block(iso, hours));
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

  const canEditAvailability = canEdit && !availabilityMissing;

  // A day click anywhere in the calendar opens the block editor for that date.
  function openDay(iso: string) {
    if (!canEditAvailability || availBusy) return;
    setEditorDate(iso);
  }
  // Editor "Save": persist the chosen block (null = whole day, else hours).
  function saveBlock(hours: number[] | null) {
    const iso = editorDate;
    if (iso === null) return;
    setEditorDate(null);
    void blockDay(iso, hours);
  }
  // Editor "Remove block": clear the whole day.
  function removeBlock() {
    const iso = editorDate;
    if (iso === null) return;
    setEditorDate(null);
    void unblockDay(iso);
  }

  const openTitleFor = useCallback(
    (iso: string) => t("vendor_calendar.block_day_title", { date: formatDay(iso, locale) }),
    [t, locale],
  );
  // Blocked pills / rows open the editor on click only when the vendor may edit.
  const openHandler = canEditAvailability && !availBusy ? openDay : undefined;

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

  // Built once and used twice: as the "month" view, and as what the agenda
  // shows when nothing is upcoming. Landing on /vendor/calendar has to put a
  // calendar on screen — the view is restored from localStorage, so a vendor
  // who once picked Ütemezés used to arrive at a single sentence and no grid,
  // which reads as a broken page rather than as an empty schedule.
  const monthGrid = (
    <MonthView
      cursor={cursor}
      eventsByDate={eventsByDate}
      blockedDays={blockedDays}
      weekdays={weekdays}
      todayStr={todayStr}
      canEdit={canEditAvailability}
      busy={availBusy}
      onOpenDay={openDay}
      openTitleFor={openTitleFor}
      isOffDay={isOffDay}
      offDayTitle={t("vendor_calendar.legend_off_day")}
    />
  );

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
          {/* Optional Google Calendar push-sync. Renders nothing until the
              operator has configured the integration, so an unconfigured deploy
              shows no dead affordance. Calendar mode only — it syncs the
              calendar, not the task board. */}
          {mode === "calendar" && (
            <GoogleCalendarConnect api={vendorGoogleCalendarApi} keyPrefix="vendor_calendar" />
          )}
          {mode === "calendar" && <ViewDropdown view={view} onChange={changeView} />}

          {/* Was a hand-rolled pair of buttons whose fill jumped from one to the
              other. Same two options, same steel, but the selection is now the
              shared control's sliding pill — and it picks up the arrow-key
              navigation the hand-rolled version never had.

              Pill-shaped at toolbar height: it shares this row with "Ma" and the
              view dropdown, both 34px rounded-full, and at the default size it
              stood 20px taller with square-ish corners. */}
          <SegmentedControl
            ariaLabel={t("vendor_calendar.mode_label")}
            value={mode}
            onChange={changeMode}
            tone="steel"
            shape="pill"
            size="sm"
            hideLabelsOnMobile
            options={[
              {
                value: "calendar" as const,
                label: t("vendor_calendar.mode_calendar"),
                icon: <CalendarDays size={16} aria-hidden="true" />,
              },
              {
                value: "tasks" as const,
                label: t("vendor_calendar.mode_tasks"),
                icon: <SquareKanban size={16} aria-hidden="true" />,
              },
            ]}
          />
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
            monthGrid
          ) : view === "schedule" ? (
            <ScheduleView
              events={events}
              onOpenDay={openHandler}
              openTitleFor={openTitleFor}
              emptyFallback={monthGrid}
            />
          ) : (
            <TimeGridView
              days={gridDays}
              eventsByDate={eventsByDate}
              todayStr={todayStr}
              allDayLabel={t("vendor_calendar.all_day")}
              onOpenDay={openHandler}
              openTitleFor={openTitleFor}
              offRangesFor={offRangesFor}
            />
          )}

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-umber-500 dark:text-umber-400">
            <span className="flex items-center gap-1.5">
              <Heart size={12} className="text-blush-600 dark:text-paper-400" aria-hidden="true" />
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
              <Hourglass size={12} className="text-blush-500" aria-hidden="true" />
              {t("vendor_calendar.legend_blocked_partial")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-moss-500" aria-hidden="true" />
              {t("vendor_calendar.legend_tasks")}
            </span>
            {/* The weekly schedule's own mark. Neutral on purpose: it is the
                absence of working time, not something the vendor did. */}
            <span className="flex items-center gap-1.5">
              <CalendarOff
                size={12}
                strokeWidth={1.5}
                className="text-umber-400"
                aria-hidden="true"
              />
              {t("vendor_calendar.legend_off_day")}
            </span>
            {/* Only rendered once something has actually been pulled, so a
                vendor with no Google connection reads no legend entry about
                one. */}
            {(availability?.buffer_blocks.length ?? 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <Hourglass
                  size={12}
                  strokeWidth={1.5}
                  className="text-umber-400"
                  aria-hidden="true"
                />
                {t("vendor_calendar.legend_buffer")}
              </span>
            )}
            {(availability?.external_busy.length ?? 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <CalendarSync
                  size={12}
                  strokeWidth={1.5}
                  className="text-umber-400"
                  aria-hidden="true"
                />
                {t("vendor_calendar.legend_external")}
              </span>
            )}
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
                className="btn w-fit bg-blush-500 text-white hover:bg-blush-600"
              >
                {t("vendor.upgrade.cta")}
              </Link>
            </section>
          )}

          {/* Blocking is now driven by clicking a day in the grid above (the
              editor picks whole-day or specific hours), so this is just the
              hint + the auto-updating next-free date. */}
          {!availabilityMissing && canEdit && availability && (
            <div className="mt-3 space-y-1 text-sm text-ink-500 dark:text-umber-300">
              <p>{t("vendor_calendar.availability_intro")}</p>
              <p className="text-xs">
                {availability.next_available
                  ? t("vendor_calendar.availability_next_free", {
                      date: formatDay(availability.next_available, locale),
                    })
                  : t("vendor_calendar.availability_none_free")}
              </p>
              {/* Recurring days off belong to the schedule, not to 52 clicks on
                  this grid, so the grid points at where they are edited. */}
              <p className="text-xs">
                <Link
                  to="/vendor/settings/schedule"
                  className="text-blush-600 underline-offset-2 hover:underline dark:text-blush-300"
                >
                  {t("vendor_calendar.schedule_link")}
                </Link>
              </p>
            </div>
          )}
        </>
      )}

      {editorDate !== null && (
        <DayBlockEditor
          iso={editorDate}
          current={blockedDays.has(editorDate) ? (blockedDays.get(editorDate) ?? null) : undefined}
          busy={availBusy}
          onSave={saveBlock}
          onRemove={removeBlock}
          onClose={() => setEditorDate(null)}
        />
      )}
    </div>
  );
}
