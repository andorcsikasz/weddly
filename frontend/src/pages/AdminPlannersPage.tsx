// Admin planner management (KEZELÉS → Szervezők). A planner is a users row with
// user_type='planner'; this lists every planner with plan tier + active-client
// count and lets an admin change plan tier, suspend/reactivate, and delete.
// The header action pre-registers a planner (email + name + business name +
// category): the account is provisioned dormant with a 2-year free comp and
// the planner activates it through an emailed link.

import type { AdminPlannerView, PlannerPlan } from "@shared/types";
import {
  Ban,
  Check,
  Handshake,
  Loader2,
  MailPlus,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, Dialog, TextField, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminPlannerMgmtApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type Filter = "all" | "active" | "suspended";

const PLANS: PlannerPlan[] = ["starter", "pro", "premium"];

// Uber-style tier chip: each tier gets a distinct fill so the plan reads at a
// glance across a dense list. Clicking cycles starter → pro → premium.
const PLAN_STYLE: Record<PlannerPlan, string> = {
  starter: "bg-paper-200 text-neutral-700 dark:bg-umber-800 dark:text-umber-200",
  pro: "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900",
  premium: "bg-sage-600 text-paper-50 dark:bg-sage-500 dark:text-umber-900",
};

function nextPlan(plan: PlannerPlan): PlannerPlan {
  const i = PLANS.indexOf(plan);
  return PLANS[(i + 1) % PLANS.length] ?? "starter";
}

function initials(name: string, email: string): string {
  const src = (name || email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? src[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

function fmtDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "Szervező regisztrálása" modal: email + name + business name + category.
 *  Submit provisions the dormant account (2-year comp) and fires the
 *  activation email; the list refreshes with the new "pending" row. */
function ProvisionPlannerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every open; a half-typed planner from a cancelled attempt
  // must not leak into the next one.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setFullName("");
    setBusinessName("");
    setCategory("");
    setError(null);
  }, [open]);

  const canSubmit =
    email.includes("@") &&
    fullName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    category.trim().length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminPlannerMgmtApi.provision({
        email: email.trim(),
        full_name: fullName.trim(),
        business_name: businessName.trim(),
        category: category.trim(),
      });
      toast.success(t("admin.planners.provision_success"));
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("admin.planners.provision_email_taken"));
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("admin.planners.provision_title")}
      onClose={onClose}
      role="dialog"
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="provision-planner-form"
            variant="primary"
            disabled={!canSubmit}
            loading={submitting}
            loadingLabel={t("common.loading")}
            leftIcon={<MailPlus size={15} />}
          >
            {t("admin.planners.provision_submit")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-600 dark:text-umber-300">
        {t("admin.planners.provision_intro")}
      </p>
      <form id="provision-planner-form" className="space-y-4" onSubmit={onSubmit}>
        <TextField
          id="provision-email"
          type="email"
          label={t("admin.planners.provision_email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-name"
          label={t("admin.planners.provision_name")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-business"
          label={t("admin.planners.provision_business")}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-category"
          label={t("admin.planners.provision_category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("admin.planners.provision_category_placeholder")}
          required
          autoComplete="off"
        />
        {error && <p className="field-error">{error}</p>}
      </form>
    </Dialog>
  );
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
    : planner.pending_activation
      ? { tone: "blush", Icon: Send, label: t("admin.planners.status_pending_activation") }
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

  function handleResendActivation() {
    void run(
      () => adminPlannerMgmtApi.resendActivation(planner.user_id),
      "admin.planners.resend_success",
    );
  }

  function handlePlanChange(plan: PlannerPlan) {
    if (plan === planner.planner_plan) return;
    void run(
      () => adminPlannerMgmtApi.setPlan(planner.user_id, plan),
      "admin.planners.plan_success",
    );
  }

  function cyclePlan() {
    if (busy) return;
    handlePlanChange(nextPlan(planner.planner_plan));
  }

  const iconBtnClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-umber-700 transition hover:border-umber-400 hover:text-umber-900 disabled:opacity-50 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:text-paper-50";

  return (
    <div className="admin-card">
      <div className="flex items-center gap-4">
        {/* Identity */}
        <div
          aria-hidden="true"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-paper-50 sm:flex dark:bg-paper-100 dark:text-umber-900"
        >
          {initials(planner.full_name, planner.email)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-umber-900 dark:text-paper-50">
              {planner.full_name || planner.email}
            </p>
            <Pill tone={statusPill.tone} icon={<statusPill.Icon size={11} />}>
              {statusPill.label}
            </Pill>
          </div>
          <p className="truncate text-sm text-umber-700 dark:text-umber-300">{planner.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-500 dark:text-umber-400">
            {planner.business_name && (
              <>
                <span className="truncate">
                  {planner.business_name}
                  {planner.planner_category ? ` (${planner.planner_category})` : ""}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              {t("admin.planners.clients", {
                n: planner.client_count,
                max: planner.planner_max_clients,
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{fmtDate(planner.created_at, locale)}</span>
            {planner.planner_city && (
              <>
                <span aria-hidden="true">·</span>
                <span>{planner.planner_city}</span>
              </>
            )}
            {planner.founding_until && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("admin.planners.free_until", {
                    date: fmtDate(planner.founding_until, locale),
                  })}
                </span>
              </>
            )}
            {!planner.planner_onboarding_done && !planner.pending_activation && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("admin.planners.onboarding_pending")}</span>
              </>
            )}
          </div>
        </div>

        {/* Plan + actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={cyclePlan}
            disabled={busy}
            title={t("admin.planners.plan_cycle_hint")}
            aria-label={`${t("admin.planners.plan")}: ${t(`admin.planners.plan_${planner.planner_plan}`)}. ${t("admin.planners.plan_cycle_hint")}`}
            className={`inline-flex min-w-[76px] select-none items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition active:scale-95 disabled:opacity-60 ${PLAN_STYLE[planner.planner_plan]}`}
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              t(`admin.planners.plan_${planner.planner_plan}`)
            )}
          </button>

          {planner.pending_activation && (
            <button
              type="button"
              className={iconBtnClass}
              onClick={handleResendActivation}
              disabled={busy}
              title={t("admin.planners.resend_activation")}
              aria-label={t("admin.planners.resend_activation")}
            >
              <Send size={15} />
            </button>
          )}
          {suspended ? (
            <button
              type="button"
              className={iconBtnClass}
              onClick={handleReactivate}
              disabled={busy}
              aria-label={t("admin.planners.reactivate")}
            >
              <RotateCcw size={15} />
            </button>
          ) : (
            <button
              type="button"
              className={iconBtnClass}
              onClick={handleSuspend}
              disabled={busy}
              aria-label={t("admin.planners.suspend")}
            >
              <Ban size={15} />
            </button>
          )}
          <button
            type="button"
            className={iconBtnClass}
            onClick={handleDelete}
            disabled={busy}
            aria-label={t("admin.planners.delete")}
          >
            <Trash2 size={15} />
          </button>
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
  const [provisionOpen, setProvisionOpen] = useState(false);

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
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<UserPlus size={15} />}
            onClick={() => setProvisionOpen(true)}
          >
            {t("admin.planners.provision_cta")}
          </Button>
        }
      />

      <ProvisionPlannerDialog
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        onCreated={() => void load()}
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
