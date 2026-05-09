// 5-step wizard: name → date → guests → budget → style. State is local until
// the final submit; one POST creates the couple + seeds budget lines.

import type { WeddingStyleTag } from "@shared/types";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useT } from "../lib/i18n";
import { coupleApi } from "../lib/endpoints";

const STYLE_TAGS: WeddingStyleTag[] = [
  "classic",
  "modern",
  "rustic",
  "garden",
  "bohemian",
  "minimalist",
  "vintage",
  "destination",
];

interface FormState {
  display_name: string;
  wedding_date: string;
  target_guest_count: string;
  budget_ceiling_huf: string;
  style_tags: WeddingStyleTag[];
}

const TOTAL_STEPS = 5;

export default function OnboardingWizard() {
  const { t } = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    display_name: "",
    wedding_date: "",
    target_guest_count: "",
    budget_ceiling_huf: "",
    style_tags: [],
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleTag(tag: WeddingStyleTag) {
    setForm((prev) => ({
      ...prev,
      style_tags: prev.style_tags.includes(tag)
        ? prev.style_tags.filter((x) => x !== tag)
        : [...prev.style_tags, tag],
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await coupleApi.onboard({
        display_name: form.display_name.trim(),
        wedding_date: form.wedding_date || null,
        target_guest_count: form.target_guest_count ? Number(form.target_guest_count) : null,
        budget_ceiling_huf: form.budget_ceiling_huf ? Number(form.budget_ceiling_huf) : null,
        style_tags: form.style_tags,
      });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(t("common.error_generic"));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const stepValid = (() => {
    switch (step) {
      case 0:
        return form.display_name.trim().length > 0;
      default:
        return true;
    }
  })();

  return (
    <Shell>
      <form className="mx-auto max-w-xl" onSubmit={onSubmit}>
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-ink-500">
            {step + 1} / {TOTAL_STEPS}
          </p>
          <div className="mt-2 h-1 w-full rounded-full bg-paper-300">
            <div
              className="h-1 rounded-full bg-ink-700 transition-all"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        <div className="card animate-fade-in-up">
          {step === 0 && (
            <>
              <h1>{t("onboarding.step1_title")}</h1>
              <p className="mt-2 text-sm text-ink-600">{t("onboarding.step1_help")}</p>
              <div className="mt-6">
                <label htmlFor="display_name" className="field-label">
                  {t("onboarding.display_name_label")}
                </label>
                <input
                  id="display_name"
                  className="input"
                  value={form.display_name}
                  onChange={(e) => update("display_name", e.target.value)}
                  placeholder="Anna & Bence"
                  autoFocus
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1>{t("onboarding.step2_title")}</h1>
              <div className="mt-6">
                <label htmlFor="wedding_date" className="field-label">
                  {t("onboarding.wedding_date_label")}{" "}
                  <span className="text-ink-400 lowercase">({t("common.optional")})</span>
                </label>
                <input
                  id="wedding_date"
                  type="date"
                  className="input"
                  value={form.wedding_date}
                  onChange={(e) => update("wedding_date", e.target.value)}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>{t("onboarding.step3_title")}</h1>
              <div className="mt-6">
                <label htmlFor="guests" className="field-label">
                  {t("onboarding.target_guest_count_label")}{" "}
                  <span className="text-ink-400 lowercase">({t("common.optional")})</span>
                </label>
                <input
                  id="guests"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  className="input"
                  value={form.target_guest_count}
                  onChange={(e) => update("target_guest_count", e.target.value)}
                  placeholder="80"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>{t("onboarding.step4_title")}</h1>
              <p className="mt-2 text-sm text-ink-600">{t("onboarding.budget_help")}</p>
              <div className="mt-6">
                <label htmlFor="budget" className="field-label">
                  {t("onboarding.budget_label")}{" "}
                  <span className="text-ink-400 lowercase">({t("common.optional")})</span>
                </label>
                <input
                  id="budget"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={50_000}
                  className="input"
                  value={form.budget_ceiling_huf}
                  onChange={(e) => update("budget_ceiling_huf", e.target.value)}
                  placeholder="5000000"
                />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1>{t("onboarding.step5_title")}</h1>
              <p className="mt-2 text-sm text-ink-600">{t("onboarding.style_help")}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {STYLE_TAGS.map((tag) => {
                  const active = form.style_tags.includes(tag);
                  return (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={
                        active
                          ? "rounded-full border-2 border-ink-700 bg-ink-700 px-4 py-1.5 text-sm font-medium text-paper-100"
                          : "rounded-full border border-paper-300 bg-paper-50 px-4 py-1.5 text-sm text-ink-700 hover:border-ink-400"
                      }
                    >
                      {t(`onboarding.style_${tag}`)}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && <p className="field-error mt-4">{error}</p>}

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              {t("common.back")}
            </button>
            {step < TOTAL_STEPS - 1 ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!stepValid}
                onClick={() => setStep((s) => s + 1)}
              >
                {t("common.next")}
              </button>
            ) : (
              <button type="submit" className="btn-accent btn-lg" disabled={submitting}>
                {submitting ? t("onboarding.saving") : t("onboarding.finish")}
              </button>
            )}
          </div>
        </div>
      </form>
    </Shell>
  );
}
