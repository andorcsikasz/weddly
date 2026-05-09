// Profile: personal info (name, email) + workspace ops (export, pause/cancel).

import type { CouplePauseRequest, CoupleStatus } from "@shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useConfirm } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { exportApi, pauseApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

export default function ProfilePage() {
  const { t, locale, setLocale } = useT();
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
          <Field
            label={t("profile.field_email")}
            value={user?.email || "—"}
            help={t("profile.email_change_help")}
          />
        </dl>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.preferences_title")}</h2>
        <p className="mt-1 text-sm text-ink-500">{t("profile.preferences_body")}</p>

        <fieldset className="mt-4">
          <legend className="field-label">{t("profile.preferences_locale_label")}</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(["hu", "en"] as const).map((opt) => (
              <label
                key={opt}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                  locale === opt
                    ? "border-ink-700 bg-paper-100 text-ink-900"
                    : "border-paper-300 bg-white text-ink-700 hover:bg-paper-100"
                }`}
              >
                <input
                  type="radio"
                  name="locale"
                  value={opt}
                  checked={locale === opt}
                  onChange={() => setLocale(opt as Locale)}
                  className="h-4 w-4 accent-ink-700"
                />
                <span>
                  {opt === "hu"
                    ? t("profile.preferences_locale_hu")
                    : t("profile.preferences_locale_en")}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6">
          <p className="field-label">{t("profile.preferences_password_label")}</p>
          <p className="mt-1 text-xs text-ink-500">{t("profile.preferences_password_help")}</p>
          <Link to="/forgot-password" className="btn-outline mt-3 inline-flex">
            {t("profile.preferences_password_link")}
          </Link>
        </div>
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

      <section className="card mt-6 border-2 border-blush-500 bg-blush-50/40">
        <h2 className="text-lg text-blush-800">{t("profile.pause_title")}</h2>
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

function Field({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd className="text-sm text-ink-800">{value}</dd>
      {help && <p className="mt-1 text-xs text-ink-500">{help}</p>}
    </div>
  );
}
