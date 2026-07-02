import { Fragment, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Sparkles } from "lucide-react";
import type { CompanyLookupResult } from "@shared/company_lookup";
import type { PlannerPlan } from "@shared/types";
import { CountryCombobox } from "../components/CountryCombobox";
import { CompanyLookupBox } from "../components/planner/CompanyLookupBox";
import { Wordmark } from "../components/Wordmark";
import { useAuth } from "../lib/auth";
import { plannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const TOTAL_STEPS = 5;

const PLANS = [
  { key: "starter", clients: 4 } as const,
  { key: "pro", clients: 7 } as const,
  { key: "premium", clients: 10 } as const,
];

export default function PlannerOnboardingPage() {
  const { t } = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  useDocumentMeta("planner_onboarding.meta_title", "planner_onboarding.meta_description");

  const [step, setStep] = useState(0);
  const [activePlan, setActivePlan] = useState<PlannerPlan>("starter");
  // True once we know the planner has data on file (waitlist application or a
  // partially-saved profile). Drives the "review & confirm" path vs the blank
  // multi-step form.
  const [hasPrefill, setHasPrefill] = useState(false);

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [bio, setBio] = useState("");
  // Official business identity. Country gates the registry lookup; the rest
  // is auto-filled by a lookup pick and stays editable.
  const [country, setCountry] = useState("");
  const [registryNumber, setRegistryNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [address, setAddress] = useState("");
  // Read-only application extras carried from the waitlist (no edit surface in
  // onboarding yet; persisted on confirm so they are not lost).
  const [weddingsPerYear, setWeddingsPerYear] = useState<number | null>(null);
  const [kmRadius, setKmRadius] = useState<number | null>(null);
  const [styles, setStyles] = useState<string[]>([]);

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [clientEmail, setClientEmail] = useState("");
  const [clientStatus, setClientStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [clientError, setClientError] = useState("");

  useEffect(() => {
    plannerApi
      .getProfile()
      .then((profile) => {
        // Pre-fill from saved profile first, then fall back to waitlist registration data.
        const wl = profile.waitlist_prefill;
        if (profile.full_name) setFullName(profile.full_name);
        if (profile.business_name) setBusinessName(profile.business_name);
        else if (wl?.company_name) setBusinessName(wl.company_name);
        if (profile.planner_city) setCity(profile.planner_city);
        else if (wl?.city) setCity(wl.city);
        if (profile.planner_phone) setPhone(profile.planner_phone);
        else if (wl?.phone) setPhone(wl.phone);
        if (profile.planner_website) setWebsite(profile.planner_website);
        else if (wl?.website) setWebsite(wl.website);
        if (profile.planner_bio) setBio(profile.planner_bio);
        else if (wl?.bio) setBio(wl.bio);
        if (profile.planner_country) setCountry(profile.planner_country);
        if (profile.planner_registry_number) setRegistryNumber(profile.planner_registry_number);
        if (profile.planner_vat_number) setVatNumber(profile.planner_vat_number);
        if (profile.planner_legal_form) setLegalForm(profile.planner_legal_form);
        if (profile.planner_address) setAddress(profile.planner_address);

        setWeddingsPerYear(profile.planner_weddings_per_year ?? wl?.weddings_per_year ?? null);
        setKmRadius(profile.planner_km_radius ?? wl?.km_radius ?? null);
        setStyles(profile.planner_styles ?? wl?.styles ?? []);

        // Keep an explicitly-set account plan; otherwise honour the waitlist choice.
        setActivePlan(
          profile.planner_plan && profile.planner_plan !== "starter"
            ? profile.planner_plan
            : (wl?.mapped_plan ?? profile.planner_plan ?? "starter"),
        );

        setHasPrefill(
          !!wl ||
            !!(
              profile.business_name ||
              profile.planner_city ||
              profile.planner_phone ||
              profile.planner_website ||
              profile.planner_bio
            ),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.full_name && !fullName) setFullName(user.full_name);
  }, [user, fullName]);

  const firstName = (user?.full_name ?? "").split(" ")[0] ?? "";

  /** Auto-fill from an official lookup pick; only returned fields overwrite. */
  function applyCompany(r: CompanyLookupResult) {
    if (r.name) setBusinessName(r.name);
    if (r.city) setCity(r.city);
    if (r.registry_number) setRegistryNumber(r.registry_number);
    if (r.vat_number) setVatNumber(r.vat_number);
    if (r.legal_form) setLegalForm(r.legal_form);
    if (r.address) setAddress(r.address);
  }

  /** The official identity fields shared by both save paths. */
  function identityPayload() {
    return {
      planner_country: country || undefined,
      planner_registry_number: registryNumber.trim() || undefined,
      planner_vat_number: vatNumber.trim() || undefined,
      planner_legal_form: legalForm.trim() || undefined,
      planner_address: address.trim() || undefined,
    };
  }

  async function handleProfileNext() {
    if (!businessName.trim()) {
      setProfileError(t("planner_onboarding.business_name_required"));
      return;
    }
    if (!city.trim()) {
      setProfileError(t("planner_onboarding.city_required"));
      return;
    }
    setProfileError(null);
    setProfileSaving(true);
    try {
      await plannerApi.updateProfile({
        full_name: fullName.trim() || undefined,
        business_name: businessName.trim(),
        planner_city: city.trim(),
        planner_phone: phone.trim() || undefined,
        planner_website: website.trim() || undefined,
        planner_bio: bio.trim() || undefined,
        ...identityPayload(),
      } as Parameters<typeof plannerApi.updateProfile>[0]);
      setStep(2);
    } catch {
      setProfileError(t("planner_onboarding.save_error"));
    } finally {
      setProfileSaving(false);
    }
  }

  // Single-tap confirm for planners arriving with waitlist/profile data: persist
  // everything (including the carried CRM extras + the plan they chose on the
  // waitlist) and jump straight to the optional first-client step.
  async function handleConfirm() {
    if (!businessName.trim()) {
      setProfileError(t("planner_onboarding.business_name_required"));
      return;
    }
    if (!city.trim()) {
      setProfileError(t("planner_onboarding.city_required"));
      return;
    }
    setProfileError(null);
    setProfileSaving(true);
    try {
      await plannerApi.updateProfile({
        full_name: fullName.trim() || undefined,
        business_name: businessName.trim(),
        planner_city: city.trim(),
        planner_phone: phone.trim() || undefined,
        planner_website: website.trim() || undefined,
        planner_bio: bio.trim() || undefined,
        ...identityPayload(),
        planner_weddings_per_year: weddingsPerYear,
        planner_km_radius: kmRadius,
        planner_styles: styles,
        planner_plan: activePlan,
      } as Parameters<typeof plannerApi.updateProfile>[0]);
      setStep(3);
    } catch {
      setProfileError(t("planner_onboarding.save_error"));
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleAddClient(e: FormEvent) {
    e.preventDefault();
    if (!clientEmail.trim()) return;
    setClientStatus("loading");
    setClientError("");
    try {
      await plannerApi.addClient(clientEmail.trim());
      setClientStatus("ok");
    } catch (err) {
      setClientStatus("error");
      setClientError(
        err instanceof Error ? err.message : t("planner_onboarding.first_client_error"),
      );
    }
  }

  async function handleFinish() {
    try {
      await plannerApi.completeOnboarding();
    } catch {
      // Non-fatal — navigate anyway.
    }
    navigate("/app/planner", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            to="/app/planner"
            className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
          {step < TOTAL_STEPS - 1 && (
            <button
              type="button"
              onClick={() => void handleFinish()}
              className="text-sm text-umber-500 underline-offset-2 transition-colors hover:text-umber-800 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
            >
              {t("planner_onboarding.later")}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        {step > 0 && step < TOTAL_STEPS - 1 && !(step === 1 && hasPrefill) && (
          <div className="mb-8 flex items-start">
            {([1, 2, 3] as const).map((s, i) => {
              const active = step === s;
              const done = step > s;
              const labels = [
                t("planner_onboarding.step_label_profile"),
                t("planner_onboarding.step_label_package"),
                t("planner_onboarding.step_label_client"),
              ];
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
                      {done ? <Check size={12} aria-hidden="true" /> : s}
                    </div>
                    <span
                      className={`hidden text-[10px] font-medium uppercase tracking-wider sm:block ${
                        active
                          ? "text-umber-800 dark:text-paper-100"
                          : "text-umber-400 dark:text-umber-600"
                      }`}
                    >
                      {labels[i]}
                    </span>
                  </div>
                  {i < 2 && (
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
        )}

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <div className="card animate-fade-in-up text-center">
            <h1 className="font-grotesk text-4xl font-semibold leading-[1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-5xl">
              {t("planner_onboarding.step1_title").replace("{{name}}", firstName)}
            </h1>
            <p className="mt-5 max-w-sm mx-auto font-grotesk text-base leading-snug text-umber-700 dark:text-umber-200">
              {t("planner_onboarding.step1_body")}
            </p>
            <button
              type="button"
              className="btn-primary btn-lg mt-8 w-full"
              onClick={() => setStep(1)}
            >
              {t("planner_onboarding.step1_cta")}
            </button>
          </div>
        )}

        {/* ── Step 1: Profile (or review & confirm when prefilled) ── */}
        {step === 1 && (
          <div className="card animate-fade-in-up">
            {hasPrefill && (
              <div className="mb-5 flex items-start gap-3 rounded-xl bg-sage-50 p-4 dark:bg-sage-900/30">
                <Sparkles
                  size={18}
                  className="mt-0.5 shrink-0 text-sage-600 dark:text-sage-400"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold text-umber-900 dark:text-paper-50">
                    {t("planner_onboarding.prefill_banner_title")}
                  </p>
                  <p className="mt-0.5 text-xs text-umber-600 dark:text-umber-300">
                    {t("planner_onboarding.prefill_banner_body")}
                  </p>
                </div>
              </div>
            )}

            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t(
                hasPrefill
                  ? "planner_onboarding.prefill_review_title"
                  : "planner_onboarding.step2_title",
              )}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t(
                hasPrefill
                  ? "planner_onboarding.prefill_review_body"
                  : "planner_onboarding.step2_body",
              )}
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <div>
                <label htmlFor="po_full_name" className="field-label">
                  {t("planner_onboarding.full_name_label")}
                </label>
                <input
                  id="po_full_name"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <CountryCombobox
                id="po_country"
                label={t("planner_profile.country_label")}
                value={country}
                onChange={setCountry}
              />

              <CompanyLookupBox country={country} onPick={applyCompany} />

              <div>
                <label htmlFor="po_business" className="field-label">
                  {t("planner_onboarding.business_name_label")}{" "}
                  <span className="text-blush-600">*</span>
                </label>
                <input
                  id="po_business"
                  className="input"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="po_city" className="field-label">
                  {t("planner_onboarding.city_label")} <span className="text-blush-600">*</span>
                </label>
                <input
                  id="po_city"
                  className="input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="po_phone" className="field-label">
                  {t("planner_onboarding.phone_label")}
                </label>
                <input
                  id="po_phone"
                  type="tel"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="po_website" className="field-label">
                  {t("planner_onboarding.website_label")}
                </label>
                <input
                  id="po_website"
                  type="url"
                  className="input"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="po_registry_number" className="field-label">
                    {t("planner_profile.registry_number_label")}
                  </label>
                  <input
                    id="po_registry_number"
                    className="input"
                    value={registryNumber}
                    onChange={(e) => setRegistryNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="po_vat_number" className="field-label">
                    {t("planner_profile.vat_number_label")}
                  </label>
                  <input
                    id="po_vat_number"
                    className="input"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="po_address" className="field-label">
                  {t("planner_profile.address_label")}
                </label>
                <input
                  id="po_address"
                  className="input"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="po_bio" className="field-label">
                  {t("planner_onboarding.bio_label")}
                </label>
                <textarea
                  id="po_bio"
                  className="input min-h-[100px] resize-y"
                  value={bio}
                  maxLength={400}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t("planner_onboarding.bio_placeholder")}
                />
                <p className="mt-1 text-right text-xs text-umber-400">
                  {t("planner_onboarding.bio_chars_remaining").replace(
                    "{{n}}",
                    String(400 - bio.length),
                  )}
                </p>
              </div>

              {hasPrefill &&
                (weddingsPerYear !== null || kmRadius !== null || styles.length > 0) && (
                  <div className="rounded-xl border border-paper-200 p-4 dark:border-umber-700">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-400">
                      {t("planner_onboarding.prefill_summary_title")}
                    </p>
                    <dl className="mt-3 space-y-2 text-sm">
                      {weddingsPerYear !== null && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-umber-500 dark:text-umber-400">
                            {t("planner_onboarding.summary_weddings")}
                          </dt>
                          <dd className="font-medium text-umber-900 dark:text-paper-100">
                            {weddingsPerYear}
                          </dd>
                        </div>
                      )}
                      {kmRadius !== null && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-umber-500 dark:text-umber-400">
                            {t("planner_onboarding.summary_radius")}
                          </dt>
                          <dd className="font-medium text-umber-900 dark:text-paper-100">
                            {kmRadius} {t("planner_onboarding.summary_km_unit")}
                          </dd>
                        </div>
                      )}
                      {styles.length > 0 && (
                        <div className="flex justify-between gap-3">
                          <dt className="shrink-0 text-umber-500 dark:text-umber-400">
                            {t("planner_onboarding.summary_styles")}
                          </dt>
                          <dd className="text-right font-medium text-umber-900 dark:text-paper-100">
                            {styles.join(", ")}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

              {profileError && (
                <p className="text-sm text-blush-700 dark:text-blush-300" role="alert">
                  {profileError}
                </p>
              )}
            </div>

            {hasPrefill ? (
              <div className="mt-8">
                <button
                  type="button"
                  className="btn-primary btn-lg w-full"
                  disabled={profileSaving}
                  onClick={() => void handleConfirm()}
                >
                  {profileSaving ? t("common.saving") : t("planner_onboarding.prefill_confirm_cta")}
                </button>
              </div>
            ) : (
              <div className="mt-8 flex items-center justify-between">
                <button type="button" className="btn-ghost" onClick={() => setStep(0)}>
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={profileSaving}
                  onClick={() => void handleProfileNext()}
                >
                  {profileSaving ? t("common.saving") : t("common.next")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Package ── */}
        {step === 2 && (
          <div className="card animate-fade-in-up">
            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planner_onboarding.step3_title")}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t("planner_onboarding.step3_body")}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {PLANS.map((plan) => {
                const isActive = activePlan === plan.key;
                return (
                  <div
                    key={plan.key}
                    className={[
                      "rounded-xl border p-4 transition",
                      isActive
                        ? "border-umber-800 bg-umber-50 dark:border-umber-400 dark:bg-umber-800"
                        : "border-paper-300 bg-paper-50 opacity-60 dark:border-umber-700 dark:bg-umber-900",
                    ].join(" ")}
                  >
                    <p className="font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                      {t(`planner_onboarding.plan_${plan.key}_name`)}
                    </p>
                    <p className="mt-0.5 text-sm text-umber-600 dark:text-umber-300">
                      {t(`planner_onboarding.plan_${plan.key}_clients`)}
                    </p>
                    <p className="mt-1 text-xs text-umber-400 dark:text-umber-400">
                      {t(`planner_onboarding.plan_${plan.key}_tagline`)}
                    </p>
                    {isActive && (
                      <span className="mt-2 inline-block rounded-full bg-umber-800 px-2 py-0.5 text-[10px] font-medium text-paper-50 dark:bg-umber-400 dark:text-umber-900">
                        {t("planner_onboarding.plan_active_badge")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-4 text-xs text-umber-400 dark:text-umber-500">
              {t("planner_onboarding.plan_coming_soon")}
            </p>

            <div className="mt-8 flex items-center justify-between">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                {t("common.back")}
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                {t("common.next")}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: First client ── */}
        {step === 3 && (
          <div className="card animate-fade-in-up">
            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planner_onboarding.step4_title")}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t("planner_onboarding.step4_body")}
            </p>

            <form className="mt-6" onSubmit={(e) => void handleAddClient(e)}>
              <label htmlFor="po_client_email" className="field-label">
                {t("planner_onboarding.first_client_label")}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="po_client_email"
                  type="email"
                  className="input flex-1"
                  value={clientEmail}
                  onChange={(e) => {
                    setClientEmail(e.target.value);
                    if (clientStatus !== "idle") setClientStatus("idle");
                  }}
                  placeholder={t("planner_onboarding.first_client_placeholder")}
                  disabled={clientStatus === "loading" || clientStatus === "ok"}
                />
                <button
                  type="submit"
                  className="btn-primary shrink-0"
                  disabled={
                    clientStatus === "loading" || clientStatus === "ok" || !clientEmail.trim()
                  }
                >
                  {clientStatus === "loading"
                    ? t("planner_onboarding.first_client_adding")
                    : t("planner_onboarding.first_client_add")}
                </button>
              </div>
              <p className="mt-2 text-xs text-umber-500 dark:text-umber-400">
                {t("planner_onboarding.first_client_hint")}
              </p>
              {clientStatus === "ok" && (
                <p className="mt-2 text-xs text-sage-600 dark:text-sage-400">
                  {t("planner_onboarding.first_client_success")}
                </p>
              )}
              {clientStatus === "error" && (
                <p className="mt-2 text-xs text-blush-700 dark:text-blush-300" role="alert">
                  {clientError}
                </p>
              )}
            </form>

            <div className="mt-8 flex items-center justify-between">
              <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
                {t("common.back")}
              </button>
              <div className="flex gap-2">
                {clientStatus !== "ok" && (
                  <button type="button" className="btn-outline" onClick={() => void handleFinish()}>
                    {t("planner_onboarding.skip")}
                  </button>
                )}
                {clientStatus === "ok" && (
                  <button type="button" className="btn-primary" onClick={() => void handleFinish()}>
                    {t("common.next")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ── */}
        {step === 4 && (
          <div className="card animate-fade-in-up text-center">
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
            <h2 className="mt-6 font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planner_onboarding.step5_title")}
            </h2>
            <p className="mt-3 text-sm text-umber-600 dark:text-umber-300">
              {t("planner_onboarding.step5_body")}
            </p>
            <button
              type="button"
              className="btn-primary btn-lg mt-8 w-full"
              onClick={() => void handleFinish()}
            >
              {t("planner_onboarding.step5_cta")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
