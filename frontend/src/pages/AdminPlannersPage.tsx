// Admin planner management (KEZELÉS → Szervezők). A planner is a users row with
// user_type='planner'; this lists every planner with plan tier + active-client
// count and lets an admin change plan tier, suspend/reactivate, and delete.

import type { AdminPlannerView, PlannerPlan } from "@shared/types";
import { Ban, Check, Handshake, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminPlannerMgmtApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type Filter = "all" | "active" | "suspended";

const PLANS: PlannerPlan[] = ["starter", "pro", "premium"];

function fmtDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function PlannerCard({
  planner,
  onChanged,
}: {
  planner: AdminPlannerView;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const suspended = planner.status === "suspended";

  const statusPill: { tone: PillTone; Icon: typeof Handshake; label: string } = suspended
    ? { tone: "muted", Icon: Ban, label: t("admin.planners.status_suspended") }
    : { tone: "sage", Icon: Check, label: t("admin.planners.status_active") };

  async function run(fn: () => Promise<unknown>, successKey: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(successKey));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspend() {
    const ok = await confirm({
      title: t("admin.planners.suspend_confirm_title"),
      body: planner.email,
      confirmLabel: t("admin.planners.suspend"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    void run(() => adminPlannerMgmtApi.suspend(planner.user_id), "admin.planners.suspend_success");
  }

  function handleReactivate() {
    void run(
      () => adminPlannerMgmtApi.reactivate(planner.user_id),
      "admin.planners.reactivate_success",
    );
  }

  async function handleDelete() {
    const phrase = t("admin.planners.delete_confirm_phrase");
    const entered = await promptEntry({
      title: `${t("admin.planners.delete_confirm_title")}: ${planner.email}`,
      label: t("admin.planners.delete_confirm_label"),
      placeholder: phrase,
      helperText: t("admin.planners.delete_confirm_help"),
      confirmLabel: t("admin.planners.delete"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim().toLowerCase() === phrase.toLowerCase()
          ? null
          : t("admin.planners.delete_confirm_mismatch"),
    });
    if (entered === null) return;
    void run(() => adminPlannerMgmtApi.remove(planner.user_id), "admin.planners.delete_success");
  }

  function handlePlanChange(plan: PlannerPlan) {
    if (plan === planner.planner_plan) return;
    void run(
      () => adminPlannerMgmtApi.setPlan(planner.user_id, plan),
      "admin.planners.plan_success",
    );
  }

  const selectClass =
    "rounded-md border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-umber-900 focus:border-umber-500 focus:outline-none dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50";

  return (
    <div className="admin-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={statusPill.tone} icon={<statusPill.Icon size={11} />}>
              {statusPill.label}
            </Pill>
            <span className="text-xs text-umber-500 dark:text-umber-400">
              {fmtDate(planner.created_at, locale)}
            </span>
          </div>
          <p className="mt-2 truncate font-medium text-umber-900 dark:text-paper-50">
            {planner.full_name || planner.email}
          </p>
          <p className="truncate text-sm text-umber-700 dark:text-umber-300">{planner.email}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-umber-500 dark:text-umber-400">
            <span>
              {t("admin.planners.clients", {
                n: planner.client_count,
                max: planner.planner_max_clients,
              })}
            </span>
            {planner.planner_city && <span>{planner.planner_city}</span>}
            {!planner.planner_onboarding_done && (
              <span>{t("admin.planners.onboarding_pending")}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="flex items-center gap-1 text-xs text-umber-500 dark:text-umber-400">
            {t("admin.planners.plan")}
            <select
              className={selectClass}
              value={planner.planner_plan}
              disabled={busy}
              onChange={(e) => handlePlanChange(e.target.value as PlannerPlan)}
              aria-label={t("admin.planners.plan")}
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {t(`admin.planners.plan_${p}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {suspended ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReactivate}
                disabled={busy}
                aria-label={t("admin.planners.reactivate")}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSuspend}
                disabled={busy}
                aria-label={t("admin.planners.suspend")}
              >
                <Ban size={13} />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleDelete}
              disabled={busy}
              aria-label={t("admin.planners.delete")}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPlannersPage() {
  const { t } = useT();
  const toast = useToast();
  const [planners, setPlanners] = useState<AdminPlannerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  async function load() {
    setLoading(true);
    try {
      const r = await adminPlannerMgmtApi.list();
      setPlanners(r.planners);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { all: planners.length, active: 0, suspended: 0 };
    for (const p of planners) {
      if (p.status === "suspended") c.suspended++;
      else c.active++;
    }
    return c;
  }, [planners]);

  const visible =
    filter === "all"
      ? planners
      : planners.filter((p) =>
          filter === "suspended" ? p.status === "suspended" : p.status === "active",
        );

  const FILTERS: Filter[] = ["all", "active", "suspended"];

  return (
    <>
      <AdminPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Handshake size={20} /> {t("admin.nav_planners")}
          </span>
        }
        subtitle={t("admin.planners.subtitle")}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <AdminFilterChip
            key={f}
            label={`${t(`admin.planners.filter_${f}`)}${counts[f] > 0 ? ` · ${counts[f]}` : ""}`}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-umber-500">
          <Loader2 size={14} className="animate-spin" />
          {t("common.loading")}
        </div>
      ) : visible.length === 0 ? (
        <AdminEmptyState>{t("admin.planners.empty")}</AdminEmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((p) => (
            <PlannerCard key={p.user_id} planner={p} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}
