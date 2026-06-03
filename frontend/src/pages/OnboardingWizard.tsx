// 5-step wizard. Wedding planning starts uncertain — couples often have a
// season ("Summer 2027") rather than a date, a guest range rather than a
// number, and a vague budget. Each step lets them pick how certain they are
// (the "kind") and only asks the fields that match. The final step
// commits the wedding country so we can offer country-aware supplier
// suggestions from day one.

import type {
  BudgetGoal,
  BudgetKind,
  Couple,
  Currency,
  GuestCountGoal,
  GuestCountKind,
  WeddingDateGoal,
  WeddingDateKind,
  WeddingSeason,
} from "@shared/types";
import { CURRENCIES } from "@shared/types";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CountryCombobox } from "../components/CountryCombobox";
import { Shell } from "../components/Shell";
import { Skeleton } from "../components/ui";
import { coupleApi } from "../lib/endpoints";
import {
  currencySymbol,
  formatBudgetGoal,
  formatGuestCountGoal,
  formatMoney,
  formatMoneyRange,
  formatNumber,
  formatWeddingDateGoal,
  todayIso,
} from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const DRAFT_KEY = "weddly.onboarding_draft";

const SEASONS: WeddingSeason[] = ["spring", "summer", "fall", "winter"];

// Sensible starting range per currency. HUF defaults to a typical Hungarian
// wedding (4-6M Ft, ~€10-15k); EUR/USD use the rough conversion so switching
// the unit re-bases the values instead of leaving "6 000 000 €" in the box.
const BUDGET_DEFAULTS: Record<Currency, { min: string; max: string; placeholder: string }> = {
  HUF: { min: "4000000", max: "6000000", placeholder: "5000000" },
  EUR: { min: "10000", max: "15000", placeholder: "12000" },
  USD: { min: "12000", max: "18000", placeholder: "15000" },
};

const TODAY = new Date();
const MIN_YEAR = TODAY.getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => MIN_YEAR + i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

interface FormState {
  bride_name: string;
  groom_name: string;
  date_kind: WeddingDateKind;
  date_exact: string;
  date_year: string;
  date_month: string;
  date_season: WeddingSeason;
  guest_kind: GuestCountKind;
  guest_exact: string;
  guest_min: string;
  guest_max: string;
  budget_kind: BudgetKind;
  budget_exact: string;
  budget_min: string;
  budget_max: string;
  /** Picked on step 4 next to the budget inputs. Stored verbatim on the
   *  couple via the onboard call; flips every money field after onboarding. */
  currency: Currency;
  /** ISO 3166-1 alpha-2 country code where the wedding will be held.
   *  Picked on step 5 (country); empty string until the user commits a
   *  pick. Drives supplier region filtering after onboarding. */
  country: string;
}

const TOTAL_STEPS = 5;

const DEFAULT_FORM: FormState = {
  bride_name: "",
  groom_name: "",
  date_kind: "season",
  date_exact: "",
  date_year: String(MIN_YEAR + 1),
  date_month: "6",
  date_season: "summer",
  guest_kind: "range",
  guest_exact: "",
  guest_min: "60",
  guest_max: "100",
  budget_kind: "range",
  budget_exact: "",
  budget_min: BUDGET_DEFAULTS.HUF.min,
  budget_max: BUDGET_DEFAULTS.HUF.max,
  currency: "HUF",
  country: "",
};

function buildDateGoal(f: FormState): WeddingDateGoal {
  const year = Number(f.date_year);
  const month = Number(f.date_month);
  if (f.date_kind === "tbd") {
    return {
      kind: "tbd",
      exact_date: null,
      target_year: null,
      target_month: null,
      target_season: null,
    };
  }
  if (f.date_kind === "exact" && f.date_exact) {
    return {
      kind: "exact",
      exact_date: f.date_exact,
      target_year: Number(f.date_exact.slice(0, 4)),
      target_month: Number(f.date_exact.slice(5, 7)),
      target_season: null,
    };
  }
  if (f.date_kind === "month") {
    return {
      kind: "month",
      exact_date: null,
      target_year: year,
      target_month: month,
      target_season: null,
    };
  }
  if (f.date_kind === "season") {
    return {
      kind: "season",
      exact_date: null,
      target_year: year,
      target_month: null,
      target_season: f.date_season,
    };
  }
  return {
    kind: "year",
    exact_date: null,
    target_year: year,
    target_month: null,
    target_season: null,
  };
}

function buildGuestGoal(f: FormState): GuestCountGoal {
  if (f.guest_kind === "tbd") return { kind: "tbd", exact: null, min: null, max: null };
  if (f.guest_kind === "exact") {
    const n = Number(f.guest_exact);
    return {
      kind: "exact",
      exact: Number.isFinite(n) ? Math.round(n) : null,
      min: null,
      max: null,
    };
  }
  const min = Number(f.guest_min);
  const max = Number(f.guest_max);
  return {
    kind: "range",
    exact: null,
    min: Number.isFinite(min) ? Math.round(min) : null,
    max: Number.isFinite(max) ? Math.round(max) : null,
  };
}

function buildBudgetGoal(f: FormState): BudgetGoal {
  if (f.budget_kind === "tbd")
    return { kind: "tbd", exact_huf: null, min_huf: null, max_huf: null };
  if (f.budget_kind === "exact") {
    const n = Number(f.budget_exact);
    return {
      kind: "exact",
      exact_huf: Number.isFinite(n) ? Math.round(n) : null,
      min_huf: null,
      max_huf: null,
    };
  }
  const min = Number(f.budget_min);
  const max = Number(f.budget_max);
  return {
    kind: "range",
    exact_huf: null,
    min_huf: Number.isFinite(min) ? Math.round(min) : null,
    max_huf: Number.isFinite(max) ? Math.round(max) : null,
  };
}

/** Strip everything that isn't a digit. Used when typing into a grouped
 *  number input — we store the raw digits, format on display. */
function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/** Display a digit-only string with thousand separators per locale. Empty
 *  string passes through so the input can be cleared while editing. */
function formatGroupedDigits(raw: string, locale: "hu" | "en"): string {
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatNumber(n, locale);
}

function isStepValid(step: number, f: FormState): boolean {
  if (step === 0) return f.bride_name.trim().length > 0 && f.groom_name.trim().length > 0;
  if (step === 1) {
    const goal = buildDateGoal(f);
    if (goal.kind === "exact") return !!goal.exact_date;
    if (goal.kind === "month") return !!goal.target_year && !!goal.target_month;
    if (goal.kind === "season") return !!goal.target_year && !!goal.target_season;
    if (goal.kind === "year") return !!goal.target_year;
    return true;
  }
  if (step === 2) {
    const g = buildGuestGoal(f);
    if (g.kind === "exact") return g.exact !== null && g.exact > 0;
    if (g.kind === "range") return g.min !== null && g.max !== null && g.min > 0 && g.min <= g.max;
    return true;
  }
  if (step === 3) {
    const b = buildBudgetGoal(f);
    if (b.kind === "exact") return b.exact_huf !== null && b.exact_huf > 0;
    if (b.kind === "range")
      return b.min_huf !== null && b.max_huf !== null && b.min_huf > 0 && b.min_huf <= b.max_huf;
    return true;
  }
  // Step 4 (the 5th, country): a known ISO code must be picked before
  // the visitor can finish onboarding. Combobox commits the code only on
  // an explicit pick, so an empty string here means "no commit yet".
  if (step === 4) {
    return f.country.length === 2;
  }
  return true;
}

function loadDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    // Merge over defaults so stale drafts that miss newer fields still load.
    return { ...DEFAULT_FORM, ...parsed };
  } catch {
    return null;
  }
}

function saveDraft(form: FormState) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    // ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export default function OnboardingWizard() {
  const { t, locale } = useT();
  useDocumentMeta("seo.onboarding_title", "seo.onboarding_description");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Set once the onboard call succeeds. We deliberately swap the wizard for a
  // standalone "All set" confirmation rather than navigating to /app straight
  // away — couples wanted a beat to land the milestone before the dashboard.
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => loadDraft() ?? DEFAULT_FORM);
  // `null` = still loading, `false` = no couple (show wizard),
  // `Couple` = workspace already exists (show welcome card instead).
  // Partner B lands on /onboarding when they accept an invite but the
  // dashboard route bounces them here (no couple at first paint); a stale
  // session can also drop a returning user here. In either case we must
  // not re-render the wizard — it would offer to overwrite partner A's data.
  const [existing, setExisting] = useState<Couple | null | false>(null);
  // Once we've completed onboarding we strip the draft; this guards a
  // late autosave from re-creating it after a successful submit.
  const completedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await coupleApi.current();
        if (cancelled) return;
        setExisting(r.couple ?? false);
      } catch {
        if (!cancelled) setExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (completedRef.current) return;
    saveDraft(form);
  }, [form]);

  // Email verification is enforced one level up by `RequireAuth` in App.tsx,
  // so by the time we render here we know `user.verified_email` is true.

  // Wait for the couple lookup before rendering anything — flashing the
  // wizard for a partner-B user who already has a workspace would be
  // worse than a blank moment.
  if (existing === null) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl">
          <div className="card">
            <Skeleton variant="block" width={200} height={32} rounded="md" />
            <Skeleton variant="line" height={12} width="65%" className="mt-3" />
            <div className="mt-8 flex flex-col gap-5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton variant="line" height={10} width="35%" />
                  <Skeleton variant="block" height={44} rounded="lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // Couple already set up by the other partner: render a read-only welcome
  // card instead of the form. Partner B never gets asked to re-enter data.
  if (existing) {
    return <ExistingCoupleWelcome couple={existing} />;
  }

  // Onboarding committed: celebrate the milestone before handing off to /app.
  if (done) {
    return <AllSet onContinue={() => navigate("/app", { replace: true })} />;
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Switching currency rebases the budget range to that currency's typical
   *  values — "6 000 000 €" would carry over from the HUF default otherwise
   *  and looks absurd. `budget_exact` is left alone so a user who typed a
   *  specific number isn't surprised by it changing, but its placeholder
   *  scales with the unit via BUDGET_DEFAULTS below. */
  function setCurrency(c: Currency) {
    setForm((prev) => ({
      ...prev,
      currency: c,
      budget_min: BUDGET_DEFAULTS[c].min,
      budget_max: BUDGET_DEFAULTS[c].max,
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Guard against a stray submit from steps 0–3. The Next button and the
    // Finish button share the same on-screen position; if the click that
    // fired `setStep(s + 1)` arrives just after the re-render, it lands on
    // the now-submit button and fires this handler from step 4 the moment
    // step 4 paints — the user sees the last step flash for a single frame
    // before navigate() to /app. Also defends against an Enter keypress in
    // an earlier-step input field. Submission only fires on the real final step.
    if (step !== TOTAL_STEPS - 1) return;
    // The Next and Finish buttons share the same on-screen slot, so a stray
    // double-click on step 3's Next can land on Finish the instant step 4
    // paints (country still empty). Refuse to submit an invalid final step —
    // the user stays on the country picker instead of flashing past it.
    if (!isStepValid(TOTAL_STEPS - 1, form)) return;
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await coupleApi.onboard({
        bride_name: form.bride_name.trim(),
        groom_name: form.groom_name.trim(),
        wedding_date_goal: buildDateGoal(form),
        guest_count_goal: buildGuestGoal(form),
        budget_goal: buildBudgetGoal(form),
        currency: form.currency,
        country: form.country,
        // Style tags are no longer collected in onboarding — the field stays
        // on the model so users can set it later from Profile, but ships
        // empty from this flow.
        style_tags: [],
      });
      completedRef.current = true;
      clearDraft();
      setDone(true);
    } catch (err) {
      setError(t("common.error_generic"));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const stepValid = isStepValid(step, form);

  return (
    <Shell>
      <form className="mx-auto max-w-xl" onSubmit={onSubmit}>
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-umber-600">
            {step + 1} / {TOTAL_STEPS} — {t(`onboarding.step${step + 1}_short`)}
          </p>
          <div className="mt-2 h-1 w-full rounded-full bg-paper-300">
            <div
              className="h-1 rounded-full bg-umber-800 transition-all"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        <div className="card animate-fade-in-up">
          {step === 0 && (
            <>
              <h1 className="font-grotesk text-umber-900 dark:text-paper-50">
                {t("onboarding.step1_title")}
              </h1>
              <p className="mt-2 text-sm text-umber-700">{t("onboarding.step1_help")}</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="bride_name" className="field-label">
                    {t("onboarding.bride_name_label")}
                  </label>
                  <input
                    id="bride_name"
                    className="input"
                    value={form.bride_name}
                    onChange={(e) => update("bride_name", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="groom_name" className="field-label">
                    {t("onboarding.groom_name_label")}
                  </label>
                  <input
                    id="groom_name"
                    className="input"
                    value={form.groom_name}
                    onChange={(e) => update("groom_name", e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="font-grotesk text-umber-900 dark:text-paper-50">
                {t("onboarding.step2_title")}
              </h1>
              <p className="mt-2 text-sm text-umber-700">{t("onboarding.date_kind_question")}</p>
              <div
                className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"
                role="group"
                aria-label={t("onboarding.date_kind_question")}
              >
                {(["exact", "month", "season", "year", "tbd"] as WeddingDateKind[]).map((k) => (
                  <KindButton
                    key={k}
                    active={form.date_kind === k}
                    onClick={() => update("date_kind", k)}
                    label={t(`onboarding.date_kind_${k}`)}
                  />
                ))}
              </div>

              {form.date_kind === "exact" && (
                <div className="mt-6">
                  <label htmlFor="wedding_date" className="field-label">
                    {t("onboarding.wedding_date_label")}
                  </label>
                  <input
                    id="wedding_date"
                    type="date"
                    min={todayIso()}
                    className="input"
                    value={form.date_exact}
                    onChange={(e) => update("date_exact", e.target.value)}
                  />
                </div>
              )}

              {form.date_kind === "month" && (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <YearSelect value={form.date_year} onChange={(v) => update("date_year", v)} />
                  <MonthSelect
                    value={form.date_month}
                    onChange={(v) => update("date_month", v)}
                    t={t}
                  />
                </div>
              )}

              {form.date_kind === "season" && (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <YearSelect value={form.date_year} onChange={(v) => update("date_year", v)} />
                  <div>
                    <label htmlFor="date_season" className="field-label">
                      {t("onboarding.date_season_label")}
                    </label>
                    <select
                      id="date_season"
                      className="input"
                      value={form.date_season}
                      onChange={(e) => update("date_season", e.target.value as WeddingSeason)}
                    >
                      {SEASONS.map((s) => (
                        <option key={s} value={s}>
                          {t(`season.${s}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {form.date_kind === "year" && (
                <div className="mt-6">
                  <YearSelect value={form.date_year} onChange={(v) => update("date_year", v)} />
                </div>
              )}

              {form.date_kind === "tbd" && (
                <p className="mt-6 rounded-lg bg-paper-200 p-4 text-sm text-umber-700">
                  {t("onboarding.date_kind_help_tbd")}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-grotesk text-umber-900 dark:text-paper-50">
                {t("onboarding.step3_title")}
              </h1>
              <p className="mt-2 text-sm text-umber-700">{t("onboarding.guest_kind_question")}</p>
              <div
                className="mt-4 grid grid-cols-3 gap-2"
                role="group"
                aria-label={t("onboarding.guest_kind_question")}
              >
                {(["exact", "range", "tbd"] as GuestCountKind[]).map((k) => (
                  <KindButton
                    key={k}
                    active={form.guest_kind === k}
                    onClick={() => update("guest_kind", k)}
                    label={t(`onboarding.guest_kind_${k}`)}
                  />
                ))}
              </div>

              {form.guest_kind === "exact" && (
                <div className="mt-6">
                  <label htmlFor="guest_exact" className="field-label">
                    {t("onboarding.target_guest_count_label")}
                  </label>
                  <input
                    id="guest_exact"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10000}
                    className="input"
                    value={form.guest_exact}
                    onChange={(e) => update("guest_exact", e.target.value)}
                    placeholder="80"
                  />
                </div>
              )}

              {form.guest_kind === "range" && (
                <>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="guest_min" className="field-label">
                        {t("onboarding.guest_min_label")}
                      </label>
                      <input
                        id="guest_min"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10000}
                        className="input"
                        value={form.guest_min}
                        onChange={(e) => update("guest_min", e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="guest_max" className="field-label">
                        {t("onboarding.guest_max_label")}
                      </label>
                      <input
                        id="guest_max"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10000}
                        className="input"
                        value={form.guest_max}
                        onChange={(e) => update("guest_max", e.target.value)}
                      />
                    </div>
                  </div>
                  {Number(form.guest_min) > 0 &&
                    Number(form.guest_max) >= Number(form.guest_min) && (
                      <p className="mt-3 text-sm text-umber-600">
                        {t("goal.count_range", {
                          min: formatNumber(Number(form.guest_min), locale),
                          max: formatNumber(Number(form.guest_max), locale),
                        })}
                      </p>
                    )}
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-grotesk text-umber-900 dark:text-paper-50">
                {t("onboarding.step4_title")}
              </h1>
              <p className="mt-2 text-sm text-umber-700">{t("onboarding.budget_help")}</p>
              {/* Currency picker — pinned above the budget inputs so the user
               *  picks the unit before typing an amount. Defaults to HUF; flips
               *  the preview formatting (and every money field after onboarding). */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-umber-600">
                  {t("onboarding.budget_currency_label")}
                </span>
                <div
                  role="radiogroup"
                  aria-label={t("onboarding.budget_currency_label")}
                  className="inline-flex overflow-hidden rounded-full border border-umber-200"
                >
                  {CURRENCIES.map((c) => {
                    const active = c === form.currency;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setCurrency(c)}
                        className={`min-h-[44px] px-3 py-2 text-sm font-medium transition-colors sm:min-h-0 sm:py-1 sm:text-xs ${
                          active
                            ? "bg-umber-900 text-paper-50"
                            : "bg-paper-50 text-umber-700 hover:bg-paper-100"
                        }`}
                      >
                        {t(`onboarding.budget_currency_${c.toLowerCase()}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="mt-4 text-sm text-umber-700">{t("onboarding.budget_kind_question")}</p>
              <div
                className="mt-3 grid grid-cols-3 gap-2"
                role="group"
                aria-label={t("onboarding.budget_kind_question")}
              >
                {(["exact", "range", "tbd"] as BudgetKind[]).map((k) => (
                  <KindButton
                    key={k}
                    active={form.budget_kind === k}
                    onClick={() => update("budget_kind", k)}
                    label={t(`onboarding.budget_kind_${k}`)}
                  />
                ))}
              </div>

              {form.budget_kind === "exact" && (
                <div className="mt-6">
                  <label htmlFor="budget_exact" className="field-label">
                    {t("onboarding.budget_label")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="budget_exact"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className="input flex-1"
                      value={formatGroupedDigits(form.budget_exact, locale)}
                      onChange={(e) => update("budget_exact", digitsOnly(e.target.value))}
                      placeholder={formatGroupedDigits(
                        BUDGET_DEFAULTS[form.currency].placeholder,
                        locale,
                      )}
                    />
                    <span className="text-sm text-umber-600">
                      {currencySymbol(form.currency, locale)}
                    </span>
                  </div>
                  {Number(form.budget_exact) > 0 && (
                    <p className="mt-2 text-sm text-umber-600">
                      {t("onboarding.budget_preview_label")}{" "}
                      <span className="font-medium text-umber-800">
                        {formatMoney(Number(form.budget_exact), form.currency, locale)}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {form.budget_kind === "range" && (
                <>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="budget_min" className="field-label">
                        {t("onboarding.budget_min_label")}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="budget_min"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className="input flex-1"
                          value={formatGroupedDigits(form.budget_min, locale)}
                          onChange={(e) => update("budget_min", digitsOnly(e.target.value))}
                        />
                        <span className="text-sm text-umber-600">
                          {currencySymbol(form.currency, locale)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="budget_max" className="field-label">
                        {t("onboarding.budget_max_label")}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="budget_max"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className="input flex-1"
                          value={formatGroupedDigits(form.budget_max, locale)}
                          onChange={(e) => update("budget_max", digitsOnly(e.target.value))}
                        />
                        <span className="text-sm text-umber-600">
                          {currencySymbol(form.currency, locale)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {Number(form.budget_min) > 0 &&
                    Number(form.budget_max) >= Number(form.budget_min) && (
                      <p className="mt-3 text-sm text-umber-600">
                        {t("onboarding.budget_preview_label")}{" "}
                        <span className="font-medium text-umber-800">
                          {formatMoneyRange(
                            Number(form.budget_min),
                            Number(form.budget_max),
                            form.currency,
                            locale,
                          )}
                        </span>
                      </p>
                    )}
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="font-grotesk text-umber-900 dark:text-paper-50">
                {t("onboarding.step5_title")}
              </h1>
              <p className="mt-2 text-sm text-umber-700">{t("onboarding.country_helper")}</p>
              <div className="mt-6">
                <CountryCombobox
                  value={form.country}
                  onChange={(code) => update("country", code)}
                  label={t("onboarding.country_label")}
                  placeholder={t("onboarding.country_placeholder")}
                  required
                />
              </div>
            </>
          )}

          {error && (
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blush-200 bg-blush-50 px-3 py-2 text-sm text-blush-900"
              role="alert"
            >
              <p className="flex-1">{t("onboarding.submit_failed")}</p>
              <button type="submit" className="btn-outline btn-sm" disabled={submitting}>
                {submitting ? t("onboarding.saving") : t("onboarding.submit_retry")}
              </button>
            </div>
          )}

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
              <button
                type="submit"
                className="btn-accent btn-lg"
                disabled={submitting || !stepValid}
              >
                {submitting ? t("onboarding.saving") : t("onboarding.finish")}
              </button>
            )}
          </div>
        </div>
      </form>
    </Shell>
  );
}

/** Confetti palette — warm coffee/blush + a green to echo the success check
 *  and a single lemon pop. Full Tailwind class strings so the scanner keeps
 *  them (no raw hex in components). */
const CONFETTI_COLORS = [
  "bg-blush-400",
  "bg-blush-500",
  "bg-sage-400",
  "bg-sage-300",
  "bg-umber-300",
  "bg-lemonade-yellow",
];

/** A one-shot confetti burst that rains down inside the success card. Pieces
 *  are generated once (useMemo) with randomised position, colour, shape and
 *  motion; the fall/spin/fade is driven by the `.confetti-piece` keyframe in
 *  index.css, which is disabled under prefers-reduced-motion. Decorative only
 *  (aria-hidden, pointer-events-none) so it never blocks the CTA. */
function Confetti() {
  const pieces = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const round = Math.random() < 0.4;
      const w = 5 + Math.random() * 6;
      return {
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round,
        style: {
          left: `${Math.random() * 100}%`,
          width: `${w}px`,
          height: round ? `${w}px` : `${w * 1.8}px`,
          "--cf-drift": `${(Math.random() - 0.5) * 180}px`,
          "--cf-spin": `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720)}deg`,
          "--cf-fall": `${380 + Math.random() * 180}px`,
          "--cf-duration": `${2.4 + Math.random() * 1.8}s`,
          "--cf-delay": `${Math.random() * 0.8}s`,
        } as CSSProperties,
      };
    });
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti-piece absolute top-0 ${p.round ? "rounded-full" : "rounded-[1px]"} ${p.color}`}
          style={p.style}
        />
      ))}
    </div>
  );
}

/**
 * Final confirmation shown once onboarding commits. A green check inside a
 * circle lands the "you're done" beat; the button hands off to the dashboard.
 */
function AllSet({ onContinue }: { onContinue: () => void }) {
  const { t } = useT();
  // Auto-hand off to the dashboard after a 7s countdown (the runner fill on the
  // CTA visualises it). Fires once on mount; clicking the button short-circuits
  // it, and unmounting (e.g. the redirect itself) clears the timer. A ref keeps
  // the latest onContinue without restarting the countdown on re-render.
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;
  useEffect(() => {
    const id = window.setTimeout(() => continueRef.current(), 7000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <div className="card animate-fade-in-up relative overflow-hidden text-center">
          <Confetti />
          <div className="relative z-10">
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
            <h1 className="mt-6 font-grotesk text-umber-900 dark:text-paper-50">
              {t("onboarding.all_set_title")}
            </h1>
            <button
              type="button"
              className="btn-primary btn-landing btn-lg relative mt-8 w-full overflow-hidden"
              onClick={onContinue}
            >
              {/* Countdown fill — sweeps left → right over 7s, then the timer
                  above redirects. Behind the label, decorative only. */}
              <span
                aria-hidden
                className="btn-runner pointer-events-none absolute inset-y-0 left-0 bg-paper-50/15"
              />
              <span className="relative z-10">{t("onboarding.all_set_continue")}</span>
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function KindButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "min-h-tap rounded-lg border px-3 py-2 text-sm transition",
        active
          ? "border-umber-800 bg-umber-800 text-paper-100"
          : "border-paper-400 bg-paper-100 text-umber-800 hover:border-umber-600",
      ].join(" ")}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function YearSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  return (
    <div>
      <label htmlFor="date_year" className="field-label">
        {t("onboarding.date_year_label")}
      </label>
      <select
        id="date_year"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {YEAR_OPTIONS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

function MonthSelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div>
      <label htmlFor="date_month" className="field-label">
        {t("onboarding.date_month_label")}
      </label>
      <select
        id="date_month"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {MONTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {t(`month.${m}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Read-only welcome card shown when the couple workspace is already set up
 * (partner B accepted an invite, or a returning partner A lands here). The
 * wizard never overwrites existing data — partner B sees what's in place and
 * heads straight to the dashboard.
 */
function ExistingCoupleWelcome({ couple }: { couple: Couple }) {
  const { t, locale } = useT();
  const goalCtx = { t, locale };
  const dateText = formatWeddingDateGoal(couple.wedding_date_goal, goalCtx);
  const guestText = formatGuestCountGoal(couple.guest_count_goal, goalCtx);
  const budgetText = formatBudgetGoal(couple.budget_goal, goalCtx, couple.currency ?? "HUF");
  const styleText =
    couple.style_tags.length > 0
      ? couple.style_tags.map((tag) => t(`onboarding.style_${tag}`)).join(", ")
      : null;

  // Guests / budget / optional style live in a flat strip below the hero date.
  // Date earns the spotlight because partner B is most likely scanning for "when".
  const supportingFacts: Array<{ label: string; value: string }> = [
    { label: t("onboarding.welcome_existing_guests_label"), value: guestText },
    { label: t("onboarding.welcome_existing_budget_label"), value: budgetText },
  ];
  if (styleText) {
    supportingFacts.push({
      label: t("onboarding.welcome_existing_style_label"),
      value: styleText,
    });
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <div className="card animate-fade-in-up">
          <p className="eyebrow">{t("onboarding.welcome_existing_eyebrow")}</p>
          <h1 className="mt-2 break-words hyphens-auto font-grotesk font-semibold tracking-tight text-4xl sm:text-5xl leading-[1.05] text-umber-900 dark:text-paper-50">
            {t("onboarding.welcome_existing_title", { names: couple.display_name })}
          </h1>
          <div className="mt-5 h-px w-full bg-paper-300 dark:bg-umber-700" />
          <p className="mt-5 text-umber-700 dark:text-umber-200">
            {t("onboarding.welcome_existing_body")}
          </p>

          <div className="mt-7">
            <p className="eyebrow">{t("onboarding.welcome_existing_date_label")}</p>
            <p className="mt-1 font-grotesk font-semibold tracking-tight text-3xl sm:text-4xl text-umber-900 dark:text-paper-50">
              {dateText}
            </p>
          </div>

          <dl className="mt-6 divide-y divide-paper-300 border-t border-paper-300 dark:divide-umber-700 dark:border-umber-700">
            {supportingFacts.map((f) => (
              <Fact key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-umber-600 dark:text-umber-300">
              {t("onboarding.welcome_existing_edit_hint")}
            </p>
            <Link to="/app" replace className="btn-accent btn-lg w-full sm:w-auto sm:min-w-[16rem]">
              {t("onboarding.welcome_existing_continue")}
            </Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 first:pt-3 last:pb-0">
      <dt className="field-label !mb-0">{label}</dt>
      <dd className="text-right font-medium text-umber-900 dark:text-paper-100">{value}</dd>
    </div>
  );
}
