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
type Step = 1 | 2;

interface FormState {
  selected_plan: Plan | "";
  full_name: string;
  email: string;
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

// ── Step indicator (2-step) ───────────────────────────────────────────────────

// ── Plan selection card (landing-style) ──────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  name: string;
  price: string;
  period: string;
  couples: string;
  features: string[];
  selected: boolean;
  onSelect: (plan: Plan) => void;
  badge?: string;
}

function PlanCard({
  plan,
  name,
  price,
  period,
  couples,
  features,
  selected,
  onSelect,
  badge,
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
      className={`relative cursor-pointer rounded-2xl border p-5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-500 focus-visible:ring-offset-2 ${
        selected
          ? "border-umber-700 bg-umber-50 ring-2 ring-umber-700 dark:border-umber-400 dark:bg-umber-800 dark:ring-umber-400"
          : "border-paper-300 bg-paper-50 hover:border-paper-400 dark:border-umber-700 dark:bg-umber-900 dark:hover:border-umber-600"
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
        {/* Radio indicator */}
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

      {/* Price block */}
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-grotesk text-3xl font-bold tracking-tight text-umber-900 dark:text-paper-50">
          {price}
        </span>
        <span className="font-grotesk text-sm text-umber-500 dark:text-umber-400">{period}</span>
      </div>
      <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">{couples}</p>

      {/* Dashed separator with ticket-punch notches */}
      <div className="relative -mx-5 my-4" aria-hidden="true">
        <div className={`absolute left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-paper-200 dark:bg-umber-800 ${selected ? "border-umber-700 dark:border-umber-400" : "border-paper-300 dark:border-umber-700"}`} />
        <div className={`absolute right-0 top-0 h-5 w-5 translate-x-1/2 -translate-y-1/2 rounded-full border bg-paper-200 dark:bg-umber-800 ${selected ? "border-umber-700 dark:border-umber-400" : "border-paper-300 dark:border-umber-700"}`} />
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

// ── Registration form (2 steps) ───────────────────────────────────────────────

const EMPTY: FormState = {
  selected_plan: "",
  full_name: "",
  email: "",
  message: "",
  privacy_accepted: false,
};

function RegistrationForm({ initialPlan }: { initialPlan: Plan | "" }) {
  const { t } = useT();
  const [step, setStep] = useState<Step>(1);
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
    if (!form.privacy_accepted) errs.privacy_accepted = t("planners.err_privacy");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(new Set(["full_name", "email", "privacy_accepted"] as (keyof FormState)[]));
    if (!validateStep2()) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await plannerWaitlistApi.submit({
        full_name: trimStr(form.full_name),
        email: trimStr(form.email),
        phone: null,
        company_name: null,
        city: null,
        years_experience: null,
        message: trimStr(form.message) || null,
        privacy_version: PRIVACY_VERSION,
        selected_plan: form.selected_plan || null,
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

  const inputClass =
    "w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-umber-900 placeholder-umber-400 focus:border-umber-500 focus:outline-none focus:ring-1 focus:ring-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:placeholder-umber-500 dark:focus:border-umber-400 dark:focus:ring-umber-400";
  const labelClass = "block text-sm font-medium text-umber-800 dark:text-umber-200 mb-1";
  const errClass = "mt-1 text-xs text-red-600 dark:text-red-400";

  return (
    <section id="waitlist" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <form
        onSubmit={
          step === 1
            ? (e) => {
                e.preventDefault();
                setTouched((prev) => new Set(prev).add("selected_plan"));
                if (validateStep1()) setStep(2);
              }
            : handleSubmit
        }
        noValidate
      >
        {/* ── Step 1: Plan selection ── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="font-grotesk text-center text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
              {t("planners.step0_title")}
            </h2>

            <div className="rounded-2xl bg-paper-200 p-3 dark:bg-umber-800">
            <div role="radiogroup" aria-label={t("planners.step0_title")} className="grid gap-3 sm:grid-cols-3">
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
            </div>

            {touched.has("selected_plan") && errors.selected_plan && (
              <p className={errClass} role="alert">
                {errors.selected_plan}
              </p>
            )}

            <button type="submit" className="btn-primary w-full py-2.5 text-sm">
              {t("planners.step1_cta")} →
            </button>
          </div>
        )}

        {/* ── Step 2: Contact info ── */}
        {step === 2 && (
          <div className="mx-auto max-w-lg space-y-5">
            <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
              {t("planners.form_title")}
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
                onBlur={() => setTouched((prev) => new Set(prev).add("full_name"))}
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
                onBlur={() => setTouched((prev) => new Set(prev).add("email"))}
                placeholder={t("planners.placeholder_email")}
              />
              {touched.has("email") && errors.email && (
                <p className={errClass}>{errors.email}</p>
              )}
            </div>

            <div>
              <label htmlFor="pw-message" className={labelClass}>
                {t("planners.label_message")}
                <span className="ml-1 text-xs text-umber-500">({t("common.optional")})</span>
              </label>
              <textarea
                id="pw-message"
                rows={3}
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
              {touched.has("privacy_accepted") && errors.privacy_accepted && (
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
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-md border border-paper-300 px-4 py-2.5 text-sm text-umber-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-umber-300 dark:hover:bg-umber-800"
              >
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
        <section className="border-t border-paper-200 dark:border-umber-800">
          <RegistrationForm initialPlan="pro" />
        </section>

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
