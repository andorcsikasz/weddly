import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";

export default function PlannerSettingsData() {
  const { t } = useT();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);

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
      await fetch("/api/planner/account", { method: "DELETE" });
      logout();
      navigate("/", { replace: true });
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Export - endpoint not wired yet, so this is an honest coming-soon. */}
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
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled
            className="btn-outline cursor-not-allowed text-sm opacity-60"
          >
            {t("planner_profile.data_export_button")}
          </button>
          <span className="rounded-full bg-paper-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-umber-600 dark:bg-umber-800 dark:text-umber-300">
            {t("planner_settings.data_export_soon")}
          </span>
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
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          {deleting ? t("common.loading") : t("planner_profile.data_delete_button")}
        </button>
      </div>
    </div>
  );
}
