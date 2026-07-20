// SEO tool: /eszkozok/ultetesi-rend-keszito — landing page for the
// /app/seating canvas, with the SEO content the in-app experience can't
// host (etiquette tips, print sizes, FAQ). Targets "ültetési rend program",
// "ültetési rend készítő ingyen", "wedding seating chart maker" and similar.
//
// No standalone widget here — the real canvas is /app/seating, which
// requires auth + a workspace to populate. This page sells the value and
// links to signup.

import { Link } from "react-router-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { SeatingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function SeatingChartPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.seating_chart.page_h1", "tools.seating_chart.page_intro");

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.seating_chart.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.seating_chart.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.page_intro")}
          </p>
        </div>
      </section>

      {/* Mockup band — uses the existing landing SeatingMockup so visitors
          see the actual canvas style before they sign up. */}
      <section className="relative overflow-hidden bg-paper-100 dark:bg-umber-900">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="origin-bottom mx-auto max-w-3xl drop-shadow-[0_20px_40px_rgba(16,24,48,0.14)]">
            <SeatingMockup className="h-auto w-full" />
          </div>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.what_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.what_body")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.print_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.print_body")}
          </p>
          <ul className="mt-6 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.seating_chart.print_li_a4")}</li>
            <li>{t("tools.seating_chart.print_li_a6")}</li>
            <li>{t("tools.seating_chart.print_li_a3")}</li>
          </ul>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.etiquette_h2")}
          </h2>
          <ul className="mt-8 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.seating_chart.etiquette_li_1")}</li>
            <li>{t("tools.seating_chart.etiquette_li_2")}</li>
            <li>{t("tools.seating_chart.etiquette_li_3")}</li>
            <li>{t("tools.seating_chart.etiquette_li_4")}</li>
          </ul>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.seating_chart.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {TOOL_FAQ[locale].seating_chart.map((entry) => (
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
