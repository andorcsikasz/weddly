// Admin vendor management (FIÓKOK → Szolgáltatók). Lists activated vendor
// accounts plus accepted-but-not-yet-activated onboarding rows, and lets an
// admin suspend/reactivate, edit details, delete, and resend the activation
// link. Sibling of AdminUsersPage; the BEÉRKEZŐ vendor waitlist stays separate.
//
// The row speaks the same visual language as the couples user page: an early-
// adopter Bird glyph for founding members, and an HONEST payment-status pill —
// tone carries the fast read (sage = paying, blush = past-due, ink = card on
// file / will pay, muted = free) so a founding vendor paying nothing never
// looks like a churned one (the trap a binary paying/not marker falls into).

import type { AdminVendorView } from "@shared/listings";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { VENDOR_FREE_LEAD_CREDITS } from "@shared/vendor_billing";
import type { VendorPlan } from "@shared/vendor_plan";
import {
  AlertTriangle,
  Ban,
  BellRing,
  Bird,
  CalendarClock,
  Check,
  Clock,
  CreditCard,
  DollarSign,
  Eye,
  Gift,
  Loader2,
  Mail,
  MinusCircle,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Search,
  Store,
  Trash2,
  UserPlus,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill, StatFilter } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, Dialog, TextField, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorMgmtApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// Filter buckets double as the "who's an early adopter / who pays" aggregate the
// flat list never surfaced. Non-exclusive views (a suspended payer counts under
// both) — counts are a lens, not a partition.
type Filter =
  | "all"
  | "founding"
  | "paying"
  | "trial"
  | "free"
  | "incomplete"
  | "pending"
  | "suspended";
const FILTERS: Filter[] = [
  "all",
  "founding",
  "paying",
  "trial",
  "free",
  "incomplete",
  "pending",
  "suspended",
];

/** Glyph per filter bucket for the stat-filter tiles. Bird mirrors the
 *  founding-member badge used on the cards; the rest read the billing state. */
const VENDOR_FILTER_ICON: Record<Filter, ReactNode> = {
  all: <Store size={16} />,
  founding: <Bird size={16} />,
  paying: <CreditCard size={16} />,
  trial: <Clock size={16} />,
  free: <Gift size={16} />,
  incomplete: <AlertTriangle size={16} />,
  pending: <Mail size={16} />,
  suspended: <Ban size={16} />,
};

// Mirrors the planner list's tier chip: the FREE/PRO tier reads at a glance
// across a dense list. Display-only here, since the vendor plan is derived
// from billing entitlement and an admin can't flip it by hand.
const PLAN_STYLE: Record<VendorPlan, string> = {
  free: "bg-paper-200 text-neutral-700 dark:bg-umber-800 dark:text-umber-200",
  pro: "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900",
};

function initials(name: string, email: string | null): string {
  const src = (name || email || "").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? src[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

function fmtDate(unixMs: number | null, locale: string): string {
  if (unixMs == null) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Which bucket a row falls into for the status pill + suspended/pending
 *  filters. Pending rows are their own bucket; active rows split by the owner's
 *  suspension state. */
function vendorBucket(v: AdminVendorView): "pending" | "suspended" | "active" {
  if (v.state === "pending") return "pending";
  return v.owner_status === "suspended" ? "suspended" : "active";
}

/** Non-exclusive filter predicate driving both the chip counts and the visible
 *  list. Every bucket except `all`/`pending` is active-account-only. */
function matchesFilter(v: AdminVendorView, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return v.state === "pending";
  if (v.state !== "active") return false;
  if (f === "suspended") return v.owner_status === "suspended";
  if (f === "incomplete") return v.listing_incomplete;
  if (f === "founding") return v.is_founding_member;
  if (f === "paying")
    return v.subscription_status === "active" || v.subscription_status === "past_due";
  if (f === "trial")
    return v.subscription_status === "trialing" || v.subscription_status === "lead_window";
  if (f === "free") return v.plan === "free";
  return false;
}

function vendorSearchHay(v: AdminVendorView): string {
  return [v.display_name, v.contact_email, v.owner_email, v.vendor_code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

interface PayState {
  key: string;
  tone: PillTone;
  Icon: typeof Store;
  label: string;
  tooltip?: string;
}

/** The honest payment-status pill. Returns null for pending rows and for an
 *  actively-free founding member (the Bird glyph already says "free early
 *  adopter", so the pill would be redundant — mirrors how the couples page
 *  suppresses its payment marker for founding workspaces). */
function vendorPaymentState(v: AdminVendorView, t: Translate, locale: string): PayState | null {
  if (v.state !== "active") return null;
  const s = v.subscription_status;
  if (s === "founding") return null;
  const d = (ts: number | null) => fmtDate(ts, locale);
  if (!s || s === "none") {
    return { key: "none", tone: "muted", Icon: MinusCircle, label: t("admin.vendors.pay_none") };
  }
  if (s === "active") {
    return {
      key: "paying",
      tone: "sage",
      Icon: DollarSign,
      label: t("admin.vendors.pay_paying"),
      tooltip: v.current_period_end
        ? t("admin.vendors.pay_paying_tooltip", { date: d(v.current_period_end) })
        : undefined,
    };
  }
  if (s === "past_due") {
    return {
      key: "past_due",
      tone: "blush",
      Icon: AlertTriangle,
      label: t("admin.vendors.pay_past_due"),
      tooltip: t("admin.vendors.pay_past_due_tooltip"),
    };
  }
  if (s === "trialing") {
    return {
      key: "trial",
      tone: "paper",
      Icon: Clock,
      label: t("admin.vendors.pay_trial"),
      tooltip: v.trial_ends_at
        ? t("admin.vendors.pay_trial_tooltip", { date: d(v.trial_ends_at) })
        : undefined,
    };
  }
  if (s === "lead_window") {
    const used = v.lead_credits_used ?? 0;
    if (used < VENDOR_FREE_LEAD_CREDITS) {
      return {
        key: "leads",
        tone: "ink",
        Icon: CreditCard,
        label: `${t("admin.vendors.pay_leads")} · ${used}/${VENDOR_FREE_LEAD_CREDITS}`,
        tooltip: t("admin.vendors.pay_leads_tooltip", { used, total: VENDOR_FREE_LEAD_CREDITS }),
      };
    }
    if (v.billing_starts_at && v.billing_starts_at > Date.now()) {
      return {
        key: "scheduled",
        tone: "ink",
        Icon: CalendarClock,
        label: t("admin.vendors.pay_scheduled"),
        tooltip: t("admin.vendors.pay_scheduled_tooltip", { date: d(v.billing_starts_at) }),
      };
    }
    return {
      key: "free",
      tone: "muted",
      Icon: MinusCircle,
      label: t("admin.vendors.pay_free"),
      tooltip: t("admin.vendors.pay_free_tooltip"),
    };
  }
  // canceled / any other lapsed status → the vendor is back on the FREE plan.
  return {
    key: "free",
    tone: "muted",
    Icon: MinusCircle,
    label: t("admin.vendors.pay_free"),
    tooltip: t("admin.vendors.pay_free_tooltip"),
  };
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: AdminVendorView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(vendor.display_name);
  const [companyName, setCompanyName] = useState(vendor.company_name ?? "");
  const [email, setEmail] = useState(vendor.contact_email ?? "");
  const [phone, setPhone] = useState(vendor.contact_phone ?? "");
  const [vat, setVat] = useState(vendor.vat_number ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (displayName.trim().length === 0) {
      toast.error(t("admin.vendors.name_required"));
      return;
    }
    setSaving(true);
    try {
      await adminVendorMgmtApi.update(vendor.id, {
        display_name: displayName.trim(),
        company_name: companyName.trim() || null,
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        vat_number: vat.trim() || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  const labelClass = "block text-sm font-medium text-umber-800 dark:text-umber-200 mb-1";
  const inputClass =
    "w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-umber-900 focus:border-umber-500 focus:outline-none focus:ring-1 focus:ring-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:focus:border-umber-400 dark:focus:ring-umber-400";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-paper-50 p-6 shadow-xl dark:bg-umber-900 sm:rounded-2xl">
        <h2 className="mb-4 text-base font-semibold text-umber-900 dark:text-paper-50">
          {t("admin.vendors.edit_title")}
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="vendor-name" className={labelClass}>
              {t("admin.vendors.field_name")}
            </label>
            <input
              id="vendor-name"
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">
              {t("admin.vendors.field_name_help")}
            </p>
          </div>
          <div>
            <label htmlFor="vendor-company" className={labelClass}>
              {t("admin.vendors.field_company")}
            </label>
            <input
              id="vendor-company"
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">
              {t("admin.vendors.field_company_help")}
            </p>
          </div>
          <div>
            <label htmlFor="vendor-email" className={labelClass}>
              {t("admin.vendors.field_email")}
            </label>
            <input
              id="vendor-email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="vendor-phone" className={labelClass}>
              {t("admin.vendors.field_phone")}
            </label>
            <input
              id="vendor-phone"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="vendor-vat" className={labelClass}>
              {t("admin.vendors.field_vat")}
            </label>
            <input
              id="vendor-vat"
              className={inputClass}
              value={vat}
              onChange={(e) => setVat(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button className="flex-[2]" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function VendorCard({ vendor, onChanged }: { vendor: AdminVendorView; onChanged: () => void }) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const bucket = vendorBucket(vendor);
  const pay = vendorPaymentState(vendor, t, locale);
  const foundingTip = vendor.founding_until
    ? t("admin.vendors.founding_until_tooltip", { date: fmtDate(vendor.founding_until, locale) })
    : t("admin.vendors.founding_tooltip");

  const statusPill: { tone: PillTone; Icon: typeof Store; label: string } =
    bucket === "pending"
      ? { tone: "blush", Icon: Clock, label: t("admin.vendors.status_pending") }
      : bucket === "suspended"
        ? { tone: "muted", Icon: Ban, label: t("admin.vendors.status_suspended") }
        : { tone: "sage", Icon: Check, label: t("admin.vendors.status_active") };

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
      title: t("admin.vendors.suspend_confirm_title"),
      body: vendor.display_name,
      confirmLabel: t("admin.vendors.suspend"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    void run(() => adminVendorMgmtApi.suspend(vendor.id), "admin.vendors.suspend_success");
  }

  // Lifting a suspension confirms too. Suspending was already guarded, but the
  // undo sat one icon away and fired on a single click, so a mis-tap silently
  // put a vendor the team had suspended back in front of couples. Both
  // directions of the same switch, both asked.
  async function handleReactivate() {
    const ok = await confirm({
      title: t("admin.vendors.reactivate_confirm_title"),
      body: vendor.display_name,
      confirmLabel: t("admin.vendors.reactivate"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    void run(() => adminVendorMgmtApi.reactivate(vendor.id), "admin.vendors.reactivate_success");
  }

  function handleRemind() {
    void run(() => adminVendorMgmtApi.remindIncomplete(vendor.id), "admin.vendors.remind_success");
  }

  // Localized names of the still-empty listing sections, for the "incomplete"
  // badge tooltip. Order follows the object key order (photos → availability).
  const missingLabels = vendor.listing_missing
    ? (Object.entries(vendor.listing_missing) as [string, boolean][])
        .filter(([, on]) => on)
        .map(([k]) => t(`admin.vendors.missing_${k}`))
    : [];

  function handleResend() {
    void run(() => adminVendorMgmtApi.resendActivation(vendor.id), "admin.vendors.resend_success");
  }

  async function handleDelete() {
    const phrase = t("admin.vendors.delete_confirm_phrase");
    const entered = await promptEntry({
      title: `${t("admin.vendors.delete_confirm_title")}: ${vendor.display_name}`,
      label: t("admin.vendors.delete_confirm_label"),
      placeholder: phrase,
      helperText: t("admin.vendors.delete_confirm_help"),
      confirmLabel: t("admin.vendors.delete"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim().toLowerCase() === phrase.toLowerCase()
          ? null
          : t("admin.vendors.delete_confirm_mismatch"),
    });
    if (entered === null) return;
    void run(() => adminVendorMgmtApi.remove(vendor.id), "admin.vendors.delete_success");
  }

  const iconBtnClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-umber-700 transition hover:border-umber-400 hover:text-umber-900 disabled:opacity-50 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:text-paper-50";

  const email = vendor.contact_email ?? vendor.owner_email;

  return (
    <>
      {editing && (
        <EditModal vendor={vendor} onClose={() => setEditing(false)} onSaved={onChanged} />
      )}
      <div className="admin-card">
        <div className="flex items-center gap-4">
          {/* Identity */}
          <div
            aria-hidden="true"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-paper-50 sm:flex dark:bg-paper-100 dark:text-umber-900"
          >
            {initials(vendor.display_name, email)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-umber-900 dark:text-paper-50">
                {vendor.display_name}
              </p>
              <Pill tone={statusPill.tone} icon={<statusPill.Icon size={11} />}>
                {statusPill.label}
              </Pill>
              {/* Which supplier category this vendor is listed under. */}
              {vendor.categories.map((cat) => (
                <Pill key={cat} tone="paper">
                  {t(`suppliers.cat.${cat}`)}
                </Pill>
              ))}
              {vendor.token_expired && <Pill tone="muted">{t("admin.vendors.token_expired")}</Pill>}
              {/* Early-adopter mark: one of the first VENDOR_FOUNDING_CAP vendors.
                  Same Bird glyph the couples page uses for founding workspaces. */}
              {vendor.is_founding_member && (
                <span
                  title={foundingTip}
                  aria-label={foundingTip}
                  className="inline-flex items-center text-umber-600 dark:text-umber-300"
                >
                  <Bird size={15} aria-hidden />
                </span>
              )}
              {/* Honest payment-status pill (tone carries the fast read). */}
              {pay && (
                <span title={pay.tooltip}>
                  <Pill
                    tone={pay.tone}
                    icon={<pay.Icon size={11} />}
                    srLabel={t("admin.vendors.pay_label")}
                  >
                    {pay.label}
                  </Pill>
                </span>
              )}
              {/* Listing completeness: which public sections are still empty. */}
              {vendor.state === "active" && vendor.listing_incomplete && (
                <span
                  title={t("admin.vendors.incomplete_tooltip", {
                    sections: missingLabels.join(", "),
                  })}
                >
                  <Pill tone="blush" icon={<AlertTriangle size={11} />}>
                    {t("admin.vendors.incomplete")}
                  </Pill>
                </span>
              )}
            </div>
            {vendor.company_name && vendor.company_name !== vendor.display_name && (
              <p className="truncate text-xs text-umber-500 dark:text-umber-400">
                {vendor.company_name}
              </p>
            )}
            {email && (
              <p className="truncate text-sm text-umber-700 dark:text-umber-300">{email}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-500 dark:text-umber-400">
              {vendor.vendor_code && <span>{vendor.vendor_code}</span>}
              {vendor.vendor_code && <span aria-hidden="true">·</span>}
              <span>{fmtDate(vendor.created_at, locale)}</span>
              {vendor.state === "active" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t("admin.vendors.listing_count", { n: vendor.listing_count })}</span>
                </>
              )}
              {vendor.analytics && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className="inline-flex items-center gap-1"
                    title={t("admin.vendors.reach_tooltip", {
                      views: vendor.analytics.views_total,
                      clicks:
                        vendor.analytics.website_clicks_total + vendor.analytics.phone_clicks_total,
                    })}
                  >
                    <Eye size={12} aria-hidden />
                    <span className="tabular-nums">{vendor.analytics.views_total}</span>
                    <MousePointerClick size={12} aria-hidden className="ml-1.5" />
                    <span className="tabular-nums">
                      {vendor.analytics.website_clicks_total + vendor.analytics.phone_clicks_total}
                    </span>
                    <span className="sr-only">{t("admin.vendors.reach_label")}</span>
                  </span>
                </>
              )}
              {vendor.state === "active" && vendor.profile_nudge_count > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    title={
                      vendor.profile_nudge_last_at
                        ? t("admin.vendors.reminders_last", {
                            date: fmtDate(vendor.profile_nudge_last_at, locale),
                          })
                        : undefined
                    }
                  >
                    {t("admin.vendors.reminders_sent", { n: vendor.profile_nudge_count })}
                  </span>
                </>
              )}
              {vendor.contact_phone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{vendor.contact_phone}</span>
                </>
              )}
            </div>
          </div>

          {/* Plan + actions */}
          <div className="flex shrink-0 items-center gap-2">
            {vendor.state === "pending" ? (
              <Button size="sm" onClick={handleResend} disabled={busy}>
                {busy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <>
                    <Mail size={13} /> {t("admin.vendors.resend")}
                  </>
                )}
              </Button>
            ) : (
              <>
                {vendor.plan && (
                  <span
                    title={vendor.billing_reason ?? undefined}
                    aria-label={`${t("admin.vendors.plan")}: ${t(`admin.vendors.plan_${vendor.plan}`)}`}
                    className={`inline-flex min-w-[76px] select-none items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide ${PLAN_STYLE[vendor.plan]}`}
                  >
                    {t(`admin.vendors.plan_${vendor.plan}`)}
                  </span>
                )}
                {bucket === "active" && vendor.listing_incomplete && (
                  <button
                    type="button"
                    className={iconBtnClass}
                    onClick={handleRemind}
                    disabled={busy}
                    aria-label={t("admin.vendors.remind")}
                    title={t("admin.vendors.remind")}
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />}
                  </button>
                )}
                <button
                  type="button"
                  className={iconBtnClass}
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  aria-label={t("admin.vendors.edit")}
                >
                  <Pencil size={15} />
                </button>
                {bucket === "suspended" ? (
                  <button
                    type="button"
                    className={iconBtnClass}
                    onClick={handleReactivate}
                    disabled={busy}
                    aria-label={t("admin.vendors.reactivate")}
                  >
                    {busy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RotateCcw size={15} />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={iconBtnClass}
                    onClick={handleSuspend}
                    disabled={busy}
                    aria-label={t("admin.vendors.suspend")}
                  >
                    <Ban size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className={iconBtnClass}
                  onClick={handleDelete}
                  disabled={busy}
                  aria-label={t("admin.vendors.delete")}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Admin "register a new vendor" — collects business name + email + category,
 *  mints a pending onboarding and emails the vendor the activation link. Mirrors
 *  the planner ProvisionPlannerDialog; the vendor sets their own password via the
 *  link (no full name / password collected here). */
function RegisterVendorDialog({
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
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every open — a cancelled half-typed vendor mustn't leak forward.
  useEffect(() => {
    if (!open) return;
    setBusinessName("");
    setEmail("");
    setCategory("");
    setError(null);
  }, [open]);

  const canSubmit = businessName.trim().length > 0 && email.includes("@") && category !== "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminVendorMgmtApi.register({
        business_name: businessName.trim(),
        email: email.trim(),
        category,
      });
      toast.success(t("admin.vendors.register_success"));
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("admin.vendors.register_email_taken"));
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
      title={t("admin.vendors.register_title")}
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
            form="register-vendor-form"
            variant="primary"
            disabled={!canSubmit}
            loading={submitting}
            loadingLabel={t("common.loading")}
            leftIcon={<Mail size={15} />}
          >
            {t("admin.vendors.register_submit")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-600 dark:text-umber-300">
        {t("admin.vendors.register_intro")}
      </p>
      <form id="register-vendor-form" className="space-y-4" onSubmit={onSubmit}>
        <TextField
          id="register-vendor-business"
          label={t("admin.vendors.register_business")}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="register-vendor-email"
          type="email"
          label={t("admin.vendors.register_email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <div>
          <label htmlFor="register-vendor-category" className="field-label">
            {t("admin.vendors.register_category")}
          </label>
          <select
            id="register-vendor-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupplierCategory | "")}
            required
          >
            <option value="" disabled>
              {t("vendor_register.category_placeholder")}
            </option>
            {SUPPLIER_GROUPS.map((g) => (
              <optgroup key={g.id} label={t(`suppliers.group.${g.id}`)}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "other"
                      ? t("vendor_register.category_other_option")
                      : t(`suppliers.cat.${c}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {error && <p className="field-error">{error}</p>}
      </form>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminVendorsPage() {
  const { t } = useT();
  const toast = useToast();
  const [active, setActive] = useState<AdminVendorView[]>([]);
  const [pending, setPending] = useState<AdminVendorView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  // Debounce the search so typing stays snappy on a long list (same 150ms
  // pacing as the couples user page + supplier directory filter).
  useEffect(() => {
    const handle = window.setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 150);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  async function load() {
    setLoading(true);
    try {
      const r = await adminVendorMgmtApi.list();
      setActive(r.active);
      setPending(r.pending);
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

  const all = useMemo(() => [...pending, ...active], [pending, active]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: all.length,
      founding: 0,
      paying: 0,
      trial: 0,
      free: 0,
      incomplete: 0,
      pending: 0,
      suspended: 0,
    };
    for (const v of all) {
      for (const f of FILTERS) {
        if (f !== "all" && matchesFilter(v, f)) c[f]++;
      }
    }
    return c;
  }, [all]);

  const visible = useMemo(
    () =>
      all.filter(
        (v) =>
          matchesFilter(v, filter) &&
          (searchQuery === "" || vendorSearchHay(v).includes(searchQuery)),
      ),
    [all, filter, searchQuery],
  );

  return (
    <>
      <AdminPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Store size={20} /> {t("admin.nav_vendors")}
          </span>
        }
        subtitle={t("admin.vendors.subtitle")}
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<UserPlus size={15} />}
            onClick={() => setRegisterOpen(true)}
          >
            {t("admin.vendors.register_cta")}
          </Button>
        }
      />
      <RegisterVendorDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => void load()}
      />

      {/* Search across name / email / vendor code. */}
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 dark:border-umber-700 dark:bg-umber-900">
        <Search size={16} aria-hidden className="shrink-0 text-umber-400 dark:text-umber-500" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("admin.vendors.search_placeholder")}
          aria-label={t("admin.vendors.search_placeholder")}
          className="w-full bg-transparent text-sm text-umber-900 placeholder:text-umber-400 focus:outline-none dark:text-paper-50 dark:placeholder:text-umber-500"
        />
      </div>

      <StatFilter
        ariaLabel={t("admin.nav_vendors")}
        onSelect={(k) => setFilter(k as Filter)}
        segments={FILTERS.map((f) => ({
          key: f,
          label: t(`admin.vendors.filter_${f}`),
          count: counts[f],
          icon: VENDOR_FILTER_ICON[f],
          active: filter === f,
        }))}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-umber-500">
          <Loader2 size={14} className="animate-spin" />
          {t("common.loading")}
        </div>
      ) : all.length === 0 ? (
        <AdminEmptyState>{t("admin.vendors.empty")}</AdminEmptyState>
      ) : visible.length === 0 ? (
        <AdminEmptyState>{t("admin.vendors.empty_filtered")}</AdminEmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((v) => (
            <VendorCard key={`${v.state}-${v.id}`} vendor={v} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}
