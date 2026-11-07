// Modal that takes over when /api/* returns 401 mid-session. Instead of
// yanking the user to /login (which loses their typed state), we keep them
// on the current page and offer an in-place re-login. After a successful
// re-auth we close the dialog and let the page continue — typed local state
// stays intact.
//
// Re-auth method follows the user's capability flags from before the 401:
//   - has_google → render Google block
//   - has_apple → render Apple block
//   - password_set → render password block
// Any combination of flags can be true (account has multiple methods linked).
// If none is
// known (legacy session where we don't have flags), both blocks are shown
// — they degrade to "the wrong button" being an obvious dead-end but not a
// hard footgun.
//
// ID-lock: the user we re-authenticate as MUST match the previously signed-in
// user. Otherwise a stale Google session in the GIS popup (or a deleted /
// unlinked account on the server) could silently switch the dialog into a
// different account.

import type { AuthSession } from "@shared/types";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, PasswordField } from "./ui";
import { AppleSignInButton } from "./AppleSignInButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { ApiError, setToken } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

interface Props {
  open: boolean;
  reason: "expired" | "admin";
  /** Email of the previously signed-in user, so we can pre-fill it. */
  email: string;
  /** ID of the previously signed-in user. Used to reject re-auth that lands
   *  on a different account (deleted-and-recreated, Google account picker
   *  resolving to a different Weddly user, etc.). When null, the guard is
   *  skipped — only happens on legacy sessions before this prop existed. */
  userId: number | null;
  /** Whether the original user has a real local password. When false, hide
   *  the password form (the placeholder hash will reject every attempt). */
  passwordSet: boolean;
  /** Whether the original user is linked to Google. When false, hide the
   *  Google button (it would create a new account or sign into the wrong
   *  one). */
  hasGoogle: boolean;
  /** Whether the original user is linked to Apple. Same rationale as
   *  `hasGoogle` — hide the Apple button unless we know it'll resolve to the
   *  same account. */
  hasApple: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}

export function SessionExpiredDialog({
  open,
  reason,
  email,
  userId,
  passwordSet,
  hasGoogle,
  hasApple,
  onClose,
  onLoggedIn,
}: Props) {
  const { t } = useT();
  const { setSession } = useAuth();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every wrong code so the boxes replay their shake.
  const [shakeKey, setShakeKey] = useState(0);
  // The code last sent, so auto-submit and the Verify button can't post the
  // same code twice (a TOTP code is single-use server-side).
  const lastSentCode = useRef<string | null>(null);

  // Reset internal state whenever the dialog re-opens so a previous error
  // banner doesn't linger across sessions.
  useEffect(() => {
    if (open) {
      setPassword("");
      setMfaCode("");
      setError(null);
      lastSentCode.current = null;
    }
  }, [open]);

  // If we don't know any capability (e.g. legacy session, fresh page reload
  // before /api/auth/me hydrates), fall back to showing every method so the
  // user has at least one path that works.
  const knowNothing = !passwordSet && !hasGoogle && !hasApple;
  const showGoogle = hasGoogle || knowNothing;
  const showApple = hasApple || knowNothing;
  const showPassword = passwordSet || knowNothing;

  function applySession(session: AuthSession) {
    // ID-lock: refuse a session that lands on a different user. Google's
    // popup lets the user pick any account; the backend's "create new user
    // if neither google_sub nor email matches" branch could silently
    // resolve into a brand-new account if the original was deleted.
    if (userId !== null && session.user.id !== userId) {
      // Hard logout — the dialog is no longer authoritative. We don't keep
      // them in the new (wrong) session because all of their on-page state
      // belongs to the original user.
      setToken(null);
      setError(t("session.wrong_account"));
      return;
    }
    setSession(session.token, session.user);
    onLoggedIn();
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await authApi.login({ email, password });
      applySession(session);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError(t("auth.bad_credentials"));
        else if (err.status === 429) setError(t("auth.rate_limited"));
        else setError(err.message || t("common.error_generic"));
      } else {
        setError(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAdminCode(code: string) {
    if (!/^\d{6}$/.test(code) || lastSentCode.current === code) return;
    lastSentCode.current = code;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.adminStepUp(code);
      onLoggedIn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 429
          ? t("auth.rate_limited")
          : status === 503
            ? t("session.admin_mfa_unavailable")
            : t("session.admin_mfa_invalid"),
      );
      // Clear the boxes so the next code can be typed straight in.
      setMfaCode("");
      lastSentCode.current = null;
      setShakeKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function onAdminStepUp(e: FormEvent) {
    e.preventDefault();
    void submitAdminCode(mfaCode);
  }

  function onMfaChange(value: string) {
    const code = value.replace(/\D/g, "").slice(0, 6);
    setMfaCode(code);
    if (code.length > 0) setError(null);
    if (code.length === 6) void submitAdminCode(code);
  }

  function onSignOut() {
    // Clear the token and bounce — nothing here to preserve if the user
    // wants out, and a stale token on every future request just keeps
    // raising the session-expired dialog.
    setToken(null);
    onClose();
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }

  const emailInvalid = Boolean(error);

  // ESC / backdrop just dismisses the modal — clearing the token and
  // bouncing the user is something they should opt into via the sign-out
  // button.
  return (
    <Dialog
      open={open}
      role="dialog"
      title={t(reason === "admin" ? "session.admin_reauth_title" : "session.expired_title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onSignOut} type="button">
            {t("session.sign_out")}
          </Button>
          {reason === "admin" ? (
            <Button
              variant="primary"
              type="submit"
              form="admin-step-up-form"
              loading={submitting}
              loadingLabel={t("common.loading")}
              disabled={!/^\d{6}$/.test(mfaCode)}
            >
              {t("session.admin_reauth_cta")}
            </Button>
          ) : showPassword ? (
            <Button
              variant="primary"
              type="submit"
              form="session-relogin-form"
              loading={submitting}
              loadingLabel={t("common.loading")}
            >
              {t("session.sign_in")}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-sm text-ink-700 dark:text-paper-100">
        {t(reason === "admin" ? "session.admin_reauth_body" : "session.expired_body")}
      </p>

      {reason === "admin" && (
        <form id="admin-step-up-form" className="mt-4" onSubmit={onAdminStepUp}>
          <CodeBoxes
            key={shakeKey}
            value={mfaCode}
            onChange={onMfaChange}
            invalid={Boolean(error)}
            shake={shakeKey > 0}
            disabled={submitting}
            label={t("session.admin_mfa_label")}
            describedBy={error ? errorId : undefined}
          />
          {error && (
            <p
              id={errorId}
              className="mt-3 text-center text-sm text-blush-700 dark:text-blush-300"
              role="alert"
            >
              {error}
            </p>
          )}
        </form>
      )}

      {reason !== "admin" && (showGoogle || showApple) && (
        <div className="mt-4 space-y-3">
          {showGoogle && (
            <GoogleSignInButton
              mode="signin"
              loginHint={email || undefined}
              onSuccess={applySession}
              onError={(msg) => setError(msg)}
            />
          )}
          {showApple && (
            <AppleSignInButton
              mode="signin"
              onSuccess={applySession}
              onError={(msg) => setError(msg)}
            />
          )}
        </div>
      )}

      {reason !== "admin" && (showGoogle || showApple) && showPassword && (
        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-ink-200 dark:bg-paper-700" />
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-paper-300">
            {t("session.or_divider")}
          </span>
          <div className="h-px flex-1 bg-ink-200 dark:bg-paper-700" />
        </div>
      )}

      {reason !== "admin" && showPassword && (
        <form
          id="session-relogin-form"
          className="mt-4 space-y-3"
          onSubmit={onPasswordSubmit}
          noValidate
        >
          <div>
            <label htmlFor="session-email" className="field-label">
              {t("auth.email_label")}
            </label>
            <input
              id="session-email"
              type="email"
              className="input"
              value={email}
              readOnly
              aria-invalid={emailInvalid || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <PasswordField
            id="session-password"
            label={t("auth.password_label")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            errorText={error ?? undefined}
          />
        </form>
      )}

      {reason !== "admin" && !showPassword && error && (
        <p id={errorId} className="mt-3 text-sm text-blush-700 dark:text-blush-300" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Six edgeless digit boxes drawn over ONE real input, so paste, iOS/Android
 *  one-time-code autofill and the password manager all keep working exactly as
 *  they do on a plain field. The boxes are only a picture of its value. */
function CodeBoxes({
  value,
  onChange,
  invalid,
  shake,
  disabled,
  label,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  shake: boolean;
  disabled: boolean;
  label: string;
  describedBy?: string;
}) {
  const [focused, setFocused] = useState(true);
  return (
    <div
      className={`relative mx-auto flex w-fit gap-2 ${shake ? "animate-code-shake motion-reduce:animate-none" : ""}`}
    >
      {Array.from({ length: 6 }, (_, i) => {
        const digit = value[i];
        const active = focused && !disabled && i === Math.min(value.length, 5) && !digit;
        const tone = invalid
          ? "bg-blush-50 text-blush-700 dark:bg-blush-950/40 dark:text-blush-300"
          : digit
            ? "bg-paper-200 text-ink-900 dark:bg-umber-600 dark:text-paper-50"
            : active
              ? "bg-paper-200 dark:bg-umber-600"
              : "bg-paper-100 dark:bg-umber-700";
        return (
          <div
            key={i}
            aria-hidden="true"
            className={`flex h-14 w-11 items-center justify-center rounded-xl font-mono text-2xl tabular-nums transition-all duration-150 ${tone} ${active ? "scale-105" : ""} ${digit ? "scale-100" : ""} ${disabled ? "opacity-60" : ""}`}
          >
            {digit ??
              (active ? (
                <span className="h-6 w-px animate-code-caret bg-ink-700 motion-reduce:animate-none dark:bg-paper-100" />
              ) : null)}
          </div>
        );
      })}
      <input
        id="admin-mfa-code"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoFocus
      />
    </div>
  );
}
