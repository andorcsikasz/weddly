import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  ListChecks,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PlannerClientCrm } from "@shared/types";
import { useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { titleCaseName } from "../../lib/planner_display";

const CLIENT_COLORS = [
  "bg-blush-100 text-blush-800",
  "bg-eucalyptus-100 text-eucalyptus-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-eucalyptus-200 text-eucalyptus-900",
  "bg-blush-200 text-blush-900",
  "bg-amber-200 text-amber-900",
  "bg-paper-300 text-umber-800",
] as const;

const STAGES = ["inquiry", "proposal", "deposit", "active", "completed", "archived"] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${y ?? ""}. ${m ?? ""}. ${d ?? ""}.`;
}

function waPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function formatAmount(val: number | null, locale: string): string {
  if (val === null) return "–";
  return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", {
    style: "currency",
    currency: locale === "hu" ? "HUF" : "EUR",
    maximumFractionDigits: 0,
  }).format(val);
}

export default function PlannerClientPage() {
  const { t, locale } = useT();
  const { coupleId } = useParams<{ coupleId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const id = Number(coupleId);
  const [crm, setCrm] = useState<PlannerClientCrm | null>(null);
  const [form, setForm] = useState<Partial<PlannerClientCrm>>({});
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const [guestPageBusy, setGuestPageBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    plannerApi
      .getClientCrm(id)
      .then((data) => {
        setCrm(data);
        setForm({
          client_phone: data.client_phone,
          client_alt_email: data.client_alt_email,
          lead_source: data.lead_source,
          contract_value: data.contract_value,
          deposit_paid: data.deposit_paid,
          stage: data.stage,
          notes: data.notes,
        });
      })
      .catch(() => navigate("/app/planner", { replace: true }));
  }, [id, navigate]);

  function set<K extends keyof PlannerClientCrm>(field: K, value: PlannerClientCrm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await plannerApi.updateClientCrm(id, form);
      setCrm((prev) => (prev ? { ...prev, ...form } : prev));
      toast.success(t("planner_client.save_success"));
    } catch {
      toast.error("Hiba a mentés során");
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(stage: string) {
    set("stage", stage);
    await plannerApi.updateClientCrm(id, { stage }).catch(() => {});
  }

  // Switch the couple's own guest-page (vendégoldal) editing on/off. The server
  // only permits "enable" once the couple has prepaid their 30% share (402
  // guest_page_not_prepaid otherwise) - which is why the toggle is locked until
  // crm.guest_page_prepaid is true.
  async function handleToggleGuestPage() {
    if (!crm || guestPageBusy) return;
    const next = !crm.guest_page_addon;
    setGuestPageBusy(true);
    try {
      const r = await plannerApi.setGuestPageAccess(id, next);
      setCrm((prev) => (prev ? { ...prev, guest_page_addon: r.guest_page_addon } : prev));
      toast.success(
        next
          ? t("planner_client.guest_page_enable_success")
          : t("planner_client.guest_page_disable_success"),
      );
    } catch (err) {
      const code =
        err instanceof ApiError ? (err.detail as { code?: string } | null)?.code : undefined;
      toast.error(
        code === "guest_page_not_prepaid"
          ? t("planner_client.guest_page_not_prepaid")
          : t("planner_client.guest_page_error"),
      );
    } finally {
      setGuestPageBusy(false);
    }
  }

  async function handleEnter() {
    setEntering(true);
    try {
      await plannerApi.enterClient(id);
      navigate("/app", { replace: true });
    } catch {
      setEntering(false);
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      title: t("planner_client.remove_confirm_title"),
      body: t("planner_client.remove_confirm_body"),
      confirmLabel: t("planner_client.remove_button"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await plannerApi.removeClient(id);
      toast.success(t("planner_client.remove_success"));
      navigate("/app/planner/clients", { replace: true });
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  if (!crm) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="h-64 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />
      </div>
    );
  }

  const colorClass = CLIENT_COLORS[crm.couple_id % 8] ?? CLIENT_COLORS[0];
  const days = crm.wedding_date ? daysUntil(crm.wedding_date) : null;
  const balance =
    crm.contract_value !== null && crm.deposit_paid !== null
      ? crm.contract_value - crm.deposit_paid
      : null;

  const stageKey = `planner_client.stage_${form.stage ?? crm.stage}` as
    | "planner_client.stage_inquiry"
    | "planner_client.stage_proposal"
    | "planner_client.stage_deposit"
    | "planner_client.stage_active"
    | "planner_client.stage_completed"
    | "planner_client.stage_archived";

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-2 pb-16">
      <Link
        to="/app/planner/clients"
        className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900 dark:text-paper-300 dark:hover:text-paper-50"
      >
        <ArrowLeft size={15} />
        {t("planner_nav.clients")}
      </Link>

      {/* Hero card */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-grotesk text-xl font-semibold ${colorClass}`}
          >
            {initials(crm.display_name)}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="font-grotesk text-2xl font-semibold leading-tight tracking-tight text-umber-900 dark:text-paper-50">
              {titleCaseName(crm.display_name)}
            </h1>
            {crm.wedding_date && (
              <div className="mt-0.5 flex items-center gap-1.5 text-sm text-umber-500 dark:text-umber-300">
                <Clock size={13} aria-hidden="true" />
                <span>
                  {formatDate(crm.wedding_date)}
                  {days !== null && (
                    <span
                      className={
                        days > 0
                          ? days <= 14
                            ? " · " + String(days) + " nap"
                            : " · " + String(days) + " nap"
                          : days === 0
                            ? " · Ma!"
                            : " · " + String(Math.abs(days)) + " napja volt"
                      }
                    />
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Stage selector */}
          <div className="shrink-0">
            <select
              value={form.stage ?? crm.stage}
              onChange={(e) => void handleStageChange(e.target.value)}
              className="rounded-lg border border-paper-300 bg-white px-2 py-1 text-xs font-medium text-umber-700 focus:outline-none focus:ring-2 focus:ring-eucalyptus-400 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100"
              aria-label={t("planner_client.stage_label")}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`planner_client.stage_${s}` as typeof stageKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Health + task summary */}
        <div className="mt-3 flex items-center gap-3">
          {crm.task_summary.overdue === 0 ? (
            <div className="flex items-center gap-1 text-xs text-eucalyptus-600 dark:text-eucalyptus-400">
              <CheckCircle2 size={13} aria-hidden="true" />
              <span>
                {crm.task_summary.done}/{crm.task_summary.total} feladat kész
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>{crm.task_summary.overdue} lejárt feladat</span>
            </div>
          )}
          {crm.confirmed_guests > 0 && (
            <span className="text-xs text-umber-400">
              · {crm.confirmed_guests} visszaigazolt vendég
            </span>
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-4 flex gap-2">
          {crm.client_phone || form.client_phone ? (
            <>
              <a
                href={`tel:${form.client_phone ?? crm.client_phone ?? ""}`}
                className="btn-outline flex flex-1 items-center justify-center gap-1.5 text-sm"
              >
                <Phone size={14} aria-hidden="true" />
                {t("planner_client.quick_call")}
              </a>
              <a
                href={`https://wa.me/${waPhone(form.client_phone ?? crm.client_phone ?? "")}`}
                target="_blank"
                rel="noreferrer"
                className="btn-outline flex flex-1 items-center justify-center gap-1.5 text-sm"
              >
                <MessageCircle size={14} aria-hidden="true" />
                {t("planner_client.quick_whatsapp")}
              </a>
            </>
          ) : (
            <p className="text-xs text-umber-400 italic">{t("planner_client.no_phone")}</p>
          )}
          {crm.primary_email && (
            <a
              href={`mailto:${crm.primary_email}`}
              className="btn-outline flex flex-1 items-center justify-center gap-1.5 text-sm"
            >
              <Mail size={14} aria-hidden="true" />
              {t("planner_client.quick_email")}
            </a>
          )}
        </div>

        {/* Primary CTA - entering the couple's workspace is the highest-value
            action on this page, so it gets a prominent moss-filled button. */}
        <button
          type="button"
          disabled={entering}
          onClick={() => void handleEnter()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-moss-600 px-4 py-3 font-grotesk text-sm font-semibold text-white shadow-sm transition-colors hover:bg-moss-700 disabled:opacity-60 dark:bg-moss-500 dark:hover:bg-moss-600"
        >
          {entering ? "..." : t("planner_client.enter_workspace")}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Tasks summary */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
            <ListChecks size={13} aria-hidden="true" />
            {t("planner_client.tasks_heading")}
          </p>
          <button
            type="button"
            onClick={() => void handleEnter()}
            className="inline-flex items-center gap-1 text-xs font-medium text-moss-600 hover:text-moss-700 dark:text-moss-400 dark:hover:text-moss-300"
          >
            {t("planner_client.enter_workspace")}
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
        {crm.task_summary.total > 0 ? (
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-grotesk text-sm font-medium text-umber-800 dark:text-paper-200">
                {t("planner_home.pipeline_tasks_done")
                  .replace("{{done}}", String(crm.task_summary.done))
                  .replace("{{total}}", String(crm.task_summary.total))}
              </span>
              {crm.task_summary.overdue > 0 && (
                <span className="text-xs font-medium text-red-500 dark:text-red-400">
                  {t("planner_home.pipeline_tasks_overdue").replace(
                    "{{n}}",
                    String(crm.task_summary.overdue),
                  )}
                </span>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
              <div
                className="h-full rounded-full bg-moss-500 transition-all"
                style={{
                  width: `${Math.round(
                    (crm.task_summary.done / Math.max(crm.task_summary.total, 1)) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-umber-400 italic">{t("planner_client.tasks_empty")}</p>
        )}
      </div>

      {/* Guest-page editing - the couple buys back editing of their own
          guest page (70% off), then the planner switches it on here. Locked
          until the couple has prepaid their share. */}
      <div className="card p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("planner_client.guest_page_heading")}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-[14rem] flex-1 text-sm text-umber-600 dark:text-umber-300">
            {crm.guest_page_prepaid
              ? t("planner_client.guest_page_desc")
              : t("planner_client.guest_page_locked")}
          </p>
          {crm.guest_page_prepaid ? (
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={crm.guest_page_addon}
                aria-label={t("planner_client.guest_page_toggle_aria")}
                disabled={guestPageBusy}
                onClick={() => void handleToggleGuestPage()}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                  crm.guest_page_addon
                    ? "bg-moss-500 dark:bg-moss-400"
                    : "bg-paper-300 dark:bg-umber-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    crm.guest_page_addon ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-umber-800 dark:text-paper-100">
                {crm.guest_page_addon
                  ? t("planner_client.guest_page_on")
                  : t("planner_client.guest_page_off")}
              </span>
            </label>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-paper-200 px-3 py-1 text-xs font-medium text-umber-500 dark:bg-umber-800 dark:text-umber-300">
              <Lock size={12} aria-hidden="true" />
              {t("planner_client.guest_page_off")}
            </span>
          )}
        </div>
      </div>

      {/* Details form */}
      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        {/* Contact */}
        <div className="card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
            {t("planner_client.contact_heading")}
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_client.phone_label")}
              </label>
              <input
                type="tel"
                className="input w-full"
                value={form.client_phone ?? ""}
                onChange={(e) => set("client_phone", e.target.value || null)}
                placeholder="+36 30 123 4567"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_client.alt_email_label")}
              </label>
              <input
                type="email"
                className="input w-full"
                value={form.client_alt_email ?? ""}
                onChange={(e) => set("client_alt_email", e.target.value || null)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_client.lead_source_label")}
              </label>
              <input
                type="text"
                className="input w-full"
                value={form.lead_source ?? ""}
                onChange={(e) => set("lead_source", e.target.value || null)}
                placeholder={t("planner_client.lead_source_placeholder")}
              />
            </div>
          </div>
        </div>

        {/* Financials */}
        <div className="card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
            {t("planner_client.financial_heading")}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_client.contract_value_label")}
              </label>
              <input
                type="number"
                min="0"
                className="input w-full"
                value={form.contract_value ?? ""}
                onChange={(e) =>
                  set("contract_value", e.target.value ? Number(e.target.value) : null)
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_client.deposit_paid_label")}
              </label>
              <input
                type="number"
                min="0"
                className="input w-full"
                value={form.deposit_paid ?? ""}
                onChange={(e) =>
                  set("deposit_paid", e.target.value ? Number(e.target.value) : null)
                }
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-paper-100 px-4 py-2 dark:bg-umber-700">
            <span className="text-sm text-umber-700 dark:text-umber-200">
              {t("planner_client.balance_label")}
            </span>
            <span
              className={`font-grotesk font-semibold ${
                balance !== null && balance > 0
                  ? "text-umber-900 dark:text-paper-50"
                  : "text-eucalyptus-600 dark:text-eucalyptus-400"
              }`}
            >
              {formatAmount(balance, locale)}
            </span>
          </div>
        </div>

        {/* Notes */}
        <div className="card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
            {t("planner_client.notes_heading")}
          </p>
          <textarea
            rows={5}
            className="input mt-4 w-full resize-none"
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || null)}
            placeholder={t("planner_client.notes_placeholder")}
          />
        </div>

        <button type="submit" disabled={saving} className="btn-outline w-full">
          {saving ? "..." : t("planner_client.save_button")}
        </button>
      </form>

      {/* Danger zone - unlink only removes the planner↔couple link; the couple
          keeps their workspace and all data. */}
      <div className="card border-red-200 p-5 dark:border-red-900/40">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-red-500 dark:text-red-400">
          {t("planner_client.danger_heading")}
        </p>
        <p className="mt-2 text-sm text-umber-600 dark:text-umber-300">
          {t("planner_client.remove_explain")}
        </p>
        <button
          type="button"
          onClick={() => void handleRemove()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <Trash2 size={14} aria-hidden="true" />
          {t("planner_client.remove_button")}
        </button>
      </div>
    </div>
  );
}
