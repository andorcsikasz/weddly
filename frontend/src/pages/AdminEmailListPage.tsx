// Read-only admin email collection. Aggregates every email address in the
// system (registered users, wedding guests, vendor + planner waitlist entries)
// and labels each by source type. Entries are never deletable from this view.

import type { AdminEmailEntry, AdminEmailSourceType } from "@shared/types";
import { AtSign, Download, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Skeleton } from "../components/ui";
import { adminEmailListApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const SOURCE_PILL: Record<AdminEmailSourceType, { tone: PillTone; labelKey: string }> = {
  user: { tone: "violet", labelKey: "admin.email_list_source_user" },
  vendor: { tone: "sage", labelKey: "admin.email_list_source_vendor" },
  guest: { tone: "blush", labelKey: "admin.email_list_source_guest" },
  vendor_waitlist: { tone: "muted", labelKey: "admin.email_list_source_vendor_waitlist" },
  planner_waitlist: { tone: "muted", labelKey: "admin.email_list_source_planner_waitlist" },
};

function formatDate(unixMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(unixMs));
}

function downloadCsv(entries: AdminEmailEntry[]) {
  const rows = [
    ["email", "source_type", "name", "added_at", "meta"],
    ...entries.map((e) => [
      e.email,
      e.source_type,
      e.name ?? "",
      new Date(e.added_at).toISOString(),
      e.meta ?? "",
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "weddly-emails.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminEmailListPage() {
  const { t, locale } = useT();
  const [entries, setEntries] = useState<AdminEmailEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<AdminEmailSourceType | "all">("all");

  useEffect(() => {
    adminEmailListApi
      .list()
      .then((r) => setEntries(r.entries))
      .catch(() => setError(t("admin.email_list_load_error")));
  }, [t]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (sourceFilter !== "all" && e.source_type !== sourceFilter) return false;
      if (q && !e.email.toLowerCase().includes(q) && !(e.name ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [entries, query, sourceFilter]);

  const SOURCE_TYPES: Array<AdminEmailSourceType | "all"> = [
    "all",
    "user",
    "vendor",
    "guest",
    "vendor_waitlist",
    "planner_waitlist",
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("admin.email_list_title")}
        subtitle={t("admin.email_list_subtitle", { n: entries?.length ?? 0 })}
        actions={
          entries && entries.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadCsv(filtered)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-100 dark:hover:bg-umber-700"
            >
              <Download size={14} />
              {t("admin.email_list_export_csv")}
            </button>
          ) : null
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.email_list_search_placeholder")}
            className="h-8 rounded-lg border border-neutral-200 bg-white py-0 pl-8 pr-3 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-umber-600 dark:bg-umber-800 dark:placeholder:text-umber-400"
          />
        </div>

        {SOURCE_TYPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSourceFilter(s)}
            className={[
              "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
              sourceFilter === s
                ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-900/30 dark:text-violet-300"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-300",
            ].join(" ")}
          >
            {s === "all" ? t("admin.email_list_filter_all") : t(SOURCE_PILL[s].labelKey)}
          </button>
        ))}
      </div>

      {/* Table */}
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries === null ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <AdminEmptyState
          icon={<AtSign size={32} />}
          title={t("admin.email_list_empty_title")}
          description={t("admin.email_list_empty_body")}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-100 dark:border-umber-700">
          <table className="min-w-full divide-y divide-neutral-100 text-sm dark:divide-umber-700">
            <thead>
              <tr className="bg-neutral-50 dark:bg-umber-800/60">
                <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-umber-400">
                  {t("admin.email_list_col_email")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-umber-400">
                  {t("admin.email_list_col_source")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-umber-400">
                  {t("admin.email_list_col_name")}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-umber-400">
                  {t("admin.email_list_col_meta")}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-neutral-500 dark:text-umber-400">
                  {t("admin.email_list_col_added")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white dark:divide-umber-700 dark:bg-umber-900">
              {filtered.map((entry, i) => {
                const pill = SOURCE_PILL[entry.source_type];
                return (
                  <tr key={`${entry.email}-${i}`} className="hover:bg-neutral-50 dark:hover:bg-umber-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-800 dark:text-umber-100">
                      <a
                        href={`mailto:${entry.email}`}
                        className="hover:underline"
                      >
                        {entry.email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={pill.tone}>{t(pill.labelKey)}</Pill>
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-umber-200">
                      {entry.name ?? <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-umber-400">
                      {entry.meta ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500 dark:text-umber-400">
                      {formatDate(entry.added_at, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries !== null && filtered.length > 0 && (
        <p className="text-right text-xs text-neutral-400">
          {t("admin.email_list_count", { n: filtered.length, total: entries.length })}
        </p>
      )}
    </div>
  );
}
