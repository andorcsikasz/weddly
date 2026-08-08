// Interactive "try-it" widget for the landing page. Pure client state — no
// backend, no auth. The breakdown uses ratios curated for the landing demo
// (see DEMO_ROWS_HU / DEMO_ROWS_EU below); the real Budget page after signup uses a more
// granular DEFAULT_BUDGET_SPLIT. The handoff carries only the chosen guest
// count + total budget into the onboarding draft.

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { scaleFromEur } from "@shared/currency";
import type { Currency } from "@shared/types";
import { formatMoney, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";
import { VendorDirectoryTeaser } from "./VendorDirectoryTeaser";

const MIN_GUESTS = 20;
const MAX_GUESTS = 250;
const DEFAULT_GUESTS = 80;
// HU market default — a 100-guest wedding on a 7.2M Ft budget (→ 72 000 Ft /
// guest) is the typical Hungarian starting point, so HU visitors land on a
// realistic number without dragging. EN/EUR keeps the generic 80-guest default.
const DEFAULT_GUESTS_HU = 100;

// Per-currency slider bounds. HU range covers the 3–12M Ft realistic span
// (sub-3M can't cover catering, 12M+ is the long tail). EUR/USD ranges are
// rough EN-market equivalents — wide enough that any visitor finds their
// number in the first drag, narrow enough that each tick feels meaningful.
// These three are hand-tuned to their market; every other currency scales off
// the EUR row via `scaleFromEur` (see `budgetRange`).
type BudgetRange = { min: number; max: number; step: number; default: number };
const TUNED_BUDGET_RANGES: Partial<Record<Currency, BudgetRange>> = {
  HUF: { min: 3_000_000, max: 12_000_000, step: 100_000, default: 7_200_000 },
  EUR: { min: 8_000, max: 60_000, step: 500, default: 25_000 },
  USD: { min: 10_000, max: 80_000, step: 500, default: 30_000 },
};
const EUR_BUDGET_RANGE = TUNED_BUDGET_RANGES.EUR!;

function budgetRange(currency: Currency): BudgetRange {
  const tuned = TUNED_BUDGET_RANGES[currency];
  if (tuned) return tuned;
  return {
    min: scaleFromEur(EUR_BUDGET_RANGE.min, currency),
    max: scaleFromEur(EUR_BUDGET_RANGE.max, currency),
    // 1 significant digit: the step is a stride, not a figure anyone reads,
    // and a "nice" stride keeps every slider stop a round number.
    step: scaleFromEur(EUR_BUDGET_RANGE.step, currency, 1),
    default: scaleFromEur(EUR_BUDGET_RANGE.default, currency),
  };
}

// Curated breakdown ratios. Order = display order (the reserve bucket lives at
// the end because it is conceptually a buffer rather than a spend line). Each
// set sums to 1.00. HU and EU deliberately DIFFER: Hungarian weddings skew more
// catering-heavy (venue often bundles the catering, so the standalone venue line
// is smaller and food/drink + music carry more), while the European split puts
// a bigger standalone share on the venue.
type DemoRow = {
  /** Locale key (under `landing.*`) for the bar label. */
  i18nKey: string;
  /** Share of the total budget — sums to 1 across the array. */
  share: number;
};

// European averages (shown for EUR/USD).
const DEMO_ROWS_EU: DemoRow[] = [
  { i18nKey: "landing.demo_cat_food_drinks", share: 0.33 },
  { i18nKey: "landing.demo_cat_venue", share: 0.2 },
  { i18nKey: "landing.demo_cat_photo_video", share: 0.13 },
  { i18nKey: "landing.demo_cat_decor_floral", share: 0.1 },
  { i18nKey: "landing.demo_cat_attire_beauty", share: 0.08 },
  { i18nKey: "landing.demo_cat_music_dj", share: 0.06 },
  { i18nKey: "landing.demo_cat_ceremony_services", share: 0.05 },
  { i18nKey: "landing.demo_cat_stationery_smalls", share: 0.02 },
  { i18nKey: "landing.demo_cat_reserve", share: 0.03 },
];

// Hungarian averages (shown for HUF) — catering-heavier, smaller standalone venue.
const DEMO_ROWS_HU: DemoRow[] = [
  { i18nKey: "landing.demo_cat_food_drinks", share: 0.4 },
  { i18nKey: "landing.demo_cat_venue", share: 0.15 },
  { i18nKey: "landing.demo_cat_photo_video", share: 0.12 },
  { i18nKey: "landing.demo_cat_decor_floral", share: 0.08 },
  { i18nKey: "landing.demo_cat_attire_beauty", share: 0.07 },
  { i18nKey: "landing.demo_cat_music_dj", share: 0.08 },
  { i18nKey: "landing.demo_cat_ceremony_services", share: 0.04 },
  { i18nKey: "landing.demo_cat_stationery_smalls", share: 0.02 },
  { i18nKey: "landing.demo_cat_reserve", share: 0.04 },
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

// ── Count-up on first view ──────────────────────────────────────────────────
// The breakdown is the moment the demo makes its point, so the figures ramp
// from zero the first time a visitor actually looks at them. Once per browser
// session, not once per page view: a visitor who bounces between the landing
// and /eszkozok has already seen the trick, and replaying it every time reads
// as a page that can't sit still.

const COUNTUP_SESSION_KEY = "weddly.demo_countup_played";
const COUNTUP_MS = 1100;

// Backstop for the case sessionStorage throws (private mode, blocked storage):
// the module lives as long as the tab does, so the animation still runs at most
// once per load rather than on every remount.
let countUpPlayedThisLoad = false;

function countUpAlreadyPlayed(): boolean {
  if (countUpPlayedThisLoad) return true;
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(COUNTUP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markCountUpPlayed(): void {
  countUpPlayedThisLoad = true;
  try {
    window.sessionStorage.setItem(COUNTUP_SESSION_KEY, "1");
  } catch {
    // Storage unavailable — the module flag above is the whole guard then.
  }
}

/**
 * Progress ramp from 0 to 1, started the first time `ref`'s element scrolls
 * into view. Returns 1 straight away on a later visit in the same session,
 * when the visitor asked for reduced motion, and when there is no
 * IntersectionObserver, so the figures are simply correct rather than absent.
 *
 * Point it at an element that is hidden while the numbers are hidden (on
 * phones the breakdown list starts collapsed). A `display:none` element never
 * intersects, so the ramp waits for the visitor to open it instead of playing
 * to nobody.
 */
function useCountUpOnView(ref: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(() => (countUpAlreadyPlayed() ? 1 : 0));
  const startedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || startedRef.current) return;
    if (countUpAlreadyPlayed()) {
      setProgress(1);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      markCountUpPlayed();
      setProgress(1);
      return;
    }

    let raf = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        startedRef.current = true;
        markCountUpPlayed();
        const startedAt = performance.now();
        const tick = (nowMs: number) => {
          const linear = Math.min(1, (nowMs - startedAt) / COUNTUP_MS);
          if (linear < 1) {
            // easeOutCubic: quick off the mark, then settles onto the figure
            // rather than snapping to it.
            setProgress(1 - (1 - linear) ** 3);
            raf = requestAnimationFrame(tick);
          } else {
            setProgress(1);
          }
        };
        raf = requestAnimationFrame(tick);
      },
      // A third of the card in view: enough that the visitor is looking at it,
      // little enough that a tall card on a short phone still triggers.
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref]);

  return progress;
}

export function InteractiveBudgetDemo({
  vendorTeaser = false,
}: {
  /** Append the directory rail under the calculator: the visitor has just
   *  decided what they'd spend per category, so "here is who you'd spend it
   *  with, sign up to see all of them" converts better than a bare register
   *  ask. Opt-in because the landing already has its own conversion path;
   *  today only the /eszkozok budget-calculator tool page turns it on. */
  vendorTeaser?: boolean;
}) {
  const { t, locale } = useT();
  // Currency follows the UI locale: HU → HUF, everything else → EUR.
  const currency = localeCurrency(locale);
  const range = budgetRange(currency);
  const [guests, setGuests] = useState(locale === "hu" ? DEFAULT_GUESTS_HU : DEFAULT_GUESTS);
  const [budget, setBudget] = useState(range.default);
  // The breakdown is a tall list; on phones it starts collapsed so the demo
  // controls stay above the fold. The header toggles it. On sm+ it's always
  // shown (the toggle + chevron are hidden there).
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Reset the figures to the market's defaults when the UI locale flips at
  // runtime (HU ↔ EN). useState only seeds the FIRST render, so without this a
  // visitor toggling to Hungarian would keep the euro budget shown as
  // "25 000 Ft" instead of a realistic Ft figure.
  useEffect(() => {
    setBudget(budgetRange(currency).default);
    setGuests(locale === "hu" ? DEFAULT_GUESTS_HU : DEFAULT_GUESTS);
  }, [currency, locale]);

  // HU and EU use different curated breakdowns (see the row tables above).
  const demoRows = currency === "HUF" ? DEMO_ROWS_HU : DEMO_ROWS_EU;

  // Multiply each curated share by the chosen total, then normalise bar
  // widths against the largest row so the chart reads at a glance.
  const rows = useMemo(() => {
    const all = demoRows.map((row) => ({
      i18nKey: row.i18nKey,
      amount: Math.round(budget * row.share),
    }));
    const maxAmount = all.reduce((m, r) => Math.max(m, r.amount), 0);
    return all.map((r) => ({
      ...r,
      pct: maxAmount === 0 ? 0 : Math.round((r.amount / maxAmount) * 100),
    }));
  }, [budget, demoRows]);

  const perGuest = guests === 0 ? 0 : Math.round(budget / guests);

  // Ramp the breakdown figures (and their bars) up from zero on first sight.
  // Applied as a multiplier rather than a second copy of the numbers, so a
  // visitor who grabs a slider mid-ramp keeps getting live figures.
  const breakdownRef = useRef<HTMLUListElement | null>(null);
  const countUp = useCountUpOnView(breakdownRef);

  const signupHref = `/signup?guests=${guests}&budget=${budget}`;

  return (
    <section id="try-it" className="relative overflow-x-clip bg-paper-50 dark:bg-umber-900">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-10 lg:py-12">
        <div className="text-center">
          <h2 className="font-grotesk text-xl font-semibold leading-[1.15] tracking-tight text-umber-900 sm:text-3xl lg:text-4xl dark:text-paper-50">
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
                <span className="font-grotesk text-lg font-semibold tabular-nums text-umber-500 dark:text-umber-300">
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
                className="mt-1.5 min-h-tap w-full touch-pan-y cursor-pointer rounded accent-umber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-umber-500 sm:mt-2 sm:min-h-0"
                aria-label={t("landing.demo_guests_label")}
                aria-valuetext={`${guests}`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="demo-budget"
                  className="font-grotesk text-base text-umber-900 dark:text-paper-50"
                >
                  {t("landing.demo_budget_label")}
                </label>
                <span className="font-grotesk text-lg font-semibold tabular-nums text-umber-500 dark:text-umber-300">
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
                className="mt-1.5 min-h-tap w-full touch-pan-y cursor-pointer rounded accent-umber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-umber-500 sm:mt-2 sm:min-h-0"
                aria-label={t("landing.demo_budget_label")}
                aria-valuetext={formatMoney(budget, currency, locale)}
              />
            </div>

            {/* Per-guest tile: vertically centred row (the prior
             *  `items-baseline` left the eyebrow falling off the numeral
             *  baseline; per the user's "boxes always vertically center"
             *  rule, switch to `items-center` and pin a fixed h-12 so the
             *  tile stops growing when HUF formatting wraps long). */}
            <div className="flex h-12 items-center gap-3 rounded-xl bg-white px-4 ring-1 ring-paper-300 dark:bg-umber-800 dark:ring-umber-700">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.24em] text-umber-600 dark:text-umber-300">
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
            {/* Header doubles as the collapse toggle on phones (sm:hidden
             *  chevron); on sm+ it's a static, non-interactive label. */}
            <button
              type="button"
              onClick={() => setBreakdownOpen((o) => !o)}
              aria-expanded={breakdownOpen}
              className="flex w-full items-center justify-between gap-3 text-left sm:pointer-events-none"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
                {t("landing.demo_breakdown_eyebrow")}
              </p>
              <span className="flex items-center gap-2">
                <span className="text-right font-grotesk text-xs italic leading-tight text-umber-600 sm:text-sm dark:text-umber-300">
                  {t("landing.demo_breakdown_sub")}
                </span>
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className={`shrink-0 text-umber-500 transition-transform sm:hidden dark:text-umber-300 ${
                    breakdownOpen ? "" : "-rotate-90"
                  }`}
                />
              </span>
            </button>
            <ul
              ref={breakdownRef}
              className={`mt-4 space-y-2.5 sm:block ${breakdownOpen ? "" : "hidden"}`}
            >
              {rows.map((row) => (
                <li key={row.i18nKey}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-grotesk text-sm text-umber-900 dark:text-paper-100">
                      {t(row.i18nKey)}
                    </span>
                    <span className="font-grotesk text-sm tabular-nums text-umber-800 dark:text-paper-100">
                      {formatMoney(Math.round(row.amount * countUp), currency, locale)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
                    {/* The width transition is what smooths a slider drag. It
                        would only lag behind the count-up, which already
                        drives the width every frame, so it stays off until
                        the ramp finishes. */}
                    <div
                      className={`h-full rounded-full bg-umber-400 ${
                        countUp === 1 ? "transition-[width] duration-300 ease-out" : ""
                      }`}
                      style={{ width: `${row.pct * countUp}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div
              className={`mt-4 border-t border-paper-300 pt-3 sm:block dark:border-umber-700 ${
                breakdownOpen ? "" : "hidden"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-grotesk text-base text-umber-900 dark:text-paper-50">
                  {t("landing.demo_total_label")}
                </span>
                <span className="font-grotesk text-lg tabular-nums text-umber-900 dark:text-paper-50">
                  {formatMoney(Math.round(budget * countUp), currency, locale)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Same signup href + draft stash as the button above, so a visitor who
            converts from the rail keeps the guest count and budget they just
            set. */}
        {vendorTeaser && (
          <VendorDirectoryTeaser
            signupHref={signupHref}
            onSignupClick={() => stashDraft(guests, budget)}
          />
        )}
      </div>
    </section>
  );
}
