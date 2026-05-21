import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import {
  Check,
  ChevronDown,
  Clock,
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
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import { SupplierDirectoryView } from "../components/admin/SupplierDirectoryView";
import { SegmentedControl, Skeleton, useConfirm, useEntryPrompt, useToast } from "../components/ui";
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
  const { t } = useT();
  useDocumentMeta("seo.admin_suppliers_title", "seo.admin_suppliers_description");
  // Two views share this page: the moderation card list (existing community
  // moderation flow) and the full directory analytics view (curated +
  // community merged with visit counters + CSV export).
  const [view, setView] = useState<"moderation" | "directory">("moderation");

  return (
    <>
      <AdminPageHeader title={t("admin.suppliers_title")} subtitle={t("admin.suppliers_sub")}>
        <SegmentedControl
          ariaLabel={t("admin.suppliers_title")}
          value={view}
          onChange={setView}
          options={[
            { value: "moderation", label: t("admin.suppliers_view_moderation") },
            { value: "directory", label: t("admin.suppliers_view_directory") },
          ]}
        />
      </AdminPageHeader>

      {view === "directory" ? <SupplierDirectoryView /> : <ModerationView />}
    </>
  );
}

function ModerationView() {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<CommunitySupplierAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [enriching, setEnriching] = useState<number | null>(null);
  // Track which row is auto-expanded on initial load. We only ever auto-pop
  // the very first awaiting_review row so the moderator's first action is
  // one click away — every other row stays collapsed until clicked.
  const [autoExpandId, setAutoExpandId] = useState<number | null>(null);

  useEffect(() => {
    adminSupplierApi
      .list()
      .then((r) => {
        // Newest first by created_at — matches the spec's default sort.
        const sorted = [...r.suppliers].sort((a, b) => b.created_at - a.created_at);
        setSuppliers(sorted);
        // First awaiting_review row in the sorted list — the moderator's
        // hottest triage candidate. Set only once on mount so re-renders
        // (after approve/hide/etc.) don't keep re-expanding a different row.
        const firstAwaiting = sorted.find((s) => s.status === "awaiting_review");
        setAutoExpandId(firstAwaiting?.id ?? null);
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
  }, [filter, setSelected]);

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
    <>
      {/* Status filter chips. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="eyebrow">{t("admin.filter_status_label")}</span>
        <AdminFilterChip
          label={t("admin.filter_status_all")}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <AdminFilterChip
          label={t("admin.filter_status_pending")}
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
        />
        <AdminFilterChip
          label={
            awaitingReviewCount > 0
              ? `${t("admin.filter_status_awaiting_review")} · ${awaitingReviewCount}`
              : t("admin.filter_status_awaiting_review")
          }
          active={filter === "awaiting_review"}
          onClick={() => setFilter("awaiting_review")}
        />
        <AdminFilterChip
          label={t("admin.filter_status_active")}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <AdminFilterChip
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
            className="btn-alert btn-sm"
            onClick={onBulkDelete}
            disabled={selected.size === 0}
          >
            <Trash2 size={14} /> {t("admin.bulk_delete_action")}
          </button>
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <article key={i} className="admin-card flex items-center gap-2 py-2">
              <Skeleton width={16} height={16} rounded="sm" />
              <Skeleton width={180} height={16} />
              <Skeleton width={64} height={20} rounded="full" />
              <Skeleton width={70} height={20} rounded="full" />
              <Skeleton width={110} height={12} />
              <Skeleton width={16} height={16} rounded="sm" className="ml-auto" />
            </article>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <AdminEmptyState>{t("admin.empty")}</AdminEmptyState>
      ) : visibleSuppliers.length === 0 ? (
        <AdminEmptyState>{t("admin.empty_filtered")}</AdminEmptyState>
      ) : (
        <div className="flex flex-col gap-2">
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
              initiallyExpanded={s.id === autoExpandId}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Status pill — single tone+icon mapping for the four supplier lifecycle
 *  states. awaiting_review picks up a clock glyph so it reads as the queue
 *  the moderator should clear first. */
function StatusPill({
  status,
  label,
}: {
  status: "active" | "hidden" | "pending" | "awaiting_review";
  label: string;
}) {
  if (status === "active") {
    return (
      <Pill tone="sage" srLabel={label}>
        {label}
      </Pill>
    );
  }
  if (status === "awaiting_review") {
    return (
      <Pill tone="blush" icon={<Clock size={11} />} srLabel={label}>
        {label}
      </Pill>
    );
  }
  if (status === "pending") {
    return (
      <Pill tone="blush" icon={<Clock size={11} />} srLabel={label}>
        {label}
      </Pill>
    );
  }
  return (
    <Pill tone="muted" srLabel={label}>
      {label}
    </Pill>
  );
}

/** Price-band glyph pill — $..$$$$$. The earlier version pinned `stat-num`
 *  on this so columns lined up; but $ is a glyph, not a digit, and
 *  tabular-num just stretches the spacing weirdly. Plain Pill is enough. */
function PriceBandPill({ band }: { band: 1 | 2 | 3 | 4 | 5 }) {
  const { t } = useT();
  return (
    <Pill tone="paper" srLabel={t("admin.price_band_aria", { band })}>
      {"$".repeat(band)}
    </Pill>
  );
}

/** Definition-list row. Renders `label` on the left (8rem, the eyebrow
 *  treatment) and `value` on the right, wrapping if long. Used inside the
 *  expanded card body — replaces the old four-column CardField stacks. */
function DefRow({
  label,
  value,
  href,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  const { t } = useT();
  const isEmpty = value == null || (typeof value === "string" && value.trim().length === 0);
  return (
    <>
      <dt className="eyebrow self-center">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-xs text-ink-800 dark:text-paper-100">
        {isEmpty ? (
          <span className="text-ink-400 dark:text-umber-300">
            {t("admin.suppliers_card_empty_value")}
          </span>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            <span className="truncate">{value}</span>
            <ExternalLink size={11} aria-hidden className="shrink-0" />
          </a>
        ) : (
          value
        )}
      </dd>
    </>
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
  /** True only for the first awaiting_review row on initial load; lets the
   *  moderator see the full detail surface for triage without an extra click. */
  initiallyExpanded: boolean;
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
  initiallyExpanded,
}: SupplierCardProps) {
  const { t } = useT();
  const toast = useToast();
  const [notesDraft, setNotesDraft] = useState<string>(s.admin_notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  // Cards collapse by default. The parent flags exactly one row (the first
  // awaiting_review submission) for auto-expand on mount so the moderator
  // sees full detail + actions one click away. Everything else stays
  // collapsed; the moderator can click any row to expand it.
  const [expanded, setExpanded] = useState<boolean>(initiallyExpanded);
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
      className={`admin-card !p-0 transition ${
        selected ? "ring-2 ring-violet-700 dark:ring-violet-400/60" : ""
      }`}
      aria-label={s.name}
    >
      {/* Collapsed row — name + category pill + status pill + city.
       *  The whole row is the click target (except the checkbox). Hover
       *  state gives the moderator a clear "this row is interactive"
       *  signal across an otherwise-static list. */}
      <header
        className={`flex flex-wrap items-center gap-2 px-3 py-2 transition-colors duration-150 ${
          expanded ? "" : "hover:bg-paper-100/60 dark:hover:bg-umber-800/60"
        } ${expanded ? "border-b border-paper-200 dark:border-umber-700" : ""}`}
      >
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
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={
            expanded ? t("admin.suppliers_card_collapse") : t("admin.suppliers_card_expand")
          }
        >
          <h2 className="m-0 text-sm font-semibold text-ink-900 dark:text-paper-50">{s.name}</h2>
          <Pill tone="violet">{t(`suppliers.cat.${s.category}`)}</Pill>
          <StatusPill status={s.status} label={t(`admin.status_${s.status}`)} />
          {s.city ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={12} aria-hidden />
              {s.city}
            </span>
          ) : null}
          {s.open_report_count > 0 ? (
            <Pill
              tone="blush"
              icon={<Flag size={11} />}
              srLabel={t("admin.suppliers_card_field_open_reports")}
            >
              {s.open_report_count}
            </Pill>
          ) : null}
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
        <div className="flex flex-col gap-4 px-3 py-3">
          {/* Body: three-column dl grid on lg, stacking on small viewports.
           *  Each <dl> packs label/value pairs into a tight `grid-cols-[8rem_1fr]
           *  gap-y-1 text-xs` rhythm — roughly half the vertical height of the
           *  prior 4× CardField column stack. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Contact column */}
            <section className="flex flex-col gap-2">
              <h3 className="eyebrow m-0">{t("admin.suppliers_card_section_contact")}</h3>
              <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                <DefRow
                  label={t("admin.suppliers_card_field_website")}
                  value={s.website}
                  href={s.website || undefined}
                />
                <DefRow
                  label={t("admin.suppliers_card_field_contact_email")}
                  value={
                    s.contact_email ? (
                      <a
                        href={`mailto:${decodeEntities(s.contact_email)}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Mail size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                        <span className="break-all">{decodeEntities(s.contact_email)}</span>
                      </a>
                    ) : null
                  }
                />
                <DefRow
                  label={t("admin.suppliers_card_field_contact_phone")}
                  value={
                    s.contact_phone ? (
                      <a
                        href={`tel:${decodeEntities(s.contact_phone).replace(/\s+/g, "")}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                        <span>{decodeEntities(s.contact_phone)}</span>
                      </a>
                    ) : null
                  }
                />
                <DefRow
                  label={t("admin.suppliers_card_field_submitter")}
                  value={
                    <span className="inline-flex items-center gap-1">
                      <User size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                      <span className="break-all">{s.submitter_email}</span>
                    </span>
                  }
                />
              </dl>
            </section>

            {/* Listing column */}
            <section className="flex flex-col gap-2">
              <h3 className="eyebrow m-0">{t("admin.suppliers_card_section_listing")}</h3>
              <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                <DefRow
                  label={t("admin.suppliers_card_field_price_band")}
                  value={<PriceBandPill band={s.price_band} />}
                />
                <DefRow
                  label={t("admin.suppliers_card_field_blurb")}
                  value={s.blurb ? <span className="whitespace-pre-line">{s.blurb}</span> : null}
                />
                {s.status === "hidden" && s.hide_reason ? (
                  <DefRow
                    label={t("admin.suppliers_card_field_hide_reason")}
                    value={
                      <span className="text-ink-600 dark:text-umber-200">{s.hide_reason}</span>
                    }
                  />
                ) : null}
              </dl>
            </section>

            {/* Meta + metrics column */}
            <section className="flex flex-col gap-2">
              <h3 className="eyebrow m-0">{t("admin.suppliers_card_section_meta")}</h3>
              <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                <DefRow label={t("admin.suppliers_card_field_id")} value={`#${s.id}`} />
                <DefRow
                  label={t("admin.suppliers_card_field_submitter_id")}
                  value={`#${s.submitter_user_id}`}
                />
                <DefRow
                  label={t("admin.suppliers_card_field_submitted_at")}
                  value={formatDate(s.created_at, locale)}
                />
                <DefRow
                  label={t("admin.suppliers_card_field_updated_at")}
                  value={formatDateTime(s.updated_at, locale)}
                />
                {s.hidden_at ? (
                  <DefRow
                    label={t("admin.suppliers_card_field_hidden_at")}
                    value={formatDateTime(s.hidden_at, locale)}
                  />
                ) : null}
                <DefRow
                  label={t("admin.suppliers_card_field_open_reports")}
                  value={
                    s.open_report_count > 0 ? (
                      <Pill tone="blush" icon={<Flag size={11} />}>
                        {s.open_report_count}
                      </Pill>
                    ) : (
                      <span className="text-ink-500 dark:text-umber-300">0</span>
                    )
                  }
                />
              </dl>
            </section>
          </div>

          {/* Admin notes — the CRM heart of the page. Editable in place, with a
           *  dirty indicator and an explicit save action so an accidental tab
           *  away doesn't silently drop a half-typed thought. */}
          <section className="admin-card flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="eyebrow m-0">{t("admin.suppliers_card_section_notes")}</h3>
              <span className={`eyebrow ${dirty ? "text-blush-700 dark:text-blush-300" : ""}`}>
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

          {/* Per-row action buttons. Keep the order familiar: Approve
           *  (when applicable) → Enrich → Hide/Unhide → Delete. Footer
           *  only renders inside the expanded body so the collapsed row
           *  stays single-line. */}
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
              className="btn-alert btn-sm"
              onClick={onDelete}
              aria-label={t("admin.delete")}
            >
              <Trash2 size={14} /> {t("admin.delete_action")}
            </button>
          </footer>
        </div>
      ) : null}
    </article>
  );
}
