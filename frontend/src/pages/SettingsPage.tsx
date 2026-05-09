// Settings: language toggle + workspace pause/cancel.

import type { CouplePauseRequest, CoupleStatus } from "@shared/types";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ApiError } from "../lib/api";
import { exportApi, pauseApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

export default function SettingsPage() {
  const { t, locale, setLocale } = useT();
  const [coupleStatus, setCoupleStatus] = useState<CoupleStatus>("active");
  const [pauseReq, setPauseReq] = useState<CouplePauseRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function refresh() {
    const r = await pauseApi.status();
    setCoupleStatus(r.couple_status);
    setPauseReq(r.pause_request);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function startPause() {
    if (!confirm(t("settings.pause_confirm"))) return;
    try {
      await pauseApi.request();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function cancelPause() {
    try {
      await pauseApi.cancel();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function downloadExport() {
    setExporting(true);
    try {
      const data = await exportApi.download();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `weddly-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setExporting(false);
    }
  }

  const scheduledYmd = pauseReq?.scheduled_delete_at
    ? new Date(pauseReq.scheduled_delete_at).toISOString().slice(0, 10)
    : null;

  return (
    <AppShell>
      <h1>{t("settings.title")}</h1>

      <section className="card mt-6">
        <h2 className="text-lg">{t("settings.locale_label")}</h2>
        <div className="mt-3 inline-flex overflow-hidden rounded-full border border-paper-300">
          <button
            type="button"
            onClick={() => setLocale("hu")}
            className={
              locale === "hu"
                ? "bg-ink-800 px-4 py-1.5 text-sm text-paper-100"
                : "px-4 py-1.5 text-sm text-ink-700"
            }
          >
            {t("settings.locale_hu")}
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={
              locale === "en"
                ? "bg-ink-800 px-4 py-1.5 text-sm text-paper-100"
                : "px-4 py-1.5 text-sm text-ink-700"
            }
          >
            {t("settings.locale_en")}
          </button>
        </div>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("settings.export_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("settings.export_body")}</p>
        <button
          type="button"
          className="btn-outline mt-4"
          onClick={downloadExport}
          disabled={exporting}
        >
          {exporting ? t("settings.export_downloading") : t("settings.export_button")}
        </button>
      </section>

      <section className="card mt-6 border-blush-200">
        <h2 className="text-lg">{t("settings.pause_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("settings.pause_body")}</p>
        {coupleStatus === "paused" && pauseReq ? (
          <div className="mt-4 rounded-xl bg-blush-50 p-4">
            <p className="text-sm font-medium text-blush-800">{t("settings.pause_pending")}</p>
            {scheduledYmd && (
              <p className="mt-1 text-xs text-blush-700">
                {t("settings.pause_pending_until", { date: formatDate(scheduledYmd, locale) })}
              </p>
            )}
            <button type="button" className="btn-outline mt-4" onClick={cancelPause}>
              {t("settings.cancel_pause")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-accent mt-4" onClick={startPause}>
            {t("settings.pause_button")}
          </button>
        )}
        {error && <p className="field-error mt-3">{error}</p>}
      </section>
    </AppShell>
  );
}
