import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";
import { useConfirm } from "../../components/ui";

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
      <div className="card">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
          {t("planner_profile.data_heading")}
        </p>
        <p className="mt-2 text-sm text-umber-700 dark:text-umber-300">
          {t("planner_profile.data_delete_body")}
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => {}}
          >
            {t("planner_profile.data_export_button")}
          </button>
        </div>
      </div>

      <div className="card border-red-200 dark:border-red-900">
        <p className="font-grotesk text-base font-semibold text-red-700 dark:text-red-400">
          {t("planner_profile.data_delete_heading")}
        </p>
        <p className="mt-1 text-sm text-umber-700 dark:text-umber-300">
          {t("planner_profile.data_delete_body")}
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          {deleting ? "..." : t("planner_profile.data_delete_button")}
        </button>
      </div>
    </div>
  );
}
