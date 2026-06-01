// Interactive "try-it" widget for the landing page. Pure client state — no
// backend, no auth. The breakdown uses ratios curated for the landing demo
// (see DEMO_ROWS below); the real Budget page after signup uses a more
// granular DEFAULT_BUDGET_SPLIT. The handoff carries only the chosen guest
// count + total budget into the onboarding draft.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Currency } from "@shared/types";
import { formatMoney, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";

const MIN_GUESTS = 20;
const MAX_GUESTS = 250;
const DEFAULT_GUESTS = 80;

// Per-currency slider bounds. HU range covers the 3–12M Ft realistic span
// (sub-3M can't cover catering, 12M+ is the long tail). EUR/USD ranges are
// rough EN-market equivalents — wide enough that any visitor finds their
// number in the first drag, narrow enough that each tick feels meaningful.
type BudgetRange = { min: number; max: number; step: number; default: number };
const BUDGET_RANGES: Record<Currency, BudgetRange> = {
  HUF: { min: 3_000_000, max: 12_000_000, step: 100_000, default: 6_000_000 },
  EUR: { min: 8_000, max: 60_000, step: 500, default: 25_000 },
  USD: { min: 10_000, max: 80_000, step: 500, default: 30_000 },
};

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
  // Currency follows the UI locale: HU → HUF, everything else → EUR.
  const currency = localeCurrency(locale);
  const range = BUDGET_RANGES[currency];
  const [guests, setGuests] = useState(DEFAULT_GUESTS);
  const [budget, setBudget] = useState(range.default);

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
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 lg:py-12">
        <div className="text-center">
          {/* Eyebrow + descriptive body stay on tablet+, hidden on phones
           *  where they were three uppercase lines plus a 3-line paragraph
           *  before the first slider, pushing the whole demo below the
           *  fold. The title alone carries the hook on mobile. */}
          <p className="hidden text-[11px] font-semibold uppercase tracking-[0.32em] text-blush-700 sm:block dark:text-blush-300">
            {t("landing.demo_eyebrow")}
          </p>
          <h2 className="font-grotesk text-xl font-semibold leading-[1.15] tracking-tight text-umber-900 sm:mt-2.5 sm:text-3xl lg:text-4xl dark:text-paper-50">
            {t("landing.demo_title")}
          </h2>
        </div>

        <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 md:grid-cols-[1fr_1.2fr] md:items-start md:gap-8 lg:gap-10">
          {/* Controls */}
          <div className="space-y-4 sm:space-y-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="demo-guests"
                  className="font-grotesk text-base text-umber-900 dark:text-paper-50"
                >
                  {t("landing.demo_guests_label")}
                </label>
                <span className="font-grotesk text-lg font-semibold tabular-nums text-blush-700 dark:text-blush-300">
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
                className="mt-1.5 w-full rounded accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 sm:mt-2"
                aria-label={t("landing.demo_guests_label")}
                aria-valuetext={`${guests}`}
              />
              <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-umber-600 sm:text-[11px] dark:text-umber-300">
                <span>{MIN_GUESTS}</span>
                <span>{MAX_GUESTS}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="demo-budget"
                  className="font-grotesk text-base text-umber-900 dark:text-paper-50"
                >
                  {t("landing.demo_budget_label")}
                </label>
                <span className="font-grotesk text-lg font-semibold tabular-nums text-blush-700 dark:text-blush-300">
                  {formatMoney(budget, currency, locale)}
                </span>
              </div>
              <input
                id="demo-budget"
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={budget}
                onChange={(e) => setBudget(clamp(Number(e.target.value), range.min, range.max))}
                className="mt-1.5 w-full rounded accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 sm:mt-2"
                aria-label={t("landing.demo_budget_label")}
                aria-valuetext={formatMoney(budget, currency, locale)}
              />
              <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-umber-600 sm:text-[11px] dark:text-umber-300">
                <span>{formatMoney(range.min, currency, locale)}</span>
                <span>{formatMoney(range.max, currency, locale)}</span>
              </div>
            </div>

            {/* Per-guest tile: vertically centred row (the prior
             *  `items-baseline` left the eyebrow falling off the numeral
             *  baseline; per the user's "boxes always vertically center"
             *  rule, switch to `items-center` and pin a fixed h-12 so the
             *  tile stops growing when HUF formatting wraps long). */}
            <div className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 ring-1 ring-paper-300 dark:bg-umber-800 dark:ring-umber-700">
              <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.24em] text-umber-600 dark:text-umber-300">
                {t("landing.demo_per_guest_label")}
              </p>
              <p className="ml-auto font-grotesk text-xl text-umber-900 sm:text-2xl lg:text-3xl dark:text-paper-50">
                {formatMoney(perGuest, currency, locale)}
              </p>
            </div>

            <div>
              <Link
                to={signupHref}
                onClick={() => stashDraft(guests, budget)}
                className="btn-primary btn-lifted btn-landing w-full"
              >
                {t("landing.demo_cta")}
              </Link>
            </div>
          </div>

          {/* Live bars. All label/amount rows use `items-center` (not
           *  `items-baseline`) per the user's universal "boxes always
           *  vertically center text" rule. Padding tightens to `p-4` on
           *  phones to match the new section pace. */}
          <div className="rounded-2xl bg-white p-4 shadow-pop ring-1 ring-paper-300 sm:p-6 dark:bg-umber-800 dark:ring-umber-700">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                {t("landing.demo_breakdown_eyebrow")}
              </p>
              <p className="text-right font-grotesk text-xs italic leading-tight text-umber-600 sm:text-sm dark:text-umber-300">
                {t("landing.demo_breakdown_sub")}
              </p>
            </div>
            <ul className="mt-4 space-y-2.5">
              {rows.map((row) => (
                <li key={row.i18nKey}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-grotesk text-sm text-umber-900 dark:text-paper-100">
                      {t(row.i18nKey)}
                    </span>
                    <span className="font-grotesk text-sm tabular-nums text-umber-800 dark:text-paper-100">
                      {formatMoney(row.amount, currency, locale)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                    <div
                      className="h-full rounded-full bg-blush-500 transition-[width] duration-300 ease-out"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-paper-300 pt-3 dark:border-umber-700">
              <div className="flex items-center justify-between">
                <span className="font-grotesk text-base text-umber-900 dark:text-paper-50">
                  {t("landing.demo_total_label")}
                </span>
                <span className="font-grotesk text-lg tabular-nums text-umber-900 dark:text-paper-50">
                  {formatMoney(budget, currency, locale)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
