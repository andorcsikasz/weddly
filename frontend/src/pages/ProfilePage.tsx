// Profile: preferences + workspace ops (export, delete account).

import type { Couple, CouplePauseRequest, CoupleStatus } from "@shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useEntryPrompt } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, exportApi, pauseApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

function deleteVerifyPhrase(couple: Couple | null): string {
  if (!couple) return "";
  return `${couple.bride_name}${couple.groom_name}`.replace(/\s+/g, "").toUpperCase();
}

export default function ProfilePage() {
  const { t, locale, setLocale } = useT();
  const promptEntry = useEntryPrompt();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [coupleStatus, setCoupleStatus] = useState<CoupleStatus>("active");
  const [pauseReq, setPauseReq] = useState<CouplePauseRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function refresh() {
    const [pause, current] = await Promise.all([pauseApi.status(), coupleApi.current()]);
    setCoupleStatus(pause.couple_status);
    setPauseReq(pause.pause_request);
    setCouple(current.couple);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function startPause() {
    const phrase = deleteVerifyPhrase(couple);
    if (!phrase) return;
    const entered = await promptEntry({
      title: t("profile.delete_account_confirm_title"),
      label: t("profile.delete_account_confirm_label", { phrase }),
      helperText: t("profile.delete_account_confirm_help"),
      placeholder: phrase,
      confirmLabel: t("profile.delete_account_confirm_yes"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.toUpperCase() === phrase
          ? null
          : t("profile.delete_account_confirm_mismatch", { phrase }),
    });
    if (entered === null) return;
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
        <h2 className="text-lg text-blush-800">{t("profile.delete_account_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.delete_account_body")}</p>
        {coupleStatus === "paused" && pauseReq ? (
          <div className="mt-4 rounded-xl bg-blush-50 p-4">
            <p className="text-sm font-medium text-blush-800">
              {t("profile.delete_account_pending")}
            </p>
            {scheduledYmd && (
              <p className="mt-1 text-xs text-blush-700">
                {t("profile.delete_account_pending_until", {
                  date: formatDate(scheduledYmd, locale),
                })}
              </p>
            )}
            <button type="button" className="btn-outline mt-4" onClick={cancelPause}>
              {t("profile.cancel_delete_account")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-accent mt-4" onClick={startPause} disabled={!couple}>
            {t("profile.delete_account_button")}
          </button>
        )}
        {error && <p className="field-error mt-3">{error}</p>}
      </section>
    </AppShell>
  );
}
