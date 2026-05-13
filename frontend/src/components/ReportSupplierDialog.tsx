// Couple-side abuse-report modal for community-submitted suppliers. Three
// distinct reporters auto-hide the listing; admin can review the queue at
// /app/admin/suppliers. Self-reports are rejected server-side.

import type { CommunitySupplierReportReason } from "@shared/community_suppliers";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, useToast } from "./ui";

type Props = {
  /** Numeric supplier id (the `N` from `c{N}`). Null when the dialog is closed. */
  supplierId: number | null;
  supplierName: string;
  onClose: () => void;
  /** Fires after a successful report. The page uses this to refresh the
   *  directory when the supplier was auto-hidden. */
  onReported: (result: { autoHidden: boolean }) => void;
};

const REASONS: CommunitySupplierReportReason[] = [
  "spam",
  "fake",
  "offensive",
  "wrong_info",
  "other",
];

export function ReportSupplierDialog({ supplierId, supplierName, onClose, onReported }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [reason, setReason] = useState<CommunitySupplierReportReason | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset every time the dialog opens for a new supplier — otherwise a fresh
  // open inherits the previous user's selection.
  useEffect(() => {
    if (supplierId !== null) {
      setReason(null);
      setNote("");
    }
  }, [supplierId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (supplierId === null || reason === null || submitting) return;

    setSubmitting(true);
    try {
      const res = await supplierApi.reportCommunity(supplierId, reason, note.trim() || undefined);
      if (res.duplicate) {
        toast.info(t("suppliers.report.duplicate_toast"));
      } else if (res.auto_hidden) {
        toast.success(t("suppliers.report.auto_hidden_toast"));
      } else {
        toast.success(t("suppliers.report.thanks_toast"));
      }
      onReported({ autoHidden: res.auto_hidden });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          toast.error(t("suppliers.report.err_rate_limited"));
        } else if (err.status >= 400 && err.status < 500) {
          toast.error(err.message);
        } else {
          toast.error(t("common.error_generic"));
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={supplierId !== null}
      role="dialog"
      title={t("suppliers.report.title")}
      onClose={() => {
        if (!submitting) onClose();
      }}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="report-supplier-form"
            loading={submitting}
            disabled={reason === null}
            loadingLabel={t("suppliers.report.submitting")}
          >
            {t("suppliers.report.submit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600 dark:text-umber-200">
        {t("suppliers.report.intro", { name: supplierName })}
      </p>
      <form id="report-supplier-form" onSubmit={onSubmit} className="mt-4 space-y-4">
        <fieldset className="space-y-2">
          <legend className="field-label">{t("suppliers.report.reason_label")}</legend>
          <div className="space-y-1.5">
            {REASONS.map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                  reason === r
                    ? "border-sage-400 bg-sage-50 dark:border-sage-400/40 dark:bg-sage-400/15"
                    : "border-paper-200 bg-paper-50 hover:border-paper-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{t(`suppliers.report.reason.${r}.label`)}</span>
                  <span className="block text-xs text-ink-500 dark:text-umber-300">
                    {t(`suppliers.report.reason.${r}.desc`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="report-supplier-note" className="field-label">
            {t("suppliers.report.note_label")}
          </label>
          <textarea
            id="report-supplier-note"
            className="input min-h-[80px]"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("suppliers.report.note_placeholder")}
          />
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">{note.length}/500</p>
        </div>
      </form>
    </Dialog>
  );
}
