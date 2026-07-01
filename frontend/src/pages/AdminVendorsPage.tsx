// Admin vendor management (KEZELÉS → Szolgáltatók). Lists activated vendor
// accounts plus accepted-but-not-yet-activated onboarding rows, and lets an
// admin suspend/reactivate, edit details, delete, and resend the activation
// link. Sibling of AdminUsersPage; the BEÉRKEZŐ vendor waitlist stays separate.

import type { AdminVendorView } from "@shared/listings";
import { Ban, Check, Clock, Loader2, Mail, Pencil, RotateCcw, Store, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorMgmtApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type Filter = "all" | "active" | "pending" | "suspended";

function fmtDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Which bucket a row falls into for the filter chips. Pending rows are their
 *  own bucket; active rows split by the owner's suspension state. */
function vendorBucket(v: AdminVendorView): "pending" | "suspended" | "active" {
  if (v.state === "pending") return "pending";
  return v.owner_status === "suspended" ? "suspended" : "active";
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

  function handleReactivate() {
    void run(() => adminVendorMgmtApi.reactivate(vendor.id), "admin.vendors.reactivate_success");
  }

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

  return (
    <>
      {editing && (
        <EditModal vendor={vendor} onClose={() => setEditing(false)} onSaved={onChanged} />
      )}
      <div className="admin-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={statusPill.tone} icon={<statusPill.Icon size={11} />}>
                {statusPill.label}
              </Pill>
              {vendor.vendor_code && (
                <span className="text-xs text-umber-500 dark:text-umber-400">
                  {vendor.vendor_code}
                </span>
              )}
              {vendor.token_expired && <Pill tone="muted">{t("admin.vendors.token_expired")}</Pill>}
              <span className="text-xs text-umber-500 dark:text-umber-400">
                {fmtDate(vendor.created_at, locale)}
              </span>
            </div>
            <p className="mt-2 truncate font-medium text-umber-900 dark:text-paper-50">
              {vendor.display_name}
            </p>
            {vendor.contact_email && (
              <p className="truncate text-sm text-umber-700 dark:text-umber-300">
                {vendor.contact_email}
              </p>
            )}
            {vendor.contact_phone && (
              <p className="text-sm text-umber-700 dark:text-umber-300">{vendor.contact_phone}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-umber-500 dark:text-umber-400">
              {vendor.state === "active" && (
                <span>{t("admin.vendors.listing_count", { n: vendor.listing_count })}</span>
              )}
              {vendor.subscription_status && (
                <span>
                  {t("admin.vendors.subscription")}: {vendor.subscription_status}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
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
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  aria-label={t("admin.vendors.edit")}
                >
                  <Pencil size={13} />
                </Button>
                {bucket === "suspended" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReactivate}
                    disabled={busy}
                    aria-label={t("admin.vendors.reactivate")}
                  >
                    {busy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSuspend}
                    disabled={busy}
                    aria-label={t("admin.vendors.suspend")}
                  >
                    <Ban size={13} />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDelete}
                  disabled={busy}
                  aria-label={t("admin.vendors.delete")}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
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
    const c = { all: all.length, active: 0, pending: 0, suspended: 0 };
    for (const v of all) c[vendorBucket(v)]++;
    return c;
  }, [all]);

  const visible = filter === "all" ? all : all.filter((v) => vendorBucket(v) === filter);

  const FILTERS: Filter[] = ["all", "active", "pending", "suspended"];

  return (
    <>
      <AdminPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Store size={20} /> {t("admin.nav_vendors")}
          </span>
        }
        subtitle={t("admin.vendors.subtitle")}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <AdminFilterChip
            key={f}
            label={`${t(`admin.vendors.filter_${f}`)}${counts[f] > 0 ? ` · ${counts[f]}` : ""}`}
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
        <AdminEmptyState>{t("admin.vendors.empty")}</AdminEmptyState>
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
