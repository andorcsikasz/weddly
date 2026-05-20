// Admin triage for in-product Visszajelzés submissions. Lists every
// entry newest-first, with status pills + actions to mark read /
// resolved / dismissed / re-open / delete.

import type { FeedbackEntry, FeedbackStatus } from "@shared/feedback";
import { CheckCircle2, Eye, Mail, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminEmptyState, AdminPageHeader } from "../components/admin";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { useDocumentMeta } from "../lib/seo";
import { ApiError } from "../lib/api";
import { adminFeedbackApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function AdminFeedbackPage() {
  const { t, locale } = useT();
  useDocumentMeta(t("seo.admin_feedback_title"), t("seo.admin_feedback_description"));
  const toast = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFeedbackApi
      .list()
      .then((r) => {
        if (!cancelled) {
          setEntries(r.entries);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function setStatus(id: number, next: FeedbackStatus) {
    setPendingId(id);
    try {
      const r = await adminFeedbackApi.setStatus(id, next);
      setEntries((cur) => cur.map((e) => (e.id === id ? r.entry : e)));
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
      setEntries((cur) => cur.filter((e) => e.id !== id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const fmtMoney = (huf: number) => huf.toLocaleString(locale === "hu" ? "hu-HU" : "en-GB") + " Ft";

  return (
    <>
      <AdminPageHeader title={t("admin.feedback_title")} subtitle={t("admin.feedback_sub")} />

      {loading ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
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
      ) : entries.length === 0 ? (
        <AdminEmptyState>{t("admin.feedback_empty")}</AdminEmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
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
              {entries.map((e) => {
                const displayEmail = e.user_email ?? e.from_email;
                const displayName =
                  e.user_full_name ?? (displayEmail ? "" : t("admin.feedback_anon"));
                return (
                  <tr
                    key={e.id}
                    className="border-t border-paper-200 align-top transition-colors duration-150 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-700/40"
                  >
                    <td className="py-3 pr-4">
                      {displayName && (
                        <p className="font-medium text-ink-900 dark:text-paper-50">{displayName}</p>
                      )}
                      {displayEmail && (
                        <a
                          href={`mailto:${displayEmail}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-50"
                        >
                          <Mail size={11} aria-hidden />
                          {displayEmail}
                        </a>
                      )}
                      {!displayName && !displayEmail && (
                        <span className="text-xs italic text-ink-500 dark:text-umber-300">
                          {t("admin.feedback_anon")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {e.message ? (
                        <p className="max-w-md whitespace-pre-wrap text-sm text-ink-800 dark:text-paper-100">
                          {e.message}
                        </p>
                      ) : (
                        <span className="text-xs italic text-ink-500 dark:text-umber-300">
                          {t("admin.feedback_no_message")}
                        </span>
                      )}
                      {/* Mobile fallback: surface rating/monthly inline when hidden columns are off. */}
                      <div className="mt-1 flex gap-3 text-xs text-ink-500 dark:text-umber-300 sm:hidden">
                        {e.rating !== null && <span>★ {e.rating}/10</span>}
                        {e.monthly_value_ft !== null && e.monthly_value_ft > 0 && (
                          <span>{fmtMoney(e.monthly_value_ft)}</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden py-3 pr-4 sm:table-cell">
                      {e.rating === null ? (
                        <span className="text-ink-300 dark:text-umber-300">—</span>
                      ) : (
                        <span className="font-medium text-ink-900 dark:text-paper-50">
                          {e.rating}/10
                        </span>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 md:table-cell">
                      {e.monthly_value_ft === null || e.monthly_value_ft === 0 ? (
                        <span className="text-ink-300 dark:text-umber-300">—</span>
                      ) : (
                        <span className="text-ink-900 dark:text-paper-50">
                          {fmtMoney(e.monthly_value_ft)}
                        </span>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 text-xs text-ink-500 dark:text-umber-300 md:table-cell">
                      {t(`admin.feedback_source_${e.source}`)}
                    </td>
                    <td className="hidden py-3 pr-4 text-xs text-ink-500 dark:text-umber-300 sm:table-cell">
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
                          className="btn-ghost btn-sm text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15"
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

function StatusPill({
  status,
  t,
}: {
  status: FeedbackStatus;
  t: (k: string) => string;
}) {
  const className =
    status === "new"
      ? "inline-flex items-center rounded-full bg-violet-900 dark:bg-violet-500/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-paper-100 dark:text-violet-100"
      : status === "read"
        ? "inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-950 dark:text-violet-200"
        : status === "resolved"
          ? "inline-flex items-center rounded-full bg-green-100 dark:bg-sage-400/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-700 dark:text-sage-300"
          : "inline-flex items-center rounded-full border border-paper-300 dark:border-umber-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300";
  return <span className={className}>{t(`admin.feedback_status_${status}`)}</span>;
}
