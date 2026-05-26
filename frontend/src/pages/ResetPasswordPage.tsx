import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button, PasswordField } from "../components/ui";
import { ApiError } from "../lib/api";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function ResetPasswordPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  useDocumentMeta("seo.reset_password_title", "seo.reset_password_description");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }
    setSubmitting(true);
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
              <PasswordField
                id="password"
                label={t("auth.new_password_label")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <PasswordField
                id="password_confirm"
                label={t("auth.password_confirm_label")}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                errorText={
                  passwordConfirm.length > 0 && passwordConfirm !== password
                    ? t("auth.password_mismatch")
                    : undefined
                }
              />
              {error && <p className="field-error">{error}</p>}
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={submitting}
                loadingLabel={t("common.loading")}
              >
                {t("auth.reset_submit")}
              </Button>
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
