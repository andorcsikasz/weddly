// /planners — wedding-planner product landing + registration form.
// Phase 1: data collection. Planners get a separate user type with broader
// workspace access in Phase 2+. Three pricing tiers: basic / pro / unlimited.

import { PRIVACY_VERSION } from "@shared/legal";
import { Calendar, Check, CheckCircle2, Clipboard, ClipboardList, FileText, LayoutGrid, Star, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { plannerWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

type Plan = "basic" | "pro" | "unlimited";
type Step = 1 | 2 | 3 | 4;

interface FormState {
  selected_plan: Plan | "";
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  city: string;
  years_experience: string;
  website: string;
  weddings_per_year: string;
  usage: string;
  message: string;
  privacy_accepted: boolean;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function trimStr(v: string): string {
  return v.trim();
}

function planName(plan: Plan, t: (key: string) => string): string {
  if (plan === "basic") return t("planners.plan_basic_name");
  if (plan === "pro") return t("planners.plan_pro_name");
  return t("planners.plan_unlimited_name");
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEP_LABELS = [
  "planners.step_label_plan",
  "planners.step_label_intro",
  "planners.step_label_business",
  "planners.step_label_usage",
] as const;

function StepIndicator({ step }: { step: Step }) {
  const { t } = useT();
  return (
    <div className="mb-8 flex flex-col items-center gap-3">
      <div className="flex items-center">
        {([1, 2, 3, 4] as Step[]).map((s, idx) => {
          const completed = step > s;
          const current = step === s;
          return (
            <div key={s} className="flex items-center">
              {idx > 0 && (
                <div
                  className={`h-px w-6 transition-colors duration-300 sm:w-10 ${
                    completed ? "bg-umber-600 dark:bg-umber-500" : "bg-paper-300 dark:bg-umber-700"
                  }`}
                />
              )}
              <div
                className={`flex items-center justify-center overflow-hidden rounded-full text-xs font-semibold transition-all duration-300 ease-in-out ${
                  current
                    ? "min-w-[6.5rem] gap-2 bg-umber-700 px-4 py-1.5 text-paper-50 dark:bg-umber-500"
                    : completed
                      ? "h-8 w-8 bg-umber-700 text-paper-50 dark:bg-umber-500"
                      : "h-8 w-8 border border-paper-300 bg-paper-50 text-umber-400 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-500"
                }`}
              >
                {completed ? (
                  <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                ) : (
                  <span>{s}</span>
                )}
                {current && (
                  <span className="whitespace-nowrap">
                    {t(STEP_LABELS[idx] as Parameters<typeof t>[0])}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-umber-500 dark:text-umber-400">
        {t("planners.step_indicator", { current: String(step), total: "4" })}
      </p>
    </div>
  );
}

// ── Plan selection card (inside form) ─────────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  name: string;
  price: string;
  period: string;
  couples: string;
  features: string[];
  badge?: string;
  recommended?: boolean;
  selected: boolean;
  onSelect: (plan: Plan) => void;
}

function PlanCard({
  plan,
  name,
  price,
  period,
  couples,
  features,
  badge,
  recommended,
  selected,
  onSelect,
}: PlanCardProps) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={() => onSelect(plan)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(plan);
        }
      }}
      className={`relative cursor-pointer rounded-xl border-2 p-5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-500 focus-visible:ring-offset-2 ${
        selected
          ? "border-umber-700 bg-paper-50 shadow-md dark:border-umber-400 dark:bg-umber-900"
          : recommended
            ? "border-umber-300 bg-paper-50 hover:border-umber-500 dark:border-umber-600 dark:bg-umber-900 dark:hover:border-umber-400"
            : "border-paper-200 bg-paper-50 hover:border-paper-400 dark:border-umber-800 dark:bg-umber-900 dark:hover:border-umber-600"
      }`}
    >
      {badge && (
        <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-umber-700 px-2.5 py-0.5 text-xs font-semibold text-paper-50 dark:bg-umber-500">
          <Star size={10} aria-hidden="true" />
          {badge}
        </div>
      )}
      <h3 className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
        {name}
      </h3>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className="text-2xl font-bold text-umber-900 dark:text-paper-50">{price}</span>
        <span className="text-sm text-umber-500 dark:text-umber-400">{period}</span>
      </div>
      <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">{couples}</p>
      <ul className="mt-4 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-umber-700 dark:text-umber-300">
            <Check
              size={14}
              className="mt-0.5 shrink-0 text-sage-600 dark:text-sage-400"
              aria-hidden="true"
            />
            {f}
          </li>
        ))}
      </ul>
      {/* Selection radio dot */}
      <div
        className={`absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
          selected
            ? "border-umber-700 bg-umber-700 dark:border-umber-400 dark:bg-umber-400"
            : "border-paper-300 dark:border-umber-600"
        }`}
      >
        {selected && <div className="h-2 w-2 rounded-full bg-paper-50" />}
      </div>
    </div>
  );
}

// ── Registration form ─────────────────────────────────────────────────────────

const EMPTY: FormState = {
  selected_plan: "",
  full_name: "",
  email: "",
  phone: "",
  company_name: "",
  city: "",
  years_experience: "",
  website: "",
  weddings_per_year: "",
  usage: "",
  message: "",
  privacy_accepted: false,
};

interface RegistrationFormProps {
  initialPlan: Plan | "";
}

function RegistrationForm({ initialPlan }: RegistrationFormProps) {
  const { t } = useT();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>({ ...EMPTY, selected_plan: initialPlan });
  const [prevPlan, setPrevPlan] = useState<Plan | "">(initialPlan);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [touched, setTouched] = useState<Set<keyof FormState>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sync initialPlan when parent updates it (e.g. pricing CTA clicked)
  if (initialPlan !== prevPlan && initialPlan !== "") {
    setPrevPlan(initialPlan);
    setForm((prev) => ({ ...prev, selected_plan: initialPlan }));
  }

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
    if (!form.selected_plan) errs.selected_plan = t("planners.err_plan");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!trimStr(form.full_name)) errs.full_name = t("planners.err_full_name");
    if (!trimStr(form.email) || !form.email.includes("@")) errs.email = t("planners.err_email");
    if (!trimStr(form.phone)) errs.phone = t("planners.err_phone");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep3(): boolean {
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

  function validateStep4(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.privacy_accepted) errs.privacy_accepted = t("planners.err_privacy");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (step === 1) {
      setTouched((prev) => new Set(prev).add("selected_plan"));
      if (validateStep1()) setStep(2);
    } else if (step === 2) {
      setTouched(new Set(["full_name", "email", "phone"] as (keyof FormState)[]));
      if (validateStep2()) setStep(3);
    } else if (step === 3) {
      if (validateStep3()) setStep(4);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep4()) return;
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
          selected_plan: form.selected_plan || null,
        website: trimStr(form.website) || null,
        weddings_per_year:
          form.weddings_per_year !== "" ? Number(form.weddings_per_year) : null,
        usage: form.usage || null,
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
        <CheckCircle2
          className="mx-auto mb-4 h-12 w-12 text-sage-600 dark:text-sage-400"
          aria-hidden="true"
        />
        <h2 className="font-display mb-3 text-2xl font-semibold text-umber-900 dark:text-paper-50">
          {t("planners.success_title")}
        </h2>
        {form.selected_plan && (
          <p className="mb-2 text-sm font-medium text-umber-700 dark:text-umber-300">
            {t("planners.success_plan")}{" "}
            <span className="font-semibold">
              {planName(form.selected_plan as Plan, (k) => t(k as Parameters<typeof t>[0]))}
            </span>
          </p>
        )}
        <p className="text-umber-700 dark:text-umber-300">{t("planners.success_body")}</p>
        <Link
          to="/"
          className="mt-8 inline-block text-sm text-umber-700 underline hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
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
  const backBtnClass =
    "flex-1 rounded-md border border-paper-300 px-4 py-2.5 text-sm text-umber-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-umber-300 dark:hover:bg-umber-800";

  return (
    <section id="waitlist" className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <StepIndicator step={step} />

      <form
        onSubmit={
          step < 4
            ? (e) => {
                e.preventDefault();
                handleNext();
              }
            : handleSubmit
        }
        noValidate
      >
        {/* ── Step 1: Plan selection ── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step0_title")}
            </h2>

            <div role="radiogroup" aria-label={t("planners.step0_title")} className="space-y-3">
              <PlanCard
                plan="basic"
                name={t("planners.plan_basic_name")}
                price={t("planners.plan_basic_price")}
                period={t("planners.plan_basic_period")}
                couples={t("planners.plan_basic_couples")}
                features={[
                  t("planners.plan_basic_feature_1"),
                  t("planners.plan_basic_feature_2"),
                  t("planners.plan_basic_feature_3"),
                ]}
                selected={form.selected_plan === "basic"}
                onSelect={(p) => set("selected_plan", p)}
              />
              <PlanCard
                plan="pro"
                name={t("planners.plan_pro_name")}
                price={t("planners.plan_pro_price")}
                period={t("planners.plan_pro_period")}
                couples={t("planners.plan_pro_couples")}
                features={[
                  t("planners.plan_pro_feature_1"),
                  t("planners.plan_pro_feature_2"),
                  t("planners.plan_pro_feature_3"),
                ]}
                badge={t("planners.plan_pro_badge")}
                recommended
                selected={form.selected_plan === "pro"}
                onSelect={(p) => set("selected_plan", p)}
              />
              <PlanCard
                plan="unlimited"
                name={t("planners.plan_unlimited_name")}
                price={t("planners.plan_unlimited_price")}
                period={t("planners.plan_unlimited_period")}
                couples={t("planners.plan_unlimited_couples")}
                features={[
                  t("planners.plan_unlimited_feature_1"),
                  t("planners.plan_unlimited_feature_2"),
                  t("planners.plan_unlimited_feature_3"),
                ]}
                selected={form.selected_plan === "unlimited"}
                onSelect={(p) => set("selected_plan", p)}
              />
            </div>

            {touched.has("selected_plan") && errors.selected_plan && (
              <p className={errClass} role="alert">
                {errors.selected_plan}
              </p>
            )}

            <button type="submit" className="btn-primary w-full py-2.5 text-sm">
              {t("common.next")} →
            </button>
          </div>
        )}

        {/* ── Step 2: Contact info ── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step1_title")}
            </h2>

            <div>
              <label htmlFor="pw-name" className={labelClass}>
                {t("planners.label_full_name")}
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="pw-name"
                type="text"
                autoComplete="name"
                className={inputClass}
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                onBlur={() => {
                  touch("full_name");
                  validateStep2();
                }}
                placeholder={t("planners.placeholder_full_name")}
              />
              {touched.has("full_name") && errors.full_name && (
                <p className={errClass}>{errors.full_name}</p>
              )}
            </div>

            <div>
              <label htmlFor="pw-email" className={labelClass}>
                {t("planners.label_email")}
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="pw-email"
                type="email"
                autoComplete="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => {
                  touch("email");
                  validateStep2();
                }}
                placeholder={t("planners.placeholder_email")}
              />
              {touched.has("email") && errors.email && (
                <p className={errClass}>{errors.email}</p>
              )}
            </div>

            <div>
              <label htmlFor="pw-phone" className={labelClass}>
                {t("planners.label_phone")}
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="pw-phone"
                type="tel"
                autoComplete="tel"
                className={inputClass}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                onBlur={() => {
                  touch("phone");
                  validateStep2();
                }}
                placeholder={t("planners.placeholder_phone")}
              />
              {touched.has("phone") && errors.phone && (
                <p className={errClass}>{errors.phone}</p>
              )}
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

        {/* ── Step 3: Business info ── */}
        {step === 3 && (
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
              {errors.years_experience && (
                <p className={errClass}>{errors.years_experience}</p>
              )}
            </div>

            <div>
              <label htmlFor="pw-website" className={labelClass}>
                {t("planners.label_website")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <input
                id="pw-website"
                type="url"
                autoComplete="url"
                className={inputClass}
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder={t("planners.placeholder_website")}
              />
            </div>

            <div>
              <label htmlFor="pw-weddings" className={labelClass}>
                {t("planners.label_weddings_per_year")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <input
                id="pw-weddings"
                type="number"
                min={0}
                className={inputClass}
                value={form.weddings_per_year}
                onChange={(e) => set("weddings_per_year", e.target.value)}
                placeholder={t("planners.placeholder_weddings_per_year")}
              />
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className={backBtnClass}>
                ← {t("common.back")}
              </button>
              <button type="submit" className="btn-primary flex-[2] py-2.5 text-sm">
                {t("common.next")} →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Usage + privacy ── */}
        {step === 4 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planners.step_label_usage")}
            </h2>

            <div>
              <label htmlFor="pw-usage" className={labelClass}>
                {t("planners.label_usage")}
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="pw-usage"
                className={inputClass}
                value={form.usage}
                onChange={(e) => set("usage", e.target.value)}
              >
                <option value="" disabled>
                  —
                </option>
                <option value="guestlist">{t("planners.usage_guestlist")}</option>
                <option value="seating">{t("planners.usage_seating")}</option>
                <option value="tasks">{t("planners.usage_tasks")}</option>
                <option value="all">{t("planners.usage_all")}</option>
              </select>
            </div>

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
                <p className={errClass} role="alert">
                  {errors.privacy_accepted}
                </p>
              )}
            </div>

            {serverError && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {serverError}
              </p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(3)} className={backBtnClass}>
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
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
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

// ── Feature showcase ──────────────────────────────────────────────────────────

function FeatureShowcase() {
  const { t } = useT();
  const features = [
    {
      icon: <Users size={22} aria-hidden="true" />,
      name: t("planners.feature_guestlist_name"),
      desc: t("planners.feature_guestlist_desc"),
    },
    {
      icon: <LayoutGrid size={22} aria-hidden="true" />,
      name: t("planners.feature_seating_name"),
      desc: t("planners.feature_seating_desc"),
    },
    {
      icon: <ClipboardList size={22} aria-hidden="true" />,
      name: t("planners.feature_tasks_name"),
      desc: t("planners.feature_tasks_desc"),
    },
    {
      icon: <FileText size={22} aria-hidden="true" />,
      name: t("planners.feature_docs_name"),
      desc: t("planners.feature_docs_desc"),
    },
  ];
  return (
    <section className="border-t border-paper-200 dark:border-umber-800">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="font-display mb-10 text-center text-3xl font-semibold text-umber-900 dark:text-paper-50">
          {t("planners.features_title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.name}
              className="flex flex-col gap-3 rounded-2xl bg-paper-100 p-5 shadow-sm dark:bg-umber-900"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper-200 text-umber-700 dark:bg-umber-800 dark:text-umber-300">
                {f.icon}
              </div>
              <h3 className="font-grotesk text-sm font-semibold text-umber-900 dark:text-paper-50">
                {f.name}
              </h3>
              <p className="text-xs leading-relaxed text-umber-600 dark:text-umber-400">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-umber-500 dark:text-umber-400">
          {t("planners.features_tagline")}
        </p>
      </div>
    </section>
  );
}

// ── Pricing section ───────────────────────────────────────────────────────────

interface PricingSectionProps {
  onSelectPlan: (plan: Plan) => void;
}

function PricingSection({ onSelectPlan }: PricingSectionProps) {
  const { t } = useT();

  const plans: {
    plan: Plan;
    name: string;
    price: string;
    period: string;
    couples: string;
    features: string[];
    badge?: string;
    recommended?: boolean;
  }[] = [
    {
      plan: "basic",
      name: t("planners.plan_basic_name"),
      price: t("planners.plan_basic_price"),
      period: t("planners.plan_basic_period"),
      couples: t("planners.plan_basic_couples"),
      features: [
        t("planners.plan_basic_feature_1"),
        t("planners.plan_basic_feature_2"),
        t("planners.plan_basic_feature_3"),
      ],
    },
    {
      plan: "pro",
      name: t("planners.plan_pro_name"),
      price: t("planners.plan_pro_price"),
      period: t("planners.plan_pro_period"),
      couples: t("planners.plan_pro_couples"),
      features: [
        t("planners.plan_pro_feature_1"),
        t("planners.plan_pro_feature_2"),
        t("planners.plan_pro_feature_3"),
      ],
      badge: t("planners.plan_pro_badge"),
      recommended: true,
    },
    {
      plan: "unlimited",
      name: t("planners.plan_unlimited_name"),
      price: t("planners.plan_unlimited_price"),
      period: t("planners.plan_unlimited_period"),
      couples: t("planners.plan_unlimited_couples"),
      features: [
        t("planners.plan_unlimited_feature_1"),
        t("planners.plan_unlimited_feature_2"),
        t("planners.plan_unlimited_feature_3"),
      ],
    },
  ];

  return (
    <section className="border-t border-paper-200 dark:border-umber-800">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <p className="font-grotesk mb-2 text-xs font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
          {t("planners.pricing_eyebrow")}
        </p>
        <h2 className="font-display mb-2 text-3xl font-semibold text-umber-900 dark:text-paper-50">
          {t("planners.pricing_title")}
        </h2>
        <p className="mb-8 text-sm text-umber-600 dark:text-umber-400">
          {t("planners.pricing_trial")}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map(({ plan, name, price, period, couples, features, badge, recommended }) => (
            <div
              key={plan}
              className={`relative flex flex-col rounded-xl border-2 p-5 ${
                recommended
                  ? "border-umber-400 dark:border-umber-500"
                  : "border-paper-200 dark:border-umber-800"
              }`}
            >
              {badge && (
                <div className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-umber-700 px-2.5 py-0.5 text-xs font-semibold text-paper-50 dark:bg-umber-500">
                  <Star size={10} aria-hidden="true" />
                  {badge}
                </div>
              )}
              <h3 className="font-grotesk text-base font-semibold text-umber-900 dark:text-paper-50">
                {name}
              </h3>
              <div className="mt-1 flex items-baseline gap-0.5">
                <span className="text-2xl font-bold text-umber-900 dark:text-paper-50">
                  {price}
                </span>
                <span className="text-sm text-umber-500 dark:text-umber-400">{period}</span>
              </div>
              <p className="mt-1 text-xs text-umber-500 dark:text-umber-400">{couples}</p>
              <ul className="mt-4 grow space-y-2">
                {features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm text-umber-700 dark:text-umber-300"
                  >
                    <Check
                      size={14}
                      className="mt-0.5 shrink-0 text-sage-600 dark:text-sage-400"
                      aria-hidden="true"
                    />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onSelectPlan(plan)}
                className={`mt-6 w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                  recommended
                    ? "bg-umber-700 text-paper-50 hover:bg-umber-800 dark:bg-umber-500 dark:hover:bg-umber-400"
                    : "border border-umber-700 text-umber-800 hover:bg-paper-100 dark:border-umber-500 dark:text-umber-200 dark:hover:bg-umber-800"
                }`}
              >
                {t("planners.plan_cta")}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-umber-400 dark:text-umber-600">
          {t("planners.pricing_active_note")}
        </p>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlannersPage() {
  const { t } = useT();
  const [selectedPlan, setSelectedPlan] = useState<Plan | "">("");

  function onSelectPlan(plan: Plan) {
    setSelectedPlan(plan);
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <PublicShell>
      <main id="main">
        {/* ── Hero ── */}
        <section className="mx-auto max-w-4xl px-4 pb-8 pt-16 sm:px-6 sm:pt-20 lg:px-8">
          <p className="font-grotesk mb-3 text-xs font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
            {t("planners.eyebrow")}
          </p>
          <h1 className="font-display mb-4 whitespace-pre-line text-4xl font-semibold italic leading-tight text-umber-900 sm:text-5xl dark:text-paper-50">
            {t("planners.hero_title")}
          </h1>
          <p className="mb-6 max-w-xl text-lg leading-relaxed text-umber-700 dark:text-umber-300">
            {t("planners.hero_body")}
          </p>
          <a
            href="#waitlist"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="btn-primary inline-block px-6 py-3 text-sm"
          >
            {t("planners.hero_cta")}
          </a>
        </section>

        {/* ── Couple escape hatch ── */}
        <div className="mx-auto max-w-4xl px-4 pb-4 sm:px-6 lg:px-8">
          <p className="text-sm text-umber-500 dark:text-umber-400">
            {t("planners.couple_escape")}{" "}
            <Link
              to="/signup"
              className="text-umber-700 underline hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
            >
              {t("planners.couple_escape_link")}
            </Link>
          </p>
        </div>

        {/* ── Benefits ── */}
        <Benefits />

        {/* ── Feature showcase ── */}
        <FeatureShowcase />

        {/* ── Pricing ── */}
        <PricingSection onSelectPlan={onSelectPlan} />

        {/* ── Trial note + Registration form ── */}
        <section className="border-t border-paper-200 dark:border-umber-800">
          <div className="mx-auto max-w-4xl px-4 pt-12 text-center sm:px-6 lg:px-8">
            <div className="inline-flex items-center justify-center gap-2 text-umber-500 dark:text-umber-400">
              <Calendar size={16} aria-hidden="true" />
              <span className="text-sm">{t("planners.pricing_trial")}</span>
            </div>
          </div>
          <RegistrationForm initialPlan={selectedPlan} />
        </section>

        {/* ── Footer escape links ── */}
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
            <span className="hidden text-umber-400 sm:block" aria-hidden="true">
              ·
            </span>
            <Link
              to="/vendors"
              className="text-sm text-umber-700 underline hover:text-umber-300 dark:text-umber-300 dark:hover:text-paper-50"
            >
              {t("planners.vendor_link")}
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
