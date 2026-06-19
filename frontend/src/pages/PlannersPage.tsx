// /planners — wedding-planner product landing + beta registration.
// Phase 1: data collection for 25-person beta cohort (2 years free).
// Phase 2: open paid tiers (basic / pro / unlimited).

import { PRIVACY_VERSION } from "@shared/legal";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  FileText,
  LayoutGrid,
  Users,
} from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { plannerWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

type Plan = "basic" | "pro" | "unlimited";
type Step = 0 | 1 | 2 | 3;

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

function StepIndicator({ step, t }: { step: Step; t: (k: string) => string }) {
  return (
    <div className="mb-8 flex items-center">
      {([0, 1, 2, 3] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                s < step
                  ? "bg-umber-700 text-paper-50 dark:bg-umber-400 dark:text-umber-900"
                  : s === step
                    ? "border-2 border-umber-700 bg-paper-50 text-umber-900 dark:border-umber-400 dark:bg-umber-900 dark:text-paper-50"
                    : "border border-paper-300 bg-paper-50 text-umber-400 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-600"
              }`}
            >
              {s < step ? <Check size={12} aria-hidden="true" /> : s + 1}
            </div>
            <span
              className={`hidden text-[10px] font-medium uppercase tracking-wider sm:block ${
                s === step
                  ? "text-umber-800 dark:text-paper-100"
                  : "text-umber-400 dark:text-umber-600"
              }`}
            >
              {t(STEP_LABELS[s]!)}
            </span>
          </div>
          {i < 3 && (
            <div
              className={`mb-4 h-px w-8 sm:w-16 ${
                s < step ? "bg-umber-700 dark:bg-umber-400" : "bg-paper-300 dark:bg-umber-700"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Plan selection card (landing-style) ──────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  name: string;
  coupleCount: string;
  coupleLabel: string;
  guests: string;
  price: string;
  period: string;
  annualPrice: string;
  annualPriceMonth: string;
  annualBilledLabel: string;
  features: string[];
  selected: boolean;
  onSelect: (plan: Plan) => void;
  badge?: string;
  billingPeriod: "monthly" | "annual";
}

function PlanCard({
  plan,
  name,
  coupleCount,
  coupleLabel,
  guests,
  price,
  period,
  annualPrice,
  annualPriceMonth,
  annualBilledLabel,
  features,
  selected,
  onSelect,
  badge,
  billingPeriod,
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
      className={`relative cursor-pointer rounded-2xl p-5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-500 focus-visible:ring-offset-2 ${
        selected
          ? "border-2 border-umber-700 bg-umber-50 dark:border-umber-400 dark:bg-umber-800"
          : "border border-paper-300 bg-paper-50 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-900 dark:hover:border-umber-600"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-umber-700 px-3 py-0.5 text-xs font-semibold text-paper-50">
          {badge}
        </div>
      )}
      {/* Top row: name + radio dot */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-grotesk text-sm font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
          {name}
        </h3>
        <div
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            selected
              ? "border-umber-700 bg-umber-700 dark:border-umber-400 dark:bg-umber-400"
              : "border-paper-300 dark:border-umber-600"
          }`}
          aria-hidden="true"
        >
          {selected && <div className="h-2 w-2 rounded-full bg-paper-50" />}
        </div>
      </div>

      {/* Couple count — main selling point */}
      <div className="mt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-grotesk text-4xl font-bold tracking-tight text-umber-900 dark:text-paper-50">
            {coupleCount}
          </span>
          <span className="font-grotesk text-sm font-medium text-umber-600 dark:text-umber-400">
            {coupleLabel}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-umber-400 dark:text-umber-500">{guests}</p>
      </div>

      {/* Price — switches by billing period */}
      <div className="mt-2.5">
        {billingPeriod === "monthly" ? (
          <div className="flex items-baseline gap-1">
            <span className="font-grotesk text-lg font-semibold text-umber-700 dark:text-umber-300">
              {price}
            </span>
            <span className="text-xs text-umber-500 dark:text-umber-400">{period}</span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="font-grotesk text-lg font-semibold text-umber-700 dark:text-umber-300">
                {annualPriceMonth}
              </span>
              <span className="text-xs text-umber-500 dark:text-umber-400">{period}</span>
            </div>
            <p className="text-xs text-umber-400 dark:text-umber-500">
              {annualPrice} {annualBilledLabel}
            </p>
          </>
        )}
      </div>

      {/* Dashed separator with ticket-punch notches */}
      <div className="relative -mx-5 my-4" aria-hidden="true">
        <div className={`absolute left-0 top-0 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper-200 dark:bg-umber-800 ${selected ? "border-2 border-umber-700 dark:border-umber-400" : "border border-paper-300 dark:border-umber-700"}`} />
        <div className={`absolute right-0 top-0 z-10 h-5 w-5 translate-x-1/2 -translate-y-1/2 rounded-full bg-paper-200 dark:bg-umber-800 ${selected ? "border-2 border-umber-700 dark:border-umber-400" : "border border-paper-300 dark:border-umber-700"}`} />
        <div className="border-t border-dashed border-paper-300 dark:border-umber-700" />
      </div>

      {/* Feature list */}
      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-umber-800 dark:text-umber-200">
            <Check
              size={14}
              className="mt-0.5 shrink-0 text-sage-600 dark:text-sage-400"
              aria-hidden="true"
            />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Registration form (4 steps) ───────────────────────────────────────────────

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

function RegistrationForm({ initialPlan }: { initialPlan: Plan | "" }) {
  const { t } = useT();
  const [step, setStep] = useState<Step>(0);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [form, setForm] = useState<FormState>({ ...EMPTY, selected_plan: initialPlan });
  const [prevPlan, setPrevPlan] = useState<Plan | "">(initialPlan);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [touched, setTouched] = useState<Set<keyof FormState>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  if (initialPlan !== prevPlan && initialPlan !== "") {
    setPrevPlan(initialPlan);
    setForm((prev) => ({ ...prev, selected_plan: initialPlan }));
  }

  function set(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  }

  function touch(...fields: (keyof FormState)[]) {
    setTouched((prev) => {
      const next = new Set(prev);
      fields.forEach((f) => next.add(f));
      return next;
    });
  }

  function validateStep0(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.selected_plan) errs.selected_plan = t("planners.err_plan");
    setErrors(errs);
    return Object.keys(errs).length === 0;
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
    const yrs = parseInt(form.years_experience, 10);
    if (form.years_experience !== "" && (isNaN(yrs) || yrs < 0 || yrs > 60))
      errs.years_experience = t("planners.err_years");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep3(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.privacy_accepted) errs.privacy_accepted = t("planners.err_privacy");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleAdvance(e: React.FormEvent) {
    e.preventDefault();
    if (step === 0) {
      touch("selected_plan");
      if (validateStep0()) setStep(1);
    } else if (step === 1) {
      touch("full_name", "email", "phone");
      if (validateStep1()) setStep(2);
    } else if (step === 2) {
      touch("years_experience");
      if (validateStep2()) setStep(3);
    } else {
      touch("privacy_accepted");
      if (validateStep3()) void doSubmit();
    }
  }

  async function doSubmit() {
    setSubmitting(true);
    setServerError(null);
    try {
      const yrs = parseInt(form.years_experience, 10);
      const wpy = parseInt(form.weddings_per_year, 10);
      await plannerWaitlistApi.submit({
        full_name: trimStr(form.full_name),
        email: trimStr(form.email),
        phone: trimStr(form.phone) || null,
        company_name: trimStr(form.company_name) || null,
        city: trimStr(form.city) || null,
        years_experience: isNaN(yrs) ? null : yrs,
        message: trimStr(form.message) || null,
        privacy_version: PRIVACY_VERSION,
        selected_plan: form.selected_plan || null,
        website: trimStr(form.website) || null,
        weddings_per_year: isNaN(wpy) ? null : wpy,
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
        <h2 className="font-grotesk mb-3 text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
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

  const inputCls =
    "w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-umber-900 placeholder-umber-400 focus:border-umber-500 focus:outline-none focus:ring-1 focus:ring-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:placeholder-umber-500 dark:focus:border-umber-400 dark:focus:ring-umber-400";
  const labelCls = "block text-sm font-medium text-umber-800 dark:text-umber-200 mb-1";
  const errCls = "mt-1 text-xs text-red-600 dark:text-red-400";
  const req = <span className="ml-1 text-red-500" aria-hidden="true">*</span>;
  const opt = <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>;

  const STEP_TITLES: Record<Step, string> = {
    0: t("planners.step0_title"),
    1: t("planners.step1_title"),
    2: t("planners.step2_title"),
    3: t("planners.step3_title"),
  };

  const USAGE_VALUES = ["guestlist", "seating", "tasks", "all"] as const;
  const USAGE_LABEL_KEYS = [
    "planners.usage_guestlist",
    "planners.usage_seating",
    "planners.usage_tasks",
    "planners.usage_all",
  ] as const;

  return (
    <section id="waitlist" className="border-t border-paper-200 dark:border-umber-800">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* Always-visible heading */}
        <div className="mb-8 text-center">
          <p className="font-grotesk mb-1 text-xs font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-400">
            {t("planners.beta_eyebrow")}
          </p>
          <h2 className="font-grotesk text-3xl font-semibold tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl">
            {t("planners.form_title")}
          </h2>
          <p className="mt-2 text-sm text-umber-600 dark:text-umber-400">
            {t("planners.beta_body")}
          </p>
        </div>

        <StepIndicator step={step} t={t} />

        <form onSubmit={handleAdvance} noValidate>
          {/* ── Step 0: Plan selection ── */}
          {step === 0 && (
            <div className="space-y-5">
              <h3 className="font-grotesk text-center text-xl font-semibold text-umber-900 dark:text-paper-50">
                {STEP_TITLES[0]}
              </h3>

              {/* Billing toggle */}
              <div className="flex justify-center">
                <div className="flex rounded-full border border-paper-300 p-0.5 text-xs font-semibold dark:border-umber-700">
                  {(["monthly", "annual"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setBillingPeriod(p)}
                      className={`rounded-full px-4 py-1.5 transition-colors ${
                        billingPeriod === p
                          ? "bg-umber-800 text-paper-50 dark:bg-umber-300 dark:text-umber-900"
                          : "text-umber-600 hover:text-umber-900 dark:text-umber-400 dark:hover:text-paper-100"
                      }`}
                    >
                      {p === "monthly" ? t("planners.billing_monthly") : t("planners.billing_annual")}
                      {p === "annual" && (
                        <span className="ml-1.5 rounded-full bg-sage-100 px-1.5 py-0.5 text-[10px] text-sage-700 dark:bg-sage-900 dark:text-sage-300">
                          {t("planners.billing_save")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div role="radiogroup" aria-label={STEP_TITLES[0]} className="grid gap-3 sm:grid-cols-3">
                <PlanCard
                  plan="basic"
                  name={t("planners.plan_basic_name")}
                  coupleCount={t("planners.plan_basic_couple_count")}
                  coupleLabel={t("planners.plan_basic_couple_label")}
                  guests={t("planners.plan_basic_guests")}
                  price={t("planners.plan_basic_price")}
                  period={t("planners.plan_basic_period")}
                  annualPrice={t("planners.plan_basic_annual_price")}
                  annualPriceMonth={t("planners.plan_basic_annual_permonth")}
                  annualBilledLabel={t("planners.plan_annual_billed")}
                  features={[
                    t("planners.plan_basic_feature_1"),
                    t("planners.plan_basic_feature_2"),
                    t("planners.plan_basic_feature_3"),
                  ]}
                  billingPeriod={billingPeriod}
                  selected={form.selected_plan === "basic"}
                  onSelect={(p) => set("selected_plan", p)}
                />
                <PlanCard
                  plan="pro"
                  name={t("planners.plan_pro_name")}
                  coupleCount={t("planners.plan_pro_couple_count")}
                  coupleLabel={t("planners.plan_pro_couple_label")}
                  guests={t("planners.plan_pro_guests")}
                  price={t("planners.plan_pro_price")}
                  period={t("planners.plan_pro_period")}
                  annualPrice={t("planners.plan_pro_annual_price")}
                  annualPriceMonth={t("planners.plan_pro_annual_permonth")}
                  annualBilledLabel={t("planners.plan_annual_billed")}
                  features={[
                    t("planners.plan_pro_feature_1"),
                    t("planners.plan_pro_feature_2"),
                    t("planners.plan_pro_feature_3"),
                    t("planners.plan_pro_feature_4"),
                    t("planners.plan_pro_feature_5"),
                  ]}
                  badge={t("planners.plan_pro_badge")}
                  billingPeriod={billingPeriod}
                  selected={form.selected_plan === "pro"}
                  onSelect={(p) => set("selected_plan", p)}
                />
                <PlanCard
                  plan="unlimited"
                  name={t("planners.plan_unlimited_name")}
                  coupleCount={t("planners.plan_unlimited_couple_count")}
                  coupleLabel={t("planners.plan_unlimited_couple_label")}
                  guests={t("planners.plan_unlimited_guests")}
                  price={t("planners.plan_unlimited_price")}
                  period={t("planners.plan_unlimited_period")}
                  annualPrice={t("planners.plan_unlimited_annual_price")}
                  annualPriceMonth={t("planners.plan_unlimited_annual_permonth")}
                  annualBilledLabel={t("planners.plan_annual_billed")}
                  features={[
                    t("planners.plan_unlimited_feature_1"),
                    t("planners.plan_unlimited_feature_2"),
                    t("planners.plan_unlimited_feature_3"),
                  ]}
                  billingPeriod={billingPeriod}
                  selected={form.selected_plan === "unlimited"}
                  onSelect={(p) => set("selected_plan", p)}
                />
              </div>

              {touched.has("selected_plan") && errors.selected_plan && (
                <p className={errCls} role="alert">
                  {errors.selected_plan}
                </p>
              )}

              <button type="submit" className="btn-primary w-full py-2.5 text-sm">
                {t("planners.step1_cta")} →
              </button>
            </div>
          )}

          {/* ── Step 1: Introduce yourself ── */}
          {step === 1 && (
            <div className="mx-auto max-w-lg space-y-5">
              <h3 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {STEP_TITLES[1]}
              </h3>
              <div>
                <label htmlFor="pw-name" className={labelCls}>
                  {t("planners.label_full_name")}{req}
                </label>
                <input id="pw-name" type="text" autoComplete="name" className={inputCls}
                  value={form.full_name} onChange={(e) => set("full_name", e.target.value)}
                  onBlur={() => touch("full_name")} placeholder={t("planners.placeholder_full_name")}
                />
                {touched.has("full_name") && errors.full_name && <p className={errCls}>{errors.full_name}</p>}
              </div>
              <div>
                <label htmlFor="pw-email" className={labelCls}>
                  {t("planners.label_email")}{req}
                </label>
                <input id="pw-email" type="email" autoComplete="email" className={inputCls}
                  value={form.email} onChange={(e) => set("email", e.target.value)}
                  onBlur={() => touch("email")} placeholder={t("planners.placeholder_email")}
                />
                {touched.has("email") && errors.email && <p className={errCls}>{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="pw-phone" className={labelCls}>
                  {t("planners.label_phone")}{req}
                </label>
                <input id="pw-phone" type="tel" autoComplete="tel" className={inputCls}
                  value={form.phone} onChange={(e) => set("phone", e.target.value)}
                  onBlur={() => touch("phone")} placeholder={t("planners.placeholder_phone")}
                />
                {touched.has("phone") && errors.phone && <p className={errCls}>{errors.phone}</p>}
              </div>
              <NavRow onBack={() => setStep(0)} t={t} />
            </div>
          )}

          {/* ── Step 2: About your business ── */}
          {step === 2 && (
            <div className="mx-auto max-w-lg space-y-5">
              <h3 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {STEP_TITLES[2]}
              </h3>
              <div>
                <label htmlFor="pw-company" className={labelCls}>{t("planners.label_company")}{opt}</label>
                <input id="pw-company" type="text" autoComplete="organization" className={inputCls}
                  value={form.company_name} onChange={(e) => set("company_name", e.target.value)}
                  placeholder={t("planners.placeholder_company")}
                />
              </div>
              <div>
                <label htmlFor="pw-city" className={labelCls}>{t("planners.label_city")}{opt}</label>
                <input id="pw-city" type="text" autoComplete="address-level2" className={inputCls}
                  value={form.city} onChange={(e) => set("city", e.target.value)}
                  placeholder={t("planners.placeholder_city")}
                />
              </div>
              <div>
                <label htmlFor="pw-years" className={labelCls}>{t("planners.label_years")}{opt}</label>
                <input id="pw-years" type="number" min={0} max={60} className={inputCls}
                  value={form.years_experience} onChange={(e) => set("years_experience", e.target.value)}
                  onBlur={() => touch("years_experience")}
                />
                {touched.has("years_experience") && errors.years_experience && <p className={errCls}>{errors.years_experience}</p>}
              </div>
              <div>
                <label htmlFor="pw-website" className={labelCls}>{t("planners.label_website")}{opt}</label>
                <input id="pw-website" type="url" autoComplete="url" className={inputCls}
                  value={form.website} onChange={(e) => set("website", e.target.value)}
                  placeholder={t("planners.placeholder_website")}
                />
              </div>
              <div>
                <label htmlFor="pw-wpy" className={labelCls}>{t("planners.label_weddings_per_year")}{opt}</label>
                <input id="pw-wpy" type="number" min={0} className={inputCls}
                  value={form.weddings_per_year} onChange={(e) => set("weddings_per_year", e.target.value)}
                  placeholder={t("planners.placeholder_weddings_per_year")}
                />
              </div>
              <NavRow onBack={() => setStep(1)} t={t} />
            </div>
          )}

          {/* ── Step 3: Almost there ── */}
          {step === 3 && (
            <div className="mx-auto max-w-lg space-y-5">
              <h3 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
                {STEP_TITLES[3]}
              </h3>

              {/* Usage radio */}
              <div>
                <p className={labelCls}>{t("planners.label_usage")}</p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {USAGE_VALUES.map((val, i) => (
                    <label key={val} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      form.usage === val
                        ? "border-umber-700 bg-umber-50 text-umber-900 dark:border-umber-400 dark:bg-umber-800 dark:text-paper-50"
                        : "border-paper-300 text-umber-700 hover:border-paper-400 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600"
                    }`}>
                      <input type="radio" name="usage" value={val} checked={form.usage === val}
                        onChange={() => set("usage", val)} className="sr-only"
                      />
                      <div className={`h-3 w-3 shrink-0 rounded-full border ${
                        form.usage === val
                          ? "border-umber-700 bg-umber-700 dark:border-umber-400 dark:bg-umber-400"
                          : "border-paper-400 dark:border-umber-600"
                      }`} />
                      {t(USAGE_LABEL_KEYS[i]!)}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="pw-message" className={labelCls}>{t("planners.label_message")}{opt}</label>
                <textarea id="pw-message" rows={3} className={inputCls}
                  value={form.message} onChange={(e) => set("message", e.target.value)}
                  placeholder={t("planners.placeholder_message")}
                />
              </div>

              <div>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-umber-700 dark:accent-umber-300"
                    checked={form.privacy_accepted} onChange={(e) => set("privacy_accepted", e.target.checked)}
                  />
                  <span className="text-xs text-umber-700 dark:text-umber-300">
                    {t("planners.privacy_consent_prefix")}{" "}
                    <Link to="/privacy" target="_blank" rel="noopener" className="underline">
                      {t("planners.privacy_link")}
                    </Link>
                    {t("planners.privacy_consent_suffix")}
                  </span>
                </label>
                {touched.has("privacy_accepted") && errors.privacy_accepted && (
                  <p className={errCls} role="alert">{errors.privacy_accepted}</p>
                )}
              </div>

              {serverError && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">{serverError}</p>
              )}

              <NavRow onBack={() => setStep(2)} t={t} isSubmit submitting={submitting} />
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

function NavRow({
  onBack,
  t,
  isSubmit,
  submitting,
}: {
  onBack: () => void;
  t: (k: string) => string;
  isSubmit?: boolean;
  submitting?: boolean;
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onBack}
        className="flex-1 rounded-md border border-paper-300 px-4 py-2.5 text-sm text-umber-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-umber-300 dark:hover:bg-umber-800"
      >
        ← {t("common.back")}
      </button>
      <button type="submit" disabled={submitting}
        className="btn-primary flex-[2] py-2.5 text-sm disabled:opacity-60"
      >
        {isSubmit
          ? submitting ? t("planners.submitting") : t("planners.submit")
          : `${t("common.next")} →`}
      </button>
    </div>
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
        <h2 className="font-grotesk mb-10 text-center text-3xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planners.features_title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.name}
              className="flex flex-col gap-3 rounded-2xl bg-paper-100 p-5 shadow-sm dark:bg-umber-900"
            >
              <div className="text-umber-800 dark:text-umber-100">{f.icon}</div>
              <h3 className="font-grotesk text-sm font-semibold text-umber-900 dark:text-paper-50">
                {f.name}
              </h3>
              <p className="text-xs leading-relaxed text-umber-600 dark:text-umber-400">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Beta offer ────────────────────────────────────────────────────────────────

function BetaOffer() {
  const { t } = useT();
  const steps = [
    { title: t("planners.beta_step_1_title"), body: t("planners.beta_step_1_body") },
    { title: t("planners.beta_step_2_title"), body: t("planners.beta_step_2_body") },
    { title: t("planners.beta_step_3_title"), body: t("planners.beta_step_3_body") },
  ];
  return (
    <section className="border-t border-paper-200 dark:border-umber-800">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-umber-900 px-6 py-8 text-center sm:px-10 dark:bg-umber-950">
          <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-paper-50 sm:text-3xl">
            {t("planners.beta_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-paper-400">
            {t("planners.beta_body")}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {steps.map((s, i) => (
              <Fragment key={s.title}>
                <span className="text-sm text-paper-300">{s.title}</span>
                {i < steps.length - 1 && (
                  <ArrowRight size={12} className="shrink-0 text-umber-600" aria-hidden="true" />
                )}
              </Fragment>
            ))}
          </div>

          <a
            href="#waitlist"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="btn btn-lg mt-6 bg-paper-50 text-umber-900 hover:bg-paper-200"
          >
            {t("planners.hero_cta")}
          </a>
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
        {/* ── Hero ── */}
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-14 sm:px-6 sm:pt-20 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8 lg:pt-24">
          <div>
            <p className="font-grotesk mb-3 text-xs font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
              {t("planners.eyebrow")}
            </p>
            <h1 className="font-grotesk mb-5 whitespace-pre-line text-4xl font-semibold leading-[1.05] tracking-tight text-umber-900 sm:text-5xl dark:text-paper-50">
              {t("planners.hero_title")}
            </h1>
            <p className="mb-8 max-w-lg text-lg leading-relaxed text-umber-700 dark:text-umber-300">
              {t("planners.hero_body")}
            </p>
            <a
              href="#waitlist"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="btn-primary inline-block px-8 py-3 text-sm"
            >
              {t("planners.hero_cta")}
            </a>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="text-sm text-umber-500 dark:text-umber-400">
                {t("planners.couple_escape")}
              </span>
              <Link to="/signup" className="btn btn-outline btn-sm">
                {t("planners.couple_escape_link")}
              </Link>
            </div>
          </div>

          <div className="mt-12 lg:mt-0">
            <div className="relative overflow-hidden rounded-2xl shadow-lg">
              <img
                src="/demo/film-02.jpg"
                alt=""
                aria-hidden="true"
                className="aspect-[4/5] w-full object-cover"
                loading="eager"
                decoding="async"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-umber-900/20 to-transparent" />
            </div>
          </div>
        </section>

        {/* ── Feature showcase ── */}
        <FeatureShowcase />

        {/* ── Beta offer + onboarding steps ── */}
        <BetaOffer />

        {/* ── Registration form ── */}
        <RegistrationForm initialPlan="pro" />

        {/* ── Footer escape links ── */}
        <section className="border-t border-paper-200 px-4 py-10 text-center dark:border-umber-800">
          <p className="mb-3 text-sm text-umber-600 dark:text-umber-400">
            {t("planners.not_a_planner")}
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link to="/" className="btn-outline btn-sm">
              {t("planners.back_home")}
            </Link>
            <Link to="/vendors" className="btn-outline btn-sm">
              {t("planners.vendor_link")}
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
