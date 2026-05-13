import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminSupplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Decode HTML numeric character entities (`&#NN;`, `&#xHH;`) and the four
 *  named entities that show up in scraped emails/phones. Belt-and-braces:
 *  the backend now decodes during scrape, but older rows still carry the
 *  obfuscated text — decoding at the render boundary fixes them retroactively
 *  until the admin re-runs "Fetch from website". */
function decodeEntities(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** `created_at` is Unix milliseconds (server uses `Date.now()` everywhere —
 *  see backend/src/db.ts `now()`). Earlier versions multiplied by 1000 here,
 *  which threw the date 1000× into the future and rendered the column
 *  unreadable — that was the "hozzáadás dátuma" bug. */
function formatDate(unixMs: number | null, locale: string): string {
  if (unixMs == null) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatDateTime(unixMs: number | null, locale: string): string {
  if (unixMs == null) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

  const replaceSupplier = useCallback((next: CommunitySupplierAdminView) => {
    setSuppliers((cur) => cur.map((s) => (s.id === next.id ? next : s)));
  }, []);

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
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("admin.suppliers_sub")}</p>
      </header>

      {/* Status filter chips. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
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

      {/* Bulk-action toolbar. Stays mounted for layout stability when the
       *  card grid loads. The select-all checkbox lives here so the toolbar
       *  doubles as the grid header. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 dark:border-umber-700 dark:bg-umber-700/60 px-3 py-2 text-sm">
        <label className="inline-flex items-center gap-2 text-xs text-ink-700 dark:text-paper-100">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label={t("admin.select_all_aria")}
          />
          {t("admin.bulk_selected", { n: selected.size })}
        </label>
        {selected.size > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            {t("admin.bulk_clear")}
          </button>
        )}
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={onBulkHide}
            disabled={selected.size === 0}
          >
            <EyeOff size={14} /> {t("admin.bulk_hide")}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm text-violet-950 dark:text-violet-200"
            onClick={onBulkDelete}
            disabled={selected.size === 0}
          >
            <Trash2 size={14} /> {t("admin.bulk_delete")}
          </button>
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</div>
      ) : suppliers.length === 0 ? (
        <div className="card text-sm text-ink-500 dark:text-umber-300">{t("admin.empty")}</div>
      ) : visibleSuppliers.length === 0 ? (
        <div className="card text-sm text-ink-500 dark:text-umber-300">
          {t("admin.empty_filtered")}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleSuppliers.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggleRow(s.id)}
              onApprove={() => onApprove(s)}
              onHide={() => onHide(s)}
              onUnhide={() => onUnhide(s)}
              onEnrich={() => onEnrich(s)}
              onDelete={() => onDelete(s)}
              enriching={enriching === s.id}
              onSavedNotes={replaceSupplier}
              locale={locale}
            />
          ))}
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
          ? "rounded-full border border-violet-900 bg-violet-900 dark:border-violet-500/50 dark:bg-violet-500/30 px-3 py-1 text-xs font-medium text-paper-100 dark:text-violet-100"
          : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-violet-950 hover:border-violet-300 dark:border-umber-700 dark:bg-umber-800 dark:text-violet-200 dark:hover:border-violet-400/40"
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
      ? "border-violet-900 bg-violet-900 text-paper-100 dark:border-violet-500/50 dark:bg-violet-500/30 dark:text-violet-100"
      : status === "awaiting_review"
        ? "border-violet-700 bg-violet-100 text-violet-900 font-semibold dark:border-violet-400/40 dark:bg-violet-500/20 dark:text-violet-200"
        : status === "pending"
          ? "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200"
          : "border-paper-300 bg-paper-100 text-ink-500 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-300";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/** Renders the price-band as $..$$$$$ in a tabular-num span so widths line up
 *  across the grid. Curated entries set band on insert; we clamp to 1..5
 *  defensively on the server. */
function PriceBandPill({ band }: { band: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="inline-flex items-center rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-2 py-0.5 text-xs font-medium text-ink-700 dark:text-paper-100 stat-num">
      {"$".repeat(band)}
    </span>
  );
}

/** Field row inside a card section. `value` may be null/empty — we render a
 *  locale-specific em-dash so the column stays visually aligned. */
function CardField({
  label,
  value,
  href,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  mono?: boolean;
}) {
  const { t } = useT();
  const isEmpty = value == null || (typeof value === "string" && value.trim().length === 0);
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {label}
      </span>
      {isEmpty ? (
        <span className="text-sm text-ink-400 dark:text-umber-300">
          {t("admin.suppliers_card_empty_value")}
        </span>
      ) : href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={`mt-0.5 inline-flex items-center gap-1 text-sm text-ink-800 dark:text-paper-100 underline-offset-2 hover:underline ${
            mono ? "stat-num" : ""
          }`}
        >
          <span className="truncate">{value}</span>
          <ExternalLink size={12} aria-hidden className="shrink-0" />
        </a>
      ) : (
        <span
          className={`mt-0.5 break-words text-sm text-ink-800 dark:text-paper-100 ${mono ? "stat-num" : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

interface SupplierCardProps {
  supplier: CommunitySupplierAdminView;
  selected: boolean;
  onToggleSelect: () => void;
  onApprove: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onEnrich: () => void;
  onDelete: () => void;
  enriching: boolean;
  onSavedNotes: (next: CommunitySupplierAdminView) => void;
  locale: string;
}

function SupplierCard({
  supplier: s,
  selected,
  onToggleSelect,
  onApprove,
  onHide,
  onUnhide,
  onEnrich,
  onDelete,
  enriching,
  onSavedNotes,
  locale,
}: SupplierCardProps) {
  const { t } = useT();
  const toast = useToast();
  const [notesDraft, setNotesDraft] = useState<string>(s.admin_notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  // Cards collapse by default — moderators rarely need the full CRM detail
  // surface for every row at once. Click the chevron (or "Részletek") to
  // expand. Pending/awaiting-review rows start expanded since those are the
  // ones the admin actually has to read end-to-end before approving.
  const [expanded, setExpanded] = useState<boolean>(
    s.status === "pending" || s.status === "awaiting_review",
  );
  const persisted = s.admin_notes ?? "";
  const dirty = notesDraft !== persisted;

  // Re-sync when the supplier prop changes (other actions may have replaced
  // the row — e.g. hide/unhide/approve/enrich path). Only stomp when we're
  // not mid-edit so we don't lose the admin's keystrokes.
  useEffect(() => {
    setNotesDraft(s.admin_notes ?? "");
  }, [s.admin_notes]);

  async function onSaveNotes() {
    setNotesSaving(true);
    try {
      const r = await adminSupplierApi.updateNotes(s.id, notesDraft);
      onSavedNotes(r.supplier);
      toast.success(t("admin.suppliers_card_notes_save_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setNotesSaving(false);
    }
  }

  return (
    <article
      className={`card flex flex-col gap-3 p-3 transition ${
        selected ? "ring-2 ring-violet-700 dark:ring-violet-400/60" : ""
      }`}
      aria-label={s.name}
    >
      {/* Header row: select + name/city + status + price band + expand toggle.
       *  This row is the entire card when collapsed. */}
      <header className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={t("admin.select_row_aria")}
          />
        </label>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={
            expanded ? t("admin.suppliers_card_collapse") : t("admin.suppliers_card_expand")
          }
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="m-0 text-base font-semibold text-ink-900 dark:text-paper-50">
              {s.name}
            </h2>
            <StatusPill status={s.status} label={t(`admin.status_${s.status}`)} />
            <PriceBandPill band={s.price_band} />
            <span className="text-xs text-ink-500 dark:text-umber-300">
              {t(`suppliers.cat.${s.category}`)}
            </span>
            {s.city ? (
              <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
                <MapPin size={12} aria-hidden />
                {s.city}
              </span>
            ) : null}
            {s.open_report_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-950 dark:text-violet-200">
                <Flag size={12} aria-hidden />
                {s.open_report_count}
              </span>
            ) : null}
          </div>
        </button>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-ink-400 transition-transform dark:text-umber-300 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </header>

      {expanded ? (
        <>
          {/* Body: three even columns on lg, stacking on small viewports. The
           *  card stays vertically centred via items-stretch on the parent — each
           *  column carries its own gap-3 so internal rhythm is consistent. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Contact column */}
            <section className="flex flex-col gap-3">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-violet-950 dark:text-violet-200">
                {t("admin.suppliers_card_section_contact")}
              </h3>
              <CardField
                label={t("admin.suppliers_card_field_website")}
                value={s.website}
                href={s.website || undefined}
              />
              <CardField
                label={t("admin.suppliers_card_field_contact_email")}
                value={
                  s.contact_email ? (
                    <a
                      href={`mailto:${decodeEntities(s.contact_email)}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Mail size={12} aria-hidden className="text-ink-500 dark:text-umber-300" />
                      <span className="break-all">{decodeEntities(s.contact_email)}</span>
                    </a>
                  ) : null
                }
              />
              <CardField
                label={t("admin.suppliers_card_field_contact_phone")}
                value={
                  s.contact_phone ? (
                    <a
                      href={`tel:${decodeEntities(s.contact_phone).replace(/\s+/g, "")}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Phone size={12} aria-hidden className="text-ink-500 dark:text-umber-300" />
                      <span>{decodeEntities(s.contact_phone)}</span>
                    </a>
                  ) : null
                }
              />
              <CardField
                label={t("admin.suppliers_card_field_submitter")}
                value={
                  <span className="inline-flex items-center gap-1">
                    <User size={12} aria-hidden className="text-ink-500 dark:text-umber-300" />
                    <span className="break-all">{s.submitter_email}</span>
                  </span>
                }
              />
            </section>

            {/* Listing column */}
            <section className="flex flex-col gap-3">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-violet-950 dark:text-violet-200">
                {t("admin.suppliers_card_section_listing")}
              </h3>
              <CardField
                label={t("admin.suppliers_card_field_blurb")}
                value={s.blurb ? <span className="whitespace-pre-line">{s.blurb}</span> : null}
              />
              {s.status === "hidden" && s.hide_reason ? (
                <CardField
                  label={t("admin.suppliers_card_field_hide_reason")}
                  value={
                    <span className="italic text-ink-600 dark:text-umber-200">{s.hide_reason}</span>
                  }
                />
              ) : null}
            </section>

            {/* Meta + metrics column */}
            <section className="flex flex-col gap-3">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-violet-950 dark:text-violet-200">
                {t("admin.suppliers_card_section_meta")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <CardField label={t("admin.suppliers_card_field_id")} value={`#${s.id}`} mono />
                <CardField
                  label={t("admin.suppliers_card_field_submitter_id")}
                  value={`#${s.submitter_user_id}`}
                  mono
                />
                <CardField
                  label={t("admin.suppliers_card_field_submitted_at")}
                  value={formatDate(s.created_at, locale)}
                />
                <CardField
                  label={t("admin.suppliers_card_field_updated_at")}
                  value={formatDateTime(s.updated_at, locale)}
                />
                {s.hidden_at ? (
                  <CardField
                    label={t("admin.suppliers_card_field_hidden_at")}
                    value={formatDateTime(s.hidden_at, locale)}
                  />
                ) : null}
                <CardField
                  label={t("admin.suppliers_card_field_open_reports")}
                  value={
                    <span
                      className={
                        s.open_report_count > 0
                          ? "inline-flex items-center gap-1 font-semibold text-violet-950 dark:text-violet-200"
                          : "inline-flex items-center gap-1 text-ink-500 dark:text-umber-300"
                      }
                    >
                      <Flag size={12} aria-hidden />
                      {s.open_report_count}
                    </span>
                  }
                  mono
                />
              </div>
            </section>
          </div>

          {/* Admin notes — the CRM heart of the page. Editable in place, with a
           *  dirty indicator and an explicit save action so an accidental tab
           *  away doesn't silently drop a half-typed thought. */}
          <section className="flex flex-col gap-2 rounded-xl border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-violet-950 dark:text-violet-200">
                {t("admin.suppliers_card_section_notes")}
              </h3>
              <span
                className={`text-[10px] uppercase tracking-wide ${
                  dirty ? "text-blush-700 dark:text-blush-300" : "text-ink-500 dark:text-umber-300"
                }`}
              >
                {dirty
                  ? t("admin.suppliers_card_field_notes_dirty")
                  : t("admin.suppliers_card_field_notes_saved")}
              </span>
            </div>
            <textarea
              className="input min-h-[80px] resize-y bg-white dark:bg-umber-700"
              placeholder={t("admin.suppliers_card_field_admin_notes_placeholder")}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              aria-label={t("admin.suppliers_card_field_admin_notes")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {t("admin.suppliers_card_field_admin_notes_help")}
              </p>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={onSaveNotes}
                disabled={!dirty || notesSaving}
              >
                {notesSaving
                  ? t("admin.suppliers_card_field_notes_saving")
                  : t("admin.suppliers_card_field_notes_save")}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {/* Footer: per-row action buttons. Keep the order familiar: Approve
       *  (when applicable) → Enrich → Hide/Unhide → Delete. */}
      <footer className="flex flex-wrap items-center justify-end gap-1 border-t border-paper-200 dark:border-umber-700 pt-2">
        {s.status === "awaiting_review" && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={onApprove}
            aria-label={t("admin.approve")}
          >
            <Check size={14} /> {t("admin.approve")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onEnrich}
          disabled={enriching}
          aria-label={t("admin.enrich")}
          title={t("admin.enrich")}
        >
          <Sparkles size={14} />
          <span>{enriching ? t("admin.enrich_running") : t("admin.enrich")}</span>
        </button>
        {s.status === "active" ? (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onHide}
            aria-label={t("admin.hide")}
          >
            <EyeOff size={14} /> {t("admin.hide")}
          </button>
        ) : s.status === "hidden" ? (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onUnhide}
            aria-label={t("admin.unhide")}
          >
            <Eye size={14} /> {t("admin.unhide")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost btn-sm text-violet-950"
          onClick={onDelete}
          aria-label={t("admin.delete")}
        >
          <Trash2 size={14} /> {t("admin.delete")}
        </button>
      </footer>
    </article>
  );
}
