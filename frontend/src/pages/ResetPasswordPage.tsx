import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ApiError } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function ResetPasswordPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.reset(token, password);
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) setError(t("auth.rate_limited"));
        else if (err.status === 400) setError(t("auth.reset_invalid"));
        else setError(t("common.error_generic"));
      } else {
        setError(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("auth.reset_title")}</h1>
          {done ? (
            <p className="mt-4 text-sm text-ink-700">{t("auth.reset_done")}</p>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label htmlFor="password" className="field-label">
                  {t("auth.new_password_label")}
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
              {error && <p className="field-error">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? t("common.loading") : t("auth.reset_submit")}
              </button>
            </form>
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
