// /planners — wedding-planner waitlist registration.
// Phase 1: data collection only. Planners are not suppliers; they get a
// separate user type with broader workspace access in Phase 2+.

import { PRIVACY_VERSION } from "@shared/legal";
import { CheckCircle2, Clipboard, ClipboardList, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { plannerWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// ── Helper ────────────────────────────────────────────────────────────────────

function trimStr(v: string): string {
  return v.trim();
}

// ── Registration form ─────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

const TOTAL_STEPS = 3;

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  city: string;
  years_experience: string;
  message: string;
  privacy_accepted: boolean;
}

const EMPTY: FormState = {
  full_name: "",
  email: "",
  phone: "",
  company_name: "",
  city: "",
  years_experience: "",
  message: "",
  privacy_accepted: false,
};

const backBtnClass =
  "flex-1 rounded-md border border-paper-300 px-4 py-2.5 text-sm text-umber-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-umber-300 dark:hover:bg-umber-800";

function PlannerWaitlistForm() {
  const { t } = useT();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [touched, setTouched] = useState<Set<keyof FormState>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function set(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  }

  function touch(field: keyof FormState) {
    setTouched((prev) => new Set(prev).add(field));
  }

  function validateStep1(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!trimStr(form.full_name)) errs.full_name = t("planners.err_full_name");
    if (!trimStr(form.email) || !form.email.includes("@")) errs.email = t("planners.err_email");
    if (!trimStr(form.phone)) errs.phone = t("planners.err_phone");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (
      form.years_experience !== "" &&
      (Number.isNaN(Number(form.years_experience)) ||
        Number(form.years_experience) < 0 ||
        Number(form.years_experience) > 60)
    ) {
      errs.years_experience = t("planners.err_years");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep3(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.privacy_accepted) errs.privacy_accepted = t("planners.err_privacy");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (step === 1) {
      setTouched(new Set(["full_name", "email", "phone"] as (keyof FormState)[]));
      if (validateStep1()) setStep(2);
    } else if (step === 2) {
      if (validateStep2()) setStep(3);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) { handleNext(); return; }
    if (!validateStep3()) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await plannerWaitlistApi.submit({
        full_name: trimStr(form.full_name),
        email: trimStr(form.email),
        phone: trimStr(form.phone),
        company_name: trimStr(form.company_name) || null,
        city: trimStr(form.city) || null,
        years_experience:
          form.years_experience !== "" ? Number(form.years_experience) : null,
        message: trimStr(form.message) || null,
        privacy_version: PRIVACY_VERSION,
        selected_plan: null,
        website: null,
        weddings_per_year: null,
        usage: null,
      });
      setDone(true);
    } catch {
      setServerError(t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-sage-600" aria-hidden="true" />
        <h2 className="font-display mb-3 text-2xl font-semibold text-umber-900 dark:text-paper-50">
          {t("planners.success_title")}
        </h2>
        <p className="text-umber-700 dark:text-umber-300">{t("planners.success_body")}</p>
        <Link
          to="/"
          className="mt-8 inline-block text-sm text-umber-700 underline hover:text-umber-900 dark:text-umber-300"
        >
          {t("planners.back_home")}
        </Link>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-umber-900 placeholder-umber-400 focus:border-umber-500 focus:outline-none focus:ring-1 focus:ring-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:placeholder-umber-500 dark:focus:border-umber-400 dark:focus:ring-umber-400";
  const labelClass = "block text-sm font-medium text-umber-800 dark:text-umber-200 mb-1";
  const errClass = "mt-1 text-xs text-red-600 dark:text-red-400";

  return (
    <section id="waitlist" className="mx-auto max-w-lg px-4 py-12">
      {/* Step indicator */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex gap-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <span
              key={s}
              className={`h-2 w-2 rounded-full transition-colors ${
                step === s
                  ? "bg-umber-700 dark:bg-umber-300"
                  : step > s
                    ? "bg-umber-400 dark:bg-umber-500"
                    : "bg-paper-300 dark:bg-umber-700"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-umber-500 dark:text-umber-400">
          {t("planners.step_indicator", { current: String(step), total: String(TOTAL_STEPS) })}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* ── Step 1: Contact ───────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step1_title")}
            </h2>

            <div>
              <label htmlFor="pw-name" className={labelClass}>
                {t("planners.label_full_name")}
                <span className="ml-1 text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="pw-name"
                type="text"
                autoComplete="name"
                className={inputClass}
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                onBlur={() => { touch("full_name"); validateStep1(); }}
                placeholder={t("planners.placeholder_full_name")}
              />
              {touched.has("full_name") && errors.full_name && <p className={errClass}>{errors.full_name}</p>}
            </div>

            <div>
              <label htmlFor="pw-email" className={labelClass}>
                {t("planners.label_email")}
                <span className="ml-1 text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="pw-email"
                type="email"
                autoComplete="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => { touch("email"); validateStep1(); }}
                placeholder={t("planners.placeholder_email")}
              />
              {touched.has("email") && errors.email && <p className={errClass}>{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="pw-phone" className={labelClass}>
                {t("planners.label_phone")}
                <span className="ml-1 text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="pw-phone"
                type="tel"
                autoComplete="tel"
                className={inputClass}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                onBlur={() => { touch("phone"); validateStep1(); }}
                placeholder={t("planners.placeholder_phone")}
              />
              {touched.has("phone") && errors.phone && <p className={errClass}>{errors.phone}</p>}
            </div>

            <button type="submit" className="btn-primary w-full py-2.5 text-sm">
              {t("common.next")} →
            </button>
          </div>
        )}

        {/* ── Step 2: Business profile ──────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step2_title")}
            </h2>

            <div>
              <label htmlFor="pw-company" className={labelClass}>
                {t("planners.label_company")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <input
                id="pw-company"
                type="text"
                autoComplete="organization"
                className={inputClass}
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                placeholder={t("planners.placeholder_company")}
              />
            </div>

            <div>
              <label htmlFor="pw-city" className={labelClass}>
                {t("planners.label_city")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <input
                id="pw-city"
                type="text"
                autoComplete="address-level2"
                className={inputClass}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder={t("planners.placeholder_city")}
              />
            </div>

            <div>
              <label htmlFor="pw-years" className={labelClass}>
                {t("planners.label_years")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <input
                id="pw-years"
                type="number"
                min={0}
                max={60}
                className={inputClass}
                value={form.years_experience}
                onChange={(e) => set("years_experience", e.target.value)}
                placeholder="0"
              />
              {errors.years_experience && <p className={errClass}>{errors.years_experience}</p>}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className={backBtnClass}>
                ← {t("common.back")}
              </button>
              <button type="submit" className="btn-primary flex-[2] py-2.5 text-sm">
                {t("common.next")} →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Message + privacy + submit ────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step3_title")}
            </h2>

            <div>
              <label htmlFor="pw-message" className={labelClass}>
                {t("planners.label_message")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <textarea
                id="pw-message"
                rows={4}
                className={inputClass}
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
                placeholder={t("planners.placeholder_message")}
              />
            </div>

            <div>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-umber-700 dark:accent-umber-300"
                  checked={form.privacy_accepted}
                  onChange={(e) => set("privacy_accepted", e.target.checked)}
                />
                <span className="text-xs text-umber-700 dark:text-umber-300">
                  {t("planners.privacy_consent_prefix")}{" "}
                  <Link to="/privacy" target="_blank" rel="noopener" className="underline">
                    {t("planners.privacy_link")}
                  </Link>
                  {t("planners.privacy_consent_suffix")}
                </span>
              </label>
              {errors.privacy_accepted && (
                <p className={errClass}>{errors.privacy_accepted}</p>
              )}
            </div>

            {serverError && (
              <p className="text-sm text-red-600 dark:text-red-400">{serverError}</p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className={backBtnClass}>
                ← {t("common.back")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary flex-[2] py-2.5 text-sm disabled:opacity-60"
              >
                {submitting ? t("planners.submitting") : t("planners.submit")}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

// ── Benefits ──────────────────────────────────────────────────────────────────

function Benefits() {
  const { t } = useT();
  const items = [
    {
      icon: <Users size={20} aria-hidden="true" />,
      title: t("planners.benefit_1_title"),
      body: t("planners.benefit_1_body"),
    },
    {
      icon: <ClipboardList size={20} aria-hidden="true" />,
      title: t("planners.benefit_2_title"),
      body: t("planners.benefit_2_body"),
    },
    {
      icon: <Clipboard size={20} aria-hidden="true" />,
      title: t("planners.benefit_3_title"),
      body: t("planners.benefit_3_body"),
    },
  ];
  return (
    <section className="border-t border-paper-200 dark:border-umber-800">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.title} className="flex flex-col gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper-200 text-umber-700 dark:bg-umber-800 dark:text-umber-300">
                {item.icon}
              </div>
              <h3 className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-umber-700 dark:text-umber-300">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlannersPage() {
  const { t } = useT();
  return (
    <PublicShell>
      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-4 pb-8 pt-16 sm:px-6 sm:pt-20">
          <p className="font-grotesk mb-3 text-xs font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
            {t("planners.eyebrow")}
          </p>
          <h1 className="font-display mb-4 text-4xl font-semibold leading-tight text-umber-900 sm:text-5xl dark:text-paper-50">
            {t("planners.hero_title")}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-umber-700 dark:text-umber-300">
            {t("planners.hero_body")}
          </p>
        </section>

        {/* Form */}
        <PlannerWaitlistForm />

        {/* Benefits */}
        <Benefits />

        {/* Footer band */}
        <section className="border-t border-paper-200 px-4 py-10 text-center dark:border-umber-800">
          <p className="mb-3 text-sm text-umber-600 dark:text-umber-400">
            {t("planners.not_a_planner")}
          </p>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Link
              to="/"
              className="text-sm text-umber-700 underline hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
            >
              {t("planners.back_home")}
            </Link>
            <span className="hidden text-umber-400 sm:block" aria-hidden="true">·</span>
            <Link
              to="/vendors"
              className="text-sm text-umber-700 underline hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
            >
              {t("planners.vendor_link")}
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
