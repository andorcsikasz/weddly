// Planner statistics - an at-a-glance command view of the whole book of
// business: KPIs, plan usage, and per-client task completion. Derived from the
// existing stats endpoint. Moss-accented, and everything that points at a
// client or another surface is clickable.

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MailQuestion,
  Users,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerStats } from "@shared/types";
import { InfoHint } from "../../components/InfoHint";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";

// Cards rest with a quiet neutral border. The dark-olive frame (border + a
// same-colour ring + soft tint) appears ONLY on the hovered/focused card, so
// nothing but the one under the cursor carries the strong green edge.
const STAT_FRAME = "border-paper-300 dark:border-umber-700";
const STAT_FRAME_HOVER =
  "transition hover:border-moss-600 hover:bg-moss-50 hover:ring-1 hover:ring-moss-600 focus-visible:border-moss-600 focus-visible:ring-1 focus-visible:ring-moss-600 dark:hover:border-moss-500 dark:hover:bg-moss-900/20 dark:hover:ring-moss-500 dark:focus-visible:border-moss-500 dark:focus-visible:ring-moss-500";

function StatTile({
  icon,
  label,
  value,
  unit,
  to,
  accent,
  help,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  to?: string;
  accent?: "moss" | "red";
  /** Optional clarifying tooltip tucked behind an "i" next to the label. */
  help?: string;
  /** Optional supplementary line shown under the value (e.g. context for a 0). */
  caption?: ReactNode;
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
        {help && (
          // Prevent the tooltip toggle from triggering an enclosing card link.
          // biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only cancels link nav; InfoHint owns focus/keys
          <span
            className="inline-flex"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <InfoHint text={help} className="-my-1 normal-case" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold leading-none tabular-nums ${valueClass}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-umber-400 dark:text-umber-500">{unit}</span>}
      </div>
      {caption && (
        <p className="mt-1 text-[11px] leading-snug text-umber-400 dark:text-umber-500">
          {caption}
        </p>
      )}
    </>
  );
  const base = `card p-3.5 ${STAT_FRAME}`;
  if (to) {
    return (
      <Link to={to} className={`${base} block ${STAT_FRAME_HOVER}`}>
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
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    plannerApi
      .stats()
      .then((r) => setStats(r.stats))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!stats) {
    // A failed fetch surfaces an alert + retry instead of pulsing forever.
    if (loadError) {
      return (
        <div className="py-2">
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
          >
            <span>{t("planner_stats.load_error")}</span>
            <button type="button" onClick={load} className="btn-outline btn-sm shrink-0">
              {t("planner_stats.load_retry")}
            </button>
          </div>
        </div>
      );
    }
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
  const planNearCap = planPct >= 75;
  const planBarClass =
    planPct >= 100
      ? "bg-red-500 dark:bg-red-400"
      : planNearCap
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-moss-500 dark:bg-moss-400";
  const clientsWithTasks = stats.per_client.filter((c) => c.task_total > 0);

  // Soonest future client wedding, used to give the "30 days" KPI context when
  // the count is 0 (derived from the existing payload - no extra fetch).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeddingTs = stats.per_client
    .map((c) => (c.wedding_date ? new Date(c.wedding_date).getTime() : Number.NaN))
    .filter((ts) => !Number.isNaN(ts) && ts >= today.getTime())
    .sort((a, b) => a - b)[0];
  const nextWeddingDays =
    nextWeddingTs === undefined ? null : Math.round((nextWeddingTs - today.getTime()) / 86_400_000);
  const upcomingCaption =
    stats.upcoming_weddings_30d > 0
      ? undefined
      : nextWeddingDays != null
        ? t("planner_stats.next_wedding", { days: nextWeddingDays })
        : t("planner_stats.no_upcoming");

  return (
    <div className="py-2">
      <div className="mb-4">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planner_stats.title")}
        </h1>
        <p className="mt-0.5 text-sm text-umber-600 dark:text-umber-300">
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
          caption={upcomingCaption}
        />
        <StatTile
          icon={<CheckCircle2 size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_completion")}
          value={`${completionPct}%`}
          accent="moss"
          help={t("planner_stats.completion_help")}
          to="/app/planner"
        />
        <StatTile
          icon={<AlertTriangle size={14} aria-hidden="true" />}
          label={t("planner_stats.kpi_overdue")}
          value={stats.overdue_tasks}
          accent={stats.overdue_tasks > 0 ? "red" : undefined}
          to="/app/planner?timing=overdue"
        />
      </div>

      {/* Plan usage + pending invites */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link
          to="/app/planner/billing"
          className={`card block p-4 sm:col-span-2 ${STAT_FRAME} ${STAT_FRAME_HOVER}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            {t("planner_stats.plan_title")}
          </p>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="font-grotesk text-xl font-semibold capitalize text-umber-900 dark:text-paper-50">
              {stats.plan}
            </span>
            <span className="text-sm text-umber-600 dark:text-umber-300">
              {t("planner_stats.plan_usage")
                .replace("{{used}}", String(stats.active_clients))
                .replace("{{max}}", String(stats.max_clients))}
            </span>
          </div>
          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
            <div
              className={`h-full rounded-full transition-all ${planBarClass}`}
              style={{ width: `${planPct}%` }}
            />
          </div>
          {planNearCap && (
            <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-moss-700 dark:text-moss-300">
              {t("planner_stats.upgrade_cta")}
              <ArrowRight size={13} aria-hidden="true" />
            </span>
          )}
        </Link>

        <Link
          to="/app/planner/clients"
          className={`card flex flex-col justify-center p-4 ${STAT_FRAME} ${STAT_FRAME_HOVER}`}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
            <MailQuestion
              size={13}
              className="text-moss-600 dark:text-moss-400"
              aria-hidden="true"
            />
            {t("planner_stats.pending_title")}
            {/* Prevent the tooltip toggle from following the card link. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only cancels link nav; InfoHint owns focus/keys */}
            <span
              className="inline-flex"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <InfoHint text={t("planner_stats.pending_help")} className="-my-1 normal-case" />
            </span>
          </div>
          <span className="mt-1.5 text-2xl font-bold tabular-nums text-umber-900 dark:text-paper-50">
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
      <section className="mt-6">
        <h2 className="mb-3 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
          {t("planner_stats.completion_title")}
        </h2>
        {clientsWithTasks.length === 0 ? (
          <p className="text-sm text-umber-400 dark:text-umber-500">{t("planner_stats.empty")}</p>
        ) : (
          <div className="space-y-1.5">
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
                  className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-2 dark:bg-umber-900 ${STAT_FRAME} ${STAT_FRAME_HOVER}`}
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
        <div className="mt-3 flex flex-wrap gap-3">
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
