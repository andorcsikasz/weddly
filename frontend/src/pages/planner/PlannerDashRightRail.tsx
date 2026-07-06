import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  type LucideIcon,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { useT } from "../../lib/i18n";
import { nameDayFor } from "../../lib/nameDays";
import { localYmd } from "../../lib/format";

interface Props {
  tasks: PlannerTaskRow[];
  clients: PlannerClientView[];
  /** Desktop-only: the rail column is tucked to a slim handle. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Optimistically completes a task from the rail (parent owns the list). */
  onMarkDone: (taskId: number) => void;
}

function clientDisplayName(clients: PlannerClientView[], coupleId: number): string {
  return clients.find((c) => c.couple_id === coupleId)?.display_name ?? "";
}

function SectionHeader({ icon: Icon, label }: { icon?: LucideIcon; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      {Icon && (
        <Icon
          size={13}
          className="shrink-0 text-umber-500 dark:text-umber-400"
          aria-hidden="true"
        />
      )}
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
        {label}
      </p>
    </div>
  );
}

/** Circle that becomes a check on hover: completes the task in place. */
function DoneToggle({ onDone, label }: { onDone: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onDone}
      aria-label={label}
      title={label}
      className="group/done mt-0.5 shrink-0 rounded-full text-umber-300 transition-colors hover:text-moss-600 focus-visible:ring-2 focus-visible:ring-moss-600 dark:text-umber-500 dark:hover:text-moss-300"
    >
      <Circle size={15} className="group-hover/done:hidden" aria-hidden="true" />
      <CheckCircle2 size={15} className="hidden group-hover/done:block" aria-hidden="true" />
    </button>
  );
}

function RailTaskRow({
  task,
  clientName,
  overdueLabel,
  onMarkDone,
  doneLabel,
  tabbable,
}: {
  task: PlannerTaskRow;
  clientName: string;
  /** e.g. "3 napja esedékes": only on overdue rows. */
  overdueLabel?: string;
  onMarkDone: (taskId: number) => void;
  doneLabel: string;
  tabbable: boolean;
}) {
  const hover = "hover:bg-moss-50 dark:hover:bg-moss-900/20";
  return (
    <li className="flex items-start gap-2 min-w-0">
      <DoneToggle onDone={() => onMarkDone(task.task_id)} label={doneLabel} />
      <Link
        to="/app/planner/calendar?mode=tasks"
        tabIndex={tabbable ? undefined : -1}
        className={`-my-0.5 block min-w-0 flex-1 rounded-lg px-1.5 py-0.5 transition-colors ${hover}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {task.priority >= 2 && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
          )}
          <span className="truncate text-sm text-ink-900 dark:text-paper-100">{task.title}</span>
        </span>
        <span className="block truncate text-[10px] leading-4 text-umber-400 dark:text-umber-500">
          {clientName}
          {overdueLabel && (
            <>
              {clientName ? " · " : ""}
              <span className="font-medium text-ink-700 dark:text-paper-300">{overdueLabel}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

export function PlannerDashRightRail({
  tasks,
  clients,
  collapsed,
  onToggleCollapsed,
  onMarkDone,
}: Props) {
  const { t, locale } = useT();
  const [urgentOpen, setUrgentOpen] = useState(true);

  const now = new Date();
  // Local calendar date: NOT toISOString() (UTC), which misfiles tasks
  // between midnight and 02:00 CEST.
  const today = localYmd(now);

  const todayLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);

  // Hungarian name-day ("névnap"): a HU cultural tradition, so shown only in the HU locale.
  const nameDay = locale === "hu" ? nameDayFor(now) : null;

  const todayTasks = tasks.filter((tk) => tk.due_date === today && !tk.done);
  const visibleToday = todayTasks.slice(0, 5);
  const extraToday = todayTasks.length - visibleToday.length;

  const overdueTasks = tasks.filter((tk) => tk.due_date < today && !tk.done);
  const visibleOverdue = overdueTasks.slice(0, 4);
  const extraOverdue = overdueTasks.length - visibleOverdue.length;

  function overdueLabelFor(due: string): string {
    const days = Math.max(
      1,
      Math.round(
        (new Date(`${today}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) /
          86_400_000,
      ),
    );
    return days === 1
      ? t("planner_home.rail_overdue_yesterday")
      : t("planner_home.rail_overdue_days").replace("{{n}}", String(days));
  }

  const doneLabel = t("planner_home.rail_mark_done");

  return (
    <>
      {/* Desktop-collapsed: the card shrinks to its own slim handle: the
          expand control stays on the card chrome instead of floating above
          it, and the urgent count keeps pulsing through so tucking the rail
          away never hides an alert. Mobile always shows the full card. */}
      {collapsed && (
        <div className="hidden lg:flex lg:flex-col lg:items-center lg:gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={false}
            aria-label={t("planner_home.rail_expand")}
            title={t("planner_home.rail_expand")}
            className="card flex h-10 w-10 items-center justify-center text-umber-500 transition-colors hover:border-moss-400 hover:text-moss-700 dark:text-umber-400 dark:hover:border-moss-500 dark:hover:text-moss-300"
          >
            <PanelRightOpen size={17} aria-hidden="true" />
          </button>
          {overdueTasks.length > 0 && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              title={t("planner_home.rail_urgent_title")}
              className="flex h-6 min-w-6 items-center justify-center rounded-full bg-blush-100 px-1 text-[10px] font-semibold tabular-nums text-blush-800 transition-colors hover:bg-blush-200 dark:bg-blush-900/30 dark:text-blush-300 dark:hover:bg-blush-900/50"
            >
              {overdueTasks.length}
            </button>
          )}
        </div>
      )}

      {/* One merged card: today's agenda on top, collapsible urgent alerts
          below. The frame is the shared card chrome; urgency reads through
          the heading and count, not a tinted panel or the border. */}
      <div className={`card p-4 ${collapsed ? "lg:hidden" : ""}`}>
        {/* HEADER: the date block opens the calendar; the collapse control
            sits on the card itself (desktop only). */}
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/app/planner/calendar"
            className="-m-1.5 block min-w-0 flex-1 rounded-lg p-1.5 transition-colors hover:bg-moss-50 dark:hover:bg-moss-900/20"
          >
            <SectionHeader icon={CalendarDays} label={t("planner_home.rail_today_title")} />
            <p className="-mt-1 text-xs text-umber-400">{todayLabel}</p>
            {nameDay && (
              <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">
                <span className="text-umber-400">{t("planner_home.rail_today_nameday")}:</span>{" "}
                {nameDay}
              </p>
            )}
          </Link>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={true}
            aria-label={t("planner_home.rail_collapse")}
            title={t("planner_home.rail_collapse")}
            className="-mr-1 -mt-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-umber-400 transition-colors hover:bg-moss-50 hover:text-moss-700 dark:text-umber-500 dark:hover:bg-umber-800 dark:hover:text-moss-300 lg:inline-flex"
          >
            <PanelRightClose size={15} aria-hidden="true" />
          </button>
        </div>

        {/* TODAY'S TASKS: each row completes in place or jumps to the list */}
        {visibleToday.length === 0 ? (
          <p className="mt-3 text-xs italic text-umber-400">{t("planner_home.rail_today_empty")}</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {visibleToday.map((tk) => (
              <RailTaskRow
                key={tk.task_id}
                task={tk}
                clientName={clientDisplayName(clients, tk.couple_id)}
                onMarkDone={onMarkDone}
                doneLabel={doneLabel}
                tabbable={true}
              />
            ))}
          </ul>
        )}
        {extraToday > 0 && (
          <Link
            to="/app/planner/calendar?mode=tasks"
            className="mt-1.5 block text-xs text-umber-500 underline-offset-2 hover:underline dark:text-umber-400"
          >
            {t("planner_home.rail_more_today").replace("{{n}}", String(extraToday))}
          </Link>
        )}

        {/* URGENT ALERTS: collapsible neutral block; rows open the tasks list */}
        <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-800">
          {overdueTasks.length === 0 ? (
            <>
              <SectionHeader icon={Sparkles} label={t("planner_home.rail_all_good")} />
              <div className="ml-1 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="shrink-0 text-moss-600" aria-hidden="true" />
                <span className="text-xs text-moss-700 dark:text-moss-400">
                  {t("planner_home.rail_all_good_body")}
                </span>
              </div>
            </>
          ) : (
            /* Urgent block: no tinted background, neutral dark text. The
               alert reads through the heading + count, not a colored zone;
               the list collapses with an animated height
               (grid-rows 0fr↔1fr trick, pure CSS). */
            <div>
              <button
                type="button"
                onClick={() => setUrgentOpen((o) => !o)}
                aria-expanded={urgentOpen}
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-moss-50 dark:hover:bg-moss-900/20"
              >
                <AlertTriangle
                  size={13}
                  className="shrink-0 text-umber-500 dark:text-umber-400"
                  aria-hidden="true"
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
                  {t("planner_home.rail_urgent_title")}
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-umber-500 dark:text-umber-400">
                  {overdueTasks.length}
                </span>
                <ChevronDown
                  size={14}
                  className={`ml-auto shrink-0 text-umber-400 transition-transform duration-300 ${
                    urgentOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  urgentOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <ul className="mt-2 space-y-1 px-0.5">
                    {visibleOverdue.map((tk) => (
                      <RailTaskRow
                        key={tk.task_id}
                        task={tk}
                        clientName={clientDisplayName(clients, tk.couple_id)}
                        overdueLabel={overdueLabelFor(tk.due_date)}
                        onMarkDone={onMarkDone}
                        doneLabel={doneLabel}
                        tabbable={urgentOpen}
                      />
                    ))}
                  </ul>
                  {extraOverdue > 0 && (
                    <Link
                      to="/app/planner/calendar?mode=tasks"
                      tabIndex={urgentOpen ? undefined : -1}
                      className="mt-1.5 block px-1.5 pb-1 text-xs text-umber-500 underline-offset-2 hover:underline dark:text-umber-400"
                    >
                      {t("planner_home.rail_more_overdue").replace("{{n}}", String(extraOverdue))}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
