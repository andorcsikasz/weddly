// Activation landing for admin-provisioned planner accounts. The emailed link
// carries a single-use token; this page shows what was registered in the
// planner's name (business, category, the 2-year free window), asks for a
// password, and the activate button doubles as the clickwrap acceptance of
// the legal documents (same contract as the register form). Completing
// returns a fresh session, so the planner lands straight in the workspace.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { intlLocale } from "../lib/format";
import type { PlannerActivationView } from "@shared/types";
import { Gift, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button, PasswordField } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { plannerActivationApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; code: "invalid" | "expired" | "consumed" }
  | { kind: "ready"; view: PlannerActivationView };

/** Narrow ApiError.detail to the backend's `{ code }` convention. */
function detailCode(err: ApiError): string | undefined {
  const d = err.detail;
  if (d && typeof d === "object" && "code" in d) {
    const c = (d as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

function fmtDate(unixMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(unixMs));
}

export default function PlannerActivatePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useT();
  useDocumentMeta("planner_activate.page_title", "planner_activate.page_body");
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await plannerActivationApi.view(token);
        if (!cancelled) setState({ kind: "ready", view });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 410) {
          setState({
            kind: "error",
            code: detailCode(err) === "activation_consumed" ? "consumed" : "expired",
          });
        } else {
          setState({ kind: "error", code: "invalid" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const session = await plannerActivationApi.complete({
        token,
        password,
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        locale,
      });
      setSession(session.token, session.user);
      navigate("/app/planner", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 410) {
          setState({
            kind: "error",
            code: detailCode(err) === "activation_consumed" ? "consumed" : "expired",
          });
        } else if (err.status === 429) {
          setError(t("auth.rate_limited"));
        } else {
          setError(err.message || t("common.error_generic"));
        }
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
          {state.kind === "loading" && (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-600">
              <Loader2 size={15} className="animate-spin" />
              {t("common.loading")}
            </div>
          )}

          {state.kind === "error" && (
            <>
              <h1 className="text-2xl">{t("planner_activate.error_title")}</h1>
              <p className="mt-4 text-sm text-ink-700">
                {t(`planner_activate.error_${state.code}`)}
              </p>
              <p className="mt-4 text-sm text-ink-600">
                <Link to="/login" className="font-medium text-ink-900 underline">
                  {t("auth.back_to_login")}
                </Link>
              </p>
            </>
          )}

          {state.kind === "ready" && (
            <>
              <h1 className="text-2xl">{t("planner_activate.title")}</h1>
              <p className="mt-3 text-sm text-ink-700">
                {t("planner_activate.intro", {
                  name: state.view.full_name,
                  business: state.view.business_name ?? state.view.full_name,
                })}
                {state.view.planner_category ? ` (${state.view.planner_category})` : ""}
              </p>
              <p className="mt-2 text-sm text-ink-600">
                {t("planner_activate.email_line", { email: state.view.email })}
              </p>

              {/* The deal itself, front and center: 2 years free. */}
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-sage-200 bg-sage-50 p-4 text-sm text-ink-800 dark:border-sage-700 dark:bg-umber-800 dark:text-paper-100">
                <Gift size={18} className="mt-0.5 shrink-0 text-sage-700 dark:text-sage-400" />
                <p>
                  {t("planner_activate.free_line", {
                    date: fmtDate(state.view.free_until, locale),
                  })}
                </p>
              </div>

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
                  {t("planner_activate.submit")}
                </Button>
                {/* Clickwrap: activating is the affirmative act that accepts
                    both policies, mirrored on the backend consent ledger. */}
                <p className="field-help mt-3 text-center">
                  {t("planner_activate.legal_prefix")}
                  <Link to="/privacy" className="underline hover:text-umber-800">
                    {t("register.continuing_privacy_link")}
                  </Link>
                  {t("register.continuing_and")}
                  <Link to="/terms" className="underline hover:text-umber-800">
                    {t("register.continuing_terms_link")}
                  </Link>
                  {t("register.continuing_suffix")}
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
