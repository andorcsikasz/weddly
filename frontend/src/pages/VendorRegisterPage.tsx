// Self-serve vendor signup. Two-step wizard that mirrors RegisterPage's
// account basics, then captures the company identity (business name, category,
// official registry data auto-filled via CompanyLookupBox where a free source
// exists) before creating a role='vendor' account via vendorAuthApi.register.
// On success a confetti + green-check screen confirms the account and hands
// the vendor to the in-app onboarding wizard at /vendor/onboarding.
//
// This replaces the old public waitlist form + emailed token-activation flow.

import type { CompanyLookupResult } from "@shared/company_lookup";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import type { AuthSession } from "@shared/types";
import { Check } from "lucide-react";
import { Fragment, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { Confetti } from "../components/Confetti";
import { CountryCombobox } from "../components/CountryCombobox";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { CompanyLookupBox } from "../components/planner/CompanyLookupBox";
import { Shell } from "../components/Shell";
import { Button, PasswordField, useToast } from "../components/ui";
import { ApiError, apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag } from "../lib/demoSession";
import { vendorAuthApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Pull the email + display name out of a Google credential for display only
 *  (which account the vendor picked). The backend re-verifies the credential
 *  and uses the attested values, so a decode failure just skips the prefill.
 *  Handles both a real ID-token JWT and the `test:` bypass string used in dev. */
function decodeGoogleClaims(credential: string): { email: string; name: string } | null {
  try {
    if (credential.startsWith("test:")) {
      const parts = credential.split(":");
      return {
        email: parts[2] ? decodeURIComponent(parts[2]) : "",
        name: parts[3] ? decodeURIComponent(parts[3]) : "",
      };
    }
    const payload = credential.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      email?: unknown;
      name?: unknown;
    };
    return {
      email: typeof json.email === "string" ? json.email : "",
      name: typeof json.name === "string" ? json.name : "",
    };
  } catch {
    return null;
  }
}

export default function VendorRegisterPage() {
  const { setSession } = useAuth();
  const { t, locale } = useT();
  const toast = useToast();
  useDocumentMeta("vendor_register.seo_title", "vendor_register.seo_description");
  const navigate = useNavigate();

  const [step, setStep] = useState<0 | 1>(0);

  // Step 1: account basics
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  // When the vendor signs up with Google, we hold the verified credential from
  // step 1 and submit it (instead of a password) with the step-2 business
  // fields. `googleEmail` is decoded from the credential for display only.
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);

  // Step 2: company identity (only name + category are required; the rest is
  // the official-registry block the planner flow already collects)
  const [country, setCountry] = useState(locale === "hu" ? "HU" : "");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [customCategory, setCustomCategory] = useState("");
  const [registryNumber, setRegistryNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hold the session until the user clicks past the success screen; see
  // RegisterPage for why we don't persist the token immediately.
  const [pendingSession, setPendingSession] = useState<AuthSession | null>(null);
  const [resending, setResending] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const businessRef = useRef<HTMLInputElement | null>(null);
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

  /** Auto-fill from an official lookup pick; only returned fields overwrite. */
  function applyCompany(r: CompanyLookupResult) {
    if (r.name) setBusinessName(r.name);
    if (r.registry_number) setRegistryNumber(r.registry_number);
    if (r.vat_number) setVatNumber(r.vat_number);
    if (r.legal_form) setLegalForm(r.legal_form);
    if (r.address) setAddress(r.address);
    if (r.city) setCity(r.city);
    if (r.postal_code) setPostalCode(r.postal_code);
    toast.success(t("company_lookup.filled_toast"));
  }

  function handleAccountNext(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("vendor_register.email_required"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.short_password"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }
    setStep(1);
  }

  // The vendor authenticated with Google on step 1. Hold the credential, prefill
  // name/email from it for display, and jump straight to the business step —
  // there's no password to collect.
  function onGoogleCredential(credential: string) {
    setError(null);
    setGoogleCredential(credential);
    const claims = decodeGoogleClaims(credential);
    if (claims?.email) {
      setEmail(claims.email);
      setGoogleEmail(claims.email);
    }
    if (claims?.name) setFullName(claims.name);
    setStep(1);
  }

  // Focus the first business field when the step flips (desktop only, matching
  // the step-1 autofocus behaviour).
  useEffect(() => {
    if (step !== 1 || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches) businessRef.current?.focus();
  }, [step]);

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
    if (category === "other" && !customCategory.trim()) {
      setError(t("vendor_register.custom_category_required"));
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
      // Everything past the identity is identical between the two signup paths;
      // only email+password (password path) vs the Google credential differ.
      const businessPayload = {
        business_name: businessName.trim(),
        category,
        custom_category: category === "other" ? customCategory.trim() : undefined,
        country: country || undefined,
        registry_number: registryNumber.trim() || undefined,
        vat_number: vatNumber.trim() || undefined,
        legal_form: legalForm.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        postal_code: postalCode.trim() || undefined,
        contact_phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        locale,
        referrer,
        ...utm,
      };
      const session = googleCredential
        ? await vendorAuthApi.registerGoogle({ credential: googleCredential, ...businessPayload })
        : await vendorAuthApi.register({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            ...businessPayload,
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

  // ── Success: big green check + confetti, then hand over to onboarding ──
  if (pendingSession) {
    return (
      <Shell>
        <div className="mx-auto max-w-md">
          <div className="card relative overflow-hidden text-center">
            <Confetti />
            <div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sage-100 ring-2 ring-sage-400 dark:bg-sage-900 dark:ring-sage-600"
              aria-hidden="true"
            >
              <svg
                className="h-10 w-10 text-sage-600 dark:text-sage-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="mt-6 font-grotesk text-2xl text-umber-900 dark:text-paper-50">
              {t("vendor_register.success_title")}
            </h1>
            <p className="mt-3 text-sm text-umber-800 dark:text-umber-200">
              {/* Google-created accounts are already verified — don't tell them
                  to go check an inbox that has nothing to confirm. */}
              {pendingSession.user.verified_email
                ? t("vendor_register.success_body_verified")
                : t("vendor_register.success_body")}
            </p>
            <p className="mt-4 break-all rounded-lg bg-paper-100 px-3 py-2 text-sm font-medium text-umber-900">
              {pendingSession.user.email}
            </p>
            {!pendingSession.user.verified_email && (
              <p className="mt-4 text-xs text-umber-600 dark:text-umber-300">
                {t("verify.check_inbox_spam_hint")}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <Button type="button" variant="primary" fullWidth onClick={continueToApp}>
                {t("vendor_register.continue_to_onboarding")}
              </Button>
              {!pendingSession.user.verified_email && (
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
              )}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const stepLabels = [t("vendor_register.step_account"), t("vendor_register.step_business")];

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

          {/* Stepper: mirrors the VendorOnboardingPage pattern */}
          <div className="mt-6 flex items-start">
            {([0, 1] as const).map((s, i) => {
              const active = step === s;
              const done = step > s;
              return (
                <Fragment key={s}>
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                        done
                          ? "bg-umber-700 text-paper-50 dark:bg-umber-400 dark:text-umber-900"
                          : active
                            ? "border-2 border-umber-700 bg-paper-50 text-umber-900 dark:border-umber-400 dark:bg-umber-900 dark:text-paper-50"
                            : "border border-paper-300 bg-paper-50 text-umber-400 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-600"
                      }`}
                    >
                      {done ? <Check size={12} aria-hidden="true" /> : s + 1}
                    </div>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wider ${
                        active
                          ? "text-umber-800 dark:text-paper-100"
                          : "text-umber-400 dark:text-umber-600"
                      }`}
                    >
                      {stepLabels[i]}
                    </span>
                  </div>
                  {i < 1 && (
                    <div
                      className={`mt-3.5 h-px flex-1 ${
                        done ? "bg-umber-700 dark:bg-umber-400" : "bg-paper-300 dark:bg-umber-700"
                      }`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* ── Step 1: Account ── */}
          {step === 0 && (
            <>
              {/* Social sign-up — hands the credential back so we can carry it
                  into the business step (GoogleSignInButton renders nothing when
                  VITE_GOOGLE_CLIENT_ID is unset, leaving just the form). */}
              <div className="mt-6">
                <GoogleSignInButton mode="signup" onCredential={onGoogleCredential} />
              </div>
              <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-umber-600 dark:text-umber-300">
                <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
                <span>{t("auth.or")}</span>
                <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
              </div>
              <form className="space-y-4" onSubmit={handleAccountNext} noValidate>
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
                <Button type="submit" variant="primary" fullWidth>
                  {t("common.next")}
                </Button>
              </form>
            </>
          )}

          {/* ── Step 2: Business ── */}
          {step === 1 && (
            <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
              {googleCredential && (
                <p className="rounded-lg bg-paper-100 px-3 py-2 text-sm text-umber-800 dark:bg-umber-800 dark:text-umber-200">
                  {t("vendor_register.google_continue_as", { email: googleEmail ?? "Google" })}
                </p>
              )}
              <CountryCombobox
                id="vr_country"
                label={t("vendor_register.country_label")}
                value={country}
                onChange={setCountry}
              />

              <CompanyLookupBox country={country} onPick={applyCompany} />

              <div>
                <label htmlFor="vr_business" className="field-label">
                  {t("vendor_register.business_name_label")}{" "}
                  <span className="text-blush-600">*</span>
                </label>
                <input
                  ref={businessRef}
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
                          {c === "other"
                            ? t("vendor_register.category_other_option")
                            : t(`suppliers.cat.${c}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {category === "other" && (
                <div>
                  <label htmlFor="vr_custom_category" className="field-label">
                    {t("vendor_register.custom_category_label")}{" "}
                    <span className="text-blush-600">*</span>
                  </label>
                  <input
                    id="vr_custom_category"
                    type="text"
                    className="input"
                    value={customCategory}
                    onChange={(e) => {
                      setCustomCategory(e.target.value);
                      clearError();
                    }}
                    maxLength={60}
                    placeholder={t("vendor_register.custom_category_placeholder")}
                    required
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="vr_registry_number" className="field-label">
                    {t("vendor_register.registry_number_label")}
                  </label>
                  <input
                    id="vr_registry_number"
                    type="text"
                    className="input"
                    value={registryNumber}
                    onChange={(e) => setRegistryNumber(e.target.value)}
                    maxLength={40}
                  />
                </div>
                <div>
                  <label htmlFor="vr_vat_number" className="field-label">
                    {t("vendor_register.vat_number_label")}
                  </label>
                  <input
                    id="vr_vat_number"
                    type="text"
                    className="input"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    maxLength={40}
                  />
                </div>
              </div>

              <AddressAutocomplete
                id="vr_address"
                label={t("vendor_register.address_label")}
                value={address}
                onChange={(v) => {
                  clearError();
                  setAddress(v);
                }}
                onPick={(s) => {
                  if (s.city) setCity(s.city);
                  if (s.postal_code) setPostalCode(s.postal_code);
                }}
                maxLength={240}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="vr_city" className="field-label">
                    {t("vendor_register.city_label")}
                  </label>
                  <input
                    id="vr_city"
                    type="text"
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    maxLength={80}
                    autoComplete="address-level2"
                  />
                </div>
                <div>
                  <label htmlFor="vr_postal_code" className="field-label">
                    {t("vendor_register.postal_code_label")}
                  </label>
                  <input
                    id="vr_postal_code"
                    type="text"
                    className="input"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    maxLength={20}
                    autoComplete="postal-code"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="vr_phone" className="field-label">
                    {t("vendor_register.phone_label")}
                  </label>
                  <input
                    id="vr_phone"
                    type="tel"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={40}
                    autoComplete="tel"
                  />
                </div>
                <div>
                  <label htmlFor="vr_website" className="field-label">
                    {t("vendor_register.website_label")}
                  </label>
                  <input
                    id="vr_website"
                    type="url"
                    className="input"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    maxLength={240}
                    placeholder="https://"
                    autoComplete="url"
                  />
                </div>
              </div>

              {error && (
                <p id={errorId} className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStep(0);
                    // Going back re-opens the auth choice, so drop any held
                    // Google credential; the user can re-pick Google or password.
                    setGoogleCredential(null);
                    setGoogleEmail(null);
                    clearError();
                  }}
                >
                  {t("common.back")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  loading={submitting}
                  loadingLabel={t("common.loading")}
                >
                  {t("vendor_register.submit")}
                </Button>
              </div>
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
          )}

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
