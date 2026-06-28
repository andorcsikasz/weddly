// Vendor settings — account basics for the signed-in vendor. Email is
// read-only, the display name is click-to-edit, the UI locale is a
// radiogroup, and a change-password form rounds it out. Logout already lives
// in the VendorShell header, so it isn't repeated here. There is no vendor
// data-export endpoint yet (the GDPR export route is couple-scoped), so that
// section is intentionally omitted until a /api/vendor export seam exists.

import { Globe, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { authApi, userApi } from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";

export default function VendorSettingsPage() {
  const { t, locale, setLocale } = useT();
  const { user, refresh: refreshAuth, setSession } = useAuth();
  const toast = useToast();

  // --- Display name (click-to-edit) ---
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Restore focus to the Edit trigger when the inline form unmounts so
  // keyboard / SR users don't get dropped to <body>.
  const editingNamePrev = useRef(false);
  useEffect(() => {
    if (editingNamePrev.current && !editingName) nameTriggerRef.current?.focus();
    editingNamePrev.current = editingName;
  }, [editingName]);

  // --- Locale switch ---
  const [savingLocale, setSavingLocale] = useState<Locale | null>(null);

  // --- Change password ---
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  if (!user) {
    return (
      <div
        aria-hidden="true"
        className="h-48 animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
      />
    );
  }

  function beginNameEdit() {
    setNameInput(user?.full_name ?? "");
    setNameError(null);
    setEditingName(true);
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      setNameError(t("profile.account_name_save_error"));
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await userApi.updateProfile({ full_name: trimmed });
      toast.success(t("profile.account_name_save_success"));
      setEditingName(false);
      await refreshAuth();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : t("profile.account_name_save_error"));
    } finally {
      setSavingName(false);
    }
  }

  async function saveLocale(next: Locale) {
    if (next === locale) return;
    setSavingLocale(next);
    try {
      // Optimistic: flip the UI immediately. `silent: true` because this is a
      // settings save, not the first-run currency-prompt path.
      setLocale(next, { silent: true });
      await userApi.updateProfile({ locale: next });
      await refreshAuth();
    } catch (err) {
      setLocale(locale, { silent: true });
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingLocale(null);
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

  return (
    <div>
      <h1 className="font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
        {t("vendor.settings.page_title")}
      </h1>
      <p className="mt-2 text-sm text-ink-600 dark:text-paper-300">
        {t("vendor.settings.page_body")}
      </p>

      {/* Account basics */}
      <section className="card mt-6">
        <h2 className="flex items-center gap-2 font-grotesk text-lg">
          <UserRound size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("profile.account_title")}
        </h2>

        <ul className="mt-4 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
          {/* Email — read-only */}
          <li className="py-3">
            <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("profile.account_email_label")}
            </span>
            <p
              className="mt-1 truncate text-base text-ink-800 dark:text-paper-100"
              title={user.email}
            >
              {user.email}
            </p>
          </li>

          {/* Display name — click-to-edit */}
          <li className="py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("profile.account_name_label")}
              </span>
              {!editingName && (
                <button
                  ref={nameTriggerRef}
                  type="button"
                  className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                  onClick={beginNameEdit}
                  aria-label={t("common.edit")}
                >
                  {t("common.edit")}
                </button>
              )}
            </div>
            {editingName ? (
              <form
                onSubmit={saveName}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2"
                aria-label={t("profile.account_name_label")}
              >
                <input
                  type="text"
                  value={nameInput}
                  onChange={(ev) => setNameInput(ev.target.value)}
                  placeholder={t("profile.account_name_placeholder")}
                  className="input h-11 min-w-[10rem] flex-1 py-0 text-base sm:h-8 sm:text-sm"
                  maxLength={200}
                  autoFocus
                  disabled={savingName}
                />
                <button
                  type="submit"
                  className="btn-sm btn-primary !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  disabled={savingName}
                >
                  {savingName ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-outline !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  onClick={() => {
                    setEditingName(false);
                    setNameError(null);
                  }}
                  disabled={savingName}
                >
                  {t("common.cancel")}
                </button>
                {nameError && (
                  <p className="basis-full text-[11px] text-blush-700 dark:text-blush-300">
                    {nameError}
                  </p>
                )}
              </form>
            ) : (
              <p className="mt-1 text-base text-ink-800 dark:text-paper-100">
                {user.full_name?.trim() || t("profile.account_name_placeholder")}
              </p>
            )}
          </li>

          {/* Locale */}
          <li className="py-3">
            <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              <Globe size={14} aria-hidden />
              {t("vendor.settings.locale_label")}
            </span>
            <p className="mt-1 text-[11px] text-ink-500 dark:text-umber-300">
              {t("profile.account_locale_help")}
            </p>
            <div
              role="radiogroup"
              aria-label={t("vendor.settings.locale_label")}
              className="mt-2 inline-flex overflow-hidden rounded-full border border-ink-200 dark:border-umber-700"
            >
              {(["hu", "en"] as const).map((l) => {
                const active = l === locale;
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => saveLocale(l)}
                    disabled={savingLocale !== null}
                    className={`min-w-[80px] px-4 py-3 text-sm font-medium transition-colors sm:py-1.5 sm:text-xs ${
                      active
                        ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                        : "bg-paper-50 text-ink-600 hover:bg-paper-100 dark:bg-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
                    }`}
                  >
                    {t(`profile.account_locale_${l}`)}
                  </button>
                );
              })}
            </div>
          </li>
        </ul>
      </section>

      {/* Security — change password */}
      <section className="card mt-6">
        <h2 className="flex items-center gap-2 font-grotesk text-lg">
          <ShieldCheck size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("vendor.settings.password_label")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
          {t("profile.security_body")}
        </p>
        <form onSubmit={changePassword} className="mt-4 max-w-sm space-y-3">
          <div>
            <label htmlFor="vendor-pw-current" className="field-label">
              {t("profile.security_pw_current")}
            </label>
            <input
              id="vendor-pw-current"
              type="password"
              autoComplete="current-password"
              className="input w-full"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
              disabled={pwSubmitting}
            />
          </div>
          <div>
            <label htmlFor="vendor-pw-new" className="field-label">
              {t("profile.security_pw_new")}
            </label>
            <input
              id="vendor-pw-new"
              type="password"
              autoComplete="new-password"
              className="input w-full"
              value={pwNext}
              onChange={(e) => setPwNext(e.target.value)}
              disabled={pwSubmitting}
            />
          </div>
          <div>
            <label htmlFor="vendor-pw-confirm" className="field-label">
              {t("profile.security_pw_confirm")}
            </label>
            <input
              id="vendor-pw-confirm"
              type="password"
              autoComplete="new-password"
              className="input w-full"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              disabled={pwSubmitting}
            />
          </div>
          {pwError && <p className="field-error">{pwError}</p>}
          <button type="submit" className="btn-primary" disabled={pwSubmitting}>
            <KeyRound size={16} />
            {pwSubmitting
              ? t("profile.security_pw_submitting")
              : t("vendor.settings.change_password")}
          </button>
        </form>
      </section>
    </div>
  );
}
