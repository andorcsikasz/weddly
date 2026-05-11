import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button } from "../components/ui";
import { ApiError } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function ForgotPasswordPage() {
  const { t } = useT();
  useDocumentMeta("seo.forgot_password_title", "seo.forgot_password_description");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

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
    const trimmed = email.trim();
    try {
      await authApi.forgot(trimmed);
      setSubmittedEmail(trimmed);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? t("auth.rate_limited")
          : t("common.error_generic"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setSubmittedEmail(null);
    // Keep the email value so they can correct a typo without retyping.
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("auth.forgot_title")}</h1>
          {submittedEmail ? (
            <>
              <p className="mt-4 text-sm text-ink-700">
                {t("auth.forgot_sent_with_email", { email: submittedEmail })}
              </p>
              <p className="mt-3 text-xs text-ink-500">{t("auth.forgot_spam_hint")}</p>
              <p className="mt-5 text-sm text-ink-600">
                <button
                  type="button"
                  onClick={retry}
                  className="font-medium text-ink-900 underline"
                >
                  {t("auth.forgot_wrong_address")}
                </button>
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-ink-600">{t("auth.forgot_help")}</p>
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                  <label htmlFor="email" className="field-label">
                    {t("auth.email_label")}
                  </label>
                  <input
                    ref={emailRef}
                    id="email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="field-error">{error}</p>}
                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  loading={submitting}
                  loadingLabel={t("common.loading")}
                >
                  {t("auth.forgot_submit")}
                </Button>
              </form>
            </>
          )}
          <p className="mt-4 text-sm text-ink-600">
            <Link to="/login" className="font-medium text-ink-900 underline">
              {t("auth.back_to_login")}
            </Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
