// Self-serve vendor signup. Mirrors RegisterPage but captures the company
// identity (business name + category) up front and creates a role='vendor'
// account via vendorAuthApi.register. On success the vendor lands in the in-app
// onboarding wizard at /vendor/onboarding (not the couple OnboardingWizard).
//
// This replaces the old public waitlist form + emailed token-activation flow.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import type { AuthSession } from "@shared/types";
import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button, PasswordField, useToast } from "../components/ui";
import { ApiError, apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag } from "../lib/demoSession";
import { vendorAuthApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function VendorRegisterPage() {
  const { setSession } = useAuth();
  const { t, locale } = useT();
  const toast = useToast();
  useDocumentMeta("vendor_register.seo_title", "vendor_register.seo_description");
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hold the session until the user clicks past the "check your inbox" screen —
  // see RegisterPage for why we don't persist the token immediately.
  const [pendingSession, setPendingSession] = useState<AuthSession | null>(null);
  const [resending, setResending] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  // Drop a stale validation error the moment the user starts correcting any
  // field — otherwise the message lingers until the next submit, which reads as
  // "still wrong" even after they've fixed it.
  function clearError() {
    setError((cur) => (cur ? null : cur));
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches) nameRef.current?.focus();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!businessName.trim()) {
      setError(t("vendor_register.business_name_required"));
      return;
    }
    if (!category) {
      setError(t("vendor_register.category_required"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const utm = readUtm();
      let referrer: string | undefined;
      try {
        const raw = window.sessionStorage.getItem("weddly.ref");
        if (raw === "rsvp" || raw === "site" || raw === "share") referrer = raw;
      } catch {
        /* sessionStorage blocked — drop attribution, keep the signup */
      }
      const session = await vendorAuthApi.register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        business_name: businessName.trim(),
        category,
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        locale,
        referrer,
        ...utm,
      });
      try {
        window.sessionStorage.removeItem("weddly.ref");
        window.sessionStorage.removeItem("weddly.utm");
      } catch {
        /* non-fatal */
      }
      setPendingSession(session);
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!pendingSession) return;
    setResending(true);
    try {
      await apiFetch<{ ok: true; already_verified?: boolean }>(
        "POST",
        "/api/auth/verify/request",
        {},
        { token: pendingSession.token },
      );
      toast.success(t("verify.banner_resent"));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 429
          ? t("auth.rate_limited")
          : t("common.error_generic");
      toast.error(msg);
    } finally {
      setResending(false);
    }
  }

  function continueToApp() {
    if (!pendingSession) return;
    clearDemoSessionFlag();
    setSession(pendingSession.token, pendingSession.user);
    navigate("/vendor/onboarding", { replace: true });
  }

  if (pendingSession) {
    return (
      <Shell>
        <div className="mx-auto max-w-md">
          <div className="card text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center text-umber-800">
              <Mail size={28} strokeWidth={1.5} />
            </div>
            <h1 className="mt-5 font-grotesk text-2xl text-umber-900 dark:text-paper-50">
              {t("verify.check_inbox_title")}
            </h1>
            <p className="mt-3 text-sm text-umber-800">{t("verify.check_inbox_body")}</p>
            <p className="mt-4 break-all rounded-lg bg-paper-100 px-3 py-2 text-sm font-medium text-umber-900">
              {pendingSession.user.email}
            </p>
            <p className="mt-4 text-xs text-umber-600">{t("verify.check_inbox_spam_hint")}</p>
            <div className="mt-6 flex flex-col gap-3">
              <Button
                type="button"
                variant="outline"
                fullWidth
                loading={resending}
                loadingLabel={t("verify.banner_resending")}
                onClick={onResend}
              >
                {t("verify.banner_resend")}
              </Button>
              <Button type="button" variant="primary" fullWidth onClick={continueToApp}>
                {t("vendor_register.continue_to_onboarding")}
              </Button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="font-grotesk text-2xl text-umber-900 dark:text-paper-50">
            {t("vendor_register.title")}
          </h1>
          <p className="mt-2 text-sm text-umber-600 dark:text-umber-300">
            {t("vendor_register.subtitle")}
          </p>
          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="vr_full_name" className="field-label">
                {t("auth.full_name_label")}
              </label>
              <input
                ref={nameRef}
                id="vr_full_name"
                type="text"
                className="input"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  clearError();
                }}
                autoComplete="name"
                required
              />
            </div>
            <div>
              <label htmlFor="vr_business" className="field-label">
                {t("vendor_register.business_name_label")} <span className="text-blush-600">*</span>
              </label>
              <input
                id="vr_business"
                type="text"
                className="input"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                  clearError();
                }}
                maxLength={120}
                autoComplete="organization"
                required
              />
            </div>
            <div>
              <label htmlFor="vr_category" className="field-label">
                {t("vendor_register.category_label")} <span className="text-blush-600">*</span>
              </label>
              <select
                id="vr_category"
                className="input"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as SupplierCategory | "");
                  clearError();
                }}
                required
              >
                <option value="" disabled>
                  {t("vendor_register.category_placeholder")}
                </option>
                {SUPPLIER_GROUPS.map((g) => (
                  <optgroup key={g.id} label={t(`suppliers.group.${g.id}`)}>
                    {g.categories.map((c) => (
                      <option key={c} value={c}>
                        {t(`suppliers.cat.${c}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vr_email" className="field-label">
                {t("auth.email_label")}
              </label>
              <input
                id="vr_email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError();
                }}
                autoComplete="email"
                inputMode="email"
                required
              />
            </div>
            <PasswordField
              id="vr_password"
              label={t("auth.password_label")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError();
              }}
              required
              minLength={8}
              autoComplete="new-password"
              helperText={t("auth.short_password")}
            />
            <PasswordField
              id="vr_password_confirm"
              label={t("auth.password_confirm_label")}
              value={passwordConfirm}
              onChange={(e) => {
                setPasswordConfirm(e.target.value);
                clearError();
              }}
              required
              minLength={8}
              autoComplete="new-password"
              errorText={
                passwordConfirm.length > 0 && passwordConfirm !== password
                  ? t("auth.password_mismatch")
                  : undefined
              }
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
              {t("vendor_register.submit")}
            </Button>
            <p className="field-help mt-3 text-center">
              {t("register.continuing_prefix")}
              <Link
                to="/privacy"
                target="_blank"
                rel="noopener"
                className="underline hover:text-umber-800"
              >
                {t("register.continuing_privacy_link")}
              </Link>
              {t("register.continuing_and")}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener"
                className="underline hover:text-umber-800"
              >
                {t("register.continuing_terms_link")}
              </Link>
              {t("register.continuing_suffix")}
            </p>
          </form>
          <p className="mt-4 text-center text-sm text-umber-700">
            {t("auth.have_account")}{" "}
            <Link to="/login" className="font-medium text-umber-900 underline">
              {t("auth.submit_login")}
            </Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}

/** UTM params the LandingPage stashed to sessionStorage this session. */
function readUtm(): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
} {
  try {
    const raw = window.sessionStorage.getItem("weddly.utm");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = parsed[key];
      if (typeof v === "string" && v.length > 0) out[key] = v.slice(0, 200);
    }
    return out;
  } catch {
    return {};
  }
}

function messageFor(err: unknown, t: ReturnType<typeof useT>["t"]): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t("auth.duplicate_email");
    if (err.status === 429) return t("auth.rate_limited");
    if (err.status === 400) return err.message;
  }
  return t("common.error_generic");
}
