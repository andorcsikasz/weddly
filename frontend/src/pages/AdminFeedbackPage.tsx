// Admin triage for in-product Visszajelzés submissions. Lists every
// entry newest-first, with status pills + actions to mark read /
// resolved / dismissed / re-open / delete. A multi-select filter chip
// row at the top scopes the table; the default selection is "new + read"
// ("untriaged") so the work that needs attention is what the page loads
// into. The fetch is tri-state — loading skeleton → list / error inline
// with retry — so an API outage doesn't disguise itself as an empty inbox.

import type { FeedbackEntry, FeedbackStatus } from "@shared/feedback";
import { CheckCircle2, Eye, Inbox, Mail, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { useDocumentMeta } from "../lib/seo";
import { ApiError } from "../lib/api";
import { adminFeedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Tri-state load envelope. Mirrors AdminAnalyticsPage so an API outage
 *  shows a real error card with retry — the previous `.catch(() =>
 *  setLoading(false))` silently disguised network failures as an empty
 *  inbox, which is the worst possible failure mode for triage. */
type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

/** All filterable statuses. The FeedbackStatus type ships with four; the
 *  panel critique mentioned a fifth (spam) that isn't in the type yet —
 *  picking it up here without a backend change would just dead-code a
 *  chip, so we stick to the four real statuses. When spam lands in
 *  shared/feedback.ts, add it to this array + the maps below. */
const FILTERS: FeedbackStatus[] = ["new", "read", "resolved", "dismissed"];

/** Default multi-select on mount — the untriaged bucket. Keeps the
 *  resting page focused on work that needs attention, instead of dumping
 *  every historical entry into view. */
const DEFAULT_FILTER: ReadonlySet<FeedbackStatus> = new Set(["new", "read"]);

/** Pill tone + icon per status. The previous StatusPill was colour-only,
 *  which is bad for low-vision users; the icon adds a second signal so
 *  the status reads even when the hue doesn't land (light/dark mode,
 *  desaturated, monochrome printout). */
const STATUS_TONES: Record<FeedbackStatus, PillTone> = {
  new: "violet",
  read: "paper",
  resolved: "sage",
  dismissed: "muted",
};

const FILTER_KEY: Record<FeedbackStatus, string> = {
  new: "admin.feedback_filter_new",
  read: "admin.feedback_filter_read",
  resolved: "admin.feedback_filter_resolved",
  dismissed: "admin.feedback_filter_dismissed",
};

/** Maps the in-app pathname captured at submission (FeedbackEntry.context)
 *  to a human page label, reusing the same nav.* / admin.nav_* keys the
 *  sidebar already translates — so "Photos"/"Képek" stays in lockstep with
 *  the nav rename instead of drifting in a parallel string table. Longest,
 *  most specific prefix first; "/app" is the catch-all (dashboard + any
 *  unmapped surface). Matching is path-boundary aware so "/app/guests"
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

/** Friendly "where from" label for an entry. In-app rows resolve to the
 *  page they were submitted from (e.g. "Képek"); landing rows and in-app
 *  rows with no/unrecognised context fall back to the coarse source label. */
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
        // Surface the underlying message in a toast too — the inline card
        // shows a generic line + retry, the toast gives the specific reason.
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      });
    return () => {
      cancelled = true;
    };
    // toast/t are stable per render; reloadNonce is what drives a refetch.
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
        // Don't allow zero-active — flipping the last one off would render an
        // unconditionally empty page that looks like a bug. Clicking the
        // active chip when it's the only one is a no-op.
        if (next.size === 1) return cur;
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }

  const entries = loadable.status === "ok" ? loadable.data : [];

  const counts = useMemo(() => {
    const m: Record<FeedbackStatus, number> = { new: 0, read: 0, resolved: 0, dismissed: 0 };
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
  // The `monthly_value_ft` column is unit-tagged by `entry.locale`: HU rows
  // are HUF (0–15 000 range), EN rows are EUR (0–50 range). Column name is
  // historic — see FeedbackDialog.tsx for the per-locale slider range.
  // Rendering always uses the *admin's* locale for number grouping (so
  // 1 234 vs 1,234), but the *entry's* locale picks the symbol.
  const fmtMoney = (amount: number, entryLocale: string | null) => {
    const symbol = entryLocale === "en" ? "€" : "Ft";
    const formatted = amount.toLocaleString(locale === "hu" ? "hu-HU" : "en-GB");
    return entryLocale === "en" ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
  };

  return (
    <>
      <AdminPageHeader title={t("admin.feedback_title")} subtitle={t("admin.feedback_sub")} />

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = counts[f];
          return (
            <AdminFilterChip
              key={f}
              label={`${t(FILTER_KEY[f])}${count > 0 ? ` · ${count}` : ""}`}
              active={filter.has(f)}
              onClick={() => toggleFilter(f)}
            />
          );
        })}
      </div>

      {loadable.status === "loading" ? (
        <div className="admin-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="eyebrow text-left">
              <tr>
                <th className="pb-3">{t("admin.feedback_col_submitter")}</th>
                <th className="pb-3">{t("admin.feedback_col_message")}</th>
                <th className="hidden pb-3 sm:table-cell">{t("admin.feedback_col_rating")}</th>
                <th className="hidden pb-3 md:table-cell">{t("admin.feedback_col_monthly")}</th>
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
                      <Skeleton width="85%" height={12} />
                      <Skeleton width="60%" height={12} />
                    </div>
                  </td>
                  <td className="hidden py-3 pr-4 sm:table-cell">
                    <Skeleton width={36} height={14} />
                  </td>
                  <td className="hidden py-3 pr-4 md:table-cell">
                    <Skeleton width={64} height={14} />
                  </td>
                  <td className="hidden py-3 pr-4 md:table-cell">
                    <Skeleton width={56} height={12} />
                  </td>
                  <td className="hidden py-3 pr-4 sm:table-cell">
                    <Skeleton width={80} height={12} />
                  </td>
                  <td className="py-3 pr-4">
                    <Skeleton width={56} height={18} rounded="full" />
                  </td>
                  <td className="py-3">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      <Skeleton width={72} height={28} rounded="md" />
                      <Skeleton width={72} height={28} rounded="md" />
                      <Skeleton width={28} height={28} rounded="md" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <th className="hidden pb-3 sm:table-cell">{t("admin.feedback_col_rating")}</th>
                <th className="hidden pb-3 md:table-cell">{t("admin.feedback_col_monthly")}</th>
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
                return (
                  <tr
                    key={e.id}
                    className="border-t border-paper-200 align-top transition-colors duration-150 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-800/60"
                  >
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
                      {/* Mobile fallback: surface rating/monthly inline when hidden columns are off. */}
                      <div className="mt-1 flex gap-3 text-xs text-neutral-500 dark:text-umber-300 sm:hidden">
                        {e.rating !== null && <span>★ {e.rating}/10</span>}
                        {e.monthly_value_ft !== null && e.monthly_value_ft > 0 && (
                          <span>{fmtMoney(e.monthly_value_ft, e.locale)}</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden py-3 pr-4 sm:table-cell">
                      {e.rating === null ? (
                        <span className="text-neutral-300 dark:text-umber-300">—</span>
                      ) : (
                        <span className="font-medium text-neutral-900 dark:text-paper-50">
                          {e.rating}/10
                        </span>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 md:table-cell">
                      {e.monthly_value_ft === null || e.monthly_value_ft === 0 ? (
                        <span className="text-neutral-300 dark:text-umber-300">—</span>
                      ) : (
                        <span className="text-neutral-900 dark:text-paper-50">
                          {fmtMoney(e.monthly_value_ft, e.locale)}
                        </span>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 text-xs text-neutral-500 dark:text-umber-300 md:table-cell">
                      {sourceLabel(e, t)}
                    </td>
                    <td className="hidden py-3 pr-4 text-xs text-neutral-500 dark:text-umber-300 sm:table-cell">
                      {fmtDate(e.created_at)}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusPill status={e.status} t={t} />
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {e.status === "new" && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={pendingId === e.id}
                            onClick={() => setStatus(e.id, "read")}
                          >
                            <Eye size={13} aria-hidden /> {t("admin.feedback_mark_read")}
                          </button>
                        )}
                        {e.status !== "resolved" && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={pendingId === e.id}
                            onClick={() => setStatus(e.id, "resolved")}
                          >
                            <CheckCircle2 size={13} aria-hidden />{" "}
                            {t("admin.feedback_mark_resolved")}
                          </button>
                        )}
                        {e.status !== "dismissed" && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={pendingId === e.id}
                            onClick={() => setStatus(e.id, "dismissed")}
                          >
                            <X size={13} aria-hidden /> {t("admin.feedback_dismiss")}
                          </button>
                        )}
                        {(e.status === "resolved" || e.status === "dismissed") && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={pendingId === e.id}
                            onClick={() => setStatus(e.id, "new")}
                          >
                            <RotateCcw size={13} aria-hidden /> {t("admin.feedback_reopen")}
                          </button>
                        )}
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Status pill — routes through the shared <Pill> primitive so the
 *  tone palette + dark-mode contrast lives in one place. Each status
 *  carries an icon as a second signal so the chip reads even when the
 *  hue doesn't land (low-vision, monochrome). */
function StatusPill({
  status,
  t,
}: {
  status: FeedbackStatus;
  t: (k: string) => string;
}) {
  const icon =
    status === "new" ? (
      <Eye size={11} aria-hidden />
    ) : status === "read" ? (
      <Eye size={11} aria-hidden />
    ) : status === "resolved" ? (
      <CheckCircle2 size={11} aria-hidden />
    ) : (
      <X size={11} aria-hidden />
    );
  return (
    <Pill tone={STATUS_TONES[status]} icon={icon}>
      {t(`admin.feedback_status_${status}`)}
    </Pill>
  );
}
