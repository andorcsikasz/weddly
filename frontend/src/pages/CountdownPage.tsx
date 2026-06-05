// SEO tool: /eszkozok/eskuvo-visszaszamlalo — pick a date, see months/weeks/
// days remaining + a milestone list. Targets "esküvő visszaszámláló",
// "mennyi nap van az esküvőig", "esküvő tervezési idővonal" and EN variants.
//
// Pure client state, no backend. The date picker localStorage-stashes the
// date as part of the onboarding draft (matching how InteractiveBudgetDemo
// hands off guests + budget), so a visitor who picks "2027-06-12" here and
// then registers gets the wizard pre-filled with that date.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const ONBOARDING_DRAFT_KEY = "weddly.onboarding_draft";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function stashDate(iso: string) {
  if (typeof window === "undefined" || !iso) return;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ ...existing, wedding_date: iso }),
    );
  } catch {
    // localStorage may be blocked — the CTA still works without the stash.
  }
}

function daysBetween(targetIso: string): number | null {
  if (!targetIso) return null;
  const target = new Date(`${targetIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

interface Breakdown {
  months: number;
  weeks: number;
  days: number;
}
function breakdown(totalDays: number): Breakdown {
  const abs = Math.abs(totalDays);
  // Months ≈ 30.44 days (365.25 / 12). Good-enough for a UI breakdown — we
  // also display the raw day count, which is what users actually plan on.
  const months = Math.floor(abs / 30.44);
  const remAfterMonths = abs - Math.floor(months * 30.44);
  const weeks = Math.floor(remAfterMonths / 7);
  const days = Math.max(0, Math.round(remAfterMonths - weeks * 7));
  return { months, weeks, days };
}

export default function CountdownPage() {
  const { t } = useT();
  useDocumentMeta("tools.countdown.page_h1", "tools.countdown.page_intro");

  const [iso, setIso] = useState("");
  const dayDelta = useMemo(() => daysBetween(iso), [iso]);
  const parts = useMemo(() => (dayDelta === null ? null : breakdown(dayDelta)), [dayDelta]);

  function onDateChange(value: string) {
    setIso(value);
    if (value) stashDate(value);
  }

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.countdown.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.countdown.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.countdown.page_intro")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <label className="block">
            <span className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-600 dark:text-paper-200">
              {t("tools.countdown.input_label")}
            </span>
            <input
              type="date"
              value={iso}
              onChange={(e) => onDateChange(e.target.value)}
              className="mt-3 w-full rounded-xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 px-4 py-3 text-lg text-ink-900 dark:text-paper-50 focus:outline-none focus:ring-2 focus:ring-ink-400"
            />
          </label>

          {dayDelta === null ? (
            <p className="mt-8 text-center text-ink-500 dark:text-umber-300">
              {t("tools.countdown.result_empty")}
            </p>
          ) : (
            <div className="mt-8 text-center">
              <p className="font-grotesk text-7xl leading-none text-ink-900 dark:text-paper-50 sm:text-8xl">
                {Math.abs(dayDelta).toLocaleString()}
              </p>
              <p className="mt-2 text-base text-ink-600 dark:text-paper-200">
                {Math.abs(dayDelta) === 1
                  ? t("tools.countdown.result_days_unit_one")
                  : t("tools.countdown.result_days_unit")}{" "}
                {dayDelta < 0
                  ? t("tools.countdown.result_passed")
                  : t("tools.countdown.result_until")}
              </p>
              {parts && (
                <p className="mt-6 text-sm text-ink-500 dark:text-umber-300">
                  {parts.months} {t("tools.countdown.breakdown_months")} · {parts.weeks}{" "}
                  {t("tools.countdown.breakdown_weeks")} · {parts.days}{" "}
                  {t("tools.countdown.breakdown_days")}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.countdown.milestones_h2")}
          </h2>
          <ul className="mt-8 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.countdown.milestone_12m")}</li>
            <li>{t("tools.countdown.milestone_9m")}</li>
            <li>{t("tools.countdown.milestone_6m")}</li>
            <li>{t("tools.countdown.milestone_3m")}</li>
            <li>{t("tools.countdown.milestone_1m")}</li>
            <li>{t("tools.countdown.milestone_1w")}</li>
          </ul>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.countdown.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.countdown.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.countdown.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.countdown.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {[
              { q: t("tools.countdown.faq_q1"), a: t("tools.countdown.faq_a1") },
              { q: t("tools.countdown.faq_q2"), a: t("tools.countdown.faq_a2") },
              { q: t("tools.countdown.faq_q3"), a: t("tools.countdown.faq_a3") },
            ].map((entry) => (
              <details
                key={entry.q}
                className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
              >
                <summary className="cursor-pointer list-none font-grotesk text-xl text-ink-900 dark:text-paper-50">
                  {entry.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
                  {entry.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
