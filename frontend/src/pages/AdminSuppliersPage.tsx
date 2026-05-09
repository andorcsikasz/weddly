import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import { ExternalLink, EyeOff, Eye, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminSupplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

function formatDate(unixSeconds: number, locale: string): string {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export default function AdminSuppliersPage() {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<CommunitySupplierAdminView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminSupplierApi
      .list()
      .then((r) => setSuppliers(r.suppliers))
      .catch((e) => {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      })
      .finally(() => setLoading(false));
  }, [toast, t]);

  function replaceSupplier(next: CommunitySupplierAdminView) {
    setSuppliers((cur) => cur.map((s) => (s.id === next.id ? next : s)));
  }

  async function onHide(supplier: CommunitySupplierAdminView) {
    const reason = await promptEntry({
      title: t("admin.confirm_hide_title"),
      label: t("admin.hide_reason_label"),
      placeholder: t("admin.hide_reason_placeholder"),
      helperText: t("admin.confirm_hide_body"),
      confirmLabel: t("admin.hide"),
      cancelLabel: t("common.cancel"),
    });
    if (reason === null) return;
    try {
      const trimmed = reason.trim();
      const r = await adminSupplierApi.hide(supplier.id, trimmed.length > 0 ? trimmed : undefined);
      replaceSupplier(r.supplier);
      toast.success(t("admin.hide"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onUnhide(supplier: CommunitySupplierAdminView) {
    try {
      const r = await adminSupplierApi.unhide(supplier.id);
      replaceSupplier(r.supplier);
      toast.success(t("admin.unhide"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onDelete(supplier: CommunitySupplierAdminView) {
    const ok = await confirm({
      title: t("admin.confirm_delete_title"),
      body: t("admin.confirm_delete_body"),
      confirmLabel: t("admin.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminSupplierApi.remove(supplier.id);
      setSuppliers((cur) => cur.filter((s) => s.id !== supplier.id));
      toast.success(t("admin.delete"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("admin.suppliers_title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("admin.suppliers_sub")}</p>
      </header>

      {loading ? (
        <div className="text-sm text-ink-500">{t("common.loading")}</div>
      ) : suppliers.length === 0 ? (
        <div className="card text-sm text-ink-500">{t("admin.empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">{t("admin.table_supplier")}</th>
                <th className="px-4 py-3 hidden md:table-cell">{t("admin.table_category")}</th>
                <th className="px-4 py-3 hidden lg:table-cell">{t("admin.table_submitter")}</th>
                <th className="px-4 py-3">{t("admin.table_status")}</th>
                <th className="px-4 py-3 text-right">{t("admin.table_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-paper-200 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">{s.name}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{s.city}</div>
                    {s.website && (
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-ink-700 underline-offset-2 hover:underline"
                      >
                        <ExternalLink size={12} aria-hidden />
                        <span className="truncate max-w-[16rem]">{s.website}</span>
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-ink-700">
                    {t(`suppliers.cat.${s.category}`)}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="text-ink-700 break-all">{s.submitter_email}</div>
                    <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-500">
                      {formatDate(s.created_at, locale)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} label={t(`admin.status_${s.status}`)} />
                    {s.status === "hidden" && s.hide_reason && (
                      <div className="mt-1 text-xs text-ink-500 italic max-w-[14rem]">
                        {s.hide_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {s.status === "active" ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onHide(s)}
                        aria-label={t("admin.hide")}
                      >
                        <EyeOff size={14} />
                        <span className="hidden sm:inline">{t("admin.hide")}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onUnhide(s)}
                        aria-label={t("admin.unhide")}
                      >
                        <Eye size={14} />
                        <span className="hidden sm:inline">{t("admin.unhide")}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-blush-700"
                      onClick={() => onDelete(s)}
                      aria-label={t("admin.delete")}
                    >
                      <Trash2 size={14} />
                      <span className="hidden sm:inline">{t("admin.delete")}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function StatusPill({ status, label }: { status: "active" | "hidden"; label: string }) {
  const cls =
    status === "active"
      ? "border-ink-700 bg-ink-700 text-paper-100"
      : "border-paper-300 bg-paper-100 text-ink-500";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
