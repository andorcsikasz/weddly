// Standalone tool page: /eszkozok/eskuvoi-ellenorzolista (HU canon), mirrors
// /tools/wedding-checklist for the EN slug. Same URL serves EN content
// client-side when the visitor's locale is en.
//
// Builds on top of PublicWeddingChecklist (the same widget that lives on the
// landing page) with SEO-tuned framing: a dedicated h1, the widget itself
// with every section open, a closing CTA back to signup, and an FAQ block
// that mirrors the FAQPage JSON-LD this page emits.

import { Link } from "react-router-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { PublicWeddingChecklist } from "../components/PublicWeddingChecklist";
import { PublicShell } from "../components/PublicShell";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function WeddingChecklistToolPage() {
  const { t, locale } = useT();
  // Title + description are also overridden server-side by seo_ssr.ts for
  // the HTML-only crawl pass — this hook just keeps the tab title in sync
  // for users who navigate client-side.
  useDocumentMeta("tools.wedding_checklist.page_h1", "tools.wedding_checklist.page_intro");

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.wedding_checklist.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.wedding_checklist.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.wedding_checklist.page_intro")}
          </p>
        </div>
      </section>

      {/* Every section starts open — this is the complete list, not a
          teaser, so a visitor searching for "esküvői ellenőrzőlista" lands on
          a genuinely useful page rather than a preview of the landing widget. */}
      <PublicWeddingChecklist previewSectionCount={11} showHeader={false} />

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.wedding_checklist.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.wedding_checklist.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.wedding_checklist.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.wedding_checklist.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {TOOL_FAQ[contentLocale(locale)].wedding_checklist.map((entry) => (
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
