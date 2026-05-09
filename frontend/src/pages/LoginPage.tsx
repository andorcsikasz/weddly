import { type FormEvent, type Ref, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button, PasswordField } from "../components/ui";
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
  const emailRef = useRef<HTMLInputElement | null>(null);

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
              inputRef={emailRef}
            />
            <PasswordField
              id="password"
              label={t("auth.password_label")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="field-error">{error}</p>}
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
          <p className="mt-4 text-sm text-ink-600">
            {t("auth.no_account")}{" "}
            <Link to="/signup" className="font-medium text-ink-900 underline">
              {t("auth.submit_register")}
            </Link>
          </p>
          <p className="mt-2 text-sm text-ink-600">
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
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement>;
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
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
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
