import { type FormEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppleSignInButton } from "../components/AppleSignInButton";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { Shell } from "../components/Shell";
import { Button, PasswordField } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** A 403 from /api/auth/login whose body carries `detail.code = "email_unverified"`
 *  means the password was correct but the account never verified its email.
 *  The login gate blocks the session and auto-sends a fresh link. */
function isUnverifiedEmailError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.detail as { code?: string } | null)?.code === "email_unverified"
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useT();
  useDocumentMeta("seo.login_title", "seo.login_description");
  const navigate = useNavigate();
  const location = useLocation();
  // An explicit `from` (set when a guard bounced the user to /login) wins;
  // otherwise the post-login destination follows the account type.
  const explicitFrom = (location.state as { from?: string } | null)?.from ?? null;
  // OAuth buttons can't know the role until the round-trip finishes, so they
  // land on the explicit `from` or /app — the route guards (RequireCoupleAuth /
  // RequireVendorAuth) then forward vendors to /vendor and planners to
  // /app/planner. The password path below redirects by role directly.
  const redirectTo = explicitFrom ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once login is blocked on an unverified email — flips the card to the
  // "check your inbox" notice instead of the login form.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const emailRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  // Only autofocus on screens wide enough for a hardware keyboard — on phones
  // the autofocus shoves the soft keyboard up and shifts the layout.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches) {
      emailRef.current?.focus();
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      const fallback =
        u.role === "vendor" ? "/vendor" : u.user_type === "planner" ? "/app/planner" : "/app";
      navigate(explicitFrom ?? fallback, { replace: true });
    } catch (err) {
      if (isUnverifiedEmailError(err)) {
        // Backend already mailed a fresh link on the blocked login; show the
        // notice (resend stays available for "didn't get it").
        setUnverifiedEmail(email.trim());
        setResendState("idle");
      } else {
        setError(messageFor(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!unverifiedEmail || resendState === "sending") return;
    setResendState("sending");
    try {
      await authApi.requestVerifyPublic(unverifiedEmail);
    } catch {
      // The endpoint always 200s; a network blip shouldn't strand the user, so
      // treat any outcome as "sent" — the worst case is they retry.
    }
    setResendState("sent");
  }

  if (unverifiedEmail) {
    return (
      <Shell>
        <div className="mx-auto max-w-md">
          <div className="card">
            <h1 className="text-2xl">{t("auth.verify_required_title")}</h1>
            <p className="mt-4 text-sm text-ink-600">
              {t("auth.verify_required_body", { email: unverifiedEmail })}
            </p>
            {resendState === "sent" ? (
              <p className="mt-5 rounded-md bg-sage-50 px-3 py-2 text-sm text-sage-800 dark:bg-sage-900/20 dark:text-sage-200">
                {t("auth.verify_resent")}
              </p>
            ) : (
              <Button
                type="button"
                variant="primary"
                fullWidth
                className="mt-5"
                loading={resendState === "sending"}
                loadingLabel={t("common.loading")}
                onClick={onResend}
              >
                {t("auth.verify_resend_button")}
              </Button>
            )}
            <p className="mt-4 text-center text-sm text-ink-600">
              <button
                type="button"
                className="font-medium text-ink-900 underline"
                onClick={() => {
                  setUnverifiedEmail(null);
                  setResendState("idle");
                }}
              >
                {t("auth.verify_back_to_login")}
              </button>
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("auth.login_title")}</h1>
          <div className="mt-6 space-y-3">
            <GoogleSignInButton mode="signin" redirectTo={redirectTo} oneTap autoSelect />
            <AppleSignInButton mode="signin" redirectTo={redirectTo} />
          </div>
          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-500">
            <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
            <span>{t("auth.or")}</span>
            <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
          </div>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <Field
              id="email"
              label={t("auth.email_label")}
              type="email"
              value={email}
              onChange={setEmail}
              required
              inputRef={emailRef}
              invalid={Boolean(error)}
              describedById={error ? errorId : undefined}
              autoComplete="email"
              inputMode="email"
            />
            <PasswordField
              id="password"
              label={t("auth.password_label")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            {error && (
              <p id={errorId} className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={submitting}
              loadingLabel={t("common.loading")}
            >
              {t("auth.submit_login")}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-ink-600">
            {t("auth.no_account")}{" "}
            <Link to="/signup" className="font-medium text-ink-900 underline">
              {t("auth.submit_register")}
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-ink-600">
            <Link to="/forgot-password" className="font-medium text-ink-900 underline">
              {t("auth.forgot_link")}
            </Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  required,
  inputRef,
  invalid,
  describedById,
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedById?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "url" | "numeric" | "decimal" | "search";
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type={type}
        className={`input ${invalid ? "input-invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
      />
    </div>
  );
}

function messageFor(err: unknown, t: ReturnType<typeof useT>["t"]): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t("auth.bad_credentials");
    if (err.status === 429) return t("auth.rate_limited");
    if (err.status === 409) return t("auth.duplicate_email");
    if (err.status === 400) return err.message;
  }
  return t("common.error_generic");
}
