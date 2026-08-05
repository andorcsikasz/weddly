// Data tab of the planner settings hub — GDPR takeout + erasure.
//
// Both cards used to be unfinished in opposite directions: the export was an
// honest disabled "coming soon", while delete fired a raw unauthenticated
// `fetch` at a route that did not exist, ignored the response, and logged the
// planner out — so a 404 read to the user as a completed erasure. Both go
// through `plannerApi` now, which throws on a non-2xx, so a failed delete
// keeps the session and says so.

import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm, useToast } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export default function PlannerSettingsData() {
  const { t } = useT();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await plannerApi.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `weddly-planner-export-${data.exported_at.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: t("planner_profile.data_delete_heading"),
      body: t("planner_profile.data_delete_body"),
      confirmLabel: t("planner_profile.data_delete_button"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await plannerApi.deleteAccount();
    } catch {
      // Nothing was erased, so the planner stays signed in and can retry or
      // write to support. Logging them out here would repeat the old lie in a
      // quieter register.
      toast.error(t("common.error_generic"));
      setDeleting(false);
      return;
    }
    logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="card">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-umber-500 dark:text-umber-400" aria-hidden="true" />
          <p className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
            {t("planner_settings.data_export_heading")}
          </p>
        </div>
        <p className="mt-1.5 text-sm text-umber-600 dark:text-umber-300">
          {t("planner_settings.data_export_desc")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="btn-outline inline-flex min-h-[44px] items-center whitespace-nowrap text-sm disabled:opacity-60"
          >
            {exporting ? t("common.loading") : t("planner_profile.data_export_button")}
          </button>
        </div>
      </div>

      {/* Delete account - destructive, GDPR right-to-erasure. */}
      <div className="card border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2">
          <Trash2 size={16} className="text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="font-grotesk text-base font-semibold text-red-700 dark:text-red-400">
            {t("planner_profile.data_delete_heading")}
          </p>
        </div>
        <p className="mt-1.5 text-sm text-umber-700 dark:text-umber-300">
          {t("planner_settings.data_delete_desc")}
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          {deleting ? t("common.loading") : t("planner_profile.data_delete_button")}
        </button>
      </div>
    </div>
  );
}
