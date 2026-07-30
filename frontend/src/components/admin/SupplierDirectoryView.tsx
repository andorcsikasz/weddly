import {
  type AdminDirectoryFacets,
  type AdminDirectoryFilters,
  DIRECTORY_GAPS,
  type DirectoryGap,
  SUPPLIER_GROUPS,
  type SupplierCategory,
  type SupplierDirectoryAdminRow,
} from "@shared/suppliers";
import { intlLocale } from "../../lib/format";
import { safeExternalHref } from "../../lib/url";
import {
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  ImageDown,
  MailX,
  MapPin,
  Search,
  SlidersHorizontal,
  Trash2,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm, useEntryPrompt, useToast } from "../ui";
import { ApiError } from "../../lib/api";
import { adminSupplierApi } from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";

/** Categories the directory covers, derived from the single taxonomy source so
 *  it can never drift from the enum. */
const CATEGORIES: SupplierCategory[] = SUPPLIER_GROUPS.flatMap((g) => g.categories);

type SortKey =
  | "name"
  | "city"
  | "category"
  | "views_total"
  | "views_30d"
  | "views_7d"
  | "website_clicks_total"
  | "phone_clicks_total"
  | "last_event_at"
  | "created_at";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const EMPTY_FILTERS: AdminDirectoryFilters = { source: "all", status: "all", category: "all" };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toDateInput(unixMs: number | null | undefined): string {
  if (!unixMs) return "";
  const d = new Date(unixMs);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function fromDateInput(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  else d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTimestamp(unixMs: number | null, locale: Locale): string {
  if (!unixMs) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function SupplierDirectoryView() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const [filters, setFilters] = useState<AdminDirectoryFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<SupplierDirectoryAdminRow[]>([]);
  // Gap counts, from the same call as the rows. Null until the first response,
  // which is why the chips render their count only when they have one: a chip
  // reading "0" before anything loaded is a lie, and one that jumps from 0 to
  // 412 reads as a bug.
  const [facets, setFacets] = useState<AdminDirectoryFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "views_total", dir: "desc" });
  // Which row's hero is currently being re-fetched, so we can disable just that
  // row's button and show a spinner without blocking the rest of the table.
  const [heroBusyId, setHeroBusyId] = useState<string | null>(null);
  // Row currently running a moderation action (hide/delete/purge), so we can
  // disable just that row's action buttons.
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  // Bumped after every mutation to force the effect below to re-fetch. Cheaper
  // than reconciling the two DTO shapes the moderation endpoints return.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  // Re-fetch whenever the filter object changes. The payload is small (one row
  // per supplier) so a debounce isn't worth the complexity here — most filter
  // edits go through a select where the change rate is human-paced anyway.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminSupplierApi
      .listDirectory(filters)
      .then((r) => {
        if (cancelled) return;
        setRows(r.suppliers);
        setFacets(r.facets);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, toast, t, reloadToken]);

  // ── Moderation actions ───────────────────────────────────────────────────
  // Curated rows are keyed by their string slug (row.id); community rows by
  // their numeric community_id. Both branches refetch on success so the table
  // reflects the new status without reconciling response shapes by hand.

  async function onToggleHide(row: SupplierDirectoryAdminRow) {
    if (row.status === "hidden") {
      setActionBusyId(row.id);
      try {
        if (row.source === "curated") await adminSupplierApi.unhideCurated(row.id);
        else if (row.community_id != null) await adminSupplierApi.unhide(row.community_id);
        toast.success(t("admin.unhide"));
        reload();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      } finally {
        setActionBusyId(null);
      }
      return;
    }
    const reason = await promptEntry({
      title: t("admin.confirm_hide_title"),
      label: `${t("admin.hide_reason_label")} ${t("admin.hide_reason_optional")}`,
      placeholder: t("admin.hide_reason_placeholder"),
      helperText: t("admin.hide_reason_help"),
      confirmLabel: t("admin.hide"),
      cancelLabel: t("common.cancel"),
    });
    if (reason === null) return;
    const trimmed = reason.trim();
    setActionBusyId(row.id);
    try {
      if (row.source === "curated") {
        await adminSupplierApi.hideCurated(row.id, trimmed.length > 0 ? trimmed : undefined);
      } else if (row.community_id != null) {
        await adminSupplierApi.hide(row.community_id, trimmed.length > 0 ? trimmed : undefined);
      }
      toast.success(t("admin.hide"));
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setActionBusyId(null);
    }
  }

  async function onDeleteEntry(row: SupplierDirectoryAdminRow) {
    const ok = await confirm({
      title: t("admin.confirm_delete_title"),
      body: t("admin.directory_delete_confirm_body", { name: row.name }),
      confirmLabel: t("admin.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setActionBusyId(row.id);
    try {
      if (row.source === "curated") await adminSupplierApi.removeCurated(row.id);
      else if (row.community_id != null) await adminSupplierApi.remove(row.community_id);
      toast.success(t("admin.delete"));
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setActionBusyId(null);
    }
  }

  async function onDeleteAccount(row: SupplierDirectoryAdminRow) {
    if (row.community_id == null) return;
    const ok = await confirm({
      title: t("admin.directory_purge_submitter_title"),
      body: t("admin.directory_purge_submitter_body", {
        email: row.submitter_email ?? row.name,
      }),
      confirmLabel: t("admin.directory_purge_submitter_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setActionBusyId(row.id);
    try {
      await adminSupplierApi.purgeSubmitter(row.community_id);
      toast.success(t("admin.directory_purge_submitter_done"));
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setActionBusyId(null);
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    const { key, dir } = sort;
    copy.sort((a, b) => {
      const av = readSortValue(a, key);
      const bv = readSortValue(b, key);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), locale === "hu" ? "hu" : "en", {
        sensitivity: "base",
      });
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, locale]);

  function setFilter<K extends keyof AdminDirectoryFilters>(
    key: K,
    value: AdminDirectoryFilters[K],
  ) {
    setFilters((cur) => ({ ...cur, [key]: value }));
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  /** Gaps currently narrowing the list. The legacy `contact=no_email` shape is
   *  folded in so a bookmarked URL lights the chip it corresponds to instead of
   *  filtering invisibly. */
  const activeGaps: DirectoryGap[] = useMemo(() => {
    const set = new Set<DirectoryGap>(filters.gaps ?? []);
    if (filters.contact === "no_email") set.add("no_email");
    return [...set];
  }, [filters.gaps, filters.contact]);

  function toggleGap(gap: DirectoryGap) {
    setFilters((cur) => {
      const set = new Set<DirectoryGap>(cur.gaps ?? []);
      if (cur.contact === "no_email") set.add("no_email");
      if (set.has(gap)) set.delete(gap);
      else set.add(gap);
      const next = [...set];
      // `contact` is dropped on the first toggle: keeping both spellings alive
      // would let the legacy field silently re-apply a chip the admin just
      // turned off.
      return { ...cur, contact: undefined, gaps: next.length > 0 ? next : undefined };
    });
  }

  /** Is anything narrowing the list? Drives whether a reset affordance exists
   *  at all. Compared field by field rather than by JSON, so an undefined and a
   *  missing key can't read as a difference. */
  const dirty =
    activeGaps.length > 0 ||
    (filters.source ?? "all") !== "all" ||
    (filters.status ?? "all") !== "all" ||
    (filters.category ?? "all") !== "all" ||
    (filters.city ?? "").trim().length > 0 ||
    (filters.q ?? "").trim().length > 0 ||
    Boolean(filters.min_views) ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  async function onRefetchHero(row: SupplierDirectoryAdminRow) {
    setHeroBusyId(row.id);
    try {
      const res = await adminSupplierApi.refetchHero(row.id);
      setRows((cur) =>
        cur.map((r) => (r.id === row.id ? { ...r, hero_image_url: res.hero_image_url } : r)),
      );
      if (res.ok) toast.success(t("admin.directory_refetch_hero_done"));
      else toast.info(t("admin.directory_refetch_hero_none"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("admin.directory_refetch_hero_failed"));
    } finally {
      setHeroBusyId(null);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const blob = await adminSupplierApi.exportDirectoryCsv(filters);
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `weddly-suppliers-${stamp}.csv`);
      toast.success(t("admin.directory_export_started"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("admin.directory_export_failed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold text-neutral-900 dark:text-paper-50">
            {t("admin.directory_title")}
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-umber-300">
            {t("admin.directory_sub")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* The count is the page's headline number, so it is set as one. When
              a filter is narrowing the list it also says what it is narrowing
              FROM, which is the difference between "1004 suppliers" and "412 of
              1004" and the thing an admin is actually reading here. */}
          <span className="flex items-baseline gap-1.5">
            <span className="stat-num text-lg text-neutral-900 dark:text-paper-50">
              {rows.length}
            </span>
            <span className="text-xs text-neutral-500 dark:text-umber-300">
              {dirty && facets
                ? t("admin.directory_count_of", { total: facets.base_total })
                : t("admin.directory_total_count_word")}
            </span>
          </span>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={onExport}
            disabled={exporting || rows.length === 0}
          >
            <Download size={14} /> {t("admin.directory_export_csv")}
          </button>
        </div>
      </header>

      {/* Filter bar. One search field and a row of chips, not nine labelled
          form controls in a grid.

          The grid version put every dimension on screen at equal weight, which
          is how a filter an admin needs weekly (no email address: the listings
          no outbound flow can reach) ended up as one option inside a select
          labelled "Kapcsolat". Here the four data GAPS are one-tap toggles
          carrying their own counts, so the answer to "how many are unreachable"
          is on screen before anything is clicked, and everything else is a pill
          that names its own value when set. */}
      <div className="flex flex-col gap-2.5">
        <label className="relative flex items-center">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3.5 text-neutral-400 dark:text-umber-300"
          />
          <span className="sr-only">{t("admin.directory_filter_search_label")}</span>
          <input
            type="search"
            value={filters.q ?? ""}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder={t("admin.directory_filter_search_placeholder")}
            className="input w-full !rounded-full !py-2 pl-10"
          />
        </label>

        {/* Chips scroll rather than wrap on a phone: a wrapping row of ten
            reflows the table down the screen every time one is toggled. */}
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          {DIRECTORY_GAPS.map((gap) => (
            <ToggleChip
              key={gap}
              label={t(`admin.directory_gap_${gap}`)}
              count={facets?.gaps[gap]}
              active={activeGaps.includes(gap)}
              onClick={() => toggleGap(gap)}
            />
          ))}

          <span className="h-5 w-px shrink-0 bg-paper-300 dark:bg-umber-700" aria-hidden />

          <SelectChip
            label={t("admin.directory_filter_source_label")}
            value={filters.source ?? "all"}
            onChange={(v) => setFilter("source", v as AdminDirectoryFilters["source"])}
            options={[
              { value: "all", label: t("admin.directory_filter_source_all") },
              { value: "curated", label: t("admin.directory_filter_source_curated") },
              { value: "community", label: t("admin.directory_filter_source_community") },
            ]}
          />
          <SelectChip
            label={t("admin.directory_filter_status_label")}
            value={filters.status ?? "all"}
            onChange={(v) => setFilter("status", v as AdminDirectoryFilters["status"])}
            options={[
              { value: "all", label: t("admin.filter_status_all") },
              { value: "active", label: t("admin.filter_status_active") },
              { value: "pending", label: t("admin.filter_status_pending") },
              { value: "awaiting_review", label: t("admin.filter_status_awaiting_review") },
              { value: "hidden", label: t("admin.filter_status_hidden") },
            ]}
          />
          <SelectChip
            label={t("admin.directory_filter_category_label")}
            value={filters.category ?? "all"}
            onChange={(v) => setFilter("category", v as AdminDirectoryFilters["category"])}
            options={[
              { value: "all", label: t("admin.directory_filter_category_all") },
              ...CATEGORIES.map((c) => ({ value: c, label: t(`suppliers.cat.${c}`) })),
            ]}
          />
          <InputChip
            label={t("admin.directory_filter_city_label")}
            value={filters.city ?? ""}
            placeholder={t("admin.directory_filter_city_placeholder")}
            onChange={(v) => setFilter("city", v)}
          />
          {/* The three rare dimensions live one tap away rather than on the
              bar: an admin sets a date window or a view floor occasionally,
              and they cost three controls of permanent width. */}
          <MoreChip
            label={t("admin.directory_filter_more")}
            activeCount={
              (filters.min_views ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)
            }
          >
            <FilterInput
              label={t("admin.directory_filter_min_views_label")}
              value={filters.min_views ? String(filters.min_views) : ""}
              placeholder="0"
              type="number"
              onChange={(v) => {
                const n = Number(v);
                setFilter("min_views", Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined);
              }}
            />
            <FilterInput
              label={t("admin.directory_filter_from_label")}
              value={toDateInput(filters.from)}
              type="date"
              onChange={(v) => setFilter("from", fromDateInput(v, false))}
            />
            <FilterInput
              label={t("admin.directory_filter_to_label")}
              value={toDateInput(filters.to)}
              type="date"
              onChange={(v) => setFilter("to", fromDateInput(v, true))}
            />
          </MoreChip>

          {/* Only when there is something to clear. A permanent reset button is
              a permanent invitation to lose the filter you just built. */}
          {dirty && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-neutral-600 transition-colors hover:bg-paper-200 dark:text-umber-200 dark:hover:bg-umber-700"
            >
              <X size={13} aria-hidden />
              {t("admin.directory_reset_filters")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="card text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.directory_loading")}
        </p>
      ) : sortedRows.length === 0 ? (
        <p className="card text-sm text-neutral-500 dark:text-umber-300">
          {t("admin.directory_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-paper-300 dark:border-umber-700">
          <table className="min-w-full divide-y divide-paper-300 text-sm dark:divide-umber-700">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-neutral-600 dark:bg-umber-800 dark:text-umber-200">
              <tr>
                <SortableTh
                  label={t("admin.directory_col_name")}
                  active={sort.key === "name"}
                  dir={sort.dir}
                  onClick={() => toggleSort("name")}
                />
                <SortableTh
                  label={t("admin.directory_col_source")}
                  active={sort.key === "category"}
                  dir={sort.dir}
                  onClick={() => toggleSort("category")}
                />
                <th scope="col" className="px-3 py-2">
                  {t("admin.directory_col_status")}
                </th>
                <SortableTh
                  label={t("admin.directory_col_category")}
                  active={sort.key === "category"}
                  dir={sort.dir}
                  onClick={() => toggleSort("category")}
                />
                <SortableTh
                  label={t("admin.directory_col_city")}
                  active={sort.key === "city"}
                  dir={sort.dir}
                  onClick={() => toggleSort("city")}
                />
                <th scope="col" className="px-3 py-2">
                  {t("admin.directory_col_hero")}
                </th>
                <SortableTh
                  label={t("admin.directory_col_views_total")}
                  active={sort.key === "views_total"}
                  dir={sort.dir}
                  onClick={() => toggleSort("views_total")}
                  align="right"
                />
                <SortableTh
                  label={t("admin.directory_col_views_30d")}
                  active={sort.key === "views_30d"}
                  dir={sort.dir}
                  onClick={() => toggleSort("views_30d")}
                  align="right"
                />
                <SortableTh
                  label={t("admin.directory_col_views_7d")}
                  active={sort.key === "views_7d"}
                  dir={sort.dir}
                  onClick={() => toggleSort("views_7d")}
                  align="right"
                />
                <SortableTh
                  label={t("admin.directory_col_clicks_total")}
                  active={sort.key === "website_clicks_total"}
                  dir={sort.dir}
                  onClick={() => toggleSort("website_clicks_total")}
                  align="right"
                />
                <SortableTh
                  label={t("admin.directory_col_phone_clicks")}
                  active={sort.key === "phone_clicks_total"}
                  dir={sort.dir}
                  onClick={() => toggleSort("phone_clicks_total")}
                  align="right"
                />
                <SortableTh
                  label={t("admin.directory_col_last_event")}
                  active={sort.key === "last_event_at"}
                  dir={sort.dir}
                  onClick={() => toggleSort("last_event_at")}
                />
                <SortableTh
                  label={t("admin.directory_col_created")}
                  active={sort.key === "created_at"}
                  dir={sort.dir}
                  onClick={() => toggleSort("created_at")}
                />
                <th scope="col" className="px-3 py-2">
                  {t("admin.directory_col_submitter_seen")}
                </th>
                <th
                  scope="col"
                  className="sticky right-0 z-20 border-l border-paper-300 bg-paper-100 px-3 py-2 text-right dark:border-umber-700 dark:bg-umber-800"
                >
                  {t("admin.directory_col_actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200 bg-paper-50 dark:divide-umber-700 dark:bg-umber-800/40">
              {sortedRows.map((row) => (
                <tr key={row.id} className="group hover:bg-paper-100 dark:hover:bg-umber-700/40">
                  <td className="px-3 py-2 font-medium text-neutral-900 dark:text-paper-50">
                    <span className="block">{row.name}</span>
                    {/* No address to write to: the claim-invite campaign mails
                        contact_email, so this row can only ever be chased by
                        hand. Flagged inline as well as behind the filter,
                        because it's the reason a listing sits unclaimed. */}
                    {!row.contact_email && (
                      <span
                        title={t("admin.directory_no_email_tooltip")}
                        className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-blush-600 dark:text-blush-300"
                      >
                        <MailX size={11} aria-hidden />
                        {t("admin.directory_no_email")}
                      </span>
                    )}
                    {row.website && (
                      <a
                        href={safeExternalHref(row.website)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-umber-300"
                      >
                        <ExternalLink size={11} aria-hidden /> {row.website}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <SourcePill source={row.source} t={t} />
                    <span className="mt-0.5 block text-[10px] text-neutral-500 dark:text-umber-300">
                      {t(`admin.directory_submitter_${submitterKind(row)}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-neutral-700 dark:text-paper-100">
                      {t(`admin.status_${row.status}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-600 dark:text-umber-200">
                    {t(`suppliers.cat.${row.category}`)}
                  </td>
                  <td className="px-3 py-2 text-neutral-700 dark:text-paper-100">{row.city}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {row.hero_image_url ? (
                        <img
                          src={row.hero_image_url}
                          alt=""
                          className="h-8 w-12 rounded border border-paper-300 object-cover dark:border-umber-700"
                          loading="lazy"
                        />
                      ) : (
                        <span className="inline-flex h-8 w-12 items-center justify-center rounded border border-dashed border-paper-300 text-[10px] text-neutral-400 dark:border-umber-700 dark:text-umber-300">
                          —
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onRefetchHero(row)}
                        disabled={heroBusyId === row.id || !row.website}
                        title={t("admin.directory_refetch_hero")}
                        aria-label={t("admin.directory_refetch_hero")}
                      >
                        <ImageDown
                          size={14}
                          className={heroBusyId === row.id ? "animate-spin" : undefined}
                          aria-hidden
                        />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-neutral-900 dark:text-paper-50">
                    {row.analytics.views_total}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-neutral-700 dark:text-paper-100">
                    {row.analytics.views_30d}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-neutral-700 dark:text-paper-100">
                    {row.analytics.views_7d}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-neutral-900 dark:text-paper-50">
                    {row.analytics.website_clicks_total}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-neutral-700 dark:text-paper-100">
                    {row.analytics.phone_clicks_total}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-umber-300">
                    {row.analytics.last_event_at
                      ? formatTimestamp(row.analytics.last_event_at, locale)
                      : t("admin.directory_last_event_never")}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-umber-300">
                    {formatTimestamp(row.created_at, locale)}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-umber-300">
                    {row.source === "curated"
                      ? "—"
                      : row.submitter_last_seen_at
                        ? formatTimestamp(row.submitter_last_seen_at, locale)
                        : t("admin.directory_last_event_never")}
                  </td>
                  <td className="sticky right-0 z-10 border-l border-paper-300 bg-paper-50 px-3 py-2 group-hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-900 dark:group-hover:bg-umber-800">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onToggleHide(row)}
                        disabled={actionBusyId === row.id}
                        title={row.status === "hidden" ? t("admin.unhide") : t("admin.hide")}
                        aria-label={row.status === "hidden" ? t("admin.unhide") : t("admin.hide")}
                      >
                        {row.status === "hidden" ? (
                          <Eye size={14} aria-hidden />
                        ) : (
                          <EyeOff size={14} aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-rose-600 dark:text-rose-400"
                        onClick={() => onDeleteEntry(row)}
                        disabled={actionBusyId === row.id}
                        title={t("admin.directory_delete_entry")}
                        aria-label={t("admin.directory_delete_entry")}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                      {row.community_id != null && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-600 dark:text-rose-400"
                          onClick={() => onDeleteAccount(row)}
                          disabled={actionBusyId === row.id}
                          title={t("admin.directory_delete_account")}
                          aria-label={t("admin.directory_delete_account")}
                        >
                          <UserX size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Collapses source + submitter_type into a single "who put this here" label
 *  key: admin (curated), self (vendor self-submitted), or user (couple rec). */
function submitterKind(row: SupplierDirectoryAdminRow): "admin" | "self" | "user" {
  if (row.source === "curated") return "admin";
  return row.submitter_type === "self" ? "self" : "user";
}

function readSortValue(row: SupplierDirectoryAdminRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name;
    case "city":
      return row.city;
    case "category":
      return row.category;
    case "views_total":
      return row.analytics.views_total;
    case "views_30d":
      return row.analytics.views_30d;
    case "views_7d":
      return row.analytics.views_7d;
    case "website_clicks_total":
      return row.analytics.website_clicks_total;
    case "phone_clicks_total":
      return row.analytics.phone_clicks_total;
    case "last_event_at":
      return row.analytics.last_event_at;
    case "created_at":
      return row.created_at;
  }
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-neutral-900 dark:hover:text-paper-50"
        onClick={onClick}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : "·"}
        </span>
      </button>
    </th>
  );
}

// ── Chips ──────────────────────────────────────────────────────────────────
// One height (32px), one radius (full), one active treatment (ink fill) across
// all four, so a row of them reads as one control rather than four widgets.

const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors";
const CHIP_OFF =
  "border-paper-300 bg-paper-50 text-neutral-700 hover:border-neutral-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500";
const CHIP_ON =
  "border-neutral-900 bg-neutral-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-neutral-900";

/** A binary filter: on or off, one tap, and it carries how many rows it would
 *  give you. The count is what makes the chip worth the width, since "no
 *  website: 6" is a decision not to bother and "no email: 412" is an afternoon
 *  of work. */
function ToggleChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`stat-num text-[11px] ${
            active
              ? "text-paper-50/70 dark:text-neutral-900/60"
              : "text-neutral-400 dark:text-umber-300"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** A one-of-many filter. The chip shows the CHOSEN value once set, not the
 *  dimension name, because "Fotós" is what the admin is looking at and
 *  "Kategória: Fotós" spends half the chip repeating a word they just picked
 *  from. The dimension survives as the accessible name. */
function SelectChip({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== "all";
  const current = options.find((o) => o.value === value);
  return (
    <span className={`${CHIP} relative ${active ? CHIP_ON : CHIP_OFF} pr-2`}>
      <span className="pointer-events-none">{active ? (current?.label ?? label) : label}</span>
      <ChevronDown size={13} aria-hidden className="pointer-events-none opacity-60" />
      {/* A native select stretched invisibly over the chip: it gets the
          platform's own menu (searchable on desktop, a wheel on iOS) for free,
          which a hand-rolled listbox of 30 categories would have to rebuild. */}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A free-text filter that stays a chip until it has something in it. Sized to
 *  its own content so an empty "Város" is chip-sized and a typed one grows to
 *  fit the town rather than truncating it. */
function InputChip({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const active = value.trim().length > 0;
  return (
    <span className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF} px-3`}>
      <MapPin size={13} aria-hidden className="opacity-60" />
      <input
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? label}
        onChange={(e) => onChange(e.target.value)}
        size={Math.max(6, Math.min(18, value.length || label.length))}
        className="border-0 bg-transparent p-0 text-xs font-medium placeholder:text-neutral-400 focus:outline-none focus:ring-0 dark:placeholder:text-umber-300"
      />
      {active && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`${label}: ×`}
          className="opacity-70 hover:opacity-100"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

/** The overflow chip: the dimensions that are worth having but not worth
 *  permanent width. Closes on outside click and on Escape, like every other
 *  dropdown in the app. */
function MoreChip({
  label,
  activeCount,
  children,
}: {
  label: string;
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${CHIP} ${activeCount > 0 ? CHIP_ON : CHIP_OFF}`}
      >
        <SlidersHorizontal size={13} aria-hidden />
        {label}
        {activeCount > 0 && <span className="stat-num text-[11px]">{activeCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-3 rounded-2xl border border-paper-300 bg-white p-3 shadow-pop dark:border-umber-700 dark:bg-umber-800">
          {children}
        </div>
      )}
    </span>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date";
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="uppercase tracking-wide text-neutral-500 dark:text-umber-300">{label}</span>
      <span className="relative inline-flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-2 text-neutral-400 dark:text-umber-300">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`input !min-h-0 !py-1.5 ${icon ? "pl-7" : ""}`}
        />
      </span>
    </label>
  );
}

function SourcePill({
  source,
  t,
}: {
  source: "curated" | "community";
  t: ReturnType<typeof useT>["t"];
}) {
  const cls =
    source === "curated"
      ? "border-neutral-700 bg-neutral-100 text-neutral-900 dark:border-neutral-400/40 dark:bg-neutral-500/20 dark:text-neutral-200"
      : "border-paper-300 bg-paper-100 text-neutral-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-paper-100";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {t(`admin.directory_source_${source}`)}
    </span>
  );
}
