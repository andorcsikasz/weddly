// Modal that takes over when /api/* returns 401 mid-session. Instead of
// yanking the user to /login (which loses their typed state), we keep them
// on the current page and offer an in-place re-login. After a successful
// re-auth we close the dialog and let the page continue — typed local state
// stays intact.

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, PasswordField } from "./ui";
import { ApiError, setToken } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

interface Props {
  open: boolean;
  /** Email of the previously signed-in user, so we can pre-fill it. */
  email: string;
  onClose: () => void;
  onLoggedIn: () => void;
}

export function SessionExpiredDialog({ open, email, onClose, onLoggedIn }: Props) {
  const { t } = useT();
  const { setSession } = useAuth();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement | null>(null);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await authApi.login({ email, password });
      setSession(session.token, session.user);
      onLoggedIn();
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
          <Button
            variant="primary"
            type="submit"
            form="session-relogin-form"
            loading={submitting}
            loadingLabel={t("common.loading")}
          >
            {t("session.sign_in")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-700">{t("session.expired_body")}</p>
      <form id="session-relogin-form" className="mt-4 space-y-3" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="session-email" className="field-label">
            {t("auth.email_label")}
          </label>
          <input
            ref={emailRef}
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
          autoFocus
          errorText={error ?? undefined}
        />
        {error && (
          <p id={errorId} className="sr-only" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
