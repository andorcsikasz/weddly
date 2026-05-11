// Profile: workspace ops only — payments placeholder, security, export,
// saved download archive, delete account.

import type {
  Couple,
  CouplePauseRequest,
  CoupleStatus,
  DataExportSummary,
  ExportKind,
} from "@shared/types";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  authApi,
  coupleApi,
  documentsApi,
  exportApi,
  fetchGuestCsvBlob,
  fetchSavedExportBlob,
  pauseApi,
  userApi,
} from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

function deleteVerifyPhrase(couple: Couple | null): string {
  if (!couple) return "";
  return `${couple.bride_name}${couple.groom_name}`.replace(/\s+/g, "").toUpperCase();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ms: number, locale: Locale): string {
  const d = new Date(ms);
  const dateStr = formatDate(d.toISOString().slice(0, 10), locale);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dateStr} ${hh}:${mm}`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ProfilePage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.profile_title", "seo.profile_description");
  const promptEntry = useEntryPrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const { setSession, user: authUser, refresh: refreshAuth, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [verifyResending, setVerifyResending] = useState(false);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [coupleStatus, setCoupleStatus] = useState<CoupleStatus>("active");
  const [pauseReq, setPauseReq] = useState<CouplePauseRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [documents, setDocuments] = useState<DataExportSummary[]>([]);
  const [redownloading, setRedownloading] = useState<number | null>(null);
  /** Two-click delete arming state — the id whose "Delete" button is armed
   *  and waiting for the second confirming click. Times out after 4s. */
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  async function refresh() {
    const [pause, current, docs] = await Promise.all([
      pauseApi.status(),
      coupleApi.current(),
      documentsApi.list(),
    ]);
    setCoupleStatus(pause.couple_status);
    setPauseReq(pause.pause_request);
    setCouple(current.couple);
    setDocuments(docs.exports);
  }
  async function refreshDocuments() {
    try {
      const docs = await documentsApi.list();
      setDocuments(docs.exports);
    } catch {
      /* non-fatal — will retry on next mount */
    }
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
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `weddly-export-${stamp}.json`);
      refreshDocuments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setExporting(false);
    }
  }

  async function downloadGuestCsv() {
    setCsvExporting(true);
    try {
      const blob = await fetchGuestCsvBlob();
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `weddly-guests-${stamp}.csv`);
      refreshDocuments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setCsvExporting(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwNext.length < 8) {
      setPwError(t("profile.security_pw_too_short"));
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwError(t("profile.security_pw_mismatch"));
      return;
    }
    setPwSubmitting(true);
    try {
      const session = await authApi.changePassword({
        current_password: pwCurrent,
        new_password: pwNext,
      });
      setSession(session.token, session.user);
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
      toast.success(t("profile.security_pw_success"));
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setPwSubmitting(false);
    }
  }

  async function requestEmailChange(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    const trimmed = newEmail.trim().toLowerCase();
    if (trimmed.length < 3 || !trimmed.includes("@") || trimmed.startsWith("@")) {
      setEmailError(t("profile.security_email_invalid"));
      return;
    }
    setEmailSubmitting(true);
    try {
      await authApi.changeEmailRequest({
        new_email: trimmed,
        current_password: emailPassword,
      });
      setNewEmail("");
      setEmailPassword("");
      toast.success(t("profile.security_email_sent"));
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function redownloadSaved(doc: DataExportSummary) {
    setRedownloading(doc.id);
    try {
      const blob = await fetchSavedExportBlob(doc.id);
      saveBlob(blob, doc.filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRedownloading(null);
    }
  }

  // Auto-disarm a pending delete after 4 seconds so the button can't sit in
  // a one-click-from-delete state indefinitely.
  useEffect(() => {
    if (armedDeleteId === null) return;
    const timer = window.setTimeout(() => setArmedDeleteId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armedDeleteId]);

  async function clickDelete(doc: DataExportSummary) {
    if (armedDeleteId !== doc.id) {
      setArmedDeleteId(doc.id);
      return;
    }
    setArmedDeleteId(null);
    setRemoving(doc.id);
    try {
      await documentsApi.remove(doc.id);
      setDocuments((cur) => cur.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRemoving(null);
    }
  }

  const scheduledYmd = pauseReq?.scheduled_delete_at
    ? new Date(pauseReq.scheduled_delete_at).toISOString().slice(0, 10)
    : null;

  async function onLeaveCouple() {
    if (!authUser || !couple) return;
    // Only partner B can actually leave — partner A (owner) gets a blocked
    // explanation card so the path is honest about why it won't work.
    if (authUser.id === couple.partner_a_id) return;
    const ok = await confirm({
      title: t("profile.leave_couple_confirm_title"),
      body: t("profile.leave_couple_confirm_body"),
      confirmLabel: t("profile.leave_couple_confirm_yes"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setLeaving(true);
    try {
      await userApi.leaveCouple();
      toast.success(t("profile.leave_couple_done"));
      // Sign out + bounce to login. logout() clears the token; AppShell's
      // user-transition effect sweeps the rest of localStorage.
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("profile.leave_couple_failed"));
      setLeaving(false);
    }
  }

  async function resendVerifyEmail() {
    setVerifyResending(true);
    try {
      const res = await authApi.requestVerify();
      if (res.already_verified) {
        toast.success(t("profile.verify_already_verified"));
        await refreshAuth();
      } else {
        toast.success(t("profile.verify_resent"));
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 429
          ? t("auth.rate_limited")
          : t("common.error_generic");
      toast.error(msg);
    } finally {
      setVerifyResending(false);
    }
  }

  return (
    <AppShell>
      <h1>{t("profile.title")}</h1>

      {authUser && !authUser.verified_email && (
        <section className="card mt-6 border-2 border-blush-400 bg-blush-50/60">
          <h2 className="text-lg text-blush-800">{t("profile.verify_title")}</h2>
          <p className="mt-2 text-sm text-ink-700">{t("profile.verify_body")}</p>
          <p className="mt-3 text-sm text-ink-600">
            {t("profile.verify_email_intro")}{" "}
            <span className="font-medium text-ink-900">{authUser.email}</span>
          </p>
          <div className="mt-4">
            <button
              type="button"
              className="btn-primary"
              onClick={resendVerifyEmail}
              disabled={verifyResending}
            >
              {verifyResending ? t("profile.verify_resending") : t("profile.verify_resend")}
            </button>
          </div>
        </section>
      )}

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.payments_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.payments_body")}</p>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.security_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.security_body")}</p>
        <form className="mt-4 grid max-w-md gap-3" onSubmit={changePassword} noValidate>
          <div>
            <label htmlFor="pw-current" className="field-label">
              {t("profile.security_pw_current")}
            </label>
            <input
              id="pw-current"
              type="password"
              className="input"
              autoComplete="current-password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="pw-new" className="field-label">
              {t("profile.security_pw_new")}
            </label>
            <input
              id="pw-new"
              type="password"
              className="input"
              autoComplete="new-password"
              value={pwNext}
              onChange={(e) => setPwNext(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="pw-confirm" className="field-label">
              {t("profile.security_pw_confirm")}
            </label>
            <input
              id="pw-confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              required
            />
          </div>
          {pwError && <p className="field-error">{pwError}</p>}
          <div>
            <button type="submit" className="btn-primary" disabled={pwSubmitting}>
              {pwSubmitting ? t("profile.security_pw_submitting") : t("profile.security_pw_submit")}
            </button>
          </div>
        </form>

        <div className="mt-8 border-t border-paper-200 pt-6">
          <h3 className="text-base font-medium">{t("profile.security_email_title")}</h3>
          <p className="mt-2 text-sm text-ink-600">{t("profile.security_email_body")}</p>
          <form className="mt-4 grid max-w-md gap-3" onSubmit={requestEmailChange} noValidate>
            <div>
              <label htmlFor="new-email" className="field-label">
                {t("profile.security_email_new")}
              </label>
              <input
                id="new-email"
                type="email"
                className="input"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="email-pw" className="field-label">
                {t("profile.security_email_password")}
              </label>
              <input
                id="email-pw"
                type="password"
                className="input"
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                required
              />
            </div>
            {emailError && <p className="field-error">{emailError}</p>}
            <div>
              <button type="submit" className="btn-outline" disabled={emailSubmitting}>
                {emailSubmitting
                  ? t("profile.security_email_submitting")
                  : t("profile.security_email_submit")}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.export_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.export_body")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-outline"
            onClick={downloadExport}
            disabled={exporting}
          >
            {exporting ? t("profile.export_downloading") : t("profile.export_button")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={downloadGuestCsv}
            disabled={csvExporting}
          >
            {csvExporting ? t("profile.export_downloading") : t("profile.export_guest_csv_button")}
          </button>
        </div>
      </section>

      <section className="card mt-6">
        <h2 className="text-lg">{t("profile.archive_title")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("profile.archive_body")}</p>
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">{t("profile.archive_empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-paper-200">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="rounded bg-paper-100 px-2 py-0.5 text-xs uppercase text-ink-600">
                  {t(`profile.archive_kind_${doc.kind}` as `profile.archive_kind_${ExportKind}`)}
                  {doc.format ? ` · ${doc.format.toUpperCase()}` : ""}
                </span>
                <span className="font-medium text-ink-800">{doc.filename}</span>
                <span className="text-xs text-ink-500">
                  {formatTimestamp(doc.created_at, locale)} · {formatBytes(doc.byte_size)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-outline h-8 px-3 text-xs"
                    onClick={() => redownloadSaved(doc)}
                    disabled={redownloading === doc.id}
                  >
                    {redownloading === doc.id
                      ? t("profile.export_downloading")
                      : t("profile.archive_redownload")}
                  </button>
                  <button
                    type="button"
                    className={`h-8 rounded-xl border px-3 text-xs transition-colors ${
                      armedDeleteId === doc.id
                        ? "border-blush-500 bg-blush-500 text-white hover:bg-blush-600"
                        : "border-paper-300 bg-white text-ink-700 hover:bg-paper-100"
                    }`}
                    onClick={() => clickDelete(doc)}
                    disabled={removing === doc.id}
                  >
                    {removing === doc.id
                      ? t("profile.archive_deleting")
                      : armedDeleteId === doc.id
                        ? t("profile.archive_delete_confirm")
                        : t("profile.archive_delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {authUser && couple && (
        <section className="card mt-6">
          <h2 className="text-lg">{t("profile.leave_couple_title")}</h2>
          {authUser.id === couple.partner_a_id ? (
            <p className="mt-2 text-sm text-ink-600">{t("profile.leave_couple_body_owner")}</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-600">
                {t("profile.leave_couple_body_partner_b")}
              </p>
              <button
                type="button"
                className="btn-outline mt-4"
                onClick={onLeaveCouple}
                disabled={leaving}
              >
                {leaving ? t("profile.leave_couple_leaving") : t("profile.leave_couple_button")}
              </button>
            </>
          )}
        </section>
      )}

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
