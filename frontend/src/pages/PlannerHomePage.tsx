import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardCheck,
  ListTodo,
  type LucideIcon,
  MailQuestion,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import type {
  PlannerClientView,
  PlannerInviteView,
  PlannerStats,
  PlannerTaskRow,
} from "@shared/types";
import { useConfirm } from "../components/ui";
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
  icon: Icon,
  progress,
  accent,
  to,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  progress?: { done: number; total: number } | null;
  accent?: "red" | "amber" | "green";
  to?: string;
}) {
  const isRed = accent === "red" && Number(value) > 0;
  const isAmber = accent === "amber" && Number(value) > 0;
  const isGreen = accent === "green";
  // The icon carries the status colour as a bare outline; the soft chip
  // background only appears while the cursor is over the tile (group-hover),
  // so at rest the row stays quiet.
  const chip = isRed
    ? "text-red-500 group-hover:bg-red-50 dark:text-red-400 dark:group-hover:bg-red-900/25"
    : isAmber
      ? "text-amber-500 group-hover:bg-amber-50 dark:text-amber-400 dark:group-hover:bg-amber-900/25"
      : "text-moss-600 group-hover:bg-moss-50 dark:text-moss-300 dark:group-hover:bg-moss-900/40";
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {label}
        </div>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${chip}`}
          title={label}
        >
          <Icon size={14} aria-hidden="true" />
        </span>
      </div>
      <div
        className={`mt-1 text-center text-2xl font-bold leading-none tabular-nums ${
          isRed
            ? "text-red-500 dark:text-red-400"
            : isAmber
              ? "text-amber-500 dark:text-amber-400"
              : isGreen
                ? "text-moss-600 dark:text-moss-300"
                : "text-ink-900 dark:text-paper-50"
        }`}
      >
        {value}
      </div>
      {progress && progress.total > 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
          <div
            className="h-full rounded-full bg-moss-600 transition-all dark:bg-moss-400"
            style={{
              width: `${Math.max(2, Math.round((progress.done / progress.total) * 100))}%`,
            }}
          />
        </div>
      )}
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        title={label}
        className="card group block p-4 transition hover:-translate-y-0.5 hover:border-moss-400 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-moss-600 dark:hover:border-moss-500 dark:focus-visible:ring-moss-400"
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

  // Aggregate counts so the legend answers "how many" without reading bars.
  // "Due this week" is a calendar concern; the dashboard bar only splits
  // done / overdue / remaining so red stays the sole warning colour.
  const totals = clients.reduce(
    (acc, c) => ({
      done: acc.done + c.task_done,
      overdue: acc.overdue + c.task_overdue,
      total: acc.total + c.task_total,
    }),
    { done: 0, overdue: 0, total: 0 },
  );
  const totalRemaining = Math.max(0, totals.total - totals.done - totals.overdue);

  return (
    <section className="mb-0">
      <h2 className="mb-4 flex items-center gap-2 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
        <BarChart3
          size={16}
          className="shrink-0 text-moss-600 dark:text-moss-400"
          aria-hidden="true"
        />
        {t("planner_home.chart_heading")}
      </h2>
      <div className="card px-5 py-4">
        <div className="space-y-3">
          {visible.map((c) => {
            const total = c.task_total;
            const rowCls =
              "flex items-center gap-3 -mx-2 rounded-lg px-2 py-0.5 transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/60";
            if (total === 0) {
              return (
                <Link
                  key={c.couple_id}
                  to={`/app/planner/clients/${c.couple_id}`}
                  className={rowCls}
                >
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
                </Link>
              );
            }
            const donePct = Math.round((c.task_done / total) * 100);
            const overduePct = Math.round((c.task_overdue / total) * 100);
            const remaining = total - c.task_done - c.task_overdue;
            const remainingPct = Math.max(0, 100 - donePct - overduePct);
            return (
              <Link key={c.couple_id} to={`/app/planner/clients/${c.couple_id}`} className={rowCls}>
                <span
                  className="w-20 min-w-0 shrink truncate text-xs font-medium text-ink-700 dark:text-paper-100 sm:w-32"
                  title={c.display_name}
                >
                  {c.display_name}
                </span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                  {donePct > 0 && (
                    <div
                      className="h-full bg-moss-500"
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
              </Link>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-3 border-t border-paper-100 pt-3 dark:border-umber-800">
          <span className="flex items-center gap-1.5 text-[10px] tabular-nums text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-moss-500" />
            {t("planner_home.chart_done_label")} · {totals.done}
          </span>
          {totals.overdue > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] tabular-nums text-ink-500 dark:text-umber-400">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
              {t("planner_home.chart_overdue_label")} · {totals.overdue}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-[10px] tabular-nums text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-paper-300 dark:bg-umber-600" />
            {t("planner_home.chart_remaining_label")} · {totalRemaining}
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
    "bg-moss-700 text-paper-50 border-moss-700 dark:bg-moss-300 dark:text-moss-950 dark:border-moss-300";
  const pillInactive = "text-ink-700 hover:bg-moss-50 dark:text-paper-200 dark:hover:bg-umber-800";

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

  // Every row gets a dot so the list stays aligned; low priority is neutral.
  const priorityDot = (p: number) => {
    const color =
      p === 2 ? "bg-red-500" : p === 1 ? "bg-amber-400" : "bg-paper-300 dark:bg-umber-600";
    return (
      <span
        className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
        aria-hidden="true"
      />
    );
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
        {/* Uppercase + tracking already does the separator work; the colour
            stays neutral so headers don't add another text hue to the page. */}
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-400">
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
          <h3 className="mb-3 text-sm font-semibold text-ink-700 dark:text-paper-200">
            {t("planner_home.rail_today_title")}
          </h3>
          <div className="space-y-4">{renderGroup(todayTasks)}</div>
        </div>
      )}
      {weekTasks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink-700 dark:text-paper-200">
            {t("planner_home.filter_timing_week")}
          </h3>
          <div className="space-y-4">{renderGroup(weekTasks)}</div>
        </div>
      )}
      {laterTasks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink-700 dark:text-paper-200">
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
const RAIL_COLLAPSED_KEY = "weddly.planner_rail_collapsed";

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
  const confirm = useConfirm();
  useDocumentMeta("planner_home.meta_title", "planner_home.meta_description");

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [tasks, setTasks] = useState<PlannerTaskRow[]>([]);
  const [invites, setInvites] = useState<PlannerInviteView[]>([]);
  const [stats, setStats] = useState<PlannerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // "?timing=overdue|week" deep-links the task list pre-filtered (the stats
  // page's overdue KPI points here); the filter panel opens so the active
  // pill is visible.
  const [searchParams] = useSearchParams();
  const timingParam = searchParams.get("timing");
  const initialTiming: TimingFilter =
    timingParam === "week" || timingParam === "overdue" ? timingParam : "all";
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({
    clientId: null,
    priority: "all",
    timing: initialTiming,
  });
  const [showAddClient, setShowAddClient] = useState(false);
  const [showTaskFilters, setShowTaskFilters] = useState(initialTiming !== "all");
  const [hasThreads, setHasThreads] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  // Desktop-only: tucks the agenda rail away to the right edge; the grid
  // column animates between the full 320px and a slim 2.75rem handle.
  const [railCollapsed, setRailCollapsed] = useState(false);

  const refreshRef = useRef(false);

  useEffect(() => {
    try {
      setChecklistDismissed(localStorage.getItem(CHECKLIST_DISMISSED_KEY) === "1");
      setRailCollapsed(localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {
      setChecklistDismissed(false);
    }
  }, []);

  function toggleRail() {
    setRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      return next;
    });
  }

  // allSettled so one failing call degrades that section only instead of
  // silently blanking the whole dashboard; any failure surfaces a retry banner.
  const load = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    void Promise.allSettled([
      plannerApi.listClients(),
      plannerApi.listTasks(),
      plannerApi.listInvites(),
      plannerApi.stats(),
      plannerApi.listInbox(),
    ])
      .then(([cr, tr, ir, sr, mr]) => {
        if (cr.status === "fulfilled") setClients(cr.value.clients);
        if (tr.status === "fulfilled") setTasks(tr.value.tasks);
        if (ir.status === "fulfilled") setInvites(ir.value.invites);
        if (sr.status === "fulfilled") setStats(sr.value.stats);
        if (mr.status === "fulfilled") setHasThreads(mr.value.threads.length > 0);
        if ([cr, tr, ir, sr, mr].some((r) => r.status === "rejected")) setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  async function handleDeclineInvite(inv: PlannerInviteView) {
    const ok = await confirm({
      title: t("planner_home.invite_decline_confirm_title"),
      body: t("planner_home.invite_decline_confirm_body", { name: inv.display_name }),
      confirmLabel: t("planner_home.invite_decline"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await plannerApi.declineInvite(inv.couple_id);
      setInvites((prev) => prev.filter((i) => i.couple_id !== inv.couple_id));
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

  const today = new Date().toISOString().slice(0, 10);
  const railOverdueCount = tasks.filter((tk) => tk.due_date < today && !tk.done).length;

  return (
    <main
      className={`py-2 transition-[grid-template-columns] duration-300 ease-out lg:grid lg:gap-6 ${
        railCollapsed ? "lg:grid-cols-[1fr_2.75rem]" : "lg:grid-cols-[1fr_320px]"
      }`}
    >
      {/* LEFT COLUMN */}
      <div className="min-w-0 space-y-6">
        {/* Briefing header */}
        <div>
          <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("planner_nav.greeting").replace("{{name}}", firstName)}
          </h1>
          <p className="mt-1 text-sm capitalize text-umber-500 dark:text-umber-400">{todayLabel}</p>
        </div>

        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
          >
            <span>{t("planner_home.load_error")}</span>
            <button type="button" onClick={load} className="btn-outline btn-sm shrink-0">
              {t("planner_home.load_retry")}
            </button>
          </div>
        )}

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
                icon={AlertTriangle}
                accent={stats.overdue_tasks > 0 ? "red" : undefined}
                to="/app/planner/stats"
              />
              <KpiTile
                label={t("planner_home.kpi_due_this_week")}
                value={stats.due_this_week}
                icon={CalendarDays}
                accent={stats.due_this_week > 0 ? "amber" : undefined}
                to="/app/planner/calendar"
              />
              <KpiTile
                label={t("planner_home.kpi_total_tasks")}
                value={stats.done_tasks}
                icon={ClipboardCheck}
                accent="green"
                progress={
                  stats.total_tasks > 0
                    ? { done: stats.done_tasks, total: stats.total_tasks }
                    : null
                }
                to="/app/planner/stats"
              />
              <KpiTile
                label={t("planner_home.kpi_active_clients")}
                value={stats.active_clients}
                icon={Users}
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
            <h2 className="mb-4 flex items-center gap-2 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
              <MailQuestion
                size={16}
                className="shrink-0 text-moss-600 dark:text-moss-400"
                aria-hidden="true"
              />
              {t("planner_home.invites_heading")}
            </h2>
            <div className="space-y-3">
              {invites.map((inv) => (
                <div
                  key={inv.couple_id}
                  className="card group flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-amber-600 transition-colors group-hover:bg-amber-50 dark:text-amber-400 dark:group-hover:bg-amber-900/25"
                      title={t("planner_home.pipeline_pending")}
                    >
                      <MailQuestion size={16} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                        {inv.display_name}
                      </p>
                      <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                        {inv.wedding_date
                          ? formatDate(inv.wedding_date, locale)
                          : t("planner_home.client_wedding_date_none")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAcceptInvite(inv.couple_id)}
                      className="btn-moss btn-sm flex items-center gap-1.5"
                      title={t("planner_home.invite_accept")}
                    >
                      <Check size={14} aria-hidden="true" />
                      {t("planner_home.invite_accept")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeclineInvite(inv)}
                      className="btn-outline btn-sm flex items-center gap-1.5"
                      title={t("planner_home.invite_decline")}
                    >
                      <X size={14} aria-hidden="true" />
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
              <h2 className="flex items-center gap-2 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
                <ListTodo
                  size={16}
                  className="shrink-0 text-moss-600 dark:text-moss-400"
                  aria-hidden="true"
                />
                {t("planner_home.upcoming_heading")}
              </h2>
              {tasks.length > 0 && (
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                    showTaskFilters
                      ? "bg-moss-100 text-moss-800 dark:bg-moss-900/40 dark:text-moss-200"
                      : "text-umber-600 hover:bg-moss-50 hover:text-moss-800 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-moss-200"
                  }`}
                  aria-expanded={showTaskFilters}
                  aria-label={t("planner_home.filter_toggle")}
                  title={t("planner_home.filter_toggle")}
                  onClick={() => setShowTaskFilters((v) => !v)}
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {tasks.length > 0 && showTaskFilters && (
              <TaskFilterPanel clients={clients} filters={taskFilters} onChange={setTaskFilters} />
            )}
            <div className="card px-5 py-5">
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

      {/* RIGHT COLUMN — collapsible to the right edge on desktop */}
      <div className="mt-6 min-w-0 lg:mt-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <div className="mb-2 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={toggleRail}
            aria-expanded={!railCollapsed}
            aria-label={t(
              railCollapsed ? "planner_home.rail_expand" : "planner_home.rail_collapse",
            )}
            title={t(railCollapsed ? "planner_home.rail_expand" : "planner_home.rail_collapse")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-umber-500 transition-colors hover:bg-moss-50 hover:text-moss-800 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-moss-200"
          >
            {railCollapsed ? (
              <PanelRightOpen size={18} aria-hidden="true" />
            ) : (
              <PanelRightClose size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        {/* Collapsed handle keeps a pulse of the urgent count so tucking the
            rail away never hides an alert completely. Mobile always shows the
            full card — the collapse is a desktop-space concern. */}
        {railCollapsed && railOverdueCount > 0 && (
          <div className="hidden justify-end lg:flex">
            <span
              className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-semibold tabular-nums text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              title={t("planner_home.rail_urgent_title")}
            >
              {railOverdueCount}
            </span>
          </div>
        )}
        <div className={railCollapsed ? "lg:hidden" : ""}>
          <PlannerDashRightRail tasks={tasks} clients={clients} />
        </div>
      </div>
    </main>
  );
}
