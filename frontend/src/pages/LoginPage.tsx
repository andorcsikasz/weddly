import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useT();
  useDocumentMeta("seo.login_title", "seo.login_description");
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
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
          <h1 className="text-2xl">{t("auth.login_title")}</h1>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <Field
              id="email"
              label={t("auth.email_label")}
              type="email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <Field
              id="password"
              label={t("auth.password_label")}
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
            {error && <p className="field-error">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t("common.loading") : t("auth.submit_login")}
            </button>
          </form>
          <p className="mt-4 text-sm text-ink-600">
            {t("auth.no_account")}{" "}
            <Link to="/signup" className="font-medium text-ink-900 underline">
              {t("auth.submit_register")}
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
  autoFocus,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
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
