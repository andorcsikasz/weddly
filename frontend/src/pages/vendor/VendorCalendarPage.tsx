// Vendor calendar + to-do board, rendered inside VendorShell. Mirrors the
// planner's calendar/tasks page structure: one route, two modes behind a pill
// toggle (deep-linkable via ?mode=tasks, persisted per device).
//
// CALENDAR mode is the vendor's occupancy view: a month grid marking blocked
// days (the self-serve Foglaltság dates) and booked days (confirmed Weddly
// bookings), with click-to-block/unblock, the classic date-input fallback,
// the blocked-date chips, and the auto-updating next-free-date line. Couples
// see the same truth on the public busy calendar. Blocking is a PRO feature;
// a FREE vendor sees the grid read-only plus the upgrade prompt.
//
// TASKS mode is the Trello-style board (todo / doing / done) with native
// HTML5 drag & drop lifted from the planner board, plus create and delete
// (vendor tasks are self-managed, unlike planner tasks which come from the
// couples' checklists).

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Lock,
  SquareKanban,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

type Mode = "calendar" | "tasks";

const MODE_KEY = "weddly.vendor_cal_mode";

// ── date helpers (UTC-free, local-day arithmetic like the planner page) ──────

function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  const [y = 0, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
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

// ── month grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  cursor,
  todayStr,
  blocked,
  bookedByDate,
  canEdit,
  busy,
  onToggle,
}: {
  cursor: Date;
  todayStr: string;
  blocked: Set<string>;
  bookedByDate: Map<string, string[]>;
  canEdit: boolean;
  busy: boolean;
  onToggle: (iso: string, isBlocked: boolean) => void;
}) {
  const { t, locale } = useT();

  // 6 fixed weeks starting from the Monday on/before the 1st, like the
  // planner month view, so the grid height never jumps between months.
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  // Monday-first weekday initials in the active locale (2024-01-01 is a Monday).
  const weekdayFmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    weekday: "short",
  });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i)));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((w) => (
          <p
            key={w}
            className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-umber-500 dark:text-umber-400"
          >
            {w}
          </p>
        ))}
        {days.map((d) => {
          const iso = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = iso === todayStr;
          const isPast = iso < todayStr;
          const isBlocked = blocked.has(iso);
          const bookedNames = bookedByDate.get(iso);
          const isBooked = bookedNames !== undefined;
          // Booked days come from confirmed bookings and can't be edited here;
          // free future days block on click, blocked days unblock.
          const clickable = canEdit && !busy && !isPast && !isBooked && inMonth;

          const base =
            "relative flex h-11 flex-col items-center justify-center rounded-lg text-sm transition-colors sm:h-12";
          let tone: string;
          if (isBooked) {
            tone = "bg-steel-600 text-white dark:bg-steel-500 dark:text-white font-medium";
          } else if (isBlocked) {
            tone =
              "bg-blush-500/90 text-white dark:bg-blush-400/80 dark:text-umber-950 font-medium";
          } else if (!inMonth) {
            tone = "text-umber-300 dark:text-umber-600";
          } else if (isPast) {
            tone = "text-umber-400 dark:text-umber-500";
          } else {
            tone =
              "text-ink-800 dark:text-paper-100 " +
              (clickable ? "hover:bg-paper-100 dark:hover:bg-umber-800" : "");
          }
          const ring = isToday ? " ring-2 ring-inset ring-moss-500 dark:ring-moss-400" : "";

          const title = isBooked
            ? t("vendor_calendar.booked_title", { name: bookedNames.join(", ") })
            : isBlocked
              ? t("vendor_calendar.availability_remove", { date: formatDay(iso, locale) })
              : clickable
                ? t("vendor_calendar.block_day_title", { date: formatDay(iso, locale) })
                : undefined;

          return (
            <button
              key={iso}
              type="button"
              disabled={!clickable}
              onClick={() => onToggle(iso, isBlocked)}
              title={title}
              aria-label={title ?? formatDay(iso, locale)}
              className={`${base} ${tone}${ring} disabled:cursor-default`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-umber-500 dark:text-umber-400">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full bg-blush-500/90 dark:bg-blush-400/80"
            aria-hidden="true"
          />
          {t("vendor_calendar.legend_blocked")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full bg-steel-600 dark:bg-steel-500"
            aria-hidden="true"
          />
          {t("vendor_calendar.legend_booked")}
        </span>
      </div>
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
    } catch {
      /* localStorage unavailable */
    }
    // A ?mode=tasks deep link (e.g. from the nav or dashboard) wins.
    const qmode = searchParams.get("mode");
    if (qmode === "tasks" || qmode === "calendar") setMode(qmode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a deep-linked mode switch working while the page stays mounted
  // (NavLink to ?mode=tasks re-renders without remounting).
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

  useEffect(() => {
    vendorAvailabilityApi
      .me()
      .then((view) => setAvailability(view))
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

  // Confirmed bookings by day, for the occupied markers + tooltips.
  const bookedByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of clients) {
      if (c.status !== "confirmed") continue;
      const names = map.get(c.event_date) ?? [];
      names.push(c.couple_display_name);
      map.set(c.event_date, names);
    }
    return map;
  }, [clients]);

  const blockedSet = useMemo(() => new Set(availability?.blocked_dates ?? []), [availability]);

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

  const monthTitle = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
  }).format(cursor);

  const modePill = (m: Mode, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => changeMode(m)}
      aria-pressed={mode === m}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        mode === m
          ? "bg-steel-600 text-white"
          : "text-umber-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
          {t("vendor_calendar.page_title")}
        </h1>
        <div className="inline-flex rounded-full border border-paper-300 p-0.5 dark:border-umber-700">
          {modePill(
            "calendar",
            <CalendarDays size={13} aria-hidden="true" />,
            t("vendor_calendar.mode_calendar"),
          )}
          {modePill(
            "tasks",
            <SquareKanban size={13} aria-hidden="true" />,
            t("vendor_calendar.mode_tasks"),
          )}
        </div>
      </div>

      {mode === "calendar" ? (
        <>
          {availabilityMissing && (
            <section className="card p-4">
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_calendar.availability_no_listing")}
              </p>
            </section>
          )}

          {!availabilityMissing && (
            <section className="card space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{t("vendor_calendar.section_availability")}</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
                    }
                    aria-label={t("vendor_calendar.month_prev")}
                    title={t("vendor_calendar.month_prev")}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCursor(new Date())}
                    className="rounded-full px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
                  >
                    {t("vendor_calendar.today")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
                    }
                    aria-label={t("vendor_calendar.month_next")}
                    title={t("vendor_calendar.month_next")}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-umber-800"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <p className="text-sm capitalize text-umber-500 dark:text-umber-400">{monthTitle}</p>
              <p className="text-sm text-ink-600 dark:text-umber-200">
                {t("vendor_calendar.availability_intro")}
              </p>

              <MonthGrid
                cursor={cursor}
                todayStr={todayStr}
                blocked={blockedSet}
                bookedByDate={bookedByDate}
                canEdit={canEdit}
                busy={availBusy}
                onToggle={onToggleDay}
              />
            </section>
          )}

          {/* Freemium: blocking is PRO. A FREE vendor sees the locked state
              with the upgrade path instead of a form whose writes would 402. */}
          {!availabilityMissing && !canEdit && (
            <section className="card flex flex-col gap-3 p-4">
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
            <section className="card space-y-2.5 p-4">
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
                        aria-label={t("vendor_calendar.availability_remove", {
                          date: formatDay(d, locale),
                        })}
                        title={t("vendor_calendar.availability_remove", {
                          date: formatDay(d, locale),
                        })}
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
      ) : (
        <TasksBoard
          tasks={tasks}
          onMove={moveTask}
          onDelete={(task) => void deleteTask(task)}
          onCreate={createTask}
          createBusy={createBusy}
        />
      )}
    </div>
  );
}
