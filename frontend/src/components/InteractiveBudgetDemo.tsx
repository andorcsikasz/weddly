// Interactive "try-it" widget for the landing page. Pure client state — no
// backend, no auth. The breakdown uses ratios curated for the landing demo
// (see DEMO_ROWS below); the real Budget page after signup uses a more
// granular DEFAULT_BUDGET_SPLIT. The handoff carries only the chosen guest
// count + total budget into the onboarding draft.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";

const MIN_GUESTS = 20;
const MAX_GUESTS = 250;
const DEFAULT_GUESTS = 80;

// Range tuned for the Hungarian market — anything under 3M is unrealistic
// for a wedding with catering, and anything over 12M is the long tail. A
// tighter range makes the slider feel meaningful on every drag.
const MIN_BUDGET = 3_000_000;
const MAX_BUDGET = 12_000_000;
const BUDGET_STEP = 100_000;
const DEFAULT_BUDGET = 6_000_000;

// Curated breakdown ratios for HU weddings. Order = display order (the
// reserve bucket lives at the end because it is conceptually a buffer
// rather than a spend line). Shares sum to 1.00.
type DemoRow = {
  /** Locale key (under `landing.*`) for the bar label. */
  i18nKey: string;
  /** Share of the total budget — sums to 1 across the array. */
  share: number;
};

const DEMO_ROWS: DemoRow[] = [
  { i18nKey: "landing.demo_cat_food_drinks", share: 0.35 },
  { i18nKey: "landing.demo_cat_venue", share: 0.18 },
  { i18nKey: "landing.demo_cat_photo_video", share: 0.13 },
  { i18nKey: "landing.demo_cat_decor_floral", share: 0.09 },
  { i18nKey: "landing.demo_cat_attire_beauty", share: 0.08 },
  { i18nKey: "landing.demo_cat_music_dj", share: 0.07 },
  { i18nKey: "landing.demo_cat_ceremony_services", share: 0.05 },
  { i18nKey: "landing.demo_cat_stationery_smalls", share: 0.02 },
  { i18nKey: "landing.demo_cat_reserve", share: 0.03 },
];

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

// Mirrored from OnboardingWizard — keep in sync if it ever moves. Stashing a
// partial draft here so the wizard's existing loadDraft() picks up the
// visitor's demo numbers after they finish signup + email verify.
const ONBOARDING_DRAFT_KEY = "weddly.onboarding_draft";

function stashDraft(guests: number, budget: number) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        ...existing,
        guest_kind: "exact",
        guest_exact: String(guests),
        budget_kind: "exact",
        budget_exact: String(budget),
      }),
    );
  } catch {
    // localStorage can throw in private mode / quota — silent fallback. The
    // URL params on the CTA still carry the intent.
  }
}

export function InteractiveBudgetDemo() {
  const { t, locale } = useT();
  const [guests, setGuests] = useState(DEFAULT_GUESTS);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);

  // Multiply each curated share by the chosen total, then normalise bar
  // widths against the largest row so the chart reads at a glance.
  const rows = useMemo(() => {
    const all = DEMO_ROWS.map((row) => ({
      i18nKey: row.i18nKey,
      amount: Math.round(budget * row.share),
    }));
    const maxAmount = all.reduce((m, r) => Math.max(m, r.amount), 0);
    return all.map((r) => ({
      ...r,
      pct: maxAmount === 0 ? 0 : Math.round((r.amount / maxAmount) * 100),
    }));
  }, [budget]);

  const perGuest = guests === 0 ? 0 : Math.round(budget / guests);

  const signupHref = `/signup?guests=${guests}&budget=${budget}`;

  return (
    <section
      id="try-it"
      className="relative overflow-hidden bg-paper-50 dark:bg-umber-900 border-y border-paper-300 dark:border-umber-700"
    >
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("landing.demo_eyebrow")}
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.demo_title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-ink-600 dark:text-umber-200 sm:text-base">
            {t("landing.demo_body")}
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start lg:gap-12">
          {/* Controls */}
          <div className="space-y-8">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="demo-guests"
                  className="font-serif text-base text-ink-900 dark:text-paper-50"
                >
                  {t("landing.demo_guests_label")}
                </label>
                <span className="font-serif text-2xl italic text-blush-700 dark:text-blush-300">
                  {guests}
                </span>
              </div>
              <input
                id="demo-guests"
                type="range"
                min={MIN_GUESTS}
                max={MAX_GUESTS}
                step={1}
                value={guests}
                onChange={(e) => setGuests(clamp(Number(e.target.value), MIN_GUESTS, MAX_GUESTS))}
                className="mt-3 w-full accent-blush-600"
                aria-label={t("landing.demo_guests_label")}
              />
              <div className="mt-1 flex justify-between text-xs text-ink-500 dark:text-umber-300">
                <span>{MIN_GUESTS}</span>
                <span>{MAX_GUESTS}</span>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="demo-budget"
                  className="font-serif text-base text-ink-900 dark:text-paper-50"
                >
                  {t("landing.demo_budget_label")}
                </label>
                <span className="font-serif text-2xl italic text-blush-700 dark:text-blush-300">
                  {formatHuf(budget, locale)}
                </span>
              </div>
              <input
                id="demo-budget"
                type="range"
                min={MIN_BUDGET}
                max={MAX_BUDGET}
                step={BUDGET_STEP}
                value={budget}
                onChange={(e) => setBudget(clamp(Number(e.target.value), MIN_BUDGET, MAX_BUDGET))}
                className="mt-3 w-full accent-blush-600"
                aria-label={t("landing.demo_budget_label")}
              />
              <div className="mt-1 flex justify-between text-xs text-ink-500 dark:text-umber-300">
                <span>{formatHuf(MIN_BUDGET, locale)}</span>
                <span>{formatHuf(MAX_BUDGET, locale)}</span>
              </div>
            </div>

            <div className="rounded-2xl bg-white dark:bg-umber-800 p-5 ring-1 ring-paper-300 dark:ring-umber-700">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 dark:text-umber-300">
                {t("landing.demo_per_guest_label")}
              </p>
              <p className="mt-2 font-serif text-3xl text-ink-900 dark:text-paper-50 sm:text-4xl">
                {formatHuf(perGuest, locale)}
              </p>
              <p className="mt-1 font-serif text-sm italic text-ink-500 dark:text-umber-300">
                {t("landing.demo_per_guest_sub")}
              </p>
            </div>

            <div className="space-y-3">
              <Link
                to={signupHref}
                onClick={() => stashDraft(guests, budget)}
                className="btn-primary btn-lg w-full shadow-sm"
              >
                {t("landing.demo_cta")}
              </Link>
              <p className="text-center text-sm text-ink-500 dark:text-umber-300">
                <a
                  href="#phases"
                  className="font-serif italic underline-offset-4 hover:text-ink-700 hover:underline dark:hover:text-paper-100"
                >
                  {t("landing.demo_cta_secondary")}
                </a>
              </p>
            </div>
            <p className="text-xs text-ink-500 dark:text-umber-300">
              {t("landing.demo_disclaimer")}
            </p>
          </div>

          {/* Live bars */}
          <div className="rounded-2xl bg-white dark:bg-umber-800 p-6 ring-1 ring-paper-300 dark:ring-umber-700 shadow-pop sm:p-8">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                {t("landing.demo_breakdown_eyebrow")}
              </p>
              <p className="font-serif text-sm italic text-ink-500 dark:text-umber-300">
                {t("landing.demo_breakdown_sub")}
              </p>
            </div>
            <ul className="mt-5 space-y-4">
              {rows.map((row) => (
                <li key={row.i18nKey}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-sm text-ink-800 dark:text-paper-100 sm:text-base">
                      {t(row.i18nKey)}
                    </span>
                    <span className="font-serif text-sm text-ink-700 dark:text-paper-100 tabular-nums sm:text-base">
                      {formatHuf(row.amount, locale)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                    <div
                      className="h-full rounded-full bg-blush-500 transition-[width] duration-300 ease-out"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-paper-300 dark:border-umber-700 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="font-serif text-base text-ink-900 dark:text-paper-50">
                  {t("landing.demo_total_label")}
                </span>
                <span className="font-serif text-xl text-ink-900 dark:text-paper-50 tabular-nums">
                  {formatHuf(budget, locale)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
