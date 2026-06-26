import { AlertTriangle, CheckCircle2, MessageSquare, Plus, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { useT } from "../../lib/i18n";

const CLIENT_DOT_COLORS = [
  "bg-rose-200",
  "bg-emerald-200",
  "bg-sky-200",
  "bg-amber-200",
  "bg-violet-200",
  "bg-teal-200",
  "bg-orange-200",
  "bg-pink-200",
] as const;

interface Props {
  tasks: PlannerTaskRow[];
  clients: PlannerClientView[];
  onAddClientClick: () => void;
}

function clientDotClass(coupleId: number): string {
  return CLIENT_DOT_COLORS[coupleId % 8] ?? "bg-paper-200";
}

function clientDisplayName(clients: PlannerClientView[], coupleId: number): string {
  return clients.find((c) => c.couple_id === coupleId)?.display_name ?? "";
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="mb-2 text-xs uppercase tracking-wider text-umber-500">{label}</p>
  );
}

export function PlannerDashRightRail({ tasks, clients, onAddClientClick }: Props) {
  const { t, locale } = useT();

  const today = new Date().toISOString().slice(0, 10);

  const todayLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  const todayTasks = tasks.filter((tk) => tk.due_date === today);
  const visibleToday = todayTasks.slice(0, 5);
  const extraToday = todayTasks.length - visibleToday.length;

  const overdueTasks = tasks.filter((tk) => tk.due_date < today && !tk.done);
  const visibleOverdue = overdueTasks.slice(0, 4);
  const extraOverdue = overdueTasks.length - visibleOverdue.length;

  return (
    <div className="flex flex-col gap-4">
      {/* SECTION A: TODAY'S AGENDA */}
      <div className="card p-4 space-y-3">
        <div>
          <SectionHeader label={t("planner_home.rail_today_title")} />
          <p className="text-xs text-umber-400 -mt-1">{todayLabel}</p>
        </div>

        {visibleToday.length === 0 ? (
          <p className="text-xs text-umber-400 italic">{t("planner_home.rail_today_empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {visibleToday.map((tk) => (
              <li key={tk.task_id} className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${clientDotClass(tk.couple_id)}`}
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
          <p className="text-xs text-blush-600 cursor-default">
            {t("planner_home.rail_more_today").replace("{{n}}", String(extraToday))}
          </p>
        )}
      </div>

      {/* SECTION B: URGENT ALERTS */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <SectionHeader label={t("planner_home.rail_urgent_title")} />

        {visibleOverdue.length === 0 ? (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-sage-600" aria-hidden="true" />
            <span className="text-xs text-sage-600">{t("planner_home.rail_all_good")}</span>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {visibleOverdue.map((tk) => (
                <li key={tk.task_id} className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      tk.priority >= 2 ? "bg-red-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="flex-1 truncate text-sm text-ink-900 dark:text-paper-100">
                    {tk.title}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${clientDotClass(tk.couple_id)}`}
                  />
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
      </div>

      {/* SECTION C: QUICK ACTIONS */}
      <div className="card p-4 space-y-2">
        <SectionHeader label={t("planner_home.rail_actions_title")} />

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

        <Link
          to="/app/planner/messages"
          className="btn-outline w-full justify-start gap-2 text-sm"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          {t("planner_home.rail_action_messages")}
        </Link>
      </div>
    </div>
  );
}
