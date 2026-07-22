// Read-only admin email collection. Aggregates every email address in the
// system (registered users, wedding guests, vendor + planner waitlist entries)
// and labels each by source type. Entries are never deletable from this view.
// Demo-seed addresses (`%@demo.weddly.local`) are excluded server-side, so what
// shows here is only ever real outreach-worthy contacts.

import type { AdminEmailEntry, AdminEmailSourceType } from "@shared/types";
import { intlLocale } from "../lib/format";
import {
  AtSign,
  ClipboardList,
  Download,
  Heart,
  Hourglass,
  Inbox,
  Search,
  Store,
  User,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill, StatFilter } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Skeleton } from "../components/ui";
import { adminEmailListApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";

type Filter = AdminEmailSourceType | "all";

const SOURCE_PILL: Record<AdminEmailSourceType, { tone: PillTone; labelKey: string }> = {
  user: { tone: "violet", labelKey: "admin.email_list_source_user" },
  vendor: { tone: "sage", labelKey: "admin.email_list_source_vendor" },
  guest: { tone: "blush", labelKey: "admin.email_list_source_guest" },
  vendor_waitlist: { tone: "muted", labelKey: "admin.email_list_source_vendor_waitlist" },
  planner_waitlist: { tone: "muted", labelKey: "admin.email_list_source_planner_waitlist" },
};

/** One glyph per source, shown both in the segmented filter and as the row's
 *  avatar, so the type reads at a glance without leaning on the label. */
const SOURCE_ICON: Record<Filter, ReactNode> = {
  all: <Inbox size={16} />,
  user: <User size={16} />,
  vendor: <Store size={16} />,
  guest: <Heart size={16} />,
  vendor_waitlist: <Hourglass size={16} />,
  planner_waitlist: <ClipboardList size={16} />,
};

const FILTERS: Filter[] = ["all", "user", "vendor", "guest", "vendor_waitlist", "planner_waitlist"];

function formatDate(unixMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    adminEmailListApi
      .list()
      .then((r) => setEntries(r.entries))
      .catch(() => setError(t("admin.email_list_load_error")));
  }, [t]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: entries?.length ?? 0,
      user: 0,
      vendor: 0,
      guest: 0,
      vendor_waitlist: 0,
      planner_waitlist: 0,
    };
    for (const e of entries ?? []) c[e.source_type] += 1;
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== "all" && e.source_type !== filter) return false;
      if (q && !e.email.toLowerCase().includes(q) && !(e.name ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [entries, query, filter]);

  const filterLabel = (f: Filter) =>
    f === "all" ? t("admin.email_list_filter_all") : t(SOURCE_PILL[f].labelKey);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={t("admin.email_list_title")}
        subtitle={t("admin.email_list_subtitle", { n: entries?.length ?? 0 })}
        actions={
          entries && entries.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadCsv(filtered)}
              aria-label={t("admin.email_list_export_csv")}
              title={t("admin.email_list_export_csv")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-paper-300 bg-paper-50 px-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-100 dark:hover:bg-umber-700"
            >
              <Download size={15} />
              <span className="hidden sm:inline">{t("admin.email_list_export_csv")}</span>
            </button>
          ) : null
        }
      />

      <StatFilter
        ariaLabel={t("admin.email_list_title")}
        onSelect={(k) => setFilter(k as Filter)}
        segments={FILTERS.map((f) => ({
          key: f,
          label: filterLabel(f),
          count: counts[f],
          icon: SOURCE_ICON[f],
          active: filter === f,
        }))}
      />

      {/* Search — one quiet full-width field, no chrome around the results. */}
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.email_list_search_placeholder")}
          aria-label={t("admin.email_list_search_placeholder")}
          className="h-11 w-full rounded-xl border border-paper-300 bg-paper-50 pl-10 pr-3 text-sm placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-500/20 dark:border-umber-700 dark:bg-umber-900 dark:placeholder:text-umber-500"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries === null ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <AdminEmptyState
          icon={<AtSign size={32} />}
          title={t("admin.email_list_empty_title")}
          description={t("admin.email_list_empty_body")}
        />
      ) : (
        <ul className="divide-y divide-paper-200/70 dark:divide-umber-800">
          {filtered.map((entry, i) => {
            const pill = SOURCE_PILL[entry.source_type];
            return (
              <li
                key={`${entry.email}-${i}`}
                className="flex items-center gap-3 py-3 transition-colors hover:bg-paper-50/60 dark:hover:bg-umber-800/40"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-100 text-neutral-500 dark:bg-umber-800 dark:text-umber-300"
                >
                  {SOURCE_ICON[entry.source_type]}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-neutral-900 dark:text-paper-100">
                      {entry.name ?? entry.email}
                    </span>
                    <Pill tone={pill.tone}>{t(pill.labelKey)}</Pill>
                  </div>
                  <a
                    href={`mailto:${entry.email}`}
                    className="block truncate font-mono text-xs text-neutral-500 hover:underline dark:text-umber-400"
                  >
                    {entry.email}
                  </a>
                </div>

                {entry.meta ? (
                  <span className="hidden max-w-[10rem] truncate text-xs text-neutral-500 sm:block dark:text-umber-400">
                    {entry.meta}
                  </span>
                ) : null}

                <time className="shrink-0 whitespace-nowrap text-xs tabular-nums text-neutral-400 dark:text-umber-500">
                  {formatDate(entry.added_at, locale)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
