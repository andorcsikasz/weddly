import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import { Check, ExternalLink, Eye, EyeOff, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminSupplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** `created_at` is Unix milliseconds (server uses `Date.now()` everywhere —
 *  see backend/src/db.ts `now()`). Earlier versions multiplied by 1000 here,
 *  which threw the date 1000× into the future and rendered the column
 *  unreadable — that was the "hozzáadás dátuma" bug. */
function formatDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** UI filter buckets. The backend stores four real statuses now —
 *  `pending` (email not yet verified), `awaiting_review` (email verified,
 *  admin sign-off pending), `active`, `hidden`. The `awaiting_review` bucket
 *  is the moderation queue and the default place the admin lands. */
type StatusFilter = "all" | "pending" | "awaiting_review" | "active" | "hidden";

export default function AdminSuppliersPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.admin_suppliers_title", "seo.admin_suppliers_description");
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<CommunitySupplierAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    adminSupplierApi
      .list()
      .then((r) => {
        // Newest first by created_at — matches the spec's default sort.
        const sorted = [...r.suppliers].sort((a, b) => b.created_at - a.created_at);
        setSuppliers(sorted);
      })
      .catch((e) => {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      })
      .finally(() => setLoading(false));
  }, [toast, t]);

  function replaceSupplier(next: CommunitySupplierAdminView) {
    setSuppliers((cur) => cur.map((s) => (s.id === next.id ? next : s)));
  }

  // Apply the status filter. We re-derive once per render — list stays small.
  const visibleSuppliers = useMemo(() => {
    if (filter === "all") return suppliers;
    return suppliers.filter((s) => s.status === filter);
  }, [suppliers, filter]);

  const awaitingReviewCount = useMemo(
    () => suppliers.filter((s) => s.status === "awaiting_review").length,
    [suppliers],
  );

  // Reset selection when filter changes — selected ids might no longer be visible.
  useEffect(() => {
    setSelected(new Set());
  }, [filter]);

  function toggleRow(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((cur) => {
      const visibleIds = visibleSuppliers.map((s) => s.id);
      const allSelected = visibleIds.every((id) => cur.has(id)) && visibleIds.length > 0;
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  }

  async function onHide(supplier: CommunitySupplierAdminView) {
    const reason = await promptEntry({
      title: t("admin.confirm_hide_title"),
      label: `${t("admin.hide_reason_label")} ${t("admin.hide_reason_optional")}`,
      placeholder: t("admin.hide_reason_placeholder"),
      helperText: t("admin.hide_reason_help"),
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

  async function onApprove(supplier: CommunitySupplierAdminView) {
    try {
      const r = await adminSupplierApi.approve(supplier.id);
      replaceSupplier(r.supplier);
      toast.success(t("admin.approve_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  const [enriching, setEnriching] = useState<number | null>(null);
  async function onEnrich(supplier: CommunitySupplierAdminView) {
    setEnriching(supplier.id);
    try {
      const r = await adminSupplierApi.enrich(supplier.id);
      replaceSupplier(r.supplier);
      if (r.fields_filled > 0) {
        toast.success(t("admin.enrich_filled", { n: r.fields_filled }));
      } else {
        toast.success(t("admin.enrich_none"));
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setEnriching(null);
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

  async function onBulkHide() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t("admin.bulk_hide_confirm_title"),
      body: t("admin.bulk_hide_confirm_body", { n: ids.length }),
      confirmLabel: t("admin.bulk_hide"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    // Best-effort sequential — small N, audit log keeps order tidy.
    let failed = 0;
    for (const id of ids) {
      try {
        const r = await adminSupplierApi.hide(id);
        replaceSupplier(r.supplier);
      } catch {
        failed++;
      }
    }
    if (failed > 0) toast.error(t("common.error_generic"));
    else toast.success(t("admin.bulk_hide"));
    setSelected(new Set());
  }

  async function onBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t("admin.bulk_delete_confirm_title"),
      body: t("admin.bulk_delete_confirm_body", { n: ids.length }),
      confirmLabel: t("admin.bulk_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    let failed = 0;
    const removed = new Set<number>();
    for (const id of ids) {
      try {
        await adminSupplierApi.remove(id);
        removed.add(id);
      } catch {
        failed++;
      }
    }
    setSuppliers((cur) => cur.filter((s) => !removed.has(s.id)));
    if (failed > 0) toast.error(t("common.error_generic"));
    else toast.success(t("admin.bulk_delete"));
    setSelected(new Set());
  }

  const visibleIds = visibleSuppliers.map((s) => s.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("admin.suppliers_title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("admin.suppliers_sub")}</p>
      </header>

      {/* Status filter chips. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-500">
          {t("admin.filter_status_label")}
        </span>
        <FilterChip
          label={t("admin.filter_status_all")}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterChip
          label={t("admin.filter_status_pending")}
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
        />
        <FilterChip
          label={
            awaitingReviewCount > 0
              ? `${t("admin.filter_status_awaiting_review")} · ${awaitingReviewCount}`
              : t("admin.filter_status_awaiting_review")
          }
          active={filter === "awaiting_review"}
          onClick={() => setFilter("awaiting_review")}
        />
        <FilterChip
          label={t("admin.filter_status_active")}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <FilterChip
          label={t("admin.filter_status_hidden")}
          active={filter === "hidden"}
          onClick={() => setFilter("hidden")}
        />
      </div>

      {/* Bulk-action toolbar. Stays mounted for layout stability. */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
          <span className="font-medium text-ink-700">
            {t("admin.bulk_selected", { n: selected.size })}
          </span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            {t("admin.bulk_clear")}
          </button>
          <span className="ml-auto flex gap-1">
            <button type="button" className="btn-outline btn-sm" onClick={onBulkHide}>
              <EyeOff size={14} /> {t("admin.bulk_hide")}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-violet-800"
              onClick={onBulkDelete}
            >
              <Trash2 size={14} /> {t("admin.bulk_delete")}
            </button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-500">{t("common.loading")}</div>
      ) : suppliers.length === 0 ? (
        <div className="card text-sm text-ink-500">{t("admin.empty")}</div>
      ) : visibleSuppliers.length === 0 ? (
        <div className="card text-sm text-ink-500">{t("admin.empty_filtered")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t("admin.select_all_aria")}
                  />
                </th>
                <th className="px-4 py-3">{t("admin.table_supplier")}</th>
                <th className="px-4 py-3 hidden md:table-cell">{t("admin.table_category")}</th>
                <th className="px-4 py-3 hidden lg:table-cell">{t("admin.table_submitter")}</th>
                <th className="px-4 py-3">{t("admin.table_submitted_at")}</th>
                <th className="px-4 py-3">{t("admin.table_status")}</th>
                <th className="px-4 py-3 text-right">{t("admin.table_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleSuppliers.map((s) => {
                const isSel = selected.has(s.id);
                return (
                  <tr key={s.id} className="border-t border-paper-200 align-top">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(s.id)}
                        aria-label={t("admin.select_row_aria")}
                      />
                    </td>
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
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-ink-500 whitespace-nowrap">
                      {formatDate(s.created_at, locale)}
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
                      {s.status === "awaiting_review" && (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => onApprove(s)}
                          aria-label={t("admin.approve")}
                        >
                          <Check size={14} />
                          <span className="hidden sm:inline">{t("admin.approve")}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onEnrich(s)}
                        disabled={enriching === s.id}
                        aria-label={t("admin.enrich")}
                        title={t("admin.enrich")}
                      >
                        <Sparkles size={14} />
                        <span className="hidden md:inline">
                          {enriching === s.id ? t("admin.enrich_running") : t("admin.enrich")}
                        </span>
                      </button>
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
                      ) : s.status === "hidden" ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => onUnhide(s)}
                          aria-label={t("admin.unhide")}
                        >
                          <Eye size={14} />
                          <span className="hidden sm:inline">{t("admin.unhide")}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-violet-800"
                        onClick={() => onDelete(s)}
                        aria-label={t("admin.delete")}
                      >
                        <Trash2 size={14} />
                        <span className="hidden sm:inline">{t("admin.delete")}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-violet-700 bg-violet-700 px-3 py-1 text-xs font-medium text-paper-100"
          : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-violet-800 hover:border-violet-300"
      }
    >
      {label}
    </button>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: "active" | "hidden" | "pending" | "awaiting_review";
  label: string;
}) {
  const cls =
    status === "active"
      ? "border-violet-700 bg-violet-700 text-paper-100"
      : status === "awaiting_review"
        ? "border-violet-500 bg-violet-100 text-violet-900 font-semibold"
        : status === "pending"
          ? "border-violet-300 bg-violet-50 text-violet-800"
          : "border-paper-300 bg-paper-100 text-ink-500";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
