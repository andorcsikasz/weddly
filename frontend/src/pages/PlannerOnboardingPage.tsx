import { Fragment, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { Wordmark } from "../components/Wordmark";
import { useAuth } from "../lib/auth";
import { plannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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

  const [step, setStep] = useState(0);
  const [activePlan, setActivePlan] = useState<string>("starter");

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [bio, setBio] = useState("");

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [clientEmail, setClientEmail] = useState("");
  const [clientStatus, setClientStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [clientError, setClientError] = useState("");

  useEffect(() => {
    plannerApi.stats().then((s) => setActivePlan(s.stats.plan)).catch(() => {});

    plannerApi.getProfile().then((profile) => {
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
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.full_name && !fullName) setFullName(user.full_name);
  }, [user, fullName]);

  const firstName = (user?.full_name ?? "").split(" ")[0] ?? "";

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
      } as Parameters<typeof plannerApi.updateProfile>[0]);
      setStep(2);
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
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        {step > 0 && step < TOTAL_STEPS - 1 && (
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

        {/* ── Step 1: Profile ── */}
        {step === 1 && (
          <div className="card animate-fade-in-up">
            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("planner_onboarding.step2_title")}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t("planner_onboarding.step2_body")}
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
                  {t("planner_onboarding.city_label")}{" "}
                  <span className="text-blush-600">*</span>
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

              {profileError && (
                <p className="text-sm text-blush-700 dark:text-blush-300" role="alert">
                  {profileError}
                </p>
              )}
            </div>

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
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => void handleFinish()}
                  >
                    {t("planner_onboarding.skip")}
                  </button>
                )}
                {clientStatus === "ok" && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleFinish()}
                  >
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
