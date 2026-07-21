import type { CommunitySupplierAdminView } from "@shared/community_suppliers";
import {
  AlertTriangle,
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
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
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

/** Fold a business name to a comparison key for the soft duplicate warning:
 *  lowercase, strip accents, drop the common HU company-form suffixes
 *  (kft/bt/zrt/kkt/e.v.) and any punctuation, then collapse whitespace. This
 *  is deliberately loose (a moderator hint, not a hard block), so we
 *  favour catching "Etalon Party" vs "Etalon Party Kft." over precision. */
function normalizeSupplierName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(kft|bt|zrt|kkt|e\.?v\.?|nyrt)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** `created_at` is Unix milliseconds (server uses `Date.now()` everywhere —
 *  see backend/src/db.ts `now()`). Earlier versions multiplied by 1000 here,
 *  which threw the date 1000× into the future and rendered the column
 *  unreadable — that was the "hozzáadás dátuma" bug. */
function formatDate(unixMs: number | null, locale: string): string {
  if (unixMs == null) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatDateTime(unixMs: number | null, locale: string): string {
  if (unixMs == null) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
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

/** Filter buckets in lifecycle order, each doubling as a KPI tile. `all`
 *  leads (total submissions), then the queue → live → hidden progression. */
const STATUS_FILTERS: { key: StatusFilter; labelKey: string }[] = [
  { key: "all", labelKey: "admin.filter_status_all" },
  { key: "pending", labelKey: "admin.filter_status_pending" },
  { key: "awaiting_review", labelKey: "admin.filter_status_awaiting_review" },
  { key: "active", labelKey: "admin.filter_status_active" },
  { key: "hidden", labelKey: "admin.filter_status_hidden" },
];

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

  // Soft duplicate detection: group every loaded listing (all statuses) by its
  // normalized name, then map each id to the OTHER listings sharing that key.
  // Purely a moderator hint on the card – never blocks an action.
  const duplicatesById = useMemo(() => {
    const byKey = new Map<string, CommunitySupplierAdminView[]>();
    for (const s of suppliers) {
      const key = normalizeSupplierName(s.name);
      if (!key) continue;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(s);
      else byKey.set(key, [s]);
    }
    const out = new Map<number, string[]>();
    for (const bucket of byKey.values()) {
      if (bucket.length < 2) continue;
      for (const s of bucket) {
        out.set(
          s.id,
          bucket.filter((o) => o.id !== s.id).map((o) => o.name),
        );
      }
    }
    return out;
  }, [suppliers]);

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

  async function onSendVerify(supplier: CommunitySupplierAdminView) {
    try {
      const r = await adminSupplierApi.sendVerify(supplier.id);
      replaceSupplier(r.supplier);
      toast.success(t("admin.send_verify_success"));
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
      {/* Uber-style segmented stat bar — mirrors the waitlist boards: the count
       *  is the headline (bold tabular figure), the status label sits under it,
       *  and the whole tile is the filter. Active tile flips to a koromfekete
       *  fill so the current segment reads at a glance on either theme. */}
      <div
        role="tablist"
        aria-label={t("admin.filter_status_label")}
        className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {STATUS_FILTERS.map(({ key, labelKey }) => {
          const count =
            key === "all" ? suppliers.length : suppliers.filter((s) => s.status === key).length;
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(key)}
              className={`flex min-h-tap flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 ${
                active
                  ? "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                  : "bg-paper-50 text-neutral-900 ring-1 ring-ink-100 hover:bg-paper-100 dark:bg-umber-900 dark:text-paper-100 dark:ring-umber-700 dark:hover:bg-umber-800"
              }`}
            >
              <span className="font-grotesk text-2xl font-semibold leading-none tabular-nums">
                {count}
              </span>
              <span
                className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
                  active
                    ? "text-paper-200 dark:text-umber-700"
                    : "text-neutral-500 dark:text-umber-300"
                }`}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk-action toolbar. Stays mounted for layout stability when the
       *  card grid loads. The select-all checkbox lives here so the toolbar
       *  doubles as the grid header. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 dark:border-umber-700 dark:bg-umber-700/60 px-3 py-2 text-sm">
        <label className="inline-flex items-center gap-2 text-xs text-neutral-700 dark:text-paper-100">
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
              onSendVerify={() => onSendVerify(s)}
              onHide={() => onHide(s)}
              onUnhide={() => onUnhide(s)}
              onEnrich={() => onEnrich(s)}
              onDelete={() => onDelete(s)}
              enriching={enriching === s.id}
              onSavedNotes={replaceSupplier}
              locale={locale}
              initiallyExpanded={s.id === autoExpandId}
              duplicateMatches={duplicatesById.get(s.id) ?? []}
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
      <dd className="m-0 min-w-0 break-words text-xs text-neutral-800 dark:text-paper-100">
        {isEmpty ? (
          <span className="text-neutral-400 dark:text-umber-300">
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
  onSendVerify: () => void;
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
  /** Names of other loaded listings that share this one's normalized name.
   *  Non-empty drives the soft duplicate warning chip. */
  duplicateMatches: string[];
}

function SupplierCard({
  supplier: s,
  selected,
  onToggleSelect,
  onApprove,
  onSendVerify,
  onHide,
  onUnhide,
  onEnrich,
  onDelete,
  enriching,
  onSavedNotes,
  locale,
  initiallyExpanded,
  duplicateMatches,
}: SupplierCardProps) {
  const { t } = useT();
  const toast = useToast();
  // Soft "profile looks thin" hint: only meaningful for listings the moderator
  // still has to approve. A listing with neither a website nor a blurb has
  // almost nothing for a couple to go on. Never blocks approval.
  const incomplete =
    (s.status === "pending" || s.status === "awaiting_review") &&
    !s.website?.trim() &&
    !s.blurb?.trim();
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
        selected ? "ring-2 ring-neutral-700 dark:ring-neutral-400/60" : ""
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
          <h2 className="m-0 text-sm font-semibold text-neutral-900 dark:text-paper-50">
            {s.name}
          </h2>
          <Pill tone="violet">{t(`suppliers.cat.${s.category}`)}</Pill>
          <StatusPill status={s.status} label={t(`admin.status_${s.status}`)} />
          {s.city ? (
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-umber-300">
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
          {duplicateMatches.length > 0 ? (
            <Pill
              tone="blush"
              icon={<AlertTriangle size={11} />}
              srLabel={t("admin.suppliers_card_dup_warning_aria")}
            >
              {t("admin.suppliers_card_dup_warning")}
            </Pill>
          ) : null}
          {incomplete ? (
            <Pill
              tone="blush"
              icon={<AlertTriangle size={11} />}
              srLabel={t("admin.suppliers_card_incomplete_aria")}
            >
              {t("admin.suppliers_card_incomplete")}
            </Pill>
          ) : null}
        </button>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-neutral-400 transition-transform dark:text-umber-300 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </header>

      {expanded ? (
        <div className="flex flex-col gap-4 px-3 py-3">
          {/* Soft moderation warnings — surfaced above the detail grid so the
           *  moderator reads them before acting. Advisory only: they name the
           *  concern but never disable Approve/Hide. */}
          {duplicateMatches.length > 0 || incomplete ? (
            <div className="flex flex-col gap-1 rounded-xl bg-blush-50 px-3 py-2 text-xs text-blush-800 ring-1 ring-blush-200 dark:bg-blush-900/30 dark:text-blush-200 dark:ring-blush-800">
              {duplicateMatches.length > 0 ? (
                <p className="m-0 flex items-start gap-1.5">
                  <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
                  <span>
                    {t("admin.suppliers_card_dup_detail", {
                      names: duplicateMatches.join(", "),
                    })}
                  </span>
                </p>
              ) : null}
              {incomplete ? (
                <p className="m-0 flex items-start gap-1.5">
                  <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
                  <span>{t("admin.suppliers_card_incomplete_detail")}</span>
                </p>
              ) : null}
            </div>
          ) : null}
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
                        <Mail
                          size={11}
                          aria-hidden
                          className="text-neutral-500 dark:text-umber-300"
                        />
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
                        <Phone
                          size={11}
                          aria-hidden
                          className="text-neutral-500 dark:text-umber-300"
                        />
                        <span>{decodeEntities(s.contact_phone)}</span>
                      </a>
                    ) : null
                  }
                />
                <DefRow
                  label={t("admin.suppliers_card_field_submitter")}
                  value={
                    <span className="inline-flex items-center gap-1">
                      <User
                        size={11}
                        aria-hidden
                        className="text-neutral-500 dark:text-umber-300"
                      />
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
                  value={s.price_band ? <PriceBandPill band={s.price_band} /> : "—"}
                />
                <DefRow
                  label={t("admin.suppliers_card_field_blurb")}
                  value={s.blurb ? <span className="whitespace-pre-line">{s.blurb}</span> : null}
                />
                {s.status === "hidden" && s.hide_reason ? (
                  <DefRow
                    label={t("admin.suppliers_card_field_hide_reason")}
                    value={
                      <span className="text-neutral-600 dark:text-umber-200">{s.hide_reason}</span>
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
                      <span className="text-neutral-500 dark:text-umber-300">0</span>
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
              <p className="text-xs text-neutral-500 dark:text-umber-300">
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
            {s.status === "pending" && s.contact_email && (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={onSendVerify}
                aria-label={t("admin.send_verify")}
                title={t("admin.send_verify_hint")}
              >
                {t("admin.send_verify")}
              </button>
            )}
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
            {s.status === "pending" && !s.contact_email && (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={onApprove}
                aria-label={t("admin.approve")}
                title={t("admin.approve_direct_hint")}
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
              title={t("admin.enrich_hint")}
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
