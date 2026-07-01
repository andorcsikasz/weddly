import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  type LucideIcon,
  MessageSquare,
  Plus,
  Sparkles,
  UserPlus,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { useT } from "../../lib/i18n";
import { nameDayFor } from "../../lib/nameDays";

interface Props {
  tasks: PlannerTaskRow[];
  clients: PlannerClientView[];
  onAddClientClick: () => void;
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

export function PlannerDashRightRail({ tasks, clients, onAddClientClick }: Props) {
  const { t, locale } = useT();

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
      {/* SECTION A: TODAY'S AGENDA — opens the calendar */}
      <Link
        to="/app/planner/calendar"
        className="card block space-y-3 p-4 transition-colors hover:border-moss-300 hover:bg-moss-50 dark:hover:border-moss-700 dark:hover:bg-moss-900/20"
      >
        <div>
          <SectionHeader label={t("planner_home.rail_today_title")} />
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
          <p className="text-xs text-blush-600">
            {t("planner_home.rail_more_today").replace("{{n}}", String(extraToday))}
          </p>
        )}
      </Link>

      {/* SECTION B: URGENT ALERTS — opens the tasks list */}
      <Link
        to="/app/planner/calendar?mode=tasks"
        className={`block transition-colors ${
          visibleOverdue.length === 0
            ? "card p-4 hover:border-moss-300 hover:bg-moss-50 dark:hover:border-moss-700 dark:hover:bg-moss-900/20"
            : "rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
        }`}
      >
        <SectionHeader
          icon={visibleOverdue.length === 0 ? Sparkles : AlertTriangle}
          label={
            visibleOverdue.length === 0
              ? t("planner_home.rail_all_good")
              : t("planner_home.rail_urgent_title")
          }
        />

        {visibleOverdue.length === 0 ? (
          <div className="flex items-center gap-1.5 ml-1">
            <CheckCircle2 size={14} className="shrink-0 text-moss-600" aria-hidden="true" />
            <span className="text-xs text-moss-700 dark:text-moss-400">
              {t("planner_home.rail_all_good_body")}
            </span>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {visibleOverdue.map((tk) => (
                <li key={tk.task_id} className="flex items-start gap-2 min-w-0">
                  <AlertTriangle
                    size={12}
                    className={`mt-0.5 shrink-0 ${
                      tk.priority >= 2 ? "text-red-500" : "text-amber-500"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate text-sm text-ink-900 dark:text-paper-100">
                    {tk.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-umber-500 dark:text-umber-400">
                    {clientDisplayName(clients, tk.couple_id)}
                  </span>
                </li>
              ))}
            </ul>
            {extraOverdue > 0 && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                {t("planner_home.rail_more_overdue").replace("{{n}}", String(extraOverdue))}
              </p>
            )}
          </>
        )}
      </Link>

      {/* SECTION C: QUICK ACTIONS */}
      <div className="card p-4 space-y-2">
        <SectionHeader icon={Zap} label={t("planner_home.rail_actions_title")} />

        <button
          type="button"
          onClick={onAddClientClick}
          className="btn-outline w-full justify-start gap-2 text-sm"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t("planner_home.rail_action_add_client")}
        </button>

        <Link
          to="/app/planner/settings/account"
          className="btn-outline w-full justify-start gap-2 text-sm"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          {t("planner_home.rail_action_profile")}
        </Link>

        <Link to="/app/planner/messages" className="btn-outline w-full justify-start gap-2 text-sm">
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          {t("planner_home.rail_action_messages")}
        </Link>
      </div>
    </div>
  );
}
