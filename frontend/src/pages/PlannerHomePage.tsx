import { CheckCircle2, ChevronDown, ChevronUp, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type {
  PlannerClientView,
  PlannerInviteView,
  PlannerStats,
  PlannerTaskRow,
} from "@shared/types";
import { plannerApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { formatDate } from "../lib/format";
import { AddClientCard } from "./planner/AddClientCard";
import { PlannerDashPipeline } from "./planner/PlannerDashPipeline";
import { PlannerDashRightRail } from "./planner/PlannerDashRightRail";

// ─── KPI Tiles ────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  unit,
  progress,
  accent,
  to,
}: {
  label: string;
  value: string | number;
  unit: string;
  progress?: { done: number; total: number } | null;
  accent?: "red" | "amber" | "green";
  to?: string;
}) {
  const isRed = accent === "red" && Number(value) > 0;
  const isAmber = accent === "amber" && Number(value) > 0;
  const isGreen = accent === "green";
  const inner = (
    <>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </div>
      <div className="mt-2 text-center">
        <div
          className={`text-2xl font-bold leading-none tabular-nums ${
            isRed
              ? "text-red-500 dark:text-red-400"
              : isAmber
                ? "text-amber-500 dark:text-amber-400"
                : isGreen
                  ? "text-moss-700 dark:text-moss-300"
                  : "text-ink-900 dark:text-paper-50"
          }`}
        >
          {value}
        </div>
        <div className="mt-1 text-xs font-semibold text-ink-500 dark:text-umber-300">{unit}</div>
        {progress && progress.total > 0 && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
            <div
              className="h-full rounded-full bg-moss-500 transition-all dark:bg-moss-400"
              style={{
                width: `${Math.max(2, Math.round((progress.done / progress.total) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="card block p-4 transition-colors hover:border-moss-300 hover:bg-moss-50 dark:hover:border-moss-700 dark:hover:bg-moss-900/20"
      >
        {inner}
      </Link>
    );
  }
  return <div className="card p-4">{inner}</div>;
}

// ─── Task overview chart ──────────────────────────────────────────────────────

const MAX_CHART_VISIBLE = 5;

function TaskOverviewChart({ stats }: { stats: PlannerStats }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  const clients = stats.per_client;
  const visible = expanded ? clients : clients.slice(0, MAX_CHART_VISIBLE);
  const hasMore = clients.length > MAX_CHART_VISIBLE;

  if (clients.length === 0) return null;

  return (
    <section className="mb-0">
      <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
        {t("planner_home.chart_heading")}
      </h2>
      <div className="rounded-xl border border-paper-200 bg-white px-5 py-4 dark:border-umber-800 dark:bg-umber-900">
        <div className="space-y-3">
          {visible.map((c) => {
            const total = c.task_total;
            if (total === 0) {
              return (
                <div key={c.couple_id} className="flex items-center gap-3">
                  <span
                    className="w-20 min-w-0 shrink truncate text-xs text-umber-500 dark:text-umber-400 sm:w-32"
                    title={c.display_name}
                  >
                    {c.display_name}
                  </span>
                  <div className="flex-1" />
                  <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-umber-400 dark:text-umber-500">
                    0
                  </span>
                </div>
              );
            }
            const donePct = Math.round((c.task_done / total) * 100);
            const overduePct = Math.round((c.task_overdue / total) * 100);
            const weekPct = Math.round((c.due_this_week / total) * 100);
            const remaining = total - c.task_done - c.task_overdue - c.due_this_week;
            const remainingPct = Math.max(0, 100 - donePct - overduePct - weekPct);
            return (
              <div key={c.couple_id} className="flex items-center gap-3">
                <span
                  className="w-20 min-w-0 shrink truncate text-xs font-medium text-ink-700 dark:text-paper-100 sm:w-32"
                  title={c.display_name}
                >
                  {c.display_name}
                </span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                  {donePct > 0 && (
                    <div
                      className="h-full bg-sage-500"
                      style={{ width: `${donePct}%` }}
                      title={`${t("planner_home.chart_done_label")}: ${c.task_done}`}
                    />
                  )}
                  {overduePct > 0 && (
                    <div
                      className="h-full bg-red-400"
                      style={{ width: `${overduePct}%` }}
                      title={`${t("planner_home.chart_overdue_label")}: ${c.task_overdue}`}
                    />
                  )}
                  {weekPct > 0 && (
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${weekPct}%` }}
                      title={`${t("planner_home.chart_week_label")}: ${c.due_this_week}`}
                    />
                  )}
                  {remainingPct > 0 && remaining > 0 && (
                    <div
                      className="h-full bg-paper-300 dark:bg-umber-600"
                      style={{ width: `${remainingPct}%` }}
                      title={`${t("planner_home.chart_remaining_label")}: ${remaining}`}
                    />
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-umber-500 dark:text-umber-400">
                  {c.task_done}/{total}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-3 border-t border-paper-100 pt-3 dark:border-umber-800">
          <span className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sage-500" />
            {t("planner_home.chart_done_label")}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
            {t("planner_home.chart_overdue_label")}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />
            {t("planner_home.chart_week_label")}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-paper-300 dark:bg-umber-600" />
            {t("planner_home.chart_remaining_label")}
          </span>
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 flex items-center gap-1 text-xs text-umber-500 hover:text-ink-700 dark:text-umber-400 dark:hover:text-paper-100"
          >
            {expanded ? (
              <>
                <ChevronUp size={13} />
                {t("planner_home.chart_show_less")}
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                {t("planner_home.chart_show_more").replace("{{count}}", String(clients.length))}
              </>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Task filter panel ────────────────────────────────────────────────────────

type TimingFilter = "all" | "week" | "overdue";
type PriorityFilter = "all" | "high" | "medium";

interface TaskFilters {
  clientId: number | null;
  priority: PriorityFilter;
  timing: TimingFilter;
}

function TaskFilterPanel({
  clients,
  filters,
  onChange,
}: {
  clients: PlannerClientView[];
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
}) {
  const { t } = useT();

  const pillBase =
    "rounded-full border border-paper-300 px-3 py-1 text-xs transition-colors dark:border-umber-700";
  const pillActive =
    "bg-ink-900 text-paper-50 border-ink-900 dark:bg-paper-100 dark:text-umber-900 dark:border-paper-100";
  const pillInactive =
    "text-ink-700 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800";

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${pillBase} ${filters.clientId === null ? pillActive : pillInactive}`}
          onClick={() => onChange({ ...filters, clientId: null })}
        >
          {t("planner_home.filter_all_clients")}
        </button>
        {clients.map((c) => (
          <button
            key={c.couple_id}
            type="button"
            className={`${pillBase} ${filters.clientId === c.couple_id ? pillActive : pillInactive}`}
            onClick={() =>
              onChange({
                ...filters,
                clientId: filters.clientId === c.couple_id ? null : c.couple_id,
              })
            }
          >
            {c.display_name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "high", "medium"] as PriorityFilter[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`${pillBase} ${filters.priority === p ? pillActive : pillInactive}`}
            onClick={() => onChange({ ...filters, priority: p })}
          >
            {t(
              p === "all"
                ? "planner_home.filter_priority_all"
                : p === "high"
                  ? "planner_home.filter_priority_high"
                  : "planner_home.filter_priority_medium",
            )}
          </button>
        ))}

        <span className="border-l border-paper-200 dark:border-umber-700" />

        {(["all", "week", "overdue"] as TimingFilter[]).map((tm) => (
          <button
            key={tm}
            type="button"
            className={`${pillBase} ${filters.timing === tm ? pillActive : pillInactive}`}
            onClick={() => onChange({ ...filters, timing: tm })}
          >
            {t(
              tm === "all"
                ? "planner_home.filter_timing_all"
                : tm === "week"
                  ? "planner_home.filter_timing_week"
                  : "planner_home.filter_timing_overdue",
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── UpcomingTasks (grouped by time horizon) ─────────────────────────────────

function applyTaskFilters(tasks: PlannerTaskRow[], filters: TaskFilters): PlannerTaskRow[] {
  let result = tasks;

  if (filters.clientId !== null) {
    result = result.filter((t) => t.couple_id === filters.clientId);
  }

  if (filters.priority === "high") {
    result = result.filter((t) => t.priority === 2);
  } else if (filters.priority === "medium") {
    result = result.filter((t) => t.priority === 1);
  }

  if (filters.timing === "week" || filters.timing === "overdue") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    result = result.filter((task) => {
      const due = new Date(task.due_date);
      due.setHours(0, 0, 0, 0);
      if (filters.timing === "overdue") return due < today;
      return due >= today && due <= weekEnd;
    });
  }

  return result;
}

function UpcomingTasks({
  tasks,
  filters,
  clients,
  showFilters,
}: {
  tasks: PlannerTaskRow[];
  filters: TaskFilters;
  clients: PlannerClientView[];
  showFilters: boolean;
}) {
  const { t, locale } = useT();

  const todayStr = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const filtered = applyTaskFilters(tasks, filters);

  const todayTasks = filtered.filter((tk) => tk.due_date === todayStr);
  const weekTasks = filtered.filter((tk) => tk.due_date > todayStr && tk.due_date <= weekEndStr);
  const laterTasks = filtered.filter((tk) => tk.due_date > weekEndStr);

  const priorityDot = (p: number) => {
    if (p === 2)
      return <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />;
    if (p === 1)
      return (
        <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      );
    return null;
  };

  const renderGroup = (groupTasks: PlannerTaskRow[]) => {
    const grouped = new Map<number, { display_name: string; tasks: PlannerTaskRow[] }>();
    for (const task of groupTasks) {
      if (!grouped.has(task.couple_id)) {
        grouped.set(task.couple_id, { display_name: task.display_name, tasks: [] });
      }
      grouped.get(task.couple_id)!.tasks.push(task);
    }
    return [...grouped.entries()].map(([coupleId, group]) => (
      <div key={coupleId}>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-umber-500 dark:text-umber-400">
          {group.display_name}
        </h4>
        <ul className="space-y-1.5">
          {group.tasks.map((task) => (
            <li key={task.task_id} className="flex items-start gap-2">
              {priorityDot(task.priority)}
              <span className="min-w-0 flex-1 text-sm text-ink-800 dark:text-paper-100">
                {task.title}
              </span>
              <span className="shrink-0 rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-200">
                {formatDate(task.due_date, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ));
  };

  if (filtered.length === 0) {
    const hasAnyTasks = tasks.length > 0;
    return (
      <p className="text-sm text-umber-500 dark:text-umber-400">
        {hasAnyTasks
          ? t("planner_home.upcoming_empty_filtered")
          : t("planner_home.upcoming_empty_encouraging")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {todayTasks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-red-500 dark:text-red-400">
            {t("planner_home.rail_today_title")}
          </h3>
          <div className="space-y-4">{renderGroup(todayTasks)}</div>
        </div>
      )}
      {weekTasks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-amber-600 dark:text-amber-400">
            {t("planner_home.filter_timing_week")}
          </h3>
          <div className="space-y-4">{renderGroup(weekTasks)}</div>
        </div>
      )}
      {laterTasks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-umber-600 dark:text-umber-300">
            {t("planner_home.filter_timing_all")}
          </h3>
          <div className="space-y-4">{renderGroup(laterTasks)}</div>
        </div>
      )}
    </div>
  );
}

// ─── GettingStartedChecklist ──────────────────────────────────────────────────

const CHECKLIST_DISMISSED_KEY = "weddly.planner_checklist_dismissed";

interface ChecklistStep {
  key: string;
  label: string;
  done: boolean;
  to?: string;
  onClick?: () => void;
  cta: string;
}

function GettingStartedChecklist({
  steps,
  onDismiss,
}: {
  steps: ChecklistStep[];
  onDismiss: () => void;
}) {
  const { t } = useT();
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
            {t("planner_home.checklist_title")}
          </h2>
          <span className="rounded-full bg-paper-200 px-2 py-0.5 text-xs font-medium text-umber-600 dark:bg-umber-700 dark:text-umber-200">
            {t("planner_home.checklist_progress")
              .replace("{{done}}", String(doneCount))
              .replace("{{total}}", String(steps.length))}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-umber-400 underline-offset-2 hover:text-umber-700 hover:underline dark:text-umber-500 dark:hover:text-paper-200"
        >
          {t("planner_home.checklist_dismiss")}
        </button>
      </div>
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3 rounded-lg px-1 py-2">
            {step.done ? (
              <CheckCircle2 size={18} className="shrink-0 text-moss-600 dark:text-moss-400" />
            ) : (
              <Circle size={18} className="shrink-0 text-umber-300 dark:text-umber-600" />
            )}
            <span
              className={`flex-1 text-sm ${
                step.done
                  ? "text-umber-400 dark:text-umber-500"
                  : "font-medium text-umber-800 dark:text-paper-100"
              }`}
            >
              {step.label}
            </span>
            {step.done ? (
              <span className="shrink-0 text-xs font-medium text-moss-600 dark:text-moss-400">
                {t("planner_home.checklist_step_done")}
              </span>
            ) : step.to ? (
              <Link to={step.to} className="btn-outline btn-sm shrink-0">
                {step.cta}
              </Link>
            ) : (
              <button type="button" onClick={step.onClick} className="btn-outline btn-sm shrink-0">
                {step.cta}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── PlannerHomePage ──────────────────────────────────────────────────────────

export default function PlannerHomePage() {
  const { user } = useAuth();
  const { t, locale } = useT();
  useDocumentMeta("planner_home.meta_title", "planner_home.meta_description");

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [tasks, setTasks] = useState<PlannerTaskRow[]>([]);
  const [invites, setInvites] = useState<PlannerInviteView[]>([]);
  const [stats, setStats] = useState<PlannerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({
    clientId: null,
    priority: "all",
    timing: "all",
  });
  const [showAddClient, setShowAddClient] = useState(false);
  const [showTaskFilters, setShowTaskFilters] = useState(false);
  const [hasThreads, setHasThreads] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(true);

  const refreshRef = useRef(false);

  useEffect(() => {
    try {
      setChecklistDismissed(localStorage.getItem(CHECKLIST_DISMISSED_KEY) === "1");
    } catch {
      setChecklistDismissed(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      plannerApi.listClients(),
      plannerApi.listTasks(),
      plannerApi.listInvites(),
      plannerApi.stats(),
      plannerApi.listInbox(),
    ])
      .then(([cr, tr, ir, sr, mr]) => {
        setClients(cr.clients);
        setTasks(tr.tasks);
        setInvites(ir.invites);
        setStats(sr.stats);
        setHasThreads(mr.threads.length > 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function dismissChecklist() {
    setChecklistDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "1");
    } catch {
      /* best-effort */
    }
  }

  if (!loading && stats !== null && !stats.onboarding_done) {
    return <Navigate to="/app/planner/onboarding" replace />;
  }

  async function handleAcceptInvite(coupleId: number) {
    try {
      await plannerApi.acceptInvite(coupleId);
      const [cr, ir, sr] = await Promise.all([
        plannerApi.listClients(),
        plannerApi.listInvites(),
        plannerApi.stats(),
      ]);
      setClients(cr.clients);
      setInvites(ir.invites);
      setStats(sr.stats);
    } catch {}
  }

  async function handleDeclineInvite(coupleId: number) {
    try {
      await plannerApi.declineInvite(coupleId);
      setInvites((prev) => prev.filter((i) => i.couple_id !== coupleId));
    } catch {}
  }

  async function handleAddClientSuccess() {
    try {
      const [cr, tr, sr] = await Promise.all([
        plannerApi.listClients(),
        plannerApi.listTasks(),
        plannerApi.stats(),
      ]);
      setClients(cr.clients);
      setTasks(tr.tasks);
      setStats(sr.stats);
      setShowAddClient(false);
    } catch {}
  }

  const firstName = user?.full_name.split(" ")[0] ?? "";
  const todayLabel = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const checklistSteps: ChecklistStep[] = [
    {
      key: "profile",
      label: t("planner_home.checklist_step_profile"),
      done: stats?.onboarding_done ?? false,
      to: "/app/planner/settings/account",
      cta: t("planner_home.checklist_cta_profile"),
    },
    {
      key: "client",
      label: t("planner_home.checklist_step_client"),
      done: clients.length > 0,
      onClick: () => setShowAddClient(true),
      cta: t("planner_home.checklist_cta_client"),
    },
    {
      key: "message",
      label: t("planner_home.checklist_step_message"),
      done: hasThreads,
      to: "/app/planner/messages",
      cta: t("planner_home.checklist_cta_message"),
    },
  ];
  const allChecklistDone = checklistSteps.every((s) => s.done);
  const showChecklist = !loading && !checklistDismissed && !allChecklistDone;

  return (
    <main className="py-2 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">
      {/* LEFT COLUMN */}
      <div className="min-w-0 space-y-6">
        {/* Briefing header */}
        <div>
          <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("planner_nav.greeting").replace("{{name}}", firstName)}
          </h1>
          <p className="mt-1 text-sm capitalize text-umber-500 dark:text-umber-400">{todayLabel}</p>
        </div>

        {showChecklist && (
          <GettingStartedChecklist steps={checklistSteps} onDismiss={dismissChecklist} />
        )}

        {/* KPI strip */}
        {stats && (
          <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiTile
              label={t("planner_home.kpi_overdue")}
              value={stats.overdue_tasks}
              unit={t("planner_home.kpi_overdue_unit")}
              accent={stats.overdue_tasks > 0 ? "red" : undefined}
              to="/app/planner/stats"
            />
            <KpiTile
              label={t("planner_home.kpi_due_this_week")}
              value={stats.due_this_week}
              unit={t("planner_home.kpi_due_week_unit")}
              accent={stats.due_this_week > 0 ? "amber" : undefined}
              to="/app/planner/calendar"
            />
            <KpiTile
              label={t("planner_home.kpi_total_tasks")}
              value={stats.done_tasks}
              unit={t("planner_home.kpi_tasks_unit")}
              accent="green"
              progress={
                stats.total_tasks > 0 ? { done: stats.done_tasks, total: stats.total_tasks } : null
              }
              to="/app/planner/stats"
            />
            <KpiTile
              label={t("planner_home.kpi_active_clients")}
              value={stats.active_clients}
              unit={t("planner_home.kpi_clients_unit")}
              progress={
                stats.max_clients > 0
                  ? { done: stats.active_clients, total: stats.max_clients }
                  : null
              }
              to="/app/planner/clients"
            />
            </div>
            <p className="mt-2 text-xs text-umber-500 dark:text-umber-400">
              {t("planner_home.kpi_caption")}
            </p>
          </div>
        )}

        {/* Pending invites from couples */}
        {!loading && invites.length > 0 && (
          <section>
            <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
              {t("planner_home.invites_heading")}
            </h2>
            <div className="space-y-3">
              {invites.map((inv) => (
                <div
                  key={inv.couple_id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10"
                >
                  <div className="min-w-0">
                    <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                      {inv.display_name}
                    </p>
                    <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                      {inv.wedding_date
                        ? formatDate(inv.wedding_date, "hu")
                        : t("planner_home.client_wedding_date_none")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAcceptInvite(inv.couple_id)}
                      className="btn-primary btn-sm"
                    >
                      {t("planner_home.invite_accept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeclineInvite(inv.couple_id)}
                      className="btn-outline btn-sm"
                    >
                      {t("planner_home.invite_decline")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Inline add-client card */}
        {showAddClient && (
          <AddClientCard
            onClose={() => setShowAddClient(false)}
            onSuccess={() => void handleAddClientSuccess()}
          />
        )}

        {/* Pipeline */}
        <PlannerDashPipeline
          clients={clients}
          onAddClientClick={() => setShowAddClient(true)}
          inviteCount={invites.length}
        />

        {/* Task overview chart */}
        {!loading && stats && stats.per_client.length > 0 && <TaskOverviewChart stats={stats} />}

        {/* Upcoming tasks */}
        {!loading && clients.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
                {t("planner_home.upcoming_heading")}
              </h2>
              {tasks.length > 0 && (
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => setShowTaskFilters((v) => !v)}
                >
                  {t("planner_home.filter_all_clients")}
                </button>
              )}
            </div>
            {tasks.length > 0 && showTaskFilters && (
              <TaskFilterPanel clients={clients} filters={taskFilters} onChange={setTaskFilters} />
            )}
            <div className="rounded-xl border border-paper-200 bg-white px-5 py-5 dark:border-umber-800 dark:bg-umber-900">
              <UpcomingTasks
                tasks={tasks}
                filters={taskFilters}
                clients={clients}
                showFilters={showTaskFilters}
              />
            </div>
          </section>
        )}
      </div>

      {/* RIGHT COLUMN */}
      <div className="mt-6 lg:mt-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <PlannerDashRightRail
          tasks={tasks}
          clients={clients}
          onAddClientClick={() => setShowAddClient(true)}
        />
      </div>
    </main>
  );
}
