// The in-person vendor signup, reached only by scanning the QR an admin shows
// from /app/admin/vendors. Three screens, one question each (name, trade,
// login), then the vendor is in. Everything the full /suppliers/signup form asks
// beyond that is optional there too and comes back in /vendor/onboarding, so
// nothing is lost by skipping it here.
//
// It posts to the same /api/vendor/register as the full form, so the account,
// listing, billing grant, directory-twin check and verify mail are all the
// ordinary ones. Terms: the final button IS the acceptance. The sentence right
// above it names the vendor terms, the highlighted clauses and the privacy
// notice, which is what the two checkboxes on the long form say, so tapping OK
// records the same three consents with the same versions.

import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { isUiLocale } from "@shared/locales";
import {
  isVendorSelfServeBlocked,
  SUPPLIER_GROUPS,
  type SupplierCategory,
} from "@shared/suppliers";
import type { AuthSession } from "@shared/types";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Confetti } from "../components/Confetti";
import { Wordmark } from "../components/Wordmark";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag } from "../lib/demoSession";
import { vendorAuthApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { vendorRegisterErrorMessage } from "../lib/vendor_register_errors";

type Step = 0 | 1 | 2;
const STEPS: readonly Step[] = [0, 1, 2];

const inputClass =
  "h-14 w-full rounded-2xl border-0 bg-neutral-100 px-4 text-lg text-neutral-900 placeholder:text-neutral-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-neutral-900 dark:bg-neutral-800 dark:text-white dark:focus:bg-neutral-900 dark:focus:ring-white";

const primaryClass =
  "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-neutral-900 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-30 disabled:active:scale-100 dark:bg-white dark:text-neutral-900";

export default function VendorQuickJoinPage() {
  const { t, locale, setLocale } = useT();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useDocumentMeta("vendor_join.seo_title", "vendor_register.seo_description");

  // The QR carries the admin's language, so a Hungarian vendor is greeted in
  // Hungarian rather than the public English default. Applied once on arrival;
  // the toggle in the corner still wins after that.
  const langParam = params.get("lang");
  useEffect(() => {
    if (isUiLocale(langParam)) setLocale(langParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>(0);
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [customCategory, setCustomCategory] = useState("");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setPendingSession] = useState<AuthSession | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Each screen opens with its field focused, so the keyboard is already up.
  useEffect(() => {
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [step]);

  const categoryLabel = (c: SupplierCategory) =>
    c === "other" ? t("vendor_register.category_other_option") : t(`suppliers.cat.${c}`);

  // Planners have their own flow, so they are not offered here at all.
  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return SUPPLIER_GROUPS.map((g) => ({
      id: g.id,
      categories: g.categories.filter(
        (c) =>
          !isVendorSelfServeBlocked(c) &&
          (q === "" || categoryLabel(c).toLocaleLowerCase().includes(q)),
      ),
    })).filter((g) => g.categories.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, locale]);

  const nameOk = businessName.trim().length > 0;
  const categoryOk = category !== "" && (category !== "other" || customCategory.trim() !== "");
  const accountOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8;

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function pickCategory(c: SupplierCategory) {
    setCategory(c);
    // A tap is the answer. "Other" needs one more word, so it stays put.
    if (c !== "other") window.setTimeout(() => go(2), 180);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (category === "" || !nameOk || !categoryOk || !accountOk || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const name = businessName.trim();
      const created = await vendorAuthApi.register({
        email: email.trim(),
        password,
        // A vendor's full_name holds the business, so the name they just typed
        // is the right answer and saves a fourth question.
        full_name: name,
        business_name: name,
        category,
        custom_category: category === "other" ? customCategory.trim() : undefined,
        country: locale === "hu" ? "HU" : undefined,
        privacy_version: PRIVACY_VERSION,
        vendor_terms_version: VENDOR_TERMS_VERSION,
        highlighted_terms_accepted: true,
        locale,
        utm_source: "qr",
        utm_medium: "in_person",
        utm_campaign: "admin_qr",
      });
      setPendingSession(created);
    } catch (err) {
      setError(vendorRegisterErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  function enterApp() {
    if (!session) return;
    clearDemoSessionFlag();
    setSession(session.token, session.user);
    navigate("/vendor/onboarding", { replace: true });
  }

  const otherLocale = locale === "hu" ? "en" : "hu";

  // ── Done ────────────────────────────────────────────────────────────────
  if (session) {
    return (
      <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] dark:bg-neutral-950">
        <Confetti />
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-24 w-24 animate-tick-pop items-center justify-center rounded-full bg-neutral-900 dark:bg-white">
            <Check
              size={44}
              strokeWidth={2.5}
              className="text-white dark:text-neutral-900"
              aria-hidden="true"
            />
          </div>
          <h1 className="mt-8 text-[2rem] font-semibold leading-tight tracking-tight text-neutral-900 dark:text-white">
            {t("vendor_join.done_title", { name: businessName.trim() })}
          </h1>
          <p className="mt-3 max-w-xs text-base text-neutral-500 dark:text-neutral-400">
            {t("vendor_join.done_body", { email: email.trim() })}
          </p>
        </div>
        <button type="button" className={primaryClass} onClick={enterApp}>
          {t("vendor_join.done_cta")}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </main>
    );
  }

  // ── The three questions ─────────────────────────────────────────────────
  return (
    <main className="flex min-h-[100dvh] flex-col bg-white pt-[max(1rem,env(safe-area-inset-top))] dark:bg-neutral-950">
      <header className="flex items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => (step > 0 ? go((step - 1) as Step) : undefined)}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-neutral-900 transition hover:bg-neutral-100 dark:text-white dark:hover:bg-neutral-800 ${step === 0 ? "invisible" : ""}`}
          aria-label={t("common.back")}
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <div
          className="flex flex-1 gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          {STEPS.map((s) => (
            <span
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${s <= step ? "bg-neutral-900 dark:bg-white" : "bg-neutral-200 dark:bg-neutral-800"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLocale(otherLocale)}
          className="flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-sm font-semibold uppercase text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label={t("vendor_join.switch_language")}
        >
          {otherLocale}
        </button>
      </header>

      <form
        className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          if (step < 2) {
            e.preventDefault();
            if (step === 0 && nameOk) go(1);
            else if (step === 1 && categoryOk) go(2);
            return;
          }
          void submit(e);
        }}
        noValidate
      >
        <div key={step} className="flex flex-1 animate-fade-in-up flex-col pt-8">
          {step === 0 && <Wordmark size="sm" className="mb-6 text-neutral-900 dark:text-white" />}
          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-tight text-neutral-900 dark:text-white">
            {t(`vendor_join.q${step}`)}
          </h1>

          {step === 0 && (
            <input
              ref={firstFieldRef}
              className={`${inputClass} mt-8`}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={t("vendor_join.name_placeholder")}
              aria-label={t("vendor_join.q0")}
              autoComplete="organization"
              enterKeyHint="next"
              maxLength={120}
            />
          )}

          {step === 1 && (
            <div className="mt-6 flex min-h-0 flex-1 flex-col">
              <div className="relative">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
                  aria-hidden="true"
                />
                <input
                  ref={firstFieldRef}
                  className={`${inputClass} h-12 pl-11 text-base`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("vendor_join.category_search")}
                  aria-label={t("vendor_join.category_search")}
                  enterKeyHint="search"
                />
              </div>
              <div className="-mx-6 mt-4 flex-1 overflow-y-auto px-6">
                {groups.map((g) => (
                  <section key={g.id} className="mb-4">
                    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      {t(`suppliers.group.${g.id}`)}
                    </h2>
                    <ul>
                      {g.categories.map((c) => {
                        const selected = category === c;
                        return (
                          <li key={c}>
                            <button
                              type="button"
                              onClick={() => pickCategory(c)}
                              aria-pressed={selected}
                              className={`flex min-h-[3.25rem] w-full items-center justify-between rounded-xl px-3 text-left text-[1.0625rem] transition active:scale-[0.99] ${selected ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-900 hover:bg-neutral-100 dark:text-white dark:hover:bg-neutral-800"}`}
                            >
                              {categoryLabel(c)}
                              {selected && <Check size={18} aria-hidden="true" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
                <button
                  type="button"
                  onClick={() => pickCategory("other")}
                  aria-pressed={category === "other"}
                  className={`mb-4 flex min-h-[3.25rem] w-full items-center rounded-xl px-3 text-left text-[1.0625rem] transition ${category === "other" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                >
                  {t("vendor_register.category_other_option")}
                </button>
              </div>
              {category === "other" && (
                <div className="pt-3">
                  <input
                    className={inputClass}
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder={t("vendor_join.other_placeholder")}
                    aria-label={t("vendor_join.other_placeholder")}
                    maxLength={60}
                    autoFocus
                  />
                  <button type="submit" className={`${primaryClass} mt-3`} disabled={!categoryOk}>
                    {t("vendor_join.next")}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mt-8 space-y-3">
              <input
                ref={firstFieldRef}
                type="email"
                inputMode="email"
                className={inputClass}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder={t("vendor_join.email_placeholder")}
                aria-label={t("vendor_join.email_placeholder")}
                autoComplete="email"
                autoCapitalize="none"
                enterKeyHint="next"
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className={`${inputClass} pr-14`}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder={t("vendor_join.password_placeholder")}
                  aria-label={t("vendor_join.password_placeholder")}
                  autoComplete="new-password"
                  enterKeyHint="go"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500"
                  aria-label={t(
                    showPassword ? "vendor_join.hide_password" : "vendor_join.show_password",
                  )}
                >
                  {showPassword ? (
                    <EyeOff size={20} aria-hidden="true" />
                  ) : (
                    <Eye size={20} aria-hidden="true" />
                  )}
                </button>
              </div>
              {error && (
                <p
                  className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {step === 0 && (
          <button type="submit" className={primaryClass} disabled={!nameOk}>
            {t("vendor_join.next")}
          </button>
        )}

        {step === 2 && (
          <div className="pt-6">
            <p className="mb-4 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              {t("vendor_join.terms_prefix")}{" "}
              <Link
                to="/terms/vendor-subscription"
                target="_blank"
                rel="noopener"
                className="underline"
              >
                {t("vendor_join.terms_link")}
              </Link>
              {t("vendor_join.terms_middle")}{" "}
              <Link to="/privacy" target="_blank" rel="noopener" className="underline">
                {t("vendor_join.privacy_link")}
              </Link>
              {t("vendor_join.terms_suffix")}
            </p>
            <button type="submit" className={primaryClass} disabled={!accountOk || submitting}>
              {submitting ? t("common.loading") : t("vendor_join.ok")}
            </button>
          </div>
        )}
      </form>
    </main>
  );
}
