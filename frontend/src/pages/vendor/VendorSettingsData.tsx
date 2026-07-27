// Data tab of the vendor settings hub — GDPR-style takeout. The export calls
// GET /api/vendor/export and serialises the JSON into a client-side download
// (no server-side file). Account deletion has no vendor endpoint yet, so that
// card is an honest contact-support note rather than a fake button.

import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm, useToast } from "../../components/ui";
import { vendorAccountApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export default function VendorSettingsData() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [exporting, setExporting] = useState(false);

  /** The mail client opening is itself a soft confirmation, so this exists for
   *  intent rather than safety: it states what deletion means (staff-processed,
   *  30 days, irreversible) before the vendor is looking at a compose window
   *  instead of at us. Nothing is destroyed either way. */
  async function askThenMail(href: string) {
    const ok = await confirm({
      title: t("vendor.settings.data_delete_confirm_title"),
      body: t("vendor.settings.data_delete_confirm_body"),
      confirmLabel: t("vendor.settings.data_delete_cta"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (ok) window.location.href = href;
  }

  async function handleExport() {
    setExporting(true);
    try {
      const data = await vendorAccountApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `weddly-vendor-export-${new Date(data.exported_at).toISOString().slice(0, 10)}.json`;
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

  const contactEmail = t("about.paragraph_contact_email");

  return (
    <div className="mt-8 space-y-6">
      {/* Export — live endpoint, JSON download. */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-ink-400 dark:text-umber-400" aria-hidden="true" />
          <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
            {t("vendor.settings.data_export_title")}
          </p>
        </div>
        <p className="mt-1.5 text-sm text-ink-600 dark:text-paper-300">
          {t("vendor.settings.data_export_body")}
        </p>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void handleExport()}
          className="btn-primary mt-4"
        >
          <Download size={16} aria-hidden="true" />
          {exporting ? t("common.loading") : t("vendor.settings.export_button")}
        </button>
      </div>

      {/* Delete — no vendor-side endpoint yet; honest support path. */}
      <div className="card border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2">
          <Trash2 size={16} className="text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="font-grotesk text-base font-semibold text-red-700 dark:text-red-400">
            {t("vendor.settings.data_delete_heading")}
          </p>
        </div>
        <p className="mt-1.5 text-sm text-ink-700 dark:text-umber-300">
          {t("vendor.settings.data_delete_desc")}
        </p>
        <button
          type="button"
          onClick={() =>
            void askThenMail(
              `mailto:${contactEmail}?subject=${encodeURIComponent(t("vendor.settings.data_delete_heading"))}`,
            )
          }
          className="btn-outline mt-4 inline-flex w-fit"
        >
          {t("vendor.settings.data_delete_cta")}
        </button>
      </div>
    </div>
  );
}
