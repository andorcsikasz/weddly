import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ApiError } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.forgot(email.trim());
      setDone(true);
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

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("auth.forgot_title")}</h1>
          {done ? (
            <p className="mt-4 text-sm text-ink-700">{t("auth.forgot_sent")}</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-ink-600">{t("auth.forgot_help")}</p>
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                  <label htmlFor="email" className="field-label">
                    {t("auth.email_label")}
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error && <p className="field-error">{error}</p>}
                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                  {submitting ? t("common.loading") : t("auth.forgot_submit")}
                </button>
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
