// Profile: personal info (name, email) + workspace ops (export, pause/cancel).

import type { CouplePauseRequest, CoupleStatus } from "@shared/types";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { exportApi, pauseApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

export default function ProfilePage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: t("profile.pause_confirm_title"),
      body: t("profile.pause_confirm"),
      confirmLabel: t("profile.pause_confirm_yes"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
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
      <h1>{t("profile.title")}</h1>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.personal_info_title")}</h2>
        <p className="mt-1 text-sm text-ink-500">{t("profile.personal_info_body")}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("profile.field_name")} value={user?.full_name || "—"} />
          <Field label={t("profile.field_email")} value={user?.email || "—"} />
        </dl>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.payments_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.payments_body")}</p>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.export_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.export_body")}</p>
        <button
          type="button"
          className="btn-outline mt-4"
          onClick={downloadExport}
          disabled={exporting}
        >
          {exporting ? t("profile.export_downloading") : t("profile.export_button")}
        </button>
      </section>

      <section className="card mt-6 border-blush-200">
        <h2 className="text-lg">{t("profile.pause_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.pause_body")}</p>
        {coupleStatus === "paused" && pauseReq ? (
          <div className="mt-4 rounded-xl bg-blush-50 p-4">
            <p className="text-sm font-medium text-blush-800">{t("profile.pause_pending")}</p>
            {scheduledYmd && (
              <p className="mt-1 text-xs text-blush-700">
                {t("profile.pause_pending_until", { date: formatDate(scheduledYmd, locale) })}
              </p>
            )}
            <button type="button" className="btn-outline mt-4" onClick={cancelPause}>
              {t("profile.cancel_pause")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-accent mt-4" onClick={startPause}>
            {t("profile.pause_button")}
          </button>
        )}
        {error && <p className="field-error mt-3">{error}</p>}
      </section>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd className="text-sm text-ink-800">{value}</dd>
    </div>
  );
}
