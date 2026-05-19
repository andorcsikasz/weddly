// Standalone tool page: /eszkozok/eskuvo-koltsegvetes-kalkulator (HU canon).
// Same URL serves EN content client-side when the user's locale is en.
//
// Builds on top of the existing InteractiveBudgetDemo (the same widget that
// lives on the landing page) but wraps it in SEO-tuned framing: a dedicated
// h1, an averages section anchoring "mennyibe kerül egy esküvő 2026-ban",
// breakdown ratios, a tips block, a CTA back to signup, and an FAQ block
// that mirrors the FAQPage JSON-LD this page emits.
//
// The widget itself is unchanged — same draft handoff into onboarding, same
// curated breakdown ratios — so a visitor who plays here gets the exact
// numbers they'd see on the landing demo.

import { Link } from "react-router-dom";
import { InteractiveBudgetDemo } from "../components/InteractiveBudgetDemo";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function BudgetCalculatorPage() {
  const { t } = useT();
  // Title + description are also overridden server-side by seo_ssr.ts for
  // the HTML-only crawl pass — this hook just keeps the tab title in sync
  // for users who navigate client-side.
  useDocumentMeta(
    "tools.budget_calculator.page_h1",
    "tools.budget_calculator.page_intro",
  );

  return (
    <PublicShell>
      {/* Hero — eyebrow, h1, intro paragraph. Keeps Tailwind-styled
          parity with the rest of the public pages. */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.budget_calculator.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-serif text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.budget_calculator.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.budget_calculator.page_intro")}
          </p>
        </div>
      </section>

      {/* The widget — same one the landing uses. Its internal CTA writes
          the visitor's guest count + budget into the onboarding draft, so
          the handoff is identical whether they came from the landing or
          this dedicated tool URL. */}
      <InteractiveBudgetDemo />

      {/* Averages + source note — anchors the "mennyibe kerül" search
          intent with concrete numbers Google can excerpt as a snippet. */}
      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.budget_calculator.averages_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.budget_calculator.averages_body")}
          </p>
          <p className="mt-4 text-xs italic text-ink-500 dark:text-umber-300">
            {t("tools.budget_calculator.averages_source_note")}
          </p>
        </div>
      </section>

      {/* Ratios — the category breakdown summary. Same numbers as the
          widget renders; the prose version is what Google reads. */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.budget_calculator.ratios_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.budget_calculator.ratios_body")}
          </p>
        </div>
      </section>

      {/* Tips — three short reminders. As a list, both for SEO (lists
          often get featured-snippet treatment) and to break up the page. */}
      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.budget_calculator.tips_h2")}
          </h2>
          <ul className="mt-6 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.budget_calculator.tips_li_1")}</li>
            <li>{t("tools.budget_calculator.tips_li_2")}</li>
            <li>{t("tools.budget_calculator.tips_li_3")}</li>
          </ul>
        </div>
      </section>

      {/* CTA — the "continue in Weddly" button. The numbers from the
          calculator are already in localStorage at this point (stashDraft
          fires on every change), so onboarding picks them up after signup. */}
      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.budget_calculator.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.budget_calculator.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.budget_calculator.cta_button")}
          </Link>
        </div>
      </section>

      {/* FAQ — same shape as the landing FAQ. <details>/<summary> rather
          than a custom accordion so the markup survives SSR + is friendly
          to screen readers without JS. */}
      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.budget_calculator.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {[
              {
                q: t("tools.budget_calculator.faq_q1"),
                a: t("tools.budget_calculator.faq_a1"),
              },
              {
                q: t("tools.budget_calculator.faq_q2"),
                a: t("tools.budget_calculator.faq_a2"),
              },
              {
                q: t("tools.budget_calculator.faq_q3"),
                a: t("tools.budget_calculator.faq_a3"),
              },
              {
                q: t("tools.budget_calculator.faq_q4"),
                a: t("tools.budget_calculator.faq_a4"),
              },
            ].map((entry) => (
              <details
                key={entry.q}
                className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
              >
                <summary className="cursor-pointer list-none font-serif text-xl text-ink-900 dark:text-paper-50">
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
