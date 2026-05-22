// Modal that takes over when /api/* returns 401 mid-session. Instead of
// yanking the user to /login (which loses their typed state), we keep them
// on the current page and offer an in-place re-login. After a successful
// re-auth we close the dialog and let the page continue — typed local state
// stays intact.
//
// Re-auth method follows the user's capability flags from before the 401:
//   - has_google → render Google block
//   - password_set → render password block
// Both flags can be true (account has both methods linked). If neither is
// known (legacy session where we don't have flags), both blocks are shown
// — they degrade to "the wrong button" being an obvious dead-end but not a
// hard footgun.
//
// ID-lock: the user we re-authenticate as MUST match the previously signed-in
// user. Otherwise a stale Google session in the GIS popup (or a deleted /
// unlinked account on the server) could silently switch the dialog into a
// different account.

import type { AuthSession } from "@shared/types";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button, Dialog, PasswordField } from "./ui";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { ApiError, setToken } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

interface Props {
  open: boolean;
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
  onClose: () => void;
  onLoggedIn: () => void;
}

export function SessionExpiredDialog({
  open,
  email,
  userId,
  passwordSet,
  hasGoogle,
  onClose,
  onLoggedIn,
}: Props) {
  const { t } = useT();
  const { setSession } = useAuth();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state whenever the dialog re-opens so a previous error
  // banner doesn't linger across sessions.
  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
    }
  }, [open]);

  // If we don't know either capability (e.g. legacy session, fresh page
  // reload before /api/auth/me hydrates), fall back to showing both so the
  // user has at least one path that works.
  const showGoogle = hasGoogle || (!passwordSet && !hasGoogle);
  const showPassword = passwordSet || (!passwordSet && !hasGoogle);

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
      title={t("session.expired_title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onSignOut} type="button">
            {t("session.sign_out")}
          </Button>
          {showPassword && (
            <Button
              variant="primary"
              type="submit"
              form="session-relogin-form"
              loading={submitting}
              loadingLabel={t("common.loading")}
            >
              {t("session.sign_in")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-ink-700 dark:text-paper-100">{t("session.expired_body")}</p>

      {showGoogle && (
        <div className="mt-4">
          <GoogleSignInButton
            mode="signin"
            loginHint={email || undefined}
            onSuccess={applySession}
            onError={(msg) => setError(msg)}
          />
        </div>
      )}

      {showGoogle && showPassword && (
        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-ink-200 dark:bg-paper-700" />
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-paper-300">
            {t("session.or_divider")}
          </span>
          <div className="h-px flex-1 bg-ink-200 dark:bg-paper-700" />
        </div>
      )}

      {showPassword && (
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

      {!showPassword && error && (
        <p id={errorId} className="mt-3 text-sm text-danger-700 dark:text-danger-300" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
