import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  type LucideIcon,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { useT } from "../../lib/i18n";
import { nameDayFor } from "../../lib/nameDays";

interface Props {
  tasks: PlannerTaskRow[];
  clients: PlannerClientView[];
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

export function PlannerDashRightRail({ tasks, clients }: Props) {
  const { t, locale } = useT();
  const [urgentOpen, setUrgentOpen] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  const now = new Date();

  const todayLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);

  // Hungarian name-day ("névnap") — a HU cultural tradition, so shown only in the HU locale.
  const nameDay = locale === "hu" ? nameDayFor(now) : null;

  const todayTasks = tasks.filter((tk) => tk.due_date === today);
  const visibleToday = todayTasks.slice(0, 5);
  const extraToday = todayTasks.length - visibleToday.length;

  const overdueTasks = tasks.filter((tk) => tk.due_date < today && !tk.done);
  const visibleOverdue = overdueTasks.slice(0, 4);
  const extraOverdue = overdueTasks.length - visibleOverdue.length;

  return (
    <div className="flex flex-col gap-4">
      {/* One merged card: today's agenda on top, collapsible urgent alerts below.
          The frame is the shared card chrome — no alert-coloured border, so the
          rail matches every other dashboard card; urgency lives in the amber
          icon + count inside. */}
      <div className="card p-4">
        {/* TODAY'S AGENDA — opens the calendar */}
        <Link
          to="/app/planner/calendar"
          className="-m-2 block space-y-3 rounded-lg p-2 transition-colors hover:bg-moss-50 dark:hover:bg-moss-900/20"
        >
          <div>
            <SectionHeader icon={CalendarDays} label={t("planner_home.rail_today_title")} />
            <p className="text-xs text-umber-400 -mt-1">{todayLabel}</p>
            {nameDay && (
              <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">
                <span className="text-umber-400">{t("planner_home.rail_today_nameday")}:</span>{" "}
                {nameDay}
              </p>
            )}
          </div>

          {visibleToday.length === 0 ? (
            <p className="text-xs text-umber-400 italic">{t("planner_home.rail_today_empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {visibleToday.map((tk) => (
                <li key={tk.task_id} className="flex items-start gap-2 min-w-0">
                  <Clock
                    size={12}
                    className="mt-0.5 shrink-0 text-umber-300 dark:text-umber-500"
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate text-sm text-ink-900 dark:text-paper-100">
                    {tk.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-umber-400">
                    {clientDisplayName(clients, tk.couple_id)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {extraToday > 0 && (
            <p className="text-xs text-umber-500 dark:text-umber-400">
              {t("planner_home.rail_more_today").replace("{{n}}", String(extraToday))}
            </p>
          )}
        </Link>

        {/* URGENT ALERTS — collapsible; rows open the tasks list */}
        <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-800">
          {visibleOverdue.length === 0 ? (
            <>
              <SectionHeader icon={Sparkles} label={t("planner_home.rail_all_good")} />
              <div className="flex items-center gap-1.5 ml-1">
                <CheckCircle2 size={14} className="shrink-0 text-moss-600" aria-hidden="true" />
                <span className="text-xs text-moss-700 dark:text-moss-400">
                  {t("planner_home.rail_all_good_body")}
                </span>
              </div>
            </>
          ) : (
            /* Amber-tinted panel so the urgent block reads as its own zone
               inside the card; the list collapses with an animated height
               (grid-rows 0fr↔1fr trick, pure CSS). */
            <div className="-mx-2 rounded-xl bg-amber-50/70 p-2 dark:bg-amber-900/15">
              <button
                type="button"
                onClick={() => setUrgentOpen((o) => !o)}
                aria-expanded={urgentOpen}
                className="flex w-full items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
              >
                <AlertTriangle
                  size={13}
                  className="shrink-0 text-amber-500 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
                  {t("planner_home.rail_urgent_title")}
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {overdueTasks.length}
                </span>
                <ChevronDown
                  size={14}
                  className={`ml-auto shrink-0 text-amber-500 transition-transform duration-300 dark:text-amber-400 ${
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
                  <div className="mt-2 px-1">
                    <ul className="space-y-1.5">
                      {visibleOverdue.map((tk) => (
                        <li key={tk.task_id}>
                          <Link
                            to="/app/planner/calendar?mode=tasks"
                            tabIndex={urgentOpen ? undefined : -1}
                            className="-mx-1 flex items-start gap-2 rounded-lg px-1 py-0.5 min-w-0 transition-colors hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
                          >
                            <span className="flex-1 truncate text-sm text-ink-900 dark:text-paper-100">
                              {tk.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-umber-500 dark:text-umber-400">
                              {clientDisplayName(clients, tk.couple_id)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {extraOverdue > 0 && (
                      <p className="mt-1.5 pb-1 text-xs text-umber-500 dark:text-umber-400">
                        {t("planner_home.rail_more_overdue").replace("{{n}}", String(extraOverdue))}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
