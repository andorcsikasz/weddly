import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { PasswordField } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useT();
  useDocumentMeta("seo.register_title", "seo.register_description");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(email.trim(), password, fullName.trim());
      // First-time signup: route into onboarding so they pick a wedding date etc.
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("auth.register_title")}</h1>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="full_name" className="field-label">
                {t("auth.full_name_label")}
              </label>
              <input
                id="full_name"
                type="text"
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>
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
              />
            </div>
            <PasswordField
              id="password"
              label={t("auth.password_label")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              helperText={t("auth.short_password")}
            />
            {error && <p className="field-error">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t("common.loading") : t("auth.submit_register")}
            </button>
          </form>
          <p className="mt-4 text-sm text-ink-600">
            {t("auth.have_account")}{" "}
            <Link to="/login" className="font-medium text-ink-900 underline">
              {t("auth.submit_login")}
            </Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}

function messageFor(err: unknown, t: ReturnType<typeof useT>["t"]): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t("auth.duplicate_email");
    if (err.status === 429) return t("auth.rate_limited");
    if (err.status === 400) return err.message;
  }
  return t("common.error_generic");
}
