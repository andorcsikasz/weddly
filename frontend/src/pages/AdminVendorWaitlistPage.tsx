// Admin triage for vendor waitlist submissions from /vendors. Lists every
// entry newest-first, with status pills + actions to mark contacted /
// dismiss / re-open.

import type { VendorWaitlistEntry, VendorWaitlistStatus } from "@shared/vendor_waitlist";
import { Mail, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function AdminVendorWaitlistPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const [entries, setEntries] = useState<VendorWaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminVendorWaitlistApi
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

  async function setStatus(id: number, next: VendorWaitlistStatus) {
    setPendingId(id);
    try {
      const r = await adminVendorWaitlistApi.setStatus(id, next);
      setEntries((cur) => cur.map((e) => (e.id === id ? r.entry : e)));
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

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("admin.waitlist_title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("admin.waitlist_sub")}</p>
      </header>

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-500">{t("common.loading")}</p>
      ) : entries.length === 0 ? (
        <div className="card text-center text-sm text-ink-500">{t("admin.waitlist_empty")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="pb-3">{t("admin.waitlist_col_business")}</th>
                <th className="hidden pb-3 md:table-cell">{t("admin.waitlist_col_category")}</th>
                <th className="hidden pb-3 sm:table-cell">{t("admin.waitlist_col_submitted")}</th>
                <th className="pb-3">{t("admin.waitlist_col_status")}</th>
                <th className="pb-3 text-right">{t("admin.waitlist_col_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-paper-200 align-top">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-ink-900">{e.business_name}</p>
                    <a
                      href={`mailto:${e.email}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800"
                    >
                      <Mail size={11} aria-hidden />
                      {e.email}
                    </a>
                    {e.location && <p className="mt-1 text-xs text-ink-500">{e.location}</p>}
                    {e.message && <p className="mt-2 text-xs italic text-ink-500">{e.message}</p>}
                  </td>
                  <td className="hidden py-3 pr-4 md:table-cell">
                    {t(`suppliers.cat.${e.category}`)}
                  </td>
                  <td className="hidden py-3 pr-4 text-xs text-ink-500 sm:table-cell">
                    {fmtDate(e.created_at)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={e.status} t={t} />
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1">
                      {e.status !== "contacted" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={pendingId === e.id}
                          onClick={() => setStatus(e.id, "contacted")}
                        >
                          <Mail size={13} aria-hidden /> {t("admin.waitlist_mark_contacted")}
                        </button>
                      )}
                      {e.status !== "dismissed" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={pendingId === e.id}
                          onClick={() => setStatus(e.id, "dismissed")}
                        >
                          <X size={13} aria-hidden /> {t("admin.waitlist_dismiss")}
                        </button>
                      )}
                      {e.status !== "new" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={pendingId === e.id}
                          onClick={() => setStatus(e.id, "new")}
                        >
                          <RotateCcw size={13} aria-hidden /> {t("admin.waitlist_reopen")}
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
    </AppShell>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: VendorWaitlistStatus;
  t: (k: string) => string;
}) {
  const className =
    status === "new"
      ? "inline-flex items-center rounded-full bg-ink-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-paper-100"
      : status === "contacted"
        ? "inline-flex items-center rounded-full bg-blush-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blush-700"
        : "inline-flex items-center rounded-full border border-paper-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500";
  return <span className={className}>{t(`admin.waitlist_status_${status}`)}</span>;
}
