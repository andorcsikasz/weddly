import type {
  AdminDirectoryFilters,
  SupplierCategory,
  SupplierDirectoryAdminRow,
} from "@shared/suppliers";
import { Download, ExternalLink, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../ui";
import { ApiError } from "../../lib/api";
import { adminSupplierApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

/** Categories the directory currently covers. Mirrors the SupplierCategory
 *  union from shared/suppliers.ts — kept inline to avoid a runtime import
 *  cycle through the i18n keys. */
const CATEGORIES: SupplierCategory[] = [
  "venue",
  "accommodation",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "stationery",
  "transport",
];

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

function formatTimestamp(unixMs: number | null, locale: string): string {
  if (!unixMs) return "";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function SupplierDirectoryView() {
  const { t, locale } = useT();
  const toast = useToast();
  const [filters, setFilters] = useState<AdminDirectoryFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<SupplierDirectoryAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "views_total", dir: "desc" });

  // Re-fetch whenever the filter object changes. The payload is small (one row
  // per supplier) so a debounce isn't worth the complexity here — most filter
  // edits go through a select where the change rate is human-paced anyway.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminSupplierApi
      .listDirectory(filters)
      .then((r) => {
        if (!cancelled) setRows(r.suppliers);
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
  }, [filters, toast, t]);

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

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
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
          <h2 className="m-0 text-lg font-semibold text-ink-900 dark:text-paper-50">
            {t("admin.directory_title")}
          </h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
            {t("admin.directory_sub")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500 dark:text-umber-300">
            {t("admin.directory_total_count", { n: rows.length })}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={resetFilters}
            aria-label={t("admin.directory_reset_filters")}
          >
            <RotateCcw size={14} /> {t("admin.directory_reset_filters")}
          </button>
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

      {/* Filter strip. Lay out as a wrapped flex so each control gets a
          comfortable minimum width on phones. */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-paper-300 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800/60 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label={t("admin.directory_filter_source_label")}
          value={filters.source ?? "all"}
          onChange={(v) => setFilter("source", v as AdminDirectoryFilters["source"])}
          options={[
            { value: "all", label: t("admin.directory_filter_source_all") },
            { value: "curated", label: t("admin.directory_filter_source_curated") },
            { value: "community", label: t("admin.directory_filter_source_community") },
          ]}
        />
        <FilterSelect
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
        <FilterSelect
          label={t("admin.directory_filter_category_label")}
          value={filters.category ?? "all"}
          onChange={(v) => setFilter("category", v as AdminDirectoryFilters["category"])}
          options={[
            { value: "all", label: t("admin.directory_filter_category_all") },
            ...CATEGORIES.map((c) => ({ value: c, label: t(`suppliers.cat.${c}`) })),
          ]}
        />
        <FilterInput
          label={t("admin.directory_filter_city_label")}
          value={filters.city ?? ""}
          placeholder={t("admin.directory_filter_city_placeholder")}
          onChange={(v) => setFilter("city", v)}
        />
        <FilterInput
          label={t("admin.directory_filter_search_label")}
          value={filters.q ?? ""}
          placeholder={t("admin.directory_filter_search_placeholder")}
          onChange={(v) => setFilter("q", v)}
          icon={<Search size={14} aria-hidden />}
        />
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
      </div>

      {loading ? (
        <p className="card text-sm text-ink-500 dark:text-umber-300">
          {t("admin.directory_loading")}
        </p>
      ) : sortedRows.length === 0 ? (
        <p className="card text-sm text-ink-500 dark:text-umber-300">
          {t("admin.directory_empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-paper-300 dark:border-umber-700">
          <table className="min-w-full divide-y divide-paper-300 text-sm dark:divide-umber-700">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-600 dark:bg-umber-800 dark:text-umber-200">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200 bg-paper-50 dark:divide-umber-700 dark:bg-umber-800/40">
              {sortedRows.map((row) => (
                <tr key={row.id} className="hover:bg-paper-100 dark:hover:bg-umber-700/40">
                  <td className="px-3 py-2 font-medium text-ink-900 dark:text-paper-50">
                    <span className="block">{row.name}</span>
                    {row.website && (
                      <a
                        href={row.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 underline-offset-2 hover:underline dark:text-umber-300"
                      >
                        <ExternalLink size={11} aria-hidden /> {row.website}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <SourcePill source={row.source} t={t} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-ink-700 dark:text-paper-100">
                      {t(`admin.status_${row.status}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs uppercase tracking-wide text-ink-600 dark:text-umber-200">
                    {t(`suppliers.cat.${row.category}`)}
                  </td>
                  <td className="px-3 py-2 text-ink-700 dark:text-paper-100">{row.city}</td>
                  <td className="px-3 py-2 text-right stat-num text-ink-900 dark:text-paper-50">
                    {row.analytics.views_total}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-ink-700 dark:text-paper-100">
                    {row.analytics.views_30d}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-ink-700 dark:text-paper-100">
                    {row.analytics.views_7d}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-ink-900 dark:text-paper-50">
                    {row.analytics.website_clicks_total}
                  </td>
                  <td className="px-3 py-2 text-right stat-num text-ink-700 dark:text-paper-100">
                    {row.analytics.phone_clicks_total}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
                    {row.analytics.last_event_at
                      ? formatTimestamp(row.analytics.last_event_at, locale)
                      : t("admin.directory_last_event_never")}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
                    {formatTimestamp(row.created_at, locale)}
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
        className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-ink-900 dark:hover:text-paper-50"
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

function FilterSelect({
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
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="uppercase tracking-wide text-ink-500 dark:text-umber-300">{label}</span>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
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
    <label className="flex flex-col gap-1 text-xs">
      <span className="uppercase tracking-wide text-ink-500 dark:text-umber-300">{label}</span>
      <span className="relative inline-flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-2 text-ink-400 dark:text-umber-300">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`input ${icon ? "pl-7" : ""}`}
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
      ? "border-violet-700 bg-violet-100 text-violet-900 dark:border-violet-400/40 dark:bg-violet-500/20 dark:text-violet-200"
      : "border-paper-300 bg-paper-100 text-ink-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-paper-100";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {t(`admin.directory_source_${source}`)}
    </span>
  );
}
