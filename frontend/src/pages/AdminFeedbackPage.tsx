// Admin triage for in-product Visszajelzés submissions. Lists every entry
// newest-first with status + priority + product-area pills and an expandable
// triage panel per row (lifecycle, priority, area, internal notes, captured
// technical context). A multi-select filter chip row scopes the table; the
// default selection is the open working set (new + reviewed + planned) so the
// page loads into the work that needs attention. The fetch is tri-state —
// loading skeleton → list / error inline with retry — so an API outage
// doesn't disguise itself as an empty inbox.

import type { FeedbackEntry, FeedbackPriority, FeedbackStatus } from "@shared/feedback";
import {
  Archive,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  ExternalLink,
  Inbox,
  ListChecks,
  Mail,
  Monitor,
  RotateCcw,
  Smartphone,
  Tablet,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminFeedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

/** Full triage lifecycle, in workflow order. Drives the filter chips, the
 *  status pill, and the segmented status control in the triage panel. */
const STATUS_ORDER: readonly FeedbackStatus[] = [
  "new",
  "reviewed",
  "planned",
  "fixed",
  "rejected",
  "archived",
];

/** Default multi-select on mount — the open working set. Keeps the resting
 *  page on items that still need attention instead of dumping closed history
 *  (fixed / rejected / archived) into view. */
const DEFAULT_FILTER: ReadonlySet<FeedbackStatus> = new Set(["new", "reviewed", "planned"]);

const STATUS_TONES: Record<FeedbackStatus, PillTone> = {
  new: "violet",
  reviewed: "paper",
  planned: "ink",
  fixed: "sage",
  rejected: "muted",
  archived: "muted",
};

function statusIcon(status: FeedbackStatus, size = 11) {
  switch (status) {
    case "new":
      return <Inbox size={size} aria-hidden />;
    case "reviewed":
      return <Eye size={size} aria-hidden />;
    case "planned":
      return <Clock size={size} aria-hidden />;
    case "fixed":
      return <CheckCircle2 size={size} aria-hidden />;
    case "rejected":
      return <Ban size={size} aria-hidden />;
    case "archived":
      return <Archive size={size} aria-hidden />;
  }
}

const PRIORITY_ORDER: readonly FeedbackPriority[] = ["low", "medium", "high"];
const PRIORITY_TONES: Record<FeedbackPriority, PillTone> = {
  low: "muted",
  medium: "violet",
  high: "blush",
};

/** Product-area options for the triage select. Aligned with the app's nav
 *  surfaces; the value stored is the slug auto-inferred from the in-app route
 *  at submission (overridable here). Any stored value outside this list is
 *  prepended at render so it stays visible + selectable. */
const FEATURE_AREAS: readonly string[] = [
  "dashboard",
  "budget",
  "guests",
  "seating",
  "vendors",
  "planning",
  "timeline",
  "schedule",
  "logistics",
  "moodboard",
  "honeymoon",
  "media",
  "guest-page",
  "design",
  "wishlist",
  "account",
  "billing",
  "admin",
  "landing",
  "other",
];

/** Maps the in-app pathname captured at submission (FeedbackEntry.context)
 *  to a human page label, reusing the same nav.* / admin.nav_* keys the
 *  sidebar already translates. Longest, most specific prefix first; "/app"
 *  is the catch-all. Matching is path-boundary aware so "/app/guests"
 *  doesn't swallow "/app/guest-page". */
const APP_PAGE_LABELS: ReadonlyArray<{ prefix: string; key: string }> = [
  { prefix: "/app/admin/suppliers", key: "admin.nav_suppliers" },
  { prefix: "/app/admin/vendor-waitlist", key: "admin.nav_waitlist" },
  { prefix: "/app/admin/feedback", key: "admin.nav_feedback" },
  { prefix: "/app/admin/couple-cards", key: "admin.nav_couple_cards" },
  { prefix: "/app/admin/users", key: "admin.nav_users" },
  { prefix: "/app/admin/categories", key: "admin.nav_taxonomy" },
  { prefix: "/app/admin/blog", key: "admin.nav_blog" },
  { prefix: "/app/admin/analytics", key: "admin.nav_analytics" },
  { prefix: "/app/guests", key: "nav.guests" },
  { prefix: "/app/budget", key: "nav.budget" },
  { prefix: "/app/vendors", key: "nav.suppliers" },
  { prefix: "/app/planning", key: "nav.planning" },
  { prefix: "/app/timeline", key: "nav.timeline" },
  { prefix: "/app/schedule", key: "nav.schedule" },
  { prefix: "/app/seating", key: "nav.seating" },
  { prefix: "/app/logistics", key: "nav.logistics" },
  { prefix: "/app/moodboard", key: "nav.moodboard" },
  { prefix: "/app/honeymoon", key: "nav.honeymoon" },
  { prefix: "/app/media", key: "nav.media" },
  { prefix: "/app/guest-page", key: "nav.guest_page" },
  { prefix: "/app", key: "nav.dashboard" },
];

function sourceLabel(
  entry: Pick<FeedbackEntry, "source" | "context">,
  t: (k: string) => string,
): string {
  if (entry.source === "app" && entry.context) {
    const match = APP_PAGE_LABELS.find(
      (p) => entry.context === p.prefix || entry.context?.startsWith(`${p.prefix}/`),
    );
    if (match) return t(match.key);
  }
  return t(`admin.feedback_source_${entry.source}`);
}

export default function AdminFeedbackPage() {
  const { t, locale } = useT();
  useDocumentMeta(t("seo.admin_feedback_title"), t("seo.admin_feedback_description"));
  const toast = useToast();
  const confirm = useConfirm();
  const [loadable, setLoadable] = useState<Loadable<FeedbackEntry[]>>({ status: "loading" });
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Set<FeedbackStatus>>(() => new Set(DEFAULT_FILTER));
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadable({ status: "loading" });
    adminFeedbackApi
      .list()
      .then((r) => {
        if (!cancelled) setLoadable({ status: "ok", data: r.entries });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadable({ status: "error" });
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce]);

  function replaceEntry(next: FeedbackEntry) {
    setLoadable((cur) =>
      cur.status === "ok"
        ? { status: "ok", data: cur.data.map((e) => (e.id === next.id ? next : e)) }
        : cur,
    );
  }

  function removeEntry(id: number) {
    setLoadable((cur) =>
      cur.status === "ok" ? { status: "ok", data: cur.data.filter((e) => e.id !== id) } : cur,
    );
  }

  async function setStatus(id: number, next: FeedbackStatus) {
    setPendingId(id);
    try {
      const r = await adminFeedbackApi.setStatus(id, next);
      replaceEntry(r.entry);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  async function setPriority(id: number, next: FeedbackPriority | null) {
    setPendingId(id);
    try {
      const r = await adminFeedbackApi.triage(id, { priority: next });
      replaceEntry(r.entry);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  async function setArea(id: number, next: string | null) {
    setPendingId(id);
    try {
      const r = await adminFeedbackApi.triage(id, { feature_area: next });
      replaceEntry(r.entry);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  async function saveNotes(id: number) {
    setPendingId(id);
    try {
      const r = await adminFeedbackApi.triage(id, { admin_notes: notesDraft[id] ?? "" });
      replaceEntry(r.entry);
      toast.success(t("admin.feedback_notes_saved"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  function toggleExpand(entry: FeedbackEntry) {
    setExpandedId((cur) => {
      if (cur === entry.id) return null;
      // Seed the notes draft from the persisted value when opening.
      setNotesDraft((d) => ({ ...d, [entry.id]: entry.admin_notes ?? "" }));
      return entry.id;
    });
  }

  async function remove(id: number) {
    const ok = await confirm({
      title: t("admin.feedback_delete_confirm_title"),
      body: t("admin.feedback_delete_confirm_body"),
      confirmLabel: t("admin.feedback_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setPendingId(id);
    try {
      await adminFeedbackApi.remove(id);
      removeEntry(id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  function toggleFilter(s: FeedbackStatus) {
    setFilter((cur) => {
      const next = new Set(cur);
      if (next.has(s)) {
        if (next.size === 1) return cur; // never zero-active
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }

  const entries = loadable.status === "ok" ? loadable.data : [];

  const counts = useMemo(() => {
    const m: Record<FeedbackStatus, number> = {
      new: 0,
      reviewed: 0,
      planned: 0,
      fixed: 0,
      rejected: 0,
      archived: 0,
    };
    for (const e of entries) m[e.status] += 1;
    return m;
  }, [entries]);

  const visibleEntries = useMemo(
    () => entries.filter((e) => filter.has(e.status)),
    [entries, filter],
  );

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const fmtMoney = (amount: number, entryLocale: string | null) => {
    const symbol = entryLocale === "en" ? "€" : "Ft";
    const formatted = amount.toLocaleString(locale === "hu" ? "hu-HU" : "en-GB");
    return entryLocale === "en" ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
  };

  const colSpan = 8;

  return (
    <>
      <AdminPageHeader title={t("admin.feedback_title")} subtitle={t("admin.feedback_sub")} />

      <div className="mb-3 flex flex-wrap gap-2">
        {STATUS_ORDER.map((f) => {
          const count = counts[f];
          return (
            <AdminFilterChip
              key={f}
              label={`${t(`admin.feedback_filter_${f}`)}${count > 0 ? ` · ${count}` : ""}`}
              active={filter.has(f)}
              onClick={() => toggleFilter(f)}
            />
          );
        })}
      </div>

      {loadable.status === "loading" ? (
        <FeedbackSkeleton t={t} />
      ) : loadable.status === "error" ? (
        <div className="admin-card flex flex-col items-center justify-center space-y-2 py-8 text-center">
          <p className="text-sm text-neutral-700 dark:text-paper-100">
            {t("admin.feedback_load_error_title")}
          </p>
          <p className="text-xs text-neutral-500 dark:text-umber-300">
            {t("admin.feedback_load_error_body")}
          </p>
          <div className="pt-1">
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RotateCcw size={13} aria-hidden /> {t("admin.feedback_retry")}
            </button>
          </div>
        </div>
      ) : visibleEntries.length === 0 ? (
        <AdminEmptyState
          icon={<Inbox size={32} aria-hidden />}
          title={t("admin.feedback_empty_title")}
          description={t("admin.feedback_empty_body")}
        />
      ) : (
        <div className="admin-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="eyebrow text-left">
              <tr>
                <th className="pb-3">{t("admin.feedback_col_submitter")}</th>
                <th className="pb-3">{t("admin.feedback_col_message")}</th>
                <th className="hidden pb-3 lg:table-cell">{t("admin.feedback_col_area")}</th>
                <th className="hidden pb-3 lg:table-cell">{t("admin.feedback_col_priority")}</th>
                <th className="hidden pb-3 md:table-cell">{t("admin.feedback_col_source")}</th>
                <th className="hidden pb-3 sm:table-cell">{t("admin.feedback_col_submitted")}</th>
                <th className="pb-3">{t("admin.feedback_col_status")}</th>
                <th className="pb-3 text-right">{t("admin.feedback_col_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e) => {
                const displayEmail = e.user_email ?? e.from_email;
                const displayName =
                  e.user_full_name ?? (displayEmail ? "" : t("admin.feedback_anon"));
                const expanded = expandedId === e.id;
                return (
                  <FeedbackRowGroup key={e.id}>
                    <tr className="border-t border-paper-200 align-top transition-colors duration-150 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-800/60">
                      <td className="py-3 pr-4">
                        {displayName && (
                          <p className="font-medium text-neutral-900 dark:text-paper-50">
                            {displayName}
                          </p>
                        )}
                        {displayEmail && (
                          <a
                            href={`mailto:${displayEmail}`}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-umber-300 dark:hover:text-paper-50"
                          >
                            <Mail size={11} aria-hidden />
                            {displayEmail}
                          </a>
                        )}
                        {!displayName && !displayEmail && (
                          <span className="text-xs text-neutral-500 dark:text-umber-300">
                            {t("admin.feedback_anon")}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {e.message ? (
                          <p className="max-w-md whitespace-pre-wrap text-sm text-neutral-800 dark:text-paper-100">
                            {e.message}
                          </p>
                        ) : (
                          <span className="text-xs text-neutral-500 dark:text-umber-300">
                            {t("admin.feedback_no_message")}
                          </span>
                        )}
                        <div className="mt-1 flex gap-3 text-xs text-neutral-500 dark:text-umber-300 lg:hidden">
                          {e.rating !== null && <span>★ {e.rating}/10</span>}
                          {e.monthly_value_ft !== null && e.monthly_value_ft > 0 && (
                            <span>{fmtMoney(e.monthly_value_ft, e.locale)}</span>
                          )}
                          {e.priority && <span>{t(`admin.feedback_priority_${e.priority}`)}</span>}
                        </div>
                      </td>
                      <td className="hidden py-3 pr-4 lg:table-cell">
                        {e.feature_area ? (
                          <span className="text-xs text-neutral-700 dark:text-paper-100">
                            {e.feature_area}
                          </span>
                        ) : (
                          <span className="text-neutral-300 dark:text-umber-300">-</span>
                        )}
                      </td>
                      <td className="hidden py-3 pr-4 lg:table-cell">
                        {e.priority ? (
                          <Pill tone={PRIORITY_TONES[e.priority]}>
                            {t(`admin.feedback_priority_${e.priority}`)}
                          </Pill>
                        ) : (
                          <span className="text-neutral-300 dark:text-umber-300">-</span>
                        )}
                      </td>
                      <td className="hidden py-3 pr-4 text-xs text-neutral-500 dark:text-umber-300 md:table-cell">
                        {sourceLabel(e, t)}
                      </td>
                      <td className="hidden py-3 pr-4 text-xs text-neutral-500 dark:text-umber-300 sm:table-cell">
                        {fmtDate(e.created_at)}
                      </td>
                      <td className="py-3 pr-4">
                        <Pill tone={STATUS_TONES[e.status]} icon={statusIcon(e.status)}>
                          {t(`admin.feedback_status_${e.status}`)}
                        </Pill>
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            aria-expanded={expanded}
                            onClick={() => toggleExpand(e)}
                          >
                            <ChevronDown
                              size={13}
                              aria-hidden
                              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                            />
                            {expanded
                              ? t("admin.feedback_details_hide")
                              : t("admin.feedback_details_show")}
                          </button>
                          <button
                            type="button"
                            className="btn-alert btn-sm"
                            disabled={pendingId === e.id}
                            onClick={() => remove(e.id)}
                          >
                            <Trash2 size={13} aria-hidden /> {t("admin.feedback_delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-paper-200 dark:border-umber-700">
                        <td
                          colSpan={colSpan}
                          className="bg-paper-50/60 px-4 py-4 dark:bg-umber-900/40"
                        >
                          <TriagePanel
                            entry={e}
                            t={t}
                            locale={locale}
                            sourceLabel={sourceLabel(e, t)}
                            busy={pendingId === e.id}
                            notesDraft={notesDraft[e.id] ?? ""}
                            onNotesChange={(v) => setNotesDraft((d) => ({ ...d, [e.id]: v }))}
                            onSaveNotes={() => saveNotes(e.id)}
                            onSetStatus={(s) => setStatus(e.id, s)}
                            onSetPriority={(p) => setPriority(e.id, p)}
                            onSetArea={(a) => setArea(e.id, a)}
                          />
                        </td>
                      </tr>
                    )}
                  </FeedbackRowGroup>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Wraps the row + its expansion in a fragment without breaking the
 *  <tbody> → <tr> nesting rule (a div here would be invalid table markup). */
function FeedbackRowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function deviceIcon(device: string | null) {
  if (device === "mobile") return <Smartphone size={13} aria-hidden />;
  if (device === "tablet") return <Tablet size={13} aria-hidden />;
  return <Monitor size={13} aria-hidden />;
}

/** Expanded triage controls for one feedback entry: captured technical
 *  context, the status lifecycle, priority, product area, and internal
 *  notes. All mutations flow up through the page-level handlers. */
function TriagePanel({
  entry,
  t,
  locale,
  sourceLabel,
  busy,
  notesDraft,
  onNotesChange,
  onSaveNotes,
  onSetStatus,
  onSetPriority,
  onSetArea,
}: {
  entry: FeedbackEntry;
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: string;
  sourceLabel: string;
  busy: boolean;
  notesDraft: string;
  onNotesChange: (v: string) => void;
  onSaveNotes: () => void;
  onSetStatus: (s: FeedbackStatus) => void;
  onSetPriority: (p: FeedbackPriority | null) => void;
  onSetArea: (a: string | null) => void;
}) {
  // Keep any stored area value visible even if it's outside the curated list.
  const areaOptions = useMemo(() => {
    const set = new Set(FEATURE_AREAS);
    if (entry.feature_area && !set.has(entry.feature_area)) {
      return [entry.feature_area, ...FEATURE_AREAS];
    }
    return FEATURE_AREAS;
  }, [entry.feature_area]);

  const techRows: Array<{ label: string; value: string | null }> = [
    { label: t("admin.feedback_tech_device"), value: entry.device },
    { label: t("admin.feedback_tech_browser"), value: entry.browser },
    { label: t("admin.feedback_tech_os"), value: entry.os },
    { label: t("admin.feedback_tech_locale"), value: entry.locale },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: lifecycle + priority + area */}
      <div className="space-y-4">
        <div>
          <p className="field-label mb-1.5">{t("admin.feedback_triage_status_label")}</p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.map((s) => {
              const active = entry.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy || active}
                  onClick={() => onSetStatus(s)}
                  className={
                    active
                      ? "inline-flex items-center gap-1 rounded-full bg-ink-900 px-2.5 py-1 text-xs font-medium text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                      : "inline-flex items-center gap-1 rounded-full border border-paper-300 bg-white px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-ink-500 hover:bg-paper-100 disabled:opacity-50 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                  }
                >
                  {statusIcon(s, 12)}
                  {t(`admin.feedback_status_${s}`)}
                </button>
              );
            })}
          </div>
          <div className="mt-2">
            <button
              type="button"
              className="btn-outline btn-sm"
              disabled={busy || entry.status === "planned"}
              onClick={() => onSetStatus("planned")}
            >
              <ListChecks size={13} aria-hidden /> {t("admin.feedback_convert_action")}
            </button>
          </div>
        </div>

        <div>
          <p className="field-label mb-1.5">{t("admin.feedback_priority_label")}</p>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_ORDER.map((p) => {
              const active = entry.priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={busy}
                  onClick={() => onSetPriority(active ? null : p)}
                  className={
                    active
                      ? "inline-flex items-center rounded-full bg-ink-900 px-2.5 py-1 text-xs font-medium text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                      : "inline-flex items-center rounded-full border border-paper-300 bg-white px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-ink-500 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
                  }
                >
                  {t(`admin.feedback_priority_${p}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-xs">
          <label htmlFor={`fb-area-${entry.id}`} className="field-label mb-1.5 block">
            {t("admin.feedback_area_label")}
          </label>
          <select
            id={`fb-area-${entry.id}`}
            className="input"
            value={entry.feature_area ?? ""}
            disabled={busy}
            onChange={(ev) => onSetArea(ev.target.value === "" ? null : ev.target.value)}
          >
            <option value="">{t("admin.feedback_area_unset")}</option>
            {areaOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: technical context + internal notes */}
      <div className="space-y-4">
        <div>
          <p className="field-label mb-1.5">{t("admin.feedback_tech_label")}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-umber-200">
            <span className="inline-flex items-center gap-1">
              {deviceIcon(entry.device)}
              {entry.device ?? "-"}
            </span>
            {techRows.slice(1).map((r) => (
              <span key={r.label}>
                <span className="text-neutral-400 dark:text-umber-400">{r.label}:</span>{" "}
                {r.value ?? "-"}
              </span>
            ))}
            <span>
              <span className="text-neutral-400 dark:text-umber-400">
                {t("admin.feedback_col_source")}:
              </span>{" "}
              {sourceLabel}
            </span>
          </div>
          {entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-neutral-500 hover:text-neutral-800 dark:text-umber-300 dark:hover:text-paper-50"
            >
              <ExternalLink size={11} aria-hidden className="shrink-0" />
              <span className="truncate">{entry.url}</span>
            </a>
          )}
          {(entry.rating !== null || (entry.monthly_value_ft ?? 0) > 0) && (
            <div className="mt-1.5 flex gap-3 text-xs text-neutral-600 dark:text-umber-200">
              {entry.rating !== null && (
                <span>
                  {t("admin.feedback_col_rating")}: {entry.rating}/10
                </span>
              )}
              {(entry.monthly_value_ft ?? 0) > 0 && (
                <span>
                  {t("admin.feedback_col_monthly")}: {(() => {
                    const symbol = entry.locale === "en" ? "€" : "Ft";
                    const amt = (entry.monthly_value_ft ?? 0).toLocaleString(
                      locale === "hu" ? "hu-HU" : "en-GB",
                    );
                    return entry.locale === "en" ? `${symbol}${amt}` : `${amt} ${symbol}`;
                  })()}
                </span>
              )}
            </div>
          )}
        </div>

        <div>
          <label htmlFor={`fb-notes-${entry.id}`} className="field-label mb-1.5 block">
            {t("admin.feedback_notes_label")}
          </label>
          <textarea
            id={`fb-notes-${entry.id}`}
            className="input min-h-[5rem] resize-y"
            value={notesDraft}
            disabled={busy}
            placeholder={t("admin.feedback_notes_placeholder")}
            maxLength={4000}
            onChange={(ev) => onNotesChange(ev.target.value)}
          />
          <div className="mt-2">
            <button
              type="button"
              className="btn-outline btn-sm"
              disabled={busy || notesDraft === (entry.admin_notes ?? "")}
              onClick={onSaveNotes}
            >
              {t("admin.feedback_notes_save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedbackSkeleton({ t }: { t: (k: string) => string }) {
  return (
    <div className="admin-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="eyebrow text-left">
          <tr>
            <th className="pb-3">{t("admin.feedback_col_submitter")}</th>
            <th className="pb-3">{t("admin.feedback_col_message")}</th>
            <th className="hidden pb-3 lg:table-cell">{t("admin.feedback_col_area")}</th>
            <th className="hidden pb-3 lg:table-cell">{t("admin.feedback_col_priority")}</th>
            <th className="hidden pb-3 md:table-cell">{t("admin.feedback_col_source")}</th>
            <th className="hidden pb-3 sm:table-cell">{t("admin.feedback_col_submitted")}</th>
            <th className="pb-3">{t("admin.feedback_col_status")}</th>
            <th className="pb-3 text-right">{t("admin.feedback_col_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} className="border-t border-paper-200 dark:border-umber-700 align-top">
              <td className="py-3 pr-4">
                <div className="flex flex-col gap-1.5">
                  <Skeleton width={120} height={14} />
                  <Skeleton width={180} height={12} />
                </div>
              </td>
              <td className="py-3 pr-4">
                <div className="flex max-w-md flex-col gap-1.5">
                  <Skeleton width="100%" height={12} />
                  <Skeleton width="60%" height={12} />
                </div>
              </td>
              <td className="hidden py-3 pr-4 lg:table-cell">
                <Skeleton width={56} height={12} />
              </td>
              <td className="hidden py-3 pr-4 lg:table-cell">
                <Skeleton width={48} height={18} rounded="full" />
              </td>
              <td className="hidden py-3 pr-4 md:table-cell">
                <Skeleton width={56} height={12} />
              </td>
              <td className="hidden py-3 pr-4 sm:table-cell">
                <Skeleton width={80} height={12} />
              </td>
              <td className="py-3 pr-4">
                <Skeleton width={64} height={18} rounded="full" />
              </td>
              <td className="py-3">
                <div className="inline-flex flex-wrap justify-end gap-1">
                  <Skeleton width={72} height={28} rounded="md" />
                  <Skeleton width={72} height={28} rounded="md" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
