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
import { scaleFromEur } from "@shared/currency";
import { checkRealName } from "@shared/real_names";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Confetti } from "../components/Confetti";
import { CurrencySelect } from "../components/CurrencySelect";
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
  isPlausibleDateIso,
  todayIso,
} from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { placeholderNameField, realNameErrorKey } from "../lib/real_names";
import { useDocumentMeta } from "../lib/seo";

const DRAFT_KEY = "weddly.onboarding_draft";

const SEASONS: WeddingSeason[] = ["spring", "summer", "fall", "winter"];

// Sensible starting range per currency. HUF defaults to a typical Hungarian
// wedding (4-6M Ft, ~€10-15k); EUR/USD use the rough conversion so switching
// the unit re-bases the values instead of leaving "6 000 000 €" in the box.
// These three are hand-tuned; the rest scale off the EUR row (see
// `budgetDefaults`) so every currency in the picker re-bases the same way.
type BudgetDefaults = { min: string; max: string; placeholder: string };
const TUNED_BUDGET_DEFAULTS: Partial<Record<Currency, BudgetDefaults>> = {
  HUF: { min: "4000000", max: "6000000", placeholder: "5000000" },
  EUR: { min: "10000", max: "15000", placeholder: "12000" },
  USD: { min: "12000", max: "18000", placeholder: "15000" },
};
const EUR_BUDGET_DEFAULTS = TUNED_BUDGET_DEFAULTS.EUR!;

function budgetDefaults(currency: Currency): BudgetDefaults {
  const tuned = TUNED_BUDGET_DEFAULTS[currency];
  if (tuned) return tuned;
  const scale = (eur: string) => String(scaleFromEur(Number(eur), currency));
  return {
    min: scale(EUR_BUDGET_DEFAULTS.min),
    max: scale(EUR_BUDGET_DEFAULTS.max),
    placeholder: scale(EUR_BUDGET_DEFAULTS.placeholder),
  };
}

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
  /** Optional: the other half's email. Filled on the last (optional) step; when
   *  present, an invite to this workspace is sent the moment onboarding
   *  completes. Empty = skip. */
  partner_email: string;
}

const TOTAL_STEPS = 6;

/** Loose email shape — enough to gate the invite (the server validates for
 *  real). Empty is allowed: the invite step is optional. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function partnerEmailValid(f: FormState): boolean {
  const v = f.partner_email.trim();
  return v === "" || EMAIL_RE.test(v);
}

// One oversized, tightly-tracked headline for every step. General Sans is
// self-hosted at 600 max (no 700 woff2), so "bold" here is size + tight
// tracking, not weight — a heavier request would render as faux-bold. The
// question carries the step; the sub-questions that used to sit beneath it
// are gone (the segmented control answers them).
const STEP_TITLE =
  "font-grotesk text-[2rem] leading-[1.05] tracking-tight sm:text-[2.75rem] sm:leading-[1.03] text-umber-900 dark:text-paper-50";

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
  budget_min: TUNED_BUDGET_DEFAULTS.HUF!.min,
  budget_max: TUNED_BUDGET_DEFAULTS.HUF!.max,
  currency: "HUF",
  country: "",
  partner_email: "",
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
function formatGroupedDigits(raw: string, locale: Locale): string {
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatNumber(n, locale);
}

function isStepValid(step: number, f: FormState): boolean {
  if (step === 0) {
    // Non-empty is what enables the button; whether the names are REAL is
    // checked on the click instead (see `advance`), so the couple gets an
    // explanation rather than a button that silently refuses to work.
    return f.bride_name.trim().length > 0 && f.groom_name.trim().length > 0;
  }
  if (step === 1) {
    const goal = buildDateGoal(f);
    // Only a real, fully-typed future day counts. `isPlausibleDateIso` rejects
    // a half-typed year ("2" → "0002-01-01"); the `>= todayIso()` guard then
    // rejects a complete-but-past date.
    if (goal.kind === "exact")
      return (
        goal.exact_date !== null &&
        isPlausibleDateIso(goal.exact_date) &&
        goal.exact_date >= todayIso()
      );
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
  // Step 5 (the 6th, invite your other half): optional. Finish is enabled when
  // the field is empty OR holds a plausible email — never on a half-typed one.
  if (step === 5) {
    return partnerEmailValid(f);
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
  // Which of the two name fields has been shown its "that isn't a name" line.
  // Set on blur and on a refused Continue, never while the first letters are
  // still being typed: "A" is not yet a failed attempt at "Anna".
  const [nameErrorsShown, setNameErrorsShown] = useState(false);
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
   *  scales with the unit via budgetDefaults() above. */
  function setCurrency(c: Currency) {
    setForm((prev) => ({
      ...prev,
      currency: c,
      budget_min: budgetDefaults(c).min,
      budget_max: budgetDefaults(c).max,
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
      let pendingRefCode: string | undefined;
      try {
        const stored = localStorage.getItem("weddly.pending_ref_code");
        if (stored) {
          pendingRefCode = stored;
          localStorage.removeItem("weddly.pending_ref_code");
        }
      } catch {
        // localStorage blocked — proceed without referral
      }
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
        ref_code: pendingRefCode,
      });
      // Optional: invite the other half straight into the fresh workspace. The
      // couple now exists, so the invite endpoint resolves it off the session.
      // Best-effort — a failure here (e.g. the email already has an account)
      // must NOT block onboarding; the couple can still invite from the app.
      const partnerEmail = form.partner_email.trim();
      if (partnerEmail && EMAIL_RE.test(partnerEmail)) {
        try {
          await coupleApi.createInvite({ invited_email: partnerEmail });
        } catch (inviteErr) {
          console.error("partner invite failed", inviteErr);
        }
      }
      completedRef.current = true;
      clearDraft();
      setDone(true);
    } catch (err) {
      // The server runs the same name rule. If it refused on that, walk the
      // couple back to the field rather than leaving "something went wrong" on
      // the last step of a wizard they can't get out of.
      if (placeholderNameField(err) !== null) {
        setNameErrorsShown(true);
        setStep(0);
        setError(null);
      } else {
        setError(t("common.error_generic"));
      }
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const stepValid = isStepValid(step, form);

  // Placeholder-name verdicts for the two step-0 fields. Computed every render
  // from the SAME shared rule the server enforces, so the wizard can never
  // wave through something the POST is about to refuse.
  const brideVerdict = checkRealName(form.bride_name);
  const groomVerdict = checkRealName(form.groom_name);
  const namesAreReal = form.bride_name.trim() !== "" && !brideVerdict && !groomVerdict;

  /** Step 0's Continue. Refuses with an explanation rather than advancing into
   *  a wizard the couple would only be thrown out of at the final POST. */
  function advance() {
    if (step === 0 && !namesAreReal) {
      setNameErrorsShown(true);
      return;
    }
    setStep((s) => s + 1);
  }

  // The exact-date field is "invalid" once it holds a value that isn't a
  // real future day — a half-typed year ("2") or a past date. Drives the
  // inline error + aria-invalid on step 2.
  const dateExactInvalid =
    form.date_kind === "exact" &&
    form.date_exact !== "" &&
    !(isPlausibleDateIso(form.date_exact) && form.date_exact >= todayIso());

  return (
    <Shell>
      <form className="mx-auto max-w-xl" onSubmit={onSubmit}>
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-umber-600">
            {step + 1} / {TOTAL_STEPS} · {t(`onboarding.step${step + 1}_short`)}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-paper-300">
            <div
              className="h-1.5 rounded-full bg-umber-900 transition-all"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        <div className="card animate-fade-in-up sm:p-8">
          {step === 0 && (
            <>
              <h1 className={STEP_TITLE}>{t("onboarding.step1_title")}</h1>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="bride_name" className="field-label">
                    {t("onboarding.bride_name_label")}
                  </label>
                  <input
                    id="bride_name"
                    className="input"
                    value={form.bride_name}
                    onChange={(e) => update("bride_name", e.target.value)}
                    onBlur={() => setNameErrorsShown(true)}
                    aria-invalid={nameErrorsShown && brideVerdict !== null}
                    aria-describedby={
                      nameErrorsShown && brideVerdict ? "bride_name_error" : undefined
                    }
                    placeholder={t("onboarding.bride_name_placeholder")}
                  />
                  {nameErrorsShown && brideVerdict && (
                    <p id="bride_name_error" className="mt-1.5 text-sm text-clay-700">
                      {t(realNameErrorKey(brideVerdict.reason))}
                    </p>
                  )}
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
                    onBlur={() => setNameErrorsShown(true)}
                    aria-invalid={nameErrorsShown && groomVerdict !== null}
                    aria-describedby={
                      nameErrorsShown && groomVerdict ? "groom_name_error" : undefined
                    }
                    placeholder={t("onboarding.groom_name_placeholder")}
                  />
                  {nameErrorsShown && groomVerdict && (
                    <p id="groom_name_error" className="mt-1.5 text-sm text-clay-700">
                      {t(realNameErrorKey(groomVerdict.reason))}
                    </p>
                  )}
                </div>
              </div>
              {nameErrorsShown && (brideVerdict || groomVerdict) && (
                <p className="mt-4 text-sm text-ink-500">{t("onboarding.real_names_why")}</p>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h1 className={STEP_TITLE}>{t("onboarding.step2_title")}</h1>
              <div
                className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-5"
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
                    aria-invalid={dateExactInvalid}
                    className="input"
                    value={form.date_exact}
                    onChange={(e) => update("date_exact", e.target.value)}
                  />
                  {dateExactInvalid && (
                    <p className="mt-1 text-xs text-blush-700 dark:text-blush-300" role="alert">
                      {t("onboarding.date_past_error")}
                    </p>
                  )}
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
              <h1 className={STEP_TITLE}>{t("onboarding.step3_title")}</h1>
              <div
                className="mt-8 grid grid-cols-3 gap-2"
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
              <h1 className={STEP_TITLE}>{t("onboarding.step4_title")}</h1>
              {/* Currency picker — pinned above the budget inputs so the user
               *  picks the unit before typing an amount. Defaults to HUF; flips
               *  the preview formatting (and every money field after onboarding). */}
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-umber-600">
                  {t("onboarding.budget_currency_label")}
                </span>
                <CurrencySelect
                  value={form.currency}
                  onChange={setCurrency}
                  label={t("onboarding.budget_currency_label")}
                />
              </div>

              <div
                className="mt-5 grid grid-cols-3 gap-2"
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
                        budgetDefaults(form.currency).placeholder,
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
              <h1 className={STEP_TITLE}>{t("onboarding.step5_title")}</h1>
              <div className="mt-8">
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

          {step === 5 && (
            <>
              <h1 className={STEP_TITLE}>{t("onboarding.step6_title")}</h1>
              <p className="mt-3 text-base text-umber-600 dark:text-umber-300">
                {t("onboarding.invite_help")}
              </p>
              <div className="mt-8">
                <label className="field-label" htmlFor="onb-partner-email">
                  {t("onboarding.invite_email_label")}
                </label>
                <input
                  id="onb-partner-email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t("onboarding.invite_email_placeholder")}
                  value={form.partner_email}
                  onChange={(e) => update("partner_email", e.target.value)}
                  aria-invalid={!partnerEmailValid(form)}
                />
                <p className="mt-2 text-sm text-umber-500 dark:text-umber-400">
                  {t("onboarding.invite_skip_hint")}
                </p>
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
              <button type="button" className="btn-primary" disabled={!stepValid} onClick={advance}>
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

const EXTRA_PRESET_IDS = ["civil", "abroad", "custom"] as const;
type ExtraPresetId = (typeof EXTRA_PRESET_IDS)[number];

interface ExtraDraft {
  name: string;
  date: string; // YYYY-MM-DD or ""
  country: string; // ISO 3166-1 alpha-2; only used by the "abroad" preset
}

function buildDateGoalFromDateStr(dateStr: string): WeddingDateGoal {
  if (dateStr && isPlausibleDateIso(dateStr) && dateStr >= todayIso()) {
    return {
      kind: "exact",
      exact_date: dateStr,
      target_year: Number(dateStr.slice(0, 4)),
      target_month: Number(dateStr.slice(5, 7)),
      target_season: null,
    };
  }
  return {
    kind: "tbd",
    exact_date: null,
    target_year: null,
    target_month: null,
    target_season: null,
  };
}

function AllSet({ onContinue }: { onContinue: () => void }) {
  const { t } = useT();
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;

  // Auto-redirect after 20s; cancelled the moment the user engages with extras.
  // Long enough to read the celebration and decide whether to add another
  // event — 7s fired before the user could take it in and dumped them on the
  // dashboard skeleton mid-thought.
  const timerRef = useRef<number | null>(null);
  const timerCancelledRef = useRef(false);
  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      if (!timerCancelledRef.current) continueRef.current();
    }, 20000);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const [selected, setSelected] = useState<Set<ExtraPresetId>>(new Set());
  const [drafts, setDrafts] = useState<Partial<Record<ExtraPresetId, ExtraDraft>>>({});
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Set<ExtraPresetId>>(new Set());
  const [extrasError, setExtrasError] = useState<string | null>(null);

  function cancelTimer() {
    if (!timerCancelledRef.current) {
      timerCancelledRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    }
  }

  function getDefaultName(id: ExtraPresetId): string {
    if (id === "civil") return t("onboarding.extra_preset_civil");
    if (id === "abroad") return t("onboarding.extra_preset_abroad");
    return "";
  }

  function togglePreset(id: ExtraPresetId) {
    cancelTimer();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setDrafts((d) => {
          const nd = { ...d };
          delete nd[id];
          return nd;
        });
      } else {
        if (next.size >= 2) return prev;
        next.add(id);
        setDrafts((d) => ({ ...d, [id]: { name: getDefaultName(id), date: "", country: "" } }));
      }
      return next;
    });
  }

  function updateDraft(id: ExtraPresetId, field: keyof ExtraDraft, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, [field]: value } }));
  }

  const selectedList = EXTRA_PRESET_IDS.filter((id) => selected.has(id));
  const hasExtras = selectedList.length > 0;
  const canSubmit = selectedList.every((id) => {
    const draft = drafts[id];
    if (!draft || draft.name.trim().length === 0) return false;
    if (id === "abroad" && draft.country.length !== 2) return false;
    return true;
  });

  async function handleCreateExtras() {
    if (!canSubmit || creating) return;
    setCreating(true);
    setExtrasError(null);
    try {
      for (const id of selectedList) {
        if (created.has(id)) continue;
        const draft = drafts[id]!;
        await coupleApi.createAdditional({
          event_name: draft.name.trim(),
          wedding_date_goal: buildDateGoalFromDateStr(draft.date),
          ...(id === "abroad" && draft.country.length === 2 ? { country: draft.country } : {}),
        });
        setCreated((prev) => new Set([...prev, id]));
      }
      continueRef.current();
    } catch {
      setExtrasError(t("common.error_generic"));
      setCreating(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <div className="card animate-fade-in-up relative overflow-hidden text-center">
          <Confetti />
          <div className="relative z-10 flex flex-col items-center">
            {/* ── Celebration hero ─────────────────────────────────────── */}
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-100 ring-2 ring-sage-400 dark:bg-sage-900 dark:ring-sage-600"
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
            <h1 className={`mt-6 ${STEP_TITLE}`}>{t("onboarding.all_set_title")}</h1>

            {/* ── Add another event? (optional, centered) ──────────────── */}
            <div className="mt-8 w-full border-t border-paper-300 pt-7 dark:border-umber-700">
              <p className="text-sm font-semibold text-umber-800 dark:text-paper-100">
                {t("onboarding.extra_events_heading")}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-umber-600 dark:text-umber-300">
                {t("onboarding.extra_events_body")}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXTRA_PRESET_IDS.map((id) => (
                  <KindButton
                    key={id}
                    active={selected.has(id)}
                    onClick={() => togglePreset(id)}
                    label={
                      id === "civil"
                        ? t("onboarding.extra_preset_civil")
                        : id === "abroad"
                          ? t("onboarding.extra_preset_abroad")
                          : t("onboarding.extra_preset_custom")
                    }
                  />
                ))}
              </div>

              {hasExtras && (
                <div className="mt-5 flex flex-col gap-3 text-left">
                  {selectedList.map((id) => {
                    const draft = drafts[id]!;
                    return (
                      <div key={id} className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <input
                            className="input flex-1"
                            value={draft.name}
                            onChange={(e) => updateDraft(id, "name", e.target.value)}
                            placeholder={t("onboarding.extra_event_name_placeholder")}
                            aria-label={t("onboarding.extra_event_name_placeholder")}
                          />
                          <input
                            type="date"
                            className="input w-40"
                            value={draft.date}
                            onChange={(e) => updateDraft(id, "date", e.target.value)}
                            aria-label={t("onboarding.extra_event_date_label")}
                            title={t("onboarding.extra_event_date_label")}
                          />
                        </div>
                        {id === "abroad" && (
                          <CountryCombobox
                            value={draft.country}
                            onChange={(code) => updateDraft(id, "country", code)}
                            label={t("onboarding.country_label")}
                            placeholder={t("onboarding.country_placeholder")}
                            required
                          />
                        )}
                      </div>
                    );
                  })}
                  {extrasError !== null && (
                    <p className="text-sm text-red-600 dark:text-red-400">{extrasError}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Primary action ───────────────────────────────────────── */}
            {hasExtras ? (
              <div className="mt-8 w-full">
                <button
                  type="button"
                  className="btn-accent btn-lg w-full"
                  disabled={!canSubmit || creating}
                  onClick={handleCreateExtras}
                >
                  {creating ? t("onboarding.extra_entering") : t("onboarding.extra_enter_cta")}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full text-sm text-umber-500 transition hover:text-umber-700 dark:text-umber-400 dark:hover:text-umber-200"
                  onClick={onContinue}
                >
                  {t("onboarding.extra_skip")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary btn-landing btn-lg relative mt-8 w-full overflow-hidden"
                onClick={onContinue}
              >
                <span
                  aria-hidden
                  className="btn-runner pointer-events-none absolute inset-y-0 left-0 bg-paper-50/15"
                />
                <span className="relative z-10">{t("onboarding.all_set_continue")}</span>
              </button>
            )}
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
        "min-h-tap rounded-xl border px-4 py-3 text-sm font-semibold transition",
        active
          ? "border-umber-900 bg-umber-900 text-paper-50 shadow-soft"
          : "border-paper-300 bg-paper-100 text-umber-800 hover:border-umber-500 hover:bg-paper-200 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-100 dark:hover:border-umber-500",
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
