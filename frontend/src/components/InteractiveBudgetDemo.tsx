// Interactive "try-it" widget for the landing page. Mirrors the real budget
// page: same DEFAULT_BUDGET_SPLIT, same formatHuf, same per-guest framing —
// so a visitor who likes it can sign up and find an identical-shape Budget
// page seeded from the same numbers via URL params.
//
// No backend, no auth. Pure client state. Keep it under one screen on
// mobile so it doesn't feel like a separate page.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BudgetCategory } from "@shared/types";
import { DEFAULT_BUDGET_SPLIT } from "@shared/types";
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

// Display rows. Each row is one bar; `shareOf` lists the BudgetCategory
// keys whose shares from DEFAULT_BUDGET_SPLIT sum into that row. We collapse
// catering+drinks under one "vendéglátás" bar (which is how HU couples
// actually think about it) so the tail "other" bar stays small relative to
// the featured rows — otherwise it grows large enough to dominate the chart.
type DemoRow = {
  /** i18n key suffix under `budget.cat.*` for the bar label. */
  label: BudgetCategory;
  /** Categories whose DEFAULT_BUDGET_SPLIT shares sum into this row. */
  shareOf: BudgetCategory[];
};

const FEATURED_ROWS: DemoRow[] = [
  { label: "venue", shareOf: ["venue"] },
  { label: "catering", shareOf: ["catering", "drinks"] },
  { label: "photo_video", shareOf: ["photo_video"] },
  { label: "attire", shareOf: ["attire"] },
  { label: "decor_floral", shareOf: ["decor_floral"] },
  { label: "music_dj", shareOf: ["music_dj"] },
  { label: "honeymoon", shareOf: ["honeymoon"] },
];

// Everything not pulled into a featured row falls into "Egyéb". With the
// list above this is ~14% of the total — small enough to feel like a tail.
const OTHER_CATS: BudgetCategory[] = [
  "cake_dessert",
  "hair_makeup",
  "transport",
  "stationery",
  "favours",
  "rings",
  "other",
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

  // Compute per-category HUF using the same split the onboarding wizard
  // uses. Featured rows sum the shares of their `shareOf` keys; the residual
  // (OTHER_CATS) lands in a single "other" tail row.
  const rows = useMemo(() => {
    const featured = FEATURED_ROWS.map((row) => {
      const share = row.shareOf.reduce((s, c) => s + DEFAULT_BUDGET_SPLIT[c], 0);
      return { cat: row.label, amount: Math.round(budget * share) };
    });
    const otherShare = OTHER_CATS.reduce((s, c) => s + DEFAULT_BUDGET_SPLIT[c], 0);
    const otherAmount = Math.round(budget * otherShare);
    const all = [...featured, { cat: "other" as BudgetCategory, amount: otherAmount }];
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
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
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
                <li key={row.cat}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-sm text-ink-800 dark:text-paper-100 sm:text-base">
                      {t(`budget.cat.${row.cat}`)}
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
