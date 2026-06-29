// Planner statistics — an at-a-glance command view of the whole book of
// business: KPIs, plan usage, and per-client task completion. Derived from the
// existing stats endpoint. Moss-accented, and everything that points at a
// client or another surface is clickable.

import { AlertTriangle, CalendarDays, CheckCircle2, MailQuestion, Users } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerStats } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";

function StatTile({
  icon,
  label,
  value,
  unit,
  to,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  to?: string;
  accent?: "moss" | "red";
}) {
  const valueClass =
    accent === "red"
      ? "text-red-500 dark:text-red-400"
      : accent === "moss"
        ? "text-moss-700 dark:text-moss-300"
        : "text-umber-900 dark:text-paper-50";
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-umber-500 dark:text-umber-400">
        <span className="text-moss-600 dark:text-moss-400">{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-3xl font-bold leading-none tabular-nums ${valueClass}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-umber-400 dark:text-umber-500">{unit}</span>}
      </div>
    </>
  );
  const base = "card p-4";
  if (to) {
    return (
      <Link
        to={to}
        className={`${base} block transition-colors hover:border-moss-300 hover:bg-moss-50 dark:hover:border-moss-700 dark:hover:bg-moss-900/20`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

export default function PlannerStatsPage() {
  const { t } = useT();
  useDocumentMeta("planner_stats.meta_title", "planner_stats.meta_description");
  const [stats, setStats] = useState<PlannerStats | null>(null);

  useEffect(() => {
    plannerApi
      .stats()
      .then((r) => setStats(r.stats))
      .catch(() => {});
  }, []);

  if (!stats) {
    return (
      <div className="py-2">
        <div className="h-64 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />
      </div>
    );
  }

  const completionPct =
    stats.total_tasks > 0 ? Math.round((stats.done_tasks / stats.total_tasks) * 100) : 0;
  const planPct =
    stats.max_clients > 0 ? Math.round((stats.active_clients / stats.max_clients) * 100) : 0;
  const clientsWithTasks = stats.per_client.filter((c) => c.task_total > 0);

  return (
    <div className="py-2">
      <div className="mb-6">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planner_stats.title")}
        </h1>
        <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
          {t("planner_stats.subtitle")}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={<Users size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_active_clients")}
          value={`${stats.active_clients}/${stats.max_clients}`}
          to="/app/planner/clients"
          accent="moss"
        />
        <StatTile
          icon={<CalendarDays size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_upcoming")}
          value={stats.upcoming_weddings_30d}
          to="/app/planner/calendar"
        />
        <StatTile
          icon={<CheckCircle2 size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_completion")}
          value={`${completionPct}%`}
          accent="moss"
        />
        <StatTile
          icon={<AlertTriangle size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_overdue")}
          value={stats.overdue_tasks}
          accent={stats.overdue_tasks > 0 ? "red" : undefined}
        />
      </div>

      {/* Plan usage + pending invites */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5 sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            {t("planner_stats.plan_title")}
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-grotesk text-xl font-semibold capitalize text-umber-900 dark:text-paper-50">
              {stats.plan}
            </span>
            <span className="text-sm text-umber-600 dark:text-umber-300">
              {t("planner_stats.plan_usage")
                .replace("{{used}}", String(stats.active_clients))
                .replace("{{max}}", String(stats.max_clients))}
            </span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
            <div
              className="h-full rounded-full bg-moss-500 transition-all dark:bg-moss-400"
              style={{ width: `${planPct}%` }}
            />
          </div>
        </div>

        <Link
          to="/app/planner/clients"
          className="card flex flex-col justify-center p-5 transition-colors hover:border-moss-300 hover:bg-moss-50 dark:hover:border-moss-700 dark:hover:bg-moss-900/20"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            <MailQuestion
              size={13}
              className="text-moss-600 dark:text-moss-400"
              aria-hidden="true"
            />
            {t("planner_stats.pending_title")}
          </div>
          <span className="mt-2 text-3xl font-bold tabular-nums text-umber-900 dark:text-paper-50">
            {stats.pending_invites}
          </span>
          {stats.pending_invites === 0 && (
            <span className="mt-1 text-xs text-umber-400 dark:text-umber-500">
              {t("planner_stats.pending_none")}
            </span>
          )}
        </Link>
      </div>

      {/* Per-client completion */}
      <section className="mt-8">
        <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
          {t("planner_stats.completion_title")}
        </h2>
        {clientsWithTasks.length === 0 ? (
          <p className="text-sm text-umber-400 dark:text-umber-500">{t("planner_stats.empty")}</p>
        ) : (
          <div className="space-y-2">
            {clientsWithTasks.map((c) => {
              const total = c.task_total;
              const donePct = Math.round((c.task_done / total) * 100);
              const overduePct = Math.round((c.task_overdue / total) * 100);
              const weekPct = Math.round((c.due_this_week / total) * 100);
              const remainingPct = Math.max(0, 100 - donePct - overduePct - weekPct);
              return (
                <Link
                  key={c.couple_id}
                  to={`/app/planner/clients/${c.couple_id}`}
                  className="flex items-center gap-3 rounded-xl border border-paper-200 bg-white px-4 py-3 transition-colors hover:border-moss-300 hover:bg-moss-50 dark:border-umber-800 dark:bg-umber-900 dark:hover:border-moss-700 dark:hover:bg-moss-900/20"
                  title={t("planner_stats.view_client")}
                >
                  <span className="w-32 shrink-0 truncate text-sm font-medium text-ink-700 dark:text-paper-100">
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
                    {weekPct > 0 && (
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${weekPct}%` }}
                        title={`${t("planner_home.chart_week_label")}: ${c.due_this_week}`}
                      />
                    )}
                    {remainingPct > 0 && (
                      <div
                        className="h-full bg-moss-100 dark:bg-umber-600"
                        style={{ width: `${remainingPct}%` }}
                      />
                    )}
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-umber-500 dark:text-umber-400">
                    {c.task_done}/{total}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-moss-500" />
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
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-moss-100 dark:bg-umber-600" />
            {t("planner_home.chart_remaining_label")}
          </span>
        </div>
      </section>
    </div>
  );
}
